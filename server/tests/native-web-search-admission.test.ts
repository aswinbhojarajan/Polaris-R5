import { test } from "node:test";
import assert from "node:assert/strict";
import { webSearchEnabledInput } from "../../shared/native-web-search";
import { admitNativeSearch } from "../services/native-web-search/admission";
import type { SearchPolicy } from "../services/native-web-search/policy";

const model = { id: "model-1", vendor: "OpenAI", model: "fixture-model", enabled: true };
const actor = { tenantId: "tenant-1", userId: "operator-1", isAdmin: false, itemCount: 1 };
const policy: SearchPolicy = {
  enabled: true, valid: true, environment: "fixture",
  providerEnabled: { openai: true, anthropic: true, google: false },
  accounts: { openai: "fixture-account" }, cohorts: [],
  approvals: [{ provider: "openai", model: "fixture-model", tool: "web_search",
    environment: "fixture", accountRef: "fixture-account",
    validatedAt: "2026-10-20T00:00:00.000Z", evidenceRef: "synthetic-only", actualModels: [] }],
};

test("the API's shared search input is optional, default-OFF, and strictly boolean", () => {
  assert.equal(webSearchEnabledInput.parse(undefined), false);
  assert.equal(webSearchEnabledInput.parse(false), false);
  assert.equal(webSearchEnabledInput.parse(true), true);
  for (const value of [null, "true", "false", 0, 1, {}, []]) assert.equal(webSearchEnabledInput.safeParse(value).success, false);
});
test("OFF does not apply native eligibility policy or add model routing", () => {
  const result = admitNativeSearch(false, [{ ...model, vendor: "Perplexity" }], actor, policy);
  assert.equal(result.webSearch.enabled, false);
  assert.equal(result.models, undefined);
});
test("ON freezes exact selected identities and the authenticated actor, without account details", () => {
  const selected = [{ ...model }];
  const result = admitNativeSearch(true, selected, actor, policy);
  selected[0].model = "changed-after-admission";
  assert.equal(result.models?.["model-1"].model, "fixture-model");
  assert.equal(result.actor?.tenantId, actor.tenantId);
  assert.equal(result.actor?.userId, actor.userId);
  assert.ok(!JSON.stringify(result).includes("fixture-account"));
});
test("mixed ON selections fail together with actionable IDs; no selected model is removed", () => {
  const selected = [model, { ...model, id: "gemini", vendor: "Google" },
    { ...model, id: "perplexity", vendor: "Perplexity" }, { ...model, id: "unknown", model: "unverified" }];
  assert.throws(() => admitNativeSearch(true, selected, actor, policy), error => {
    const blocked = (error as Error & { blocked: Array<{ modelId: string; reason: string }> }).blocked;
    assert.deepEqual(blocked.map(b => b.modelId), ["gemini", "perplexity", "unknown"]);
    assert.deepEqual(blocked.map(b => b.reason), ["terms_blocked", "unsupported", "unverified"]);
    return true;
  });
  assert.equal(selected.length, 4);
});
test("internal access, current model enablement, account match and provider kill switches remain authoritative", () => {
  assert.throws(() => admitNativeSearch(true, [{ ...model, internalOnly: true }], actor, policy));
  assert.throws(() => admitNativeSearch(true, [{ ...model, enabled: false }], actor, policy));
  assert.throws(() => admitNativeSearch(true, [model], actor, { ...policy, accounts: { openai: "other-account" } }));
  assert.throws(() => admitNativeSearch(true, [model], actor, { ...policy, enabled: false }));
});
test("an approved internal cohort remains tenant/operator/model scoped and never becomes public validation", () => {
  const cohortPolicy: SearchPolicy = { ...policy, approvals: [], cohorts: [{
    provider: "openai", model: "fixture-model", environment: "fixture", accountRef: "fixture-account",
    tenantId: actor.tenantId, operatorId: actor.userId, approvalRef: "fixture-pilot",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), maxItems: 2, spendCeilingUsd: 1,
  }] };
  assert.throws(() => admitNativeSearch(true, [model], actor, cohortPolicy));
  const internalActor = { ...actor, isAdmin: true, validation: true };
  const result = admitNativeSearch(true, [model], internalActor, cohortPolicy);
  assert.deepEqual(result.validationApprovals, ["fixture-pilot"]);
  assert.throws(() => admitNativeSearch(true, [model], { ...internalActor, tenantId: "other-tenant" }, cohortPolicy));
  assert.throws(() => admitNativeSearch(true, [model], { ...internalActor, userId: "other-operator" }, cohortPolicy));
  assert.throws(() => admitNativeSearch(true, [model], { ...internalActor, itemCount: 3 }, cohortPolicy));
});
