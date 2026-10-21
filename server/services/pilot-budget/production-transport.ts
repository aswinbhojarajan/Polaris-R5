import { randomUUID } from "node:crypto";
import { PilotBudgetError } from "./guard";
import { productionManifest, productionPilotContext, type ProductionManifest } from "./production-config";
import { quotePilotRequest, settlePilotUsage } from "./pricing";

/** Installed before SDK imports. Only scoped pilot jobs are metered; unrelated
 * production work keeps its original transport and is never charged to this cap. */
export function productionBudgetFetch(transport: typeof fetch,
  resolveManifest: () => ProductionManifest | undefined = productionManifest): typeof fetch {
  const faults = new Set<string>();
  return async (input, init) => {
    const context = productionPilotContext.getStore();
    if (!context) return transport(input, init);
    const m = resolveManifest();
    if (!m || m.approvalRef !== context.approvalRef || faults.has(m.approvalRef))
      throw new PilotBudgetError("INVALID_PRODUCTION_SCOPE");
    const store = await import("./production-store");
    const fail = (code: string): never => { throw new PilotBudgetError(code); };
    try {
      let request = new Request(input, init);
      const url = new URL(request.url);
      const provider = url.origin === "https://api.openai.com" ? "openai"
        : url.origin === "https://api.anthropic.com" ? "anthropic" : null;
      if (!provider) {
        if (/\/(chat\/completions|responses|messages)$/.test(url.pathname) ||
            /(?:perplexity\.ai|googleapis\.com)$/.test(url.hostname)) fail("UNAPPROVED_PROVIDER");
        return transport(request);
      }
      if (request.method === "GET" && /^\/v1\/models(?:\/|$)/.test(url.pathname)) return transport(request);
      const paths = provider === "openai" ? ["/v1/responses", "/v1/chat/completions"] : ["/v1/messages"];
      if (request.method !== "POST" || !paths.includes(url.pathname) || url.search) fail("UNAPPROVED_ENDPOINT");
      const body = await request.clone().json();
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("INVALID_JSON");
      const quote = quotePilotRequest(body, provider, url.pathname, fail);
      body.service_tier = provider === "openai" ? "default" : "standard_only";
      const headers = new Headers(request.headers); headers.delete("content-length");
      request = new Request(request, { headers, body: JSON.stringify(body), redirect: "error" });
      const id = randomUUID();
      const expiresAt = await store.reserveProduction(m, {
        id, model: quote.model, state: "reserved", reservedMicros: quote.reservedMicros,
        accountedMicros: quote.reservedMicros, searchUseCeiling: quote.searchUses, runId: context.runId,
      });
      const milliseconds = Math.min(180_000, Date.parse(expiresAt) - Date.now());
      if (milliseconds <= 0) fail("EXPIRED");
      const response = await transport(new Request(request, { signal: AbortSignal.any([
        request.signal, AbortSignal.timeout(milliseconds),
      ]) }));
      if (!response.ok) fail("PROVIDER_REJECTED");
      const settlement = settlePilotUsage(await response.clone().json(), quote, provider, fail);
      await store.withProductionBudget(m, state => {
        const entry = state.ledger.entries.find(e => e.id === id);
        if (!entry || entry.state !== "reserved") throw new PilotBudgetError("INVALID_RESERVATION");
        Object.assign(entry, settlement);
      });
      return response;
    } catch (failure) {
      faults.add(m.approvalRef);
      const code = failure instanceof PilotBudgetError ? failure.code : "UNKNOWN_OUTCOME";
      await store.stopProduction(m, code).catch(() => undefined);
      throw new PilotBudgetError(code);
    }
  };
}

export function installProductionBudgetFetch() {
  if (process.env.NODE_ENV === "production") globalThis.fetch = productionBudgetFetch(globalThis.fetch);
}
