/**
 * Actual auth/CSRF/tenant routes + actual queue/executor/PostgreSQL.
 * Only provider IO is synthetic. No TEST_AUTH_BYPASS, no application DB.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import pg from "pg";

const url = process.env.NATIVE_SEARCH_TEST_DATABASE_URL;
const local = url && new URL(url);
if (!local || local.hostname !== "127.0.0.1" || local.port !== "55432" ||
  process.env.DATABASE_URL !== url || process.env.TEST_AUTH_BYPASS === "true") {
  throw new Error("Run only through the private local native-search test runner, without auth bypass.");
}
process.env.NODE_ENV = "test";
process.env.AEO_MODE = "heuristic";
process.env.SESSION_SECRET = randomBytes(48).toString("hex");
// A synthetic non-credential for SDK construction; request methods never network.
process.env.OPENAI_API_KEY = "unpaid-fixture-not-a-credential";
const realFetch = globalThis.fetch;
let nativeCalls = 0, offCalls = 0, internalCalls = 0;
let holdNextNative: (() => void) | undefined;
const prose = "😀 Test Brand offers a reliable service.";
const source = "https://example.com/native-source";
globalThis.fetch = async (input, init) => {
  if (String(input) !== "https://api.openai.com/v1/responses") {
    throw new Error("Unpaid suite blocked unexpected external fetch");
  }
  nativeCalls++;
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, "fixture-openai");
  assert.equal(body.tools[0].type, "web_search");
  if (holdNextNative) {
    const started = holdNextNative;
    holdNextNative = undefined;
    started();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }
  return new Response(JSON.stringify({
    id: "resp_unpaid_fixture", model: "fixture-openai-snapshot", status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: source }] } },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: prose,
        annotations: [{ type: "url_citation", url: source, title: "Native fixture",
          start_index: 2, end_index: 12 }] }] },
    ], usage: { input_tokens: 12, output_tokens: 10 },
  }), { headers: { "content-type": "application/json", "x-request-id": "unpaid-request" } });
};

const sqlPool = new pg.Pool({ connectionString: url });
let dbModule: typeof import("../db");
let storage: typeof import("../storage").storage;
let queue: typeof import("../routes/_shared").jobQueue;
let app: ReturnType<typeof express>;
let schema: typeof import("../../shared/schema");
let db: typeof import("../db").db;
let admin: { id: string; email: string }, member: typeof admin, viewer: typeof admin, outsider: typeof admin;
let client: { id: string }, otherClient: typeof client;
let prompt: { id: string }, otherPrompt: typeof prompt;
let model: { id: string }, google: typeof model;
const password = randomBytes(24).toString("base64url");
let csrf = "";
let adminAgent: ReturnType<typeof request.agent>;
let cohort: Record<string, unknown>;
let retainedSnapshot: import("../services/report-snapshot").SnapshotData;
let retainedRunId: string;

before(async () => {
  // Adapt the EXISTING application's exported pool to native local pg only in
  // this test process. No production transport switch or application test hook.
  dbModule = await import("../db");
  dbModule.pool.query = sqlPool.query.bind(sqlPool) as typeof dbModule.pool.query;
  dbModule.pool.connect = sqlPool.connect.bind(sqlPool) as typeof dbModule.pool.connect;
  db = dbModule.db;
  schema = await import("../../shared/schema");
  const { default: OpenAI } = await import("openai");
  OpenAI.prototype.request = (async (options) => {
    const body = (await options).body as { model?: string };
    // Count diagnostic and internal calls separately: OFF is not "no billing".
    const diagnostic = body.model === "fixture-openai";
    if (diagnostic) offCalls++; else internalCalls++;
    return { id: "fixture-off", model: "fixture-openai", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ message: { role: "assistant", content: diagnostic ? prose : JSON.stringify({ mentions: [] }) }, finish_reason: "stop" }] };
  }) as typeof OpenAI.prototype.request;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  Anthropic.prototype.request = (async () => { throw new Error("Unexpected Anthropic SDK IO in unpaid suite"); }) as typeof Anthropic.prototype.request;
  ({ storage } = await import("../storage"));
  const { hashPassword } = await import("../services/passwords");
  const [org] = await db.insert(schema.organizations).values({ name: "Unpaid native test" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other isolated tenant" }).returning();
  const hash = await hashPassword(password);
  const makeUser = async (role: "admin" | "member" | "viewer", orgId = org.id) => {
    const [user] = await db.insert(schema.users).values({
      email: `${role}-${randomBytes(5).toString("hex")}@test.invalid`, passwordHash: hash,
    }).returning();
    await db.insert(schema.userOrgMemberships).values({ userId: user.id, orgId, role });
    return user;
  };
  admin = await makeUser("admin"); member = await makeUser("member");
  viewer = await makeUser("viewer"); outsider = await makeUser("admin", otherOrg.id);
  await db.insert(schema.userOrgMemberships).values({ userId: viewer.id, orgId: otherOrg.id, role: "member" });
  [client] = await db.insert(schema.clients).values({ orgId: org.id, name: "Test Brand", projectName: "Unpaid fixture" }).returning();
  [otherClient] = await db.insert(schema.clients).values({ orgId: otherOrg.id, name: "Other", projectName: "Other" }).returning();
  await db.insert(schema.projectMemberships).values({ clientId: otherClient.id, userId: viewer.id });
  await db.insert(schema.projectMemberships).values([member, viewer].map(user => ({
    clientId: client.id, userId: user.id, grantedByUserId: admin.id,
  })));
  [prompt] = await db.insert(schema.prompts).values({ clientId: client.id, text: "Compare Test Brand services.", source: "manual" }).returning();
  [otherPrompt] = await db.insert(schema.prompts).values({ clientId: otherClient.id, text: "Other tenant secret prompt", source: "manual" }).returning();
  [model] = await db.insert(schema.aiModels).values({ vendor: "OpenAI", model: "fixture-openai", displayName: "Fixture" }).returning();
  [google] = await db.insert(schema.aiModels).values({ vendor: "Google", model: "fixture-google", displayName: "Blocked fixture" }).returning();
  cohort = { provider: "openai", model: "fixture-openai", environment: "unpaid-test", accountRef: "synthetic",
    operatorId: admin.id, tenantId: client.id, approvalRef: "unpaid-bootstrap", maxItems: 6,
    spendCeilingUsd: 1, expiresAt: new Date(Date.now() + 600_000).toISOString(),
    actualModels: ["fixture-openai-snapshot"], openAiOffsetUnit: "codepoint" };
  Object.assign(process.env, {
    POLARIS_NATIVE_WEB_SEARCH_ENABLED: "true", POLARIS_NATIVE_WEB_SEARCH_OPENAI_ENABLED: "true",
    POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT: "unpaid-test",
    POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS: JSON.stringify({ openai: "synthetic" }),
    POLARIS_NATIVE_WEB_SEARCH_APPROVALS: "[]",
    POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS: JSON.stringify([cohort]),
  });
  const { openaiService } = await import("../openai-service");
  openaiService.generateRecommendations = async () => [{
    title: "Fixture recommendation", description: "Synthetic recommendation", severity: "low",
    category: "content", source: "ai_analysis", actionItems: [],
  }];
  openaiService.generateOptimizedContent = async () => [{
    title: "Fixture draft", content: "Synthetic content", targetKeywords: [], contentType: "article",
  }];
  const { csrfTokenIssuer, csrfProtect, isCsrfExempt } = await import("../middleware/csrf");
  const { setupAuth } = await import("../auth");
  const { registerRoutes } = await import("../routes");
  const { errorHandler } = await import("../middleware/error-handler");
  app = express(); app.use(express.json()); app.use(csrfTokenIssuer());
  app.use("/api/v1", (req, res, next) => isCsrfExempt(req.path) ? next() : csrfProtect()(req, res, next));
  setupAuth(app);
  await registerRoutes(app);
  ({ jobQueue: queue } = await import("../routes/_shared"));
  app.use(errorHandler);
  adminAgent = request.agent(app);
  csrf = await login(adminAgent, admin.email);
});

after(async () => {
  if (queue) { queue.stopAcceptingJobs(); await queue.drain(); }
  globalThis.fetch = realFetch;
  await sqlPool.end();
});

async function login(agent: ReturnType<typeof request.agent>, email: string) {
  const res = await agent.post("/api/v1/auth/login").send({ email, password }).expect(200);
  const cookies = res.headers["set-cookie"] as unknown as string[];
  const token = cookies.find(c => c.startsWith("polaris.csrf="))?.split(";")[0].slice("polaris.csrf=".length);
  assert.ok(token, "real CSRF cookie issued");
  await agent.get("/api/v1/auth/me").expect(200).expect(r => assert.equal(r.body.user.email, email));
  return decodeURIComponent(token);
}
const body = (extra: Record<string, unknown> = {}) => ({
  clientId: client.id, promptIds: [prompt.id], modelIds: [model.id], webSearchEnabled: true, ...extra,
});
async function create(extra: Record<string, unknown> = {}) {
  return adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(body(extra)).expect(201);
}
async function terminal(id: string) {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const run = await storage.getPromptRun(id);
    if (["done", "completed_with_errors", "error", "cancelled"].includes(run!.status)) return run!;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error("Real queued run did not finish within unpaid test deadline");
}

test("real cookie login, CSRF, viewer/member/admin and forged actor/policy requests", async () => {
  await request(app).get("/api/v1/prompt-runs?clientId=" + client.id).expect(401);
  await adminAgent.post("/api/v1/prompt-runs").send(body()).expect(403);
  const view = request.agent(app), viewToken = await login(view, viewer.email);
  await view.post("/api/v1/prompt-runs").set("x-csrf-token", viewToken).send(body()).expect(403);
  const mem = request.agent(app), memToken = await login(mem, member.email);
  await mem.post("/api/v1/prompt-runs").set("x-csrf-token", memToken).send(body({
    createdBy: admin.id, searchConfig: { actor: { validation: true } },
  })).expect(400);
  await adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(body({ webSearchEnabled: "true" })).expect(422);
  await adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(body({ modelIds: [model.id, google.id] })).expect(400);
  await adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(body({ promptIds: [otherPrompt.id] })).expect(400);
  assert.equal(nativeCalls, 0);
  assert.equal((await storage.getPromptRuns(client.id)).length, 0);
});

test("actual queue uses cohort-only alias/Unicode policy; details/rerun reject cross-tenant spoofing", async () => {
  const res = await create({ createdBy: outsider.id });
  const run = await terminal(res.body.run.id);
  assert.equal(run.status, "done");
  assert.equal(run.createdBy, admin.id);
  assert.equal(run.deliverablesStatus, "ready");
  assert.equal(nativeCalls, 1);
  const item = res.body.items[0];
  const view = request.agent(app), token = await login(view, viewer.email);
  for (const action of ["pause", "resume", "stop", "recalculate-position"]) {
    await view.post(`/api/v1/prompt-runs/${run.id}/${action}`).set("x-csrf-token", token)
      .set("x-client-id", otherClient.id).send({ clientId: otherClient.id }).expect(403);
  }
  await view.patch(`/api/v1/prompt-runs/${run.id}`).set("x-csrf-token", token)
    .set("x-client-id", otherClient.id).send({ name: "Forbidden rename" }).expect(403);
  await view.delete(`/api/v1/prompt-runs/${run.id}`).set("x-csrf-token", token)
    .set("x-client-id", otherClient.id).expect(403);
  const path = `/api/v1/prompt-runs/${run.id}/search-evidence/${item.id}`;
  const evidence = await adminAgent.get(path).expect(200);
  assert.equal(evidence.body.phase, "scored");
  assert.equal(evidence.body.evidence.actualModel, "fixture-openai-snapshot");
  assert.equal(evidence.body.evidence.invocationStatus, "invoked");
  assert.equal(evidence.body.evidence.citations[0].providerLocator.unit, "codepoint");
  const foreign = request.agent(app);
  await login(foreign, outsider.email);
  await foreign.get(path).set("x-client-id", otherClient.id).expect(403);
  await foreign.get(`/api/v1/prompt-runs/${run.id}/selections?clientId=${otherClient.id}`).expect(403);
  await adminAgent.get(`/api/v1/prompt-runs/${run.id}/search-evidence/missing`).expect(404);
  const selections = await adminAgent.get(`/api/v1/prompt-runs/${run.id}/selections`).expect(200);
  assert.equal(selections.body.webSearchEnabled, true);
  const rerun = await create({ iterationOf: run.name, webSearchEnabled: selections.body.webSearchEnabled });
  assert.equal((await terminal(rerun.body.run.id)).status, "done");
  assert.equal(nativeCalls, 2);
  const { getSearchEligibility, loadSearchPolicy } = await import("../services/native-web-search/policy");
  assert.equal(getSearchEligibility({ vendor: "openai", model: "fixture-openai", enabled: true },
    loadSearchPolicy()).eligible, false, "unpaid cohort never made model publicly eligible");

  const { aggregateSnapshotData } = await import("../services/report-snapshot");
  const snapshot = await aggregateSnapshotData(client.id, [run.id]);
  retainedSnapshot = structuredClone(snapshot);
  retainedRunId = run.id;
  assert.equal(snapshot.responses[0].answer, prose, "snapshot scorer input remains final prose");
  assert.equal(snapshot.responses[0].nativeSearchEvidence?.actualModel, "fixture-openai-snapshot");
  const { generateEnhancedJSON } = await import("../services/json-exporter");
  const { generateCSVExports } = await import("../services/csv-exporter");
  const clientInfo = { id: client.id, name: "Test Brand", projectName: "Fixture" };
  const exported = generateEnhancedJSON(snapshot, clientInfo, []);
  assert.ok(exported.promptAnalysis[0].modelResponses[0].responseText.includes(source));
  assert.ok(JSON.stringify(generateCSVExports(snapshot, clientInfo, [])).includes(source));
  const broken = structuredClone(snapshot);
  broken.responses[0].nativeSearchEvidence!.citations[0].textEnd = 999999;
  assert.throws(() => generateEnhancedJSON(broken, clientInfo, []));
  assert.throws(() => generateCSVExports(broken, clientInfo, []));
});

test("OFF queue path, legacy omission and strict false preserve ordinary execution", async () => {
  const before = nativeCalls;
  const offBefore = offCalls;
  const res = await create({ webSearchEnabled: false });
  assert.equal((await terminal(res.body.run.id)).status, "done");
  assert.equal(nativeCalls, before);
  assert.equal(offCalls, offBefore + 1);
  const response = await adminAgent.get(`/api/v1/prompt-runs/${res.body.run.id}/search-evidence/${res.body.items[0].id}`).expect(200);
  assert.equal(response.body.phase, "off");
  const legacy = body(); delete legacy.webSearchEnabled;
  const omitted = await adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(legacy).expect(201);
  assert.equal((await terminal(omitted.body.run.id)).status, "done");
  assert.equal(nativeCalls, before);
  assert.equal(offCalls, offBefore + 2);
});

test("actual pause/resume aborts in-flight HTTP and refuses an indeterminate paid replay", async () => {
  const before = nativeCalls;
  const started = new Promise<void>(resolve => { holdNextNative = resolve; });
  const res = await create();
  await started;
  await adminAgent.post(`/api/v1/prompt-runs/${res.body.run.id}/pause`).set("x-csrf-token", csrf).expect(200);
  await queue.drain();
  assert.equal((await storage.getPromptRun(res.body.run.id))!.status, "paused");
  await adminAgent.post(`/api/v1/prompt-runs/${res.body.run.id}/resume`).set("x-csrf-token", csrf).expect(200);
  const run = await terminal(res.body.run.id);
  assert.ok(["error", "completed_with_errors"].includes(run.status));
  assert.equal(nativeCalls, before + 1, "resume must not repeat uncertain provider work");
  const evidence = await adminAgent.get(`/api/v1/prompt-runs/${run.id}/search-evidence/${res.body.items[0].id}`).expect(200);
  assert.equal(evidence.body.evidence.error.code, "INDETERMINATE_GENERATION");
});

test("real membership revocation aborts generation; deletion never refunds cohort allowance", async () => {
  const { eq } = await import("drizzle-orm");
  const started = new Promise<void>(resolve => { holdNextNative = resolve; });
  const res = await create();
  await started;
  try {
    await db.update(schema.userOrgMemberships).set({ role: "viewer" })
      .where(eq(schema.userOrgMemberships.userId, admin.id));
    const run = await terminal(res.body.run.id);
    assert.ok(["error", "completed_with_errors"].includes(run.status));
  } finally {
    await db.update(schema.userOrgMemberships).set({ role: "admin" })
      .where(eq(schema.userOrgMemberships.userId, admin.id));
  }
  const evidence = await adminAgent.get(`/api/v1/prompt-runs/${res.body.run.id}/search-evidence/${res.body.items[0].id}`).expect(200);
  assert.equal(evidence.body.evidence.error.code, "ACCESS_REVOKED");
  await adminAgent.delete(`/api/v1/prompt-runs/${res.body.run.id}`).set("x-csrf-token", csrf).expect(204);
  await adminAgent.get(`/api/v1/prompt-runs/${res.body.run.id}/search-evidence/${res.body.items[0].id}`).expect(404);
  const allowance = await sqlPool.query("SELECT sum(item_count)::int AS n FROM native_search_validation_reservations WHERE approval_ref=$1",
    [cohort.approvalRef]);
  assert.equal(allowance.rows[0].n, 4);
  process.env.POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS = JSON.stringify([{ ...cohort, maxItems: 4 }]);
  const before = nativeCalls;
  await adminAgent.post("/api/v1/prompt-runs").set("x-csrf-token", csrf).send(body()).expect(400);
  assert.equal(nativeCalls, before);
  assert.ok(internalCalls > 0, "record internal calls separately from diagnostic transport");
});

test("attributed PDF and historical snapshot survive original run deletion without provider work", async () => {
  const { appendNativeReportEvidence, nativeReportLinks, linkNativeReportCitations } = await import("../services/native-report-attribution");
  const { generateAppendixHTML } = await import("../services/pdf-template");
  const { renderAppendixToPDF, closeSharedBrowser } = await import("../services/pdf-renderer");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "polaris-native-report-"));
  const counts = { nativeCalls, offCalls, internalCalls };
  const frozen = JSON.stringify(retainedSnapshot);
  try {
    const raw = "## Unpaid report narrative\n\nThis narrative is a fixture, not an AI generation.";
    const content = appendNativeReportEvidence(raw, retainedSnapshot);
    assert.ok(content.includes(source));
    assert.ok(content.includes("Web search: Used"));
    assert.ok(content.includes("fixture-openai-snapshot"));
    assert.equal(JSON.stringify(retainedSnapshot), frozen, "display attribution must not mutate score/snapshot data");
    const off = structuredClone(retainedSnapshot);
    for (const response of off.responses) delete response.nativeSearchEvidence;
    assert.equal(appendNativeReportEvidence(raw, off), raw);
    const unsafe = structuredClone(retainedSnapshot);
    unsafe.responses[0].nativeSearchEvidence!.sources[0].title =
      "<img src='https://example.com/untrusted-image'>";
    const safeHTML = generateAppendixHTML({
      appendixContent: appendNativeReportEvidence(raw, unsafe),
      clientName: "Fixture", generatedDate: "2026-10-21",
    });
    assert.ok(!safeHTML.includes("<img src='https://example.com/untrusted-image'>"));
    assert.ok(safeHTML.includes("&lt;img"));
    const broken = structuredClone(retainedSnapshot);
    broken.responses[0].nativeSearchEvidence!.citations[0].textEnd = 999999;
    assert.throws(() => appendNativeReportEvidence(raw, broken));

    assert.throws(() => linkNativeReportCitations("fixture", [{ number: 1, url: "javascript:alert(1)" }]));
    const template = { appendixContent: content, nativeSearchLinks: nativeReportLinks(retainedSnapshot),
      clientName: "Test Brand", generatedDate: "2026-10-21" };
    const html = generateAppendixHTML(template);
    assert.ok(html.includes(source));
    assert.ok(html.includes("Native Web Search Evidence"));
    assert.ok(html.includes(`<a href="${source}">[1]</a>`));
    const pdfPath = path.join(dir, "native-appendix.pdf");
    const rendered = await renderAppendixToPDF(template, pdfPath);
    assert.ok(rendered.fileSize > 1000);
    const pdf = await fs.readFile(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.includes(Buffer.from(source)), "actual PDF must retain the clickable citation URI");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const text = await promisify(execFile)("pdftotext", [pdfPath, "-"]);
    assert.ok(text.stdout.includes(source), "actual PDF must retain the readable source URI");
    assert.ok(text.stdout.includes("Web search: Used"));

    const [report] = await db.insert(schema.reportSnapshots).values({
      clientId: client.id, projectId: client.id, runIds: [retainedRunId],
      snapshotData: retainedSnapshot as unknown as Record<string, unknown>, generatedBy: admin.id,
    }).returning();
    await db.insert(schema.reportSections).values({
      snapshotId: report.id, sectionName: "diagnostic_appendix", sectionContent: content, sectionOrder: 13,
    });
    await db.insert(schema.reportFiles).values({
      snapshotId: report.id, fileType: "appendix_pdf", fileUrl: pdfPath, fileSize: rendered.fileSize,
    });
    await adminAgent.delete(`/api/v1/prompt-runs/${retainedRunId}`).set("x-csrf-token", csrf).expect(204);
    await adminAgent.get(`/api/v1/prompt-runs/${retainedRunId}`).expect(404);
    const historical = await adminAgent.get(`/api/v1/reports/${report.id}`)
      .set("x-client-id", client.id).expect(200);
    assert.deepEqual(historical.body.report.snapshotData.responses[0].nativeSearchEvidence,
      retainedSnapshot.responses[0].nativeSearchEvidence);
    const download = await adminAgent.get(`/api/v1/reports/${report.id}/download/appendix`)
      .set("x-client-id", client.id).expect(200);
    assert.match(download.headers["content-type"], /application\/pdf/);
    assert.ok(Buffer.isBuffer(download.body));
    assert.deepEqual(download.body, pdf, "historical download returns the actual attributed PDF unchanged");
    const foreign = request.agent(app);
    await login(foreign, outsider.email);
    await foreign.get(`/api/v1/reports/${report.id}`).set("x-client-id", otherClient.id).expect(404);
    await foreign.get(`/api/v1/reports/${report.id}/download/appendix`)
      .set("x-client-id", otherClient.id).expect(404);
    assert.deepEqual({ nativeCalls, offCalls, internalCalls }, counts, "rendering/retrieval must make zero provider calls");
  } finally {
    await closeSharedBrowser();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
