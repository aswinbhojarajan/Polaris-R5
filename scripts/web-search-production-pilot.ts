/**
 * Release-only operations. This does NOT start runs or call provider APIs.
 * Scope/status live in ignored generated-artifacts; session cookies stay in /tmp.
 * npx tsx scripts/web-search-production-pilot.ts login|status|activate|close
 * activate additionally requires the real browser audit's workspace path.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { productionManifestSchema } from "../server/services/pilot-budget/production-config";

async function main() {
  const action = process.argv[2], ref = process.argv[3] ?? "";
  if (!["login", "status", "activate", "close"].includes(action)) throw new Error("INVALID_OPERATION");
  if (action === "activate" && !existsSync(ref)) throw new Error("REAL_BROWSER_AUDIT_REQUIRED");
  const root = resolve("generated-artifacts/web-search-r1a-production");
  const scope = JSON.parse(readFileSync(resolve(root, "scope.json"), "utf8"));
  const manifest = productionManifestSchema.parse(scope.manifest);
  const base = new URL(scope.productionUrl);
  if (base.protocol !== "https:" || base.username || base.password ||
      base.hostname.endsWith(".replit.dev") || base.pathname !== "/") throw new Error("INVALID_PRODUCTION_ORIGIN");
  const authFile = resolve(tmpdir(), `polaris-${manifest.approvalRef}-auth.private.json`);
  const cookies: Record<string, string> = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf8")) : {};
  const save = (file: string, data: unknown) => writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  async function api(path: string, body?: unknown) {
    const headers: Record<string, string> = { "x-client-id": manifest.clientId };
    headers.cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      headers["x-csrf-token"] = decodeURIComponent(cookies["polaris.csrf"] ?? "");
    }
    const response = await fetch(new URL(path, base), { method: body === undefined ? "GET" : "POST",
      headers, redirect: "error", signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], index = pair.indexOf("=");
      cookies[pair.slice(0, index)] = pair.slice(index + 1);
    }
    if (Object.keys(cookies).length) save(authFile, cookies);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  if (action === "login") {
    const password = process.env.SAMPLE_USER_PASSWORD;
    if (!password) throw new Error("BOOTSTRAP_PASSWORD_SECRET_MISSING");
    await api("/api/v1/auth/me");
    await api("/api/v1/auth/login", { email: manifest.operatorEmail, password });
    const me = await api("/api/v1/auth/me");
    if (me?.user?.id !== manifest.operatorId) throw new Error("PRODUCTION_OPERATOR_MISMATCH");
  }
  if (action === "activate") {
    const result = await api("/api/v1/internal/r1a-pilot/activate", { browserAcceptanceRef: ref });
    save(resolve(root, "activation.json"), result);
    unlinkSync(authFile);
    console.log(JSON.stringify({ phase: result.state.phase, publicEligibility: result.publicEligibility }));
    return;
  }
  if (action === "close") {
    const result = await api("/api/v1/internal/r1a-pilot/close", {});
    save(resolve(root, "closed.json"), result);
    if (existsSync(authFile)) unlinkSync(authFile);
    console.log(JSON.stringify(result));
    return;
  }
  const result = await api("/api/v1/internal/r1a-pilot");
  save(resolve(root, "status.private.json"), result);
  console.log(JSON.stringify({ phase: result.state.phase, expiresAt: result.state.expiresAt,
    budgetUsd: result.budgetUsd, accountedUpperUsd: result.accountedUpperUsd,
    requests: result.state.ledger.entries.length, cases: result.state.cases,
    stop: result.state.ledger.stopped,
    unresolved: result.state.ledger.entries.filter((entry: { state: string }) => entry.state !== "settled").length }));
}
main().catch(() => { console.error("Production pilot operation failed; no automatic retry or generation was submitted."); process.exitCode = 1; });
