/**
 * Approved development-pilot controller. No provider calls are made directly:
 * all generation uses real authenticated application routes and the guarded
 * managed workflow. Private cookies never appear in stdout or audit documents.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const [command, acknowledgement, windowOption] = process.argv.slice(2);
if (windowOption && windowOption !== "--continuation") throw new Error("Unknown pilot window");
const continuation = windowOption === "--continuation";
const evidenceRoot = resolve("generated-artifacts/web-search-pilot");
const root = continuation ? resolve(evidenceRoot, "continuation") : evidenceRoot;
const scopeFile = resolve(root, "scope.json"), authFile = resolve(root, "auth.private.json");
const manifestFile = resolve(root, "approved-manifest.json");
const approvalRef = continuation ? "r1a-dev-continuation-20261020" : "r1a-dev-20261020";
const budgetUsd = continuation ? 49.56 : 50;
const ledgerPath = resolve(evidenceRoot, `${approvalRef}.ledger.json`);
if (acknowledgement !== "--approved" || process.env.NODE_ENV !== "development" || !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error("Explicit owner-approved development pilot required");
}
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
type Scope = {
  approvalRef: string; clientId: string; operatorId: string; orgId: string; expiresAt: string;
  models: Record<string, string>; prompts: Record<string, string>;
  runs: Record<string, { id: string; itemIds: string[] }>;
};
let cookies: Record<string, string> = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf8")) : {};
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
async function api(path: string, method = "GET", body?: unknown, clientId?: string) {
  const headers: Record<string, string> = {};
  if (Object.keys(cookies).length) headers.cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-csrf-token"] = decodeURIComponent(cookies["polaris.csrf"] ?? "");
  }
  if (clientId) headers["x-client-id"] = clientId;
  const response = await fetch(`${base}${path}`, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: "error" });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0], index = pair.indexOf("=");
    cookies[pair.slice(0, index)] = pair.slice(index + 1);
  }
  if (Object.keys(cookies).length) save(authFile, cookies);
  let data: any;
  if (response.status !== 204) data = await response.json();
  if (!response.ok) throw new Error(`Pilot application request rejected (${response.status}; ${data?.error?.code ?? "unknown"})`);
  return data;
}
async function prepare() {
  if (existsSync(scopeFile) || existsSync(manifestFile)) throw new Error("Existing pilot state must be reviewed, never reset");
  if (continuation) {
    const previous = JSON.parse(readFileSync(resolve(evidenceRoot, "r1a-dev-20261020.ledger.json"), "utf8"));
    if (previous.stopped !== "UNBOUNDED_OUTPUT" || previous.entries.length !== 4 ||
        previous.entries.some((e: any) => e.state !== "settled" || !Number.isSafeInteger(e.accountedMicros) || e.accountedMicros < 0) ||
        previous.entries.reduce((n: number, e: any) => n + e.accountedMicros, 0) !== 430_336 ||
        Math.floor(budgetUsd * 1_000_000) + 430_336 > 50_000_000) {
      throw new Error("Prior debit or approved aggregate allowance changed; operator review required");
    }
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const { db } = await import("../server/db");
  const s = await import("../shared/schema");
  const { hashPassword } = await import("../server/services/passwords");
  const password = randomBytes(32).toString("base64url");
  const passwordHash = await hashPassword(password);
  const models = await db.select().from(s.aiModels);
  const openai = models.find(m => m.vendor === "OpenAI" && m.model === "gpt-5.6-terra" && m.enabled);
  const anthropic = models.find(m => m.vendor === "Anthropic" && m.model === "claude-sonnet-5" && m.enabled);
  if (!openai || !anthropic) throw new Error("Approved exact models unavailable; no substitution allowed");
  const scope = await db.transaction(async tx => {
    const [org] = await tx.insert(s.organizations).values({ name: "R1A controlled validation" }).returning();
    const [user] = await tx.insert(s.users).values({
      email: `r1a-${randomBytes(8).toString("hex")}@pilot.invalid`, passwordHash,
      displayName: "R1A isolated pilot operator",
    }).returning();
    await tx.insert(s.userOrgMemberships).values({ userId: user.id, orgId: org.id, role: "admin" });
    const [client] = await tx.insert(s.clients).values({
      orgId: org.id, ownerUserId: user.id, name: "Mozilla Firefox",
      projectName: "Web Search R1A controlled pilot", website: "https://www.mozilla.org",
      urls: ["https://www.mozilla.org", "https://www.firefox.com"], aliases: ["Firefox", "Mozilla"],
      brandAliases: ["Firefox", "Mozilla"], industry: "Web browsers", geography: "Global",
      selectedAiModelIds: [openai.id, anthropic.id],
    }).returning();
    await tx.insert(s.competitors).values({ clientId: client.id, name: "Google Chrome",
      website: "https://www.google.com/chrome/", aliases: ["Chrome"] });
    await tx.insert(s.topics).values({ clientId: client.id, label: "Browser privacy",
      category: "Product", source: "manual", accepted: true });
    const suffix = " Answer in English without emojis. Finish with a short Sources section listing the literal official URLs. Do not invent facts or citations.";
    const prompts: Record<string, string> = {};
    for (const [key, text] of Object.entries({
      current: "Check Mozilla's official release notes. What is the current stable Firefox version and release date at the time of your answer?",
      branded: "Using Mozilla's official documentation, summarize Firefox's current privacy protections.",
      comparative: "Compare Firefox and Google Chrome for privacy and cross-platform availability using official documentation. Separate verified facts from judgement.",
    })) {
      const [prompt] = await tx.insert(s.prompts).values({ clientId: client.id, text: text + suffix,
        source: "manual", accepted: true }).returning();
      prompts[key] = prompt.id;
    }
    return { approvalRef, orgId: org.id, clientId: client.id, operatorId: user.id,
      models: { openai: openai.id, anthropic: anthropic.id }, prompts, runs: {},
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), email: user.email };
  });
  const { email, ...publicScope } = scope;
  save(scopeFile, publicScope);
  save(manifestFile, { version: 1, approvalRef, budgetUsd, expiresAt: scope.expiresAt });
  await api("/api/v1/auth/me").catch(() => undefined); // Issue real CSRF cookie before login.
  await api("/api/v1/auth/login", "POST", { email, password });
  const me = await api("/api/v1/auth/me");
  if (me.user?.id !== scope.operatorId) throw new Error("Pilot cookie session verification failed");
  console.log(JSON.stringify({ prepared: true, scopeFile, manifestFile, expiresAt: scope.expiresAt }));
}

async function runCase(scope: Scope, provider: string, kind: string) {
  const key = `${provider}-${kind}`;
  if (scope.runs[key]) throw new Error("Case already admitted; do not repeat paid work");
  if (!existsSync(ledgerPath)) throw new Error("Guarded workflow has not initialized its durable ledger");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const used = ledger.entries.reduce((n: number, entry: any) => n + entry.accountedMicros, 0);
  if (ledger.stopped || ledger.entries.some((entry: any) => entry.state !== "settled")) throw new Error("Uncertain/stopped ledger requires review");
  if (Date.now() >= Date.parse(scope.expiresAt)) throw new Error("Pilot expired");
  if (kind === "core" && Math.floor(budgetUsd * 1_000_000) - used < 22_000_000) throw new Error("Insufficient full-context reservation headroom for core stage");
  const requirePassed = (caseKey: string) => {
    const saved = JSON.parse(readFileSync(resolve(root, `${caseKey}.evidence.json`), "utf8"));
    if (saved.run.status !== "done" || saved.run.deliverablesStatus !== "ready" ||
        saved.evidence.some((entry: any) => entry.evidence?.error)) {
      throw new Error(`Earlier case requires review: ${caseKey}`);
    }
  };
  if (kind !== "probe") requirePassed(`${provider}-probe`);
  if (provider === "anthropic") for (const stage of ["probe", "core", "paired", "off"]) requirePassed(`openai-${stage}`);
  const me = await api("/api/v1/auth/me");
  if (me.user?.id !== scope.operatorId) throw new Error("Wrong pilot session");
  const currentId = scope.prompts.current;
  const selected = kind === "core" ? [scope.prompts.branded, scope.prompts.comparative] : [currentId];
  const source = scope.runs[`${provider}-probe`];
  if (kind !== "probe" && !source) throw new Error("Initial probe must be reviewed first");
  const inherited = kind === "paired"
    ? await api(`/api/v1/prompt-runs/${source.id}/selections`, "GET", undefined, scope.clientId) : null;
  if (inherited && (inherited.webSearchEnabled !== true ||
      !inherited.promptIds.includes(currentId) || !inherited.modelIds.includes(scope.models[provider]))) {
    throw new Error("Rerun selections do not match the approved source");
  }
  const payload = {
    clientId: scope.clientId, modelIds: [scope.models[provider]], promptIds: selected,
    name: `R1A ${provider} ${kind}`, webSearchEnabled: inherited ? inherited.webSearchEnabled : kind !== "off",
    ...(kind === "paired" ? { iterationOf: `R1A ${provider} probe` } : {}),
  };
  const result = await api("/api/v1/prompt-runs", "POST", payload, scope.clientId);
  scope.runs[key] = { id: result.run.id, itemIds: result.items.map((item: any) => item.id) };
  save(scopeFile, scope);
  const started = Date.now();
  let run: any;
  while (Date.now() - started < 900_000 && Date.now() < Date.parse(scope.expiresAt)) {
    run = await api(`/api/v1/prompt-runs/${result.run.id}`, "GET", undefined, scope.clientId);
    if (["done", "error", "completed_with_errors", "cancelled", "paused"].includes(run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const evidence = [];
  for (const id of scope.runs[key].itemIds) {
    evidence.push(await api(`/api/v1/prompt-runs/${run.id}/search-evidence/${id}`, "GET", undefined, scope.clientId));
  }
  save(resolve(root, `${key}.evidence.json`), { run, evidence });
  await collect(scope, key);
}

// Rebuild evidence exports without re-admitting or regenerating a paid run.
async function collect(scope: Scope, key: string) {
  const { run, evidence } = JSON.parse(readFileSync(resolve(root, `${key}.evidence.json`), "utf8"));
  if (run.status === "done") {
    const { aggregateSnapshotData } = await import("../server/services/report-snapshot");
    const { generateEnhancedJSON } = await import("../server/services/json-exporter");
    const { generateCSVExports } = await import("../server/services/csv-exporter");
    const { storage } = await import("../server/storage");
    const snapshot = await aggregateSnapshotData(scope.clientId, [run.id]);
    const client = await storage.getClient(scope.clientId);
    if (!client) throw new Error("Controlled project disappeared");
    const competitors = await storage.getCompetitors(scope.clientId);
    save(resolve(root, `${key}.snapshot.json`), snapshot);
    save(resolve(root, `${key}.export.json`), generateEnhancedJSON(snapshot, client, competitors));
    const csv = generateCSVExports(snapshot, client, competitors);
    for (const [name, content] of Object.entries(csv)) {
      if (typeof content === "string") writeFileSync(resolve(root, `${key}.${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}.csv`), content, { mode: 0o600 });
    }
  }
  const finalLedger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  console.log(JSON.stringify({
    case: key, runId: run.id, status: run.status, deliverablesStatus: run.deliverablesStatus,
    savedEvidence: evidence.map((entry: any) => ({
      phase: entry.phase, error: entry.evidence?.error,
      invocation: entry.evidence?.invocationStatus,
      actualModel: entry.evidence?.actualModel,
    })),
    accountedUpperUsd: finalLedger.entries.reduce((n: number, entry: any) => n + entry.accountedMicros, 0) / 1_000_000,
    providerRequests: finalLedger.entries.length, guardStopped: finalLedger.stopped,
  }));
}

async function finish(scope: Scope) {
  await api("/api/v1/auth/logout", "POST", {});
  const { db } = await import("../server/db");
  const { users } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  await db.update(users).set({ status: "disabled", sessionEpoch: sql`${users.sessionEpoch} + 1` }).where(eq(users.id, scope.operatorId));
  if (existsSync(authFile)) unlinkSync(authFile);
  console.log(JSON.stringify({ isolatedOperatorDisabled: true, retainedEvidence: root }));
}

try {
  if (command === "prepare") await prepare();
  else {
    const scope: Scope = JSON.parse(readFileSync(scopeFile, "utf8"));
    if (command === "finish") await finish(scope);
    else if (/^collect-(openai|anthropic)-(probe|core|paired|off)$/.test(command ?? "")) {
      await collect(scope, command.slice("collect-".length));
    }
    else {
      const match = /^(openai|anthropic)-(probe|core|paired|off)$/.exec(command ?? "");
      if (!match) throw new Error("Unknown approved pilot case");
      await runCase(scope, match[1], match[2]);
    }
  }
} finally {
  const { pool } = await import("../server/db");
  await pool.end();
}
