import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { pilotRates as rates, quotePilotRequest, settlePilotUsage } from "./pricing";

export const pilotManifestSchema = z.object({
  version: z.literal(1),
  approvalRef: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  budgetUsd: z.number().positive().max(50),
  expiresAt: z.string().datetime(),
}).strict();
export type PilotManifest = z.infer<typeof pilotManifestSchema>;

// Conservative default-tier upper rates, NOT invoice prices. All four models
// must be rechecked against official pricing before an approved pilot starts.
// Input allowances cover cache/long-context/regional uplifts; no other models,
// tiers, billable tools, streaming, or providers are accepted.
const entrySchema = z.object({
  id: z.string(), model: z.enum(["gpt-5.6-terra", "gpt-5.4", "gpt-4o-mini", "claude-sonnet-5"]),
  runId: z.string().optional(),
  state: z.enum(["reserved", "settled"]), reservedMicros: z.number().int().nonnegative(),
  accountedMicros: z.number().int().nonnegative(),
  searchUseCeiling: z.number().int().min(0).max(5),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reportedModel: z.string().max(200).optional(),
}).refine(entry => entry.state === "reserved"
  ? entry.accountedMicros === entry.reservedMicros
  : entry.inputTokens !== undefined && entry.outputTokens !== undefined && entry.accountedMicros <= entry.reservedMicros);
export const ledgerSchema = z.object({
  version: z.literal(1), manifestHash: z.string(), stopped: z.string().nullable(),
  entries: z.array(entrySchema),
});
export type Ledger = z.infer<typeof ledgerSchema>;
export class PilotBudgetError extends Error {
  constructor(public readonly code: string) { super(`Pilot spending guard stopped: ${code}`); }
}

/** Private, single-process pilot ledger. Never writes prompts, keys or headers. */
export class PilotBudgetGuard {
  private ledger: Ledger;
  private fault = false;
  private lockFd: number;
  private closed = false;
  private readonly controller = new AbortController();
  readonly manifest: PilotManifest;

  constructor(private readonly path: string, manifest: unknown, private readonly now = Date.now) {
    this.manifest = pilotManifestSchema.parse(manifest);
    const remaining = Date.parse(this.manifest.expiresAt) - now();
    if (remaining <= 0 || remaining > 3_600_000) throw new PilotBudgetError("INVALID_EXPIRY");
    const manifestHash = createHash("sha256").update(JSON.stringify({ manifest: this.manifest, rates, policyVersion: 1 })).digest("hex");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.lockFd = openSync(`${path}.lock`, "wx", 0o600);
    try {
      this.ledger = existsSync(path)
        ? ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8")))
        : { version: 1, manifestHash, stopped: null, entries: [] };
      if (this.ledger.manifestHash !== manifestHash) throw new PilotBudgetError("MANIFEST_CHANGED");
      if (this.ledger.entries.some(e => e.state === "reserved")) this.ledger.stopped = "UNRESOLVED_RESTART";
      if (this.usedMicros > this.limitMicros) throw new PilotBudgetError("INVALID_LEDGER");
      this.persist();
    } catch (error) {
      closeSync(this.lockFd); unlinkSync(`${path}.lock`); throw error;
    }
  }

  get limitMicros() { return Math.floor(this.manifest.budgetUsd * 1_000_000); }
  get usedMicros() { return this.ledger.entries.reduce((sum, e) => sum + e.accountedMicros, 0); }
  summary() {
    return { budgetUsd: this.manifest.budgetUsd, accountedUpperUsd: this.usedMicros / 1_000_000,
      remainingUsd: (this.limitMicros - this.usedMicros) / 1_000_000,
      requests: this.ledger.entries.length, unresolved: this.ledger.entries.filter(e => e.state === "reserved").length,
      stopped: this.ledger.stopped, expiresAt: this.manifest.expiresAt };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    closeSync(this.lockFd);
    unlinkSync(`${this.path}.lock`);
  }
  private persist() {
    try {
      const temporary = `${this.path}.tmp`;
      const fd = openSync(temporary, "w", 0o600);
      try { writeFileSync(fd, JSON.stringify(this.ledger)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.path);
      const dir = openSync(dirname(this.path), "r");
      try { fsyncSync(dir); } finally { closeSync(dir); }
    } catch {
      this.fault = true;
      this.controller.abort();
      throw new PilotBudgetError("LEDGER_WRITE_FAILED");
    }
  }
  private stop(code: string): never {
    this.ledger.stopped ||= code;
    this.controller.abort();
    this.persist();
    throw new PilotBudgetError(code);
  }
  private check() {
    if (this.closed || this.fault || this.ledger.stopped) throw new PilotBudgetError("ALREADY_STOPPED");
    if (this.now() >= Date.parse(this.manifest.expiresAt)) this.stop("EXPIRED");
  }
  wrap(transport: typeof fetch): typeof fetch {
    return async (input, init) => {
      let req = new Request(input, init);
      const url = new URL(req.url);
      const provider = url.origin === "https://api.openai.com" ? "openai"
        : url.origin === "https://api.anthropic.com" ? "anthropic" : null;
      if (!provider) {
        if (/\/(chat\/completions|responses|messages)$/.test(url.pathname) ||
            /(?:perplexity\.ai|googleapis\.com)$/.test(url.hostname)) this.stop("UNAPPROVED_PROVIDER");
        return transport(req);
      }
      // Model metadata is non-generating. No other unmetered provider route.
      if (req.method === "GET" && /^\/v1\/models(?:\/|$)/.test(url.pathname)) return transport(req);
      this.check();
      const paths = provider === "openai" ? ["/v1/responses", "/v1/chat/completions"] : ["/v1/messages"];
      if (req.method !== "POST" || !paths.includes(url.pathname) || url.search) this.stop("UNAPPROVED_ENDPOINT");
      let body: any;
      try { body = await req.clone().json(); } catch { this.stop("INVALID_JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) this.stop("INVALID_JSON");
      const quote = quotePilotRequest(body, provider, url.pathname, code => this.stop(code));
      // Pin default-tier routing for the approved pilot only; preserve model,
      // prompt, reasoning, temperature and output/tool limits.
      body.service_tier = provider === "openai" ? "default" : "standard_only";
      const headers = new Headers(req.headers); headers.delete("content-length");
      req = new Request(req, { headers, body: JSON.stringify(body), redirect: "error" });
      this.check(); // Parsing awaited: recheck expiry and concurrent reservations.
      if (this.usedMicros + quote.reservedMicros > this.limitMicros) this.stop("INSUFFICIENT_BUDGET");
      const entry = { id: randomUUID(), model: quote.model, state: "reserved" as const,
        reservedMicros: quote.reservedMicros, accountedMicros: quote.reservedMicros,
        searchUseCeiling: quote.searchUses };
      this.ledger.entries.push(entry);
      this.persist(); // Must be durable BEFORE any paid wire dispatch.
      const milliseconds = Math.min(180_000, Date.parse(this.manifest.expiresAt) - this.now());
      if (milliseconds <= 0) this.stop("EXPIRED");
      let response: Response;
      let payload: any;
      try {
        response = await transport(new Request(req, { signal: AbortSignal.any([
          req.signal, this.controller.signal, AbortSignal.timeout(milliseconds),
        ]) }));
        if (!response.ok) this.stop("PROVIDER_REJECTED");
        payload = await response.clone().json();
      } catch {
        this.stop("UNKNOWN_OUTCOME");
      }
      Object.assign(entry, settlePilotUsage(payload, quote, provider, code => this.stop(code)));
      this.persist();
      return response;
    };
  }
}
