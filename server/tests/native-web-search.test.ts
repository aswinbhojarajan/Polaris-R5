import test from "node:test";
import assert from "node:assert/strict";
import {
  createSearchConfig, readSearchConfig, safeSourceUrl, validateGeneration, MAX_EVIDENCE_BYTES,
} from "../../shared/native-web-search";
import { baseEvidence, failedGeneration, NativeSearchError } from "../services/native-web-search/common";
import { buildOpenAiSearchRequest, normalizeOpenAiSearch } from "../services/native-web-search/openai";
import { buildClaudeSearchRequest, normalizeClaudeSearch } from "../services/native-web-search/claude";
import { assertGeminiGroundingPermitted, buildGeminiSearchRequest, normalizeGeminiSearch } from "../services/native-web-search/gemini";
import { getSearchEligibility, getSearchExecutionPolicy, loadSearchPolicy } from "../services/native-web-search/policy";
import { executeNativeSearch, type NativeSearchOptions } from "../services/native-web-search/runtime";

const ctx = { provider: "openai" as const, model: "fixture-openai" };
const url = "https://example.com/report";
const annotation = { type: "url_citation", url, title: "Example report", start_index: 0, end_index: 4 };
const openAi = () => ({
  id: "resp_fixture", model: ctx.model, status: "completed",
  output: [
    { type: "reasoning", content: [{ type: "summary_text", text: "Never store reasoning." }] },
    { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url, title: "Consulted title" }] } },
    { type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Acme leads.", annotations: [annotation] }] },
  ],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});
const claude = (stop = "end_turn") => ({
  id: "msg_fixture", model: "fixture-claude", stop_reason: stop,
  content: [
    { type: "server_tool_use", id: "tool_1", name: "web_search", input: { query: "synthetic" } },
    { type: "web_search_tool_result", tool_use_id: "tool_1", content: [
      { type: "web_search_result", url, title: "Example", encrypted_content: "DO_NOT_PERSIST_ENCRYPTED" },
    ] },
    { type: "text", text: "Acme leads.", citations: [
      { type: "web_search_result_location", url, title: "Example", cited_text: "A quotation, not an answer offset." },
    ] },
  ],
  usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
});
const google = () => ({
  modelVersion: "fixture-gemini", responseId: "gemini_fixture",
  candidates: [{ finishReason: "STOP", content: { parts: [
    { thought: true, text: "Do not store thoughts." }, { text: "Acme leads." },
  ] }, groundingMetadata: {
    webSearchQueries: ["synthetic query"],
    groundingChunks: [{ web: { uri: url, title: "Example" } }],
    groundingSupports: [{ segment: { partIndex: 1, startIndex: 0, endIndex: 4 }, groundingChunkIndices: [0] }],
    searchEntryPoint: { renderedContent: "<div>Provider suggestions, not executable application HTML.</div>" },
  } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
});
function runtime(overrides: Partial<NativeSearchOptions> = {}): NativeSearchOptions {
  return { provider: "openai", model: ctx.model, prompt: "Synthetic diagnostic",
    instructions: "Fixture instructions", apiKey: "fixture-only-not-a-secret",
    assertEligible: async () => {}, checkControl: () => {}, saveAttempt: async () => {},
    ledger: { attemptCount: 0, continuationCount: 0, searchBudgetReserved: 0 },
    deadlineAt: Date.now() + 10_000, maxRetries: 0, actualModels: [],
    transport: async () => Response.json(openAi()), ...overrides };
}

test("missing search config is OFF; true/false are strict and invalid versions cannot downgrade", () => {
  assert.equal(readSearchConfig(null).webSearch.enabled, false);
  assert.deepEqual(readSearchConfig(createSearchConfig(true)), createSearchConfig(true));
  assert.throws(() => readSearchConfig({ ...createSearchConfig(), version: 2 }));
  assert.throws(() => readSearchConfig({ version: 1, webSearch: { ...createSearchConfig().webSearch, enabled: "true" } }));
});
test("source URLs allow only safe absolute HTTP(S) and reject credentials/controls", () => {
  assert.equal(safeSourceUrl(url), url);
  for (const v of ["javascript:alert(1)", "data:text/html,test", "//example.com", "https://user:pass@example.com",
    "https://example.com\\@evil.com", "https://example.com/\nmalicious", "/relative", null, 123]) {
    assert.equal(safeSourceUrl(v), null, String(v));
  }
});
test("OpenAI normalizer isolates prose and native metadata", () => {
  const result = normalizeOpenAiSearch(openAi(), ctx);
  assert.equal(result.answerText, "Acme leads.");
  assert.equal(result.evidence.invocationStatus, "invoked");
  assert.equal(result.evidence.searchCount, 1);
  assert.equal(result.evidence.actualModel, ctx.model);
  // The provider's consulted list includes the cited URL. It is one cited
  // source, not an additional "other consulted, not cited" source.
  assert.deepEqual(result.evidence.sources.map(s => s.kind), ["cited"]);
  assert.deepEqual(result.evidence.citations[0].sourceIds, [result.evidence.sources[0].id]);
  assert.equal(result.evidence.citations[0].textEnd, 4);
  assert.ok(!JSON.stringify(result).includes("Never store reasoning"));
  assert.ok(!result.answerText.includes("Consulted title"));
});
test("OpenAI keeps all final text blocks and adjusts native offsets after joining", () => {
  const fixture = openAi();
  fixture.output[2].content!.push({ type: "output_text", text: "Acme again.", annotations: [annotation] });
  const result = normalizeOpenAiSearch(fixture, ctx);
  assert.equal(result.answerText, "Acme leads.\n\nAcme again.");
  assert.equal(result.evidence.citations[1].textStart, 13);
});
test("search requested without a native tool action is explicitly not invoked, even with a URL in prose", () => {
  const fixture = { status: "completed", output: [{ type: "message", role: "assistant",
    content: [{ type: "output_text", text: `See ${url}.`, annotations: [] }] }] };
  const result = normalizeOpenAiSearch(fixture, ctx);
  assert.equal(result.evidence.invocationStatus, "not_invoked");
  assert.equal(result.evidence.actualModel, null);
  assert.equal(result.evidence.actualModelEvidence, "not_reported");
  assert.equal(result.evidence.sources.length, 0);
});
test("OpenAI refuses partial/refused/failed-tool output rather than scoring it as success", () => {
  assert.throws(() => normalizeOpenAiSearch({ ...openAi(), status: "incomplete" }, ctx), /did not complete/);
  const fixture = openAi(); fixture.output[1].status = "failed";
  assert.throws(() => normalizeOpenAiSearch(fixture, ctx), /did not complete/);
  assert.throws(() => normalizeOpenAiSearch({ status: "completed", output: [
    { type: "message", role: "assistant", content: [{ type: "refusal" }] },
  ] }, ctx), /declined/);
});
test("mandatory malformed/unsafe attribution fails instead of silently dropping citations", () => {
  const fixture = openAi();
  fixture.output[2].content![0].annotations![0] = { ...annotation, url: "javascript:alert(1)" };
  assert.throws(() => normalizeOpenAiSearch(fixture, ctx), /unsafe/);
  fixture.output[2].content![0].annotations![0] = { ...annotation, end_index: 500 };
  assert.throws(() => normalizeOpenAiSearch(fixture, ctx), /exceeds/);
});
test("unknown native blocks and attribution cannot be silently ignored", () => {
  assert.throws(() => normalizeOpenAiSearch({ ...openAi(), output: [
    { type: "unrequested_tool_call" }, ...openAi().output,
  ] }, ctx), /Unexpected native/);
  const fixture = openAi();
  fixture.output[2].content![0].annotations![0] = { ...annotation, type: "unsupported_citation" };
  assert.throws(() => normalizeOpenAiSearch(fixture, ctx), /Unsupported native/);
});
test("OpenAI Unicode offsets require declared units when ambiguous and map codepoints to UTF16", () => {
  const fixture = openAi();
  fixture.output[2].content![0].text = "😀 Acme";
  fixture.output[2].content![0].annotations![0] = { ...annotation, start_index: 2, end_index: 6 };
  assert.throws(() => normalizeOpenAiSearch(fixture, ctx), /Unicode citation/);
  const result = normalizeOpenAiSearch(fixture, { ...ctx, openAiOffsetUnit: "codepoint" });
  assert.deepEqual([result.evidence.citations[0].textStart, result.evidence.citations[0].textEnd], [3, 7]);
  assert.equal(result.answerText!.slice(3, 7), "Acme");
});
test("Claude basic search uses block attribution, never cited_text as answer offsets", () => {
  const result = normalizeClaudeSearch([claude()], { provider: "anthropic", model: "fixture-claude" });
  assert.equal(result.answerText, "Acme leads.");
  assert.equal(result.evidence.citations[0].association, "block");
  assert.equal(result.evidence.citations[0].textEnd, result.answerText.length);
  assert.equal(result.evidence.usage.webSearchRequests, 1);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_PERSIST"));
  assert.ok(!JSON.stringify(result).includes("quotation"));
});
test("Claude HTTP-200 embedded tool errors and mismatched tool IDs are failures", () => {
  const fixture: any = claude();
  fixture.content[1].content = { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" };
  assert.throws(() => normalizeClaudeSearch([fixture], { provider: "anthropic", model: "fixture-claude" }), /embedded/);
  fixture.content[1].tool_use_id = "missing";
  assert.throws(() => normalizeClaudeSearch([fixture], { provider: "anthropic", model: "fixture-claude" }), /Unmatched/);
});
test("Claude joins pause-turn response blocks in order with bounded continuation", () => {
  const tail = { ...claude(), content: [{ type: "text", text: "Final paragraph." }],
    usage: { input_tokens: 50, output_tokens: 10, server_tool_use: { web_search_requests: 0 } } };
  const result = normalizeClaudeSearch([claude("pause_turn"), tail], { provider: "anthropic", model: "fixture-claude" });
  assert.equal(result.answerText, "Acme leads.\n\nFinal paragraph.");
  assert.equal(result.evidence.continuationCount, 1);
  assert.equal(result.evidence.usage.inputTokens, 150);
  assert.throws(() => normalizeClaudeSearch([claude("pause_turn")], { provider: "anthropic", model: "fixture-claude" }), /did not finish/);
});
test("Claude reports missing usage honestly, and rejects changed reported model identity", () => {
  const fixture = { ...claude(), usage: undefined };
  const result = normalizeClaudeSearch([fixture], { provider: "anthropic", model: "fixture-claude" });
  assert.equal(result.evidence.searchCount, undefined);
  assert.deepEqual(result.evidence.usage, {});
  assert.throws(() => normalizeClaudeSearch([claude("pause_turn"), { ...claude(), model: "swapped" }],
    { provider: "anthropic", model: "fixture-claude" }), /changed reported model/);
});
test("Gemini fixture parser excludes thoughts, maps supports, and never retains raw suggestions HTML", () => {
  const result = normalizeGeminiSearch(google(), { provider: "google", model: "fixture-gemini" });
  assert.equal(result.answerText, "Acme leads.");
  assert.equal(result.evidence.invocationStatus, "invoked");
  assert.equal(result.evidence.citations[0].textEnd, 4);
  assert.equal(result.evidence.hasGoogleSearchSuggestions, true);
  assert.ok(!JSON.stringify(result).includes("<div>"));
  assert.ok(!JSON.stringify(result).includes("Do not store thoughts"));
});
test("Gemini fixture rejects truncation, absent support sources and unverified Unicode mapping", () => {
  const fixture = google();
  fixture.candidates[0].finishReason = "MAX_TOKENS";
  assert.throws(() => normalizeGeminiSearch(fixture, { provider: "google", model: "fixture-gemini" }), /did not finish/);
  fixture.candidates[0].finishReason = "STOP";
  fixture.candidates[0].groundingMetadata.groundingSupports[0].groundingChunkIndices = [9];
  assert.throws(() => normalizeGeminiSearch(fixture, { provider: "google", model: "fixture-gemini" }), /missing web source/);
  fixture.candidates[0].groundingMetadata.groundingSupports[0].groundingChunkIndices = [0];
  fixture.candidates[0].content.parts[1].text = "😀 Acme";
  assert.throws(() => normalizeGeminiSearch(fixture, { provider: "google", model: "fixture-gemini" }), /Unicode mapping/);
});
test("Gemini gate blocks even an injected transport; request builder is REST generateContent, not OpenAI compatibility", async () => {
  let calls = 0;
  assert.throws(assertGeminiGroundingPermitted, /written permission/);
  await assert.rejects(executeNativeSearch(runtime({ provider: "google", transport: async () => {
    calls++; return Response.json(google());
  } })), /written permission/);
  assert.equal(calls, 0);
  const request = buildGeminiSearchRequest("test", "fixture-gemini", "system");
  assert.ok(request.url.endsWith(":generateContent"));
  assert.deepEqual(request.body.tools, [{ google_search: {} }]);
});
test("dedicated request builders preserve selected identity, use native auto tools and bounded tokens", () => {
  const open = buildOpenAiSearchRequest("prompt", "selected-openai", "system");
  assert.equal(open.model, "selected-openai"); assert.equal(open.tool_choice, "auto"); assert.equal(open.store, false);
  assert.equal(open.max_tool_calls, 5);
  const anthropic = buildClaudeSearchRequest("prompt", "selected-claude", "system");
  assert.equal(anthropic.model, "selected-claude"); assert.equal(anthropic.tools[0].type, "web_search_20250305");
  assert.equal(anthropic.tools[0].max_uses, 5);
  assert.throws(() => buildClaudeSearchRequest("prompt", "model", "system", 6));
});
test("evidence bounds omit consulted links explicitly, never required native attribution", () => {
  const evidence = baseEvidence(ctx);
  evidence.invocationStatus = "not_invoked";
  evidence.sources = Array.from({ length: 100 }, (_, i) =>
    ({ id: `s${i}`, kind: "consulted" as const, url: `https://example.com/${"x".repeat(1800)}${i}` }));
  const result = validateGeneration({ answerText: "Plain answer", evidence });
  assert.ok(result.evidence.omittedConsultedSources > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(result.evidence)) <= MAX_EVIDENCE_BYTES);
  assert.equal(evidence.sources.length, 100, "validation must not mutate its input");
  evidence.sources[0] = { ...evidence.sources[0], kind: "cited" as any };
  assert.throws(() => validateGeneration({ answerText: "Plain answer", evidence }), /no inline attribution/);
});
test("failure evidence never exposes arbitrary provider exception text", () => {
  const result = failedGeneration(ctx, new Error("sensitive-provider-request-body"));
  assert.equal(result.answerText, null);
  assert.equal(result.evidence.invocationStatus, "failed");
  assert.ok(!JSON.stringify(result).includes("sensitive-provider"));
});

const fixtureEnv = () => ({
  POLARIS_NATIVE_WEB_SEARCH_ENABLED: "true", POLARIS_NATIVE_WEB_SEARCH_OPENAI_ENABLED: "true",
  POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT: "fixture-environment",
  POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS: JSON.stringify({ openai: "fixture-account" }),
  POLARIS_NATIVE_WEB_SEARCH_APPROVALS: JSON.stringify([{
    provider: "openai", model: ctx.model, tool: "web_search", environment: "fixture-environment",
    accountRef: "fixture-account", validatedAt: "2026-10-20T00:00:00Z", evidenceRef: "fixture-evidence-only",
  }]),
});
test("capabilities fail closed by default, on invalid config, model/account/tool drift and Google terms", () => {
  const model = { vendor: "openai", model: ctx.model, enabled: true };
  assert.equal(getSearchEligibility(model, loadSearchPolicy({})).eligible, false);
  assert.equal(getSearchEligibility(model, loadSearchPolicy(fixtureEnv())).eligible, true);
  assert.equal(getSearchEligibility({ ...model, model: "different" }, loadSearchPolicy(fixtureEnv())).reason, "unverified");
  assert.equal(getSearchEligibility(model, loadSearchPolicy({ ...fixtureEnv(),
    POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS: '{"openai":"changed-account"}' })).eligible, false);
  assert.equal(getSearchEligibility(model, loadSearchPolicy({ ...fixtureEnv(), POLARIS_NATIVE_WEB_SEARCH_APPROVALS: "invalid-json" })).eligible, false);
  assert.equal(getSearchEligibility({ ...model, vendor: "google" }, loadSearchPolicy(fixtureEnv())).reason, "terms_blocked");
  assert.equal(getSearchEligibility({ ...model, vendor: "perplexity" }, loadSearchPolicy(fixtureEnv())).reason, "unsupported");
  assert.equal(getSearchEligibility({ ...model, enabled: false }, loadSearchPolicy(fixtureEnv())).eligible, false);
});
test("validation cohort is scoped and cannot become a public allowlist or ignore its expiry/item ceiling", () => {
  const env = { ...fixtureEnv(), POLARIS_NATIVE_WEB_SEARCH_APPROVALS: "[]",
    POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS: JSON.stringify([{
      provider: "openai", model: ctx.model, accountRef: "fixture-account", environment: "fixture-environment",
      tenantId: "fixture-tenant", operatorId: "fixture-admin", approvalRef: "fixture-approval-only",
      expiresAt: "2026-10-21T00:00:00Z", maxItems: 2, spendCeilingUsd: 1,
    }]) };
  const model = { vendor: "openai", model: ctx.model, enabled: true }, policy = loadSearchPolicy(env);
  const actor = { tenantId: "fixture-tenant", userId: "fixture-admin", isAdmin: true, validation: true, itemCount: 2 };
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(getSearchEligibility(model, policy, actor, now).eligible, true);
  assert.equal(getSearchEligibility(model, policy, undefined, now).eligible, false);
  for (const change of [{ isAdmin: false }, { userId: "other" }, { tenantId: "other" }, { itemCount: 3 }, { validation: false }]) {
    assert.equal(getSearchEligibility(model, policy, { ...actor, ...change }, now).eligible, false);
  }
  assert.equal(getSearchEligibility(model, policy, actor, Date.parse("2026-10-22T00:00:00Z")).eligible, false);
});
test("pilot alias/offset policy is scoped, not public validation, and expires fail-closed", () => {
  const cohort = {
    provider: "openai", model: ctx.model, accountRef: "fixture-account", environment: "fixture-environment",
    tenantId: "fixture-tenant", operatorId: "fixture-admin", approvalRef: "fixture-bootstrap",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), maxItems: 2, spendCeilingUsd: 1,
    actualModels: ["fixture-openai-snapshot"], openAiOffsetUnit: "codepoint",
  };
  const env = { ...fixtureEnv(), POLARIS_NATIVE_WEB_SEARCH_APPROVALS: "[]",
    POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS: JSON.stringify([cohort]) };
  const model = { vendor: "openai", model: ctx.model, enabled: true };
  const actor = { tenantId: cohort.tenantId, userId: cohort.operatorId, isAdmin: true, validation: true, itemCount: 1 };
  const policy = loadSearchPolicy(env);
  assert.equal(getSearchEligibility(model, policy).eligible, false);
  assert.equal(getSearchEligibility(model, policy, actor).reason, "unverified");
  assert.deepEqual(getSearchExecutionPolicy(model, policy, actor)?.actualModels, cohort.actualModels);
  assert.equal(getSearchExecutionPolicy(model, policy, actor)?.openAiOffsetUnit, "codepoint");
  for (const change of [{ isAdmin: false }, { userId: "other" }, { tenantId: "other" },
    { itemCount: 3 }, { validation: false }]) {
    assert.equal(getSearchExecutionPolicy(model, policy, { ...actor, ...change }), undefined);
  }
  const expired = loadSearchPolicy({ ...env, POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS:
    JSON.stringify([{ ...cohort, expiresAt: "2000-01-01T00:00:00Z" }]) });
  assert.equal(getSearchExecutionPolicy(model, expired, actor), undefined);
  const wrongAccount = loadSearchPolicy({ ...env, POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS: '{"openai":"other"}' });
  assert.equal(getSearchExecutionPolicy(model, wrongAccount, actor), undefined);
  const malformed = loadSearchPolicy({ ...env, POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS:
    JSON.stringify([{ ...cohort, openAiOffsetUnit: "guess" }]) });
  assert.equal(malformed.enabled, false);
});

test("runtime saves attempt before native dispatch, with no fallback endpoint/model", async () => {
  const order: string[] = [];
  const result = await executeNativeSearch(runtime({
    saveAttempt: async ledger => { order.push(`saved-${ledger.attemptCount}`); },
    transport: async (endpoint, init) => {
      order.push("dispatch"); assert.equal(endpoint, "https://api.openai.com/v1/responses");
      assert.equal(JSON.parse(init!.body as string).model, ctx.model);
      return Response.json(openAi(), { headers: { "x-request-id": "req_fixture" } });
    },
  }));
  assert.deepEqual(order, ["saved-1", "dispatch"]);
  assert.equal(result.evidence.providerRequestId, "req_fixture");
});
test("runtime never dispatches if durable attempt save or eligibility fails", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return Response.json(openAi()); };
  await executeNativeSearch(runtime({ transport, saveAttempt: async () => { throw new Error("DB unavailable"); } }));
  await executeNativeSearch(runtime({ transport, assertEligible: async () => {
    throw new NativeSearchError("POLICY_DISABLED", "Native search was disabled.");
  } }));
  assert.equal(calls, 0);
});
test("runtime has one bounded retry owner and honors Retry-After without exceeding the item deadline", async () => {
  let calls = 0;
  const result = await executeNativeSearch(runtime({ maxRetries: 2, transport: async () => {
    calls++; return new Response(null, { status: 429, headers: { "retry-after": "600" } });
  } }));
  assert.equal(calls, 1);
  assert.equal(result.evidence.error?.code, "PROVIDER_HTTP_429");
  assert.equal(result.evidence.attemptCount, 1);
});
test("runtime successful transient retry remains bounded and does not use an outer retry layer", async () => {
  let calls = 0;
  const result = await executeNativeSearch(runtime({ maxRetries: 1, transport: async () => {
    calls++; return calls === 1 ? new Response(null, { status: 503 }) : Response.json(openAi());
  } }));
  assert.equal(calls, 2); assert.equal(result.answerText, "Acme leads.");
  assert.equal(result.evidence.attemptCount, 2);
});
test("persisted OpenAI attempt budget is not reset by recovery", async () => {
  let calls = 0;
  const result = await executeNativeSearch(runtime({
    ledger: { attemptCount: 1, searchBudgetReserved: 0, continuationCount: 0 },
    transport: async () => { calls++; return Response.json(openAi()); },
  }));
  assert.equal(calls, 0); assert.equal(result.evidence.error?.code, "ATTEMPT_BUDGET_EXCEEDED");
});
for (const signal of ["Job paused", "Job cancelled", "Run halted by admin disable"]) {
  test(`${signal} aborts active native HTTP and escapes unchanged`, async () => {
    let halted = false, calls = 0;
    await assert.rejects(executeNativeSearch(runtime({
      checkControl: () => { if (halted) throw new Error(signal); },
      transport: async (_endpoint, init) => new Promise<Response>((_resolve, reject) => {
        calls++; halted = true;
        init!.signal!.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
      }),
    })), error => error instanceof Error && error.message === signal);
    assert.equal(calls, 1);
  });
}
test("item deadline aborts provider IO and even a stalled eligibility callback", async () => {
  const pending = () => new Promise<never>(() => {});
  const result = await executeNativeSearch(runtime({ deadlineAt: Date.now() + 30, assertEligible: pending }));
  assert.equal(result.evidence.error?.code, "ITEM_DEADLINE");
  assert.equal(result.evidence.attemptCount, 0);
});
test("runtime rejects a substituted actual model and does not silently score it", async () => {
  const result = await executeNativeSearch(runtime({
    transport: async () => Response.json({ ...openAi(), model: "unapproved-model" }),
  }));
  assert.equal(result.answerText, null);
  assert.equal(result.evidence.error?.code, "MODEL_IDENTITY_MISMATCH");
});
test("Claude continuation preserves encrypted blocks transiently with a decreasing whole-item search budget", async () => {
  let calls = 0;
  const result = await executeNativeSearch(runtime({ provider: "anthropic", model: "fixture-claude",
    transport: async (_endpoint, init) => {
      const body = JSON.parse(init!.body as string); calls++;
      assert.equal(body.tools[0].max_uses, calls === 1 ? 5 : 4);
      if (calls === 2) assert.equal(body.messages[1].content[1].content[0].encrypted_content, "DO_NOT_PERSIST_ENCRYPTED");
      return Response.json(calls === 1 ? claude("pause_turn") : {
        ...claude(), content: [{ type: "text", text: "Final." }],
        usage: { input_tokens: 20, output_tokens: 2, server_tool_use: { web_search_requests: 0 } },
      });
    },
  }));
  assert.equal(calls, 2); assert.equal(result.evidence.continuationCount, 1);
  assert.equal(result.answerText, "Acme leads.\n\nFinal.");
  assert.ok(!JSON.stringify(result).includes("DO_NOT_PERSIST"));
});
test("indeterminate Claude network outcome consumes its reservation, without a paid automatic retry", async () => {
  let calls = 0, reserved = 0;
  const result = await executeNativeSearch(runtime({ provider: "anthropic", model: "fixture-claude", maxRetries: 2,
    saveAttempt: async ledger => { reserved = ledger.searchBudgetReserved; },
    transport: async () => { calls++; throw new TypeError("Network failed"); },
  }));
  assert.equal(calls, 1); assert.equal(reserved, 5); assert.equal(result.answerText, null);
  assert.equal(result.evidence.error?.code, "PROVIDER_NETWORK_ERROR");
});
