/** Private PostgreSQL + synthetic HTTP only. Never application/prod databases. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { eq } from "drizzle-orm";
import * as s from "../../shared/schema";
import { createSearchConfig } from "../../shared/native-web-search";
import { baseEvidence } from "../services/native-web-search/common";
import { productionBudgetFetch } from "../services/pilot-budget/production-transport";
import { productionPilotContext, productionPilotPrompt, type ProductionManifest } from "../services/pilot-budget/production-config";
import { productionStateSchema, accountedMicros, withProductionBudget, reserveProduction } from "../services/pilot-budget/production-store";
import { initializeProductionPilot, executeWithProductionBudget, productionModels } from "../services/pilot-budget/production-runtime";
import { activateProductionPilot } from "../services/pilot-budget/production-activation";
import { loadSearchPolicy, getSearchEligibility } from "../services/native-web-search/policy";
import { productionPilotFence } from "../routes/production-pilot";

const url = process.env.NATIVE_SEARCH_TEST_DATABASE_URL;
if (!url || process.env.DATABASE_URL !== url || new URL(url).hostname !== "127.0.0.1" ||
    new URL(url).port !== "55432") throw new Error("Disposable native-search PostgreSQL is required.");
const sqlPool = new pg.Pool({ connectionString: url });
let db: typeof import("../db").db;
let wires = 0, peak = 0;
let mode: "ok" | "missing" | "throw" | "pending" = "ok";
let release: () => void = () => undefined;
let barrier = Promise.resolve();
const realFetch = globalThis.fetch;
const raw: typeof fetch = async input => {
  const request = input as Request;
  const body = await request.json();
  wires++;
  const m = JSON.parse(process.env.POLARIS_R1A_PRODUCTION_PILOT!);
  const state = await readState(m);
  peak = Math.max(peak, accountedMicros(state.ledger));
  assert.ok(peak <= 50_000_000, "durable reservation must precede synthetic wire");
  if (mode === "throw") throw new Error("Synthetic unknown transport outcome");
  if (mode === "pending") await barrier;
  return Response.json({ id: "unpaid", model: body.model,
    ...(mode === "missing" ? {} : { usage: { input_tokens: 10, output_tokens: 10, prompt_tokens: 10, completion_tokens: 10 } }),
    service_tier: "standard", choices: [{ message: { role: "assistant", content: "unpaid" }, finish_reason: "stop" }] });
};
const wrapped = productionBudgetFetch(raw);
before(async () => {
  const module = await import("../db");
  module.pool.query = sqlPool.query.bind(sqlPool) as typeof module.pool.query;
  module.pool.connect = sqlPool.connect.bind(sqlPool) as typeof module.pool.connect;
  db = module.db;
  process.env.NODE_ENV = "production";
  process.env.SAMPLE_USER_PASSWORD = randomBytes(32).toString("base64url");
  process.env.POLARIS_NATIVE_WEB_SEARCH_ENABLED = "true";
  process.env.POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT = "production";
  process.env.POLARIS_NATIVE_WEB_SEARCH_OPENAI_ENABLED = "true";
  process.env.POLARIS_NATIVE_WEB_SEARCH_ANTHROPIC_ENABLED = "true";
  await db.insert(s.aiModels).values([
    { vendor: "OpenAI", model: productionModels.openai, displayName: "Unpaid OpenAI production fixture", enabled: true, internalOnly: false },
    { vendor: "Anthropic", model: productionModels.anthropic, displayName: "Unpaid Claude production fixture", enabled: true, internalOnly: false },
  ]).onConflictDoNothing();
  globalThis.fetch = wrapped; // before SDK imports
});
after(async () => { globalThis.fetch = realFetch; await sqlPool.end(); });
async function fixture() {
  wires = 0; peak = 0; mode = "ok";
  const m: ProductionManifest = { version: 1, budgetUsd: 50, durationSeconds: 3600,
    approvalRef: `unpaid-prod-${randomUUID()}`, orgId: randomUUID(), operatorId: randomUUID(),
    clientId: randomUUID(), promptId: randomUUID(), operatorEmail: `${randomUUID()}@pilot.invalid`,
    accountRefs: { openai: "unpaid-prod-openai", anthropic: "unpaid-prod-claude" } };
  process.env.POLARIS_R1A_PRODUCTION_PILOT = JSON.stringify(m);
  process.env.POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS = JSON.stringify(m.accountRefs);
  await initializeProductionPilot();
  return m;
}
async function readState(m: ProductionManifest) {
  const [row] = await db.select().from(s.nativeSearchPilotBudgets).where(eq(s.nativeSearchPilotBudgets.approvalRef, m.approvalRef));
  return productionStateSchema.parse(row.state);
}
async function makeRun(m: ProductionManifest, provider: "openai" | "anthropic" = "openai", search = true) {
  const [model] = await db.select().from(s.aiModels).where(eq(s.aiModels.model, productionModels[provider]));
  const [run] = await db.insert(s.promptRuns).values({ clientId: m.clientId, createdBy: m.operatorId,
    name: "Unpaid production guard fixture", totalPrompts: 1, searchConfig: createSearchConfig(search) }).returning();
  const [item] = await db.insert(s.promptRunItems).values({
    promptRunId: run.id, promptId: m.promptId, modelId: model.id,
  }).returning();
  return { run, item };
}
const native = () => new Request("https://api.openai.com/v1/responses", { method: "POST",
  body: JSON.stringify({ model: productionModels.openai, input: "unpaid", max_output_tokens: 8000,
    max_tool_calls: 5, tools: [{ type: "web_search" }] }) });
const context = <T>(m: ProductionManifest, runId: string, work: () => T) =>
  productionPilotContext.run({ approvalRef: m.approvalRef, runId }, work);

test("production SDK native/internal calls share durable accounting; unrelated traffic is not metered", async () => {
  const m = await fixture(), { run } = await makeRun(m);
  await executeWithProductionBudget(run.id, async () => {
    await wrapped(native());
    const { default: OpenAI } = await import("openai");
    const sdk = new OpenAI({ apiKey: "unpaid-not-a-credential", maxRetries: 2 });
    await sdk.chat.completions.create({ model: "gpt-5.4", messages: [{ role: "user", content: "unpaid" }] });
  });
  let state = await readState(m);
  assert.equal(state.ledger.entries.length, 2);
  assert.ok(state.ledger.entries.every(e => e.runId === run.id && e.state === "settled"));
  assert.equal(state.ledger.entries[0].reservedMicros, 10_840_000);
  await wrapped(native()); // normal unrelated scope; synthetic transport only
  state = await readState(m);
  assert.equal(state.ledger.entries.length, 2);
  assert.equal(wires, 3);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const claude = new Anthropic({ apiKey: "unpaid-not-a-credential", maxRetries: 0 });
  await assert.rejects(context(m, run.id, () => claude.messages.create({
    model: productionModels.anthropic, max_tokens: 100, messages: [{ role: "user", content: "unpaid" }],
  })));
  assert.equal(wires, 3, "real Anthropic SDK must inherit scope guard before any wire");
  assert.equal((await readState(m)).ledger.stopped, "PRODUCTION_PRIMARY_MISMATCH");
  await context(m, run.id, () => executeWithProductionBudget(randomUUID(), async () => {
    assert.equal(productionPilotContext.getStore(), undefined, "unrelated worker must clear inherited pilot context");
  }));
});

test("concurrent production reservations cannot exceed the shared ceiling", async () => {
  const m = await fixture(), { run } = await makeRun(m);
  await executeWithProductionBudget(run.id, async () => undefined);
  mode = "pending"; barrier = new Promise(resolve => { release = resolve; });
  const pending = context(m, run.id, () => Promise.allSettled(Array.from({ length: 6 }, () => wrapped(native()))));
  for (let i = 0; i < 300 && !(await readState(m)).ledger.stopped; i++) await new Promise(resolve => setTimeout(resolve, 10));
  release();
  const results = await pending;
  assert.equal(wires, 4);
  assert.ok(results.some(result => result.status === "rejected"));
  assert.ok(peak <= 50_000_000);
  assert.equal((await readState(m)).ledger.stopped, "INSUFFICIENT_BUDGET");
});

test("missing usage retains the reservation and latches off subsequent wire calls", async () => {
  const m = await fixture(), { run } = await makeRun(m);
  mode = "missing";
  await assert.rejects(executeWithProductionBudget(run.id, () => wrapped(native())), /UNVERIFIED_USAGE/);
  const state = await readState(m);
  assert.equal(state.ledger.entries[0].state, "reserved");
  assert.equal(accountedMicros(state.ledger), 10_840_000);
  await assert.rejects(context(m, run.id, () => wrapped(native())));
  assert.equal(wires, 1);
});

test("unresolved restart never refills, and manifest changes cannot reuse approval", async () => {
  const m = await fixture(), { run } = await makeRun(m);
  await executeWithProductionBudget(run.id, () => reserveProduction(m, {
    id: randomUUID(), runId: run.id, model: productionModels.openai, state: "reserved",
    reservedMicros: 10_840_000, accountedMicros: 10_840_000, searchUseCeiling: 5,
  }));
  const expiresAt = (await readState(m)).expiresAt;
  await initializeProductionPilot();
  assert.equal((await readState(m)).ledger.stopped, "UNRESOLVED_RESTART");
  assert.equal((await readState(m)).expiresAt, expiresAt);
  assert.equal(accountedMicros((await readState(m)).ledger), 10_840_000);
  await assert.rejects(withProductionBudget({ ...m, clientId: randomUUID() }, () => undefined), /MANIFEST_CHANGED/);
  assert.equal(wires, 0);
});

test("real SDK retries cannot dispatch after an uncertain production outcome", async () => {
  const m = await fixture(), { run } = await makeRun(m);
  mode = "throw";
  const { default: OpenAI } = await import("openai");
  const sdk = new OpenAI({ apiKey: "unpaid-not-a-credential", maxRetries: 2 });
  await assert.rejects(executeWithProductionBudget(run.id, () => sdk.chat.completions.create({
    model: "gpt-5.4", max_tokens: 1000, messages: [{ role: "user", content: "unpaid" }],
  })));
  const state = await readState(m);
  assert.equal(wires, 1); assert.equal(state.ledger.entries.length, 1);
  assert.equal(state.ledger.entries[0].state, "reserved");
  assert.equal(state.ledger.entries[0].accountedMicros, state.ledger.entries[0].reservedMicros);
  assert.ok(state.ledger.stopped);
});

test("expiry and operator revocation fail before provider dispatch", async () => {
  for (const revoke of [false, true]) {
    const m = await fixture(), { run } = await makeRun(m);
    await executeWithProductionBudget(run.id, async () => undefined);
    if (revoke) await db.update(s.users).set({ status: "disabled" }).where(eq(s.users.id, m.operatorId));
    else await withProductionBudget(m, state => { state.expiresAt = new Date(Date.now() - 1000).toISOString(); });
    await assert.rejects(context(m, run.id, () => wrapped(native())), revoke ? /REVOKED/ : /EXPIRED/);
    assert.equal(wires, 0);
  }
});

test("unpriced calls, matrix order, and other operator writes remain closed", async () => {
  let m = await fixture(), { run } = await makeRun(m);
  await assert.rejects(executeWithProductionBudget(run.id, () => wrapped(new Request(
    "https://api.openai.com/v1/chat/completions", { method: "POST",
      body: JSON.stringify({ model: "unapproved", messages: [{ role: "user", content: "unpaid" }] }) }))), /UNPRICED_MODEL/);
  assert.equal(wires, 0);
  m = await fixture();
  const off = await makeRun(m, "openai", false);
  await assert.rejects(executeWithProductionBudget(off.run.id, async () => undefined), /CASE_ORDER/);
  let denied = 0, passed = false;
  productionPilotFence({ user: { id: m.operatorId }, method: "POST", originalUrl: "/api/v1/onboarding" } as any,
    { status: (code: number) => { denied = code; return { json: () => undefined }; } } as any, () => { passed = true; });
  assert.equal(denied, 403); assert.equal(passed, false);
  productionPilotFence({ user: { id: m.operatorId }, method: "GET", originalUrl: "/any-read-route" } as any,
    {} as any, () => {
      assert.equal(productionPilotContext.getStore()?.runId, "unapproved-http");
      assert.equal(productionPilotContext.getStore()?.approvalRef, m.approvalRef);
    });
  assert.equal(getSearchEligibility({ vendor: "OpenAI", model: productionModels.openai, enabled: true }, loadSearchPolicy()).eligible, false);
});

async function completeCase(m: ProductionManifest, provider: "openai" | "anthropic", search: boolean) {
  const { run, item } = await makeRun(m, provider, search);
  await executeWithProductionBudget(run.id, async () => {
    const body = { model: productionModels[provider], max_tokens: 8000, messages: [{ role: "user", content: "unpaid" }] };
    await wrapped(provider === "openai" && search ? native() : new Request(
      provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages",
      { method: "POST", body: JSON.stringify({ ...body,
        ...(provider === "anthropic" && search ? { tools: [{ type: "web_search_20250305", max_uses: 5 }] } : {}) }) }));
    for (const model of ["gpt-4o-mini", "gpt-5.4"]) await wrapped(new Request("https://api.openai.com/v1/chat/completions",
      { method: "POST", body: JSON.stringify({ model, messages: [{ role: "user", content: "unpaid" }] }) }));
    const answerText = "🧭 Firefox release.";
    const [answer] = await db.insert(s.answers).values({ promptRunItemId: item.id, rawResponse: answerText }).returning();
    if (search) {
      const evidence = { ...baseEvidence({ provider, model: productionModels[provider] }),
        actualModel: productionModels[provider], actualModelEvidence: "provider_reported" as const,
        invocationStatus: "invoked" as const,
        sources: [{ id: "s1", url: "https://example.com/official", kind: "cited" as const }],
        citations: [{ sourceIds: ["s1"], textStart: 3, textEnd: 10,
          association: provider === "openai" ? "span" as const : "block" as const,
          providerLocator: provider === "openai" ? { blockIndex: 0, unit: "codepoint" as const, start: 2, end: 9 }
            : { blockIndex: 0, unit: "block" as const } }] };
      await db.insert(s.promptRunItemExecutions).values({ itemId: item.id, runId: run.id,
        phase: "scored", answerText, evidence, canonicalAnswerId: answer.id });
    }
    await db.update(s.promptRunItems).set({ status: "done" }).where(eq(s.promptRunItems.id, item.id));
    await db.update(s.promptRuns).set({ status: "done", deliverablesStatus: "ready" }).where(eq(s.promptRuns.id, run.id));
  });
}

test("only a complete paid-evidence matrix plus browser reference can activate both; access is revoked", async () => {
  const m = await fixture();
  await assert.rejects(activateProductionPilot(m, ""), /BROWSER_ACCEPTANCE_REQUIRED/);
  for (const provider of ["openai", "anthropic"] as const) {
    for (const search of [true, true, false]) await completeCase(m, provider, search);
  }
  const result = await activateProductionPilot(m, "docs/audits/unpaid-browser-fixture");
  assert.ok(result.publicEligibility.every(row => row.eligible));
  assert.equal(result.state.approvals.length, 2);
  assert.equal(result.state.ledger.stopped, "PILOT_COMPLETE");
  const [operator] = await db.select().from(s.users).where(eq(s.users.id, m.operatorId));
  assert.equal(operator.status, "disabled"); assert.equal(operator.sessionEpoch, 1);
  await initializeProductionPilot(); // persistent activation survives clean restart
  assert.equal((await readState(m)).phase, "active");
  assert.equal(loadSearchPolicy().approvals.length, 2);
});
