import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { NativeSearchStore, stageNativeScoring } from "../services/native-web-search/store";
import { baseEvidence } from "../services/native-web-search/common";
import type { IStorage } from "../storage";
import type { db } from "../db";
import { NativeRunWorker } from "../services/native-web-search/worker";
import { executeBatch } from "../services/batch-executor";
import { createSearchConfig } from "../../shared/native-web-search";
import { formatNativeAnswerForDisplay } from "../../shared/native-search-display";

// Never fall back to DATABASE_URL. This suite requires an explicitly supplied,
// disposable LOCAL PostgreSQL instance, not the project's database.
const url = process.env.NATIVE_SEARCH_TEST_DATABASE_URL;
const local = url && new URL(url);
if (!local || local.hostname !== "127.0.0.1" || local.port !== "55432") {
  throw new Error("Set NATIVE_SEARCH_TEST_DATABASE_URL to the disposable local server on 127.0.0.1:55432.");
}
const pool = new pg.Pool({ connectionString: url, options: "-c search_path=native_search_r1a" });
const store = new NativeSearchStore(drizzle(pool) as unknown as typeof db);
const fakeStorage = {} as IStorage;
const answerText = "A stable answer mentioning Example Brand.";
const generation = () => ({ answerText, evidence: {
  ...baseEvidence({ provider: "openai", model: "fixture-model" }),
  invocationStatus: "not_invoked" as const,
} });

before(async () => {
  await pool.query("CREATE SCHEMA native_search_r1a");
  // Only the existing tables needed by the real additive upgrade and scorer
  // commits. No project database connection and no application seed data.
  await pool.query(`
    CREATE TABLE prompt_runs (
      id varchar PRIMARY KEY, client_id varchar NOT NULL DEFAULT 'fixture', name text NOT NULL DEFAULT 'Fixture',
      created_by varchar NOT NULL DEFAULT 'fixture', total_prompts int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'running',
      error_summary text, deliverables_status text NOT NULL DEFAULT 'pending', deliverables_error_summary text,
      deliverables_completed_at timestamp, heartbeat_at timestamp, created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE prompt_run_items (
      id varchar PRIMARY KEY, prompt_run_id varchar NOT NULL REFERENCES prompt_runs(id), prompt_id varchar NOT NULL DEFAULT 'p',
      model_id varchar NOT NULL DEFAULT 'm', status text NOT NULL DEFAULT 'running', started_at timestamp,
      finished_at timestamp, error text
    );
    CREATE TABLE answers (
      id varchar PRIMARY KEY, prompt_run_item_id varchar NOT NULL REFERENCES prompt_run_items(id),
      raw_response text NOT NULL, visibility_score numeric, first_mention_pos int, sentiment_score numeric,
      position_score numeric, citation_count int, summary text
    );
    CREATE TABLE citations (
      id varchar DEFAULT gen_random_uuid()::text PRIMARY KEY, answer_id varchar REFERENCES answers(id),
      url text, domain text, display_text text, position int NOT NULL, type text NOT NULL, anchor_text text, is_self_citation boolean
    );
    CREATE TABLE mentions (
      id varchar DEFAULT gen_random_uuid()::text PRIMARY KEY, answer_id varchar REFERENCES answers(id),
      span text NOT NULL, is_alias boolean, sentiment text NOT NULL
    );
    CREATE TABLE rankings (
      id varchar DEFAULT gen_random_uuid()::text PRIMARY KEY, answer_id varchar REFERENCES answers(id),
      item text NOT NULL, position int NOT NULL, is_client_brand boolean, ranking_group text, group_relevance text, relevance_reason text
    );
    CREATE TABLE score_factors (
      id varchar DEFAULT gen_random_uuid()::text PRIMARY KEY, prompt_run_item_id varchar REFERENCES prompt_run_items(id),
      category text NOT NULL, score numeric NOT NULL, relevance_value numeric, position_value numeric,
      positive_mentions int, neutral_mentions int, negative_mentions int, mentions_count int, heading_hits_count int,
      created_at timestamp DEFAULT now()
    );
  `);
  await pool.query(await readFile("migrations/20261020_native_web_search.sql", "utf8"));
});
after(async () => {
  await pool.query("DROP SCHEMA IF EXISTS native_search_r1a CASCADE");
  await pool.end();
});
async function fixture() {
  const runId = randomUUID(), itemId = randomUUID();
  await pool.query("INSERT INTO prompt_runs(id) VALUES($1)", [runId]);
  await pool.query("INSERT INTO prompt_run_items(id,prompt_run_id) VALUES($1,$2)", [itemId, runId]);
  return { runId, itemId };
}
async function score(buffer: IStorage, itemId: string) {
  await buffer.updatePromptRunItem(itemId, { status: "scoring" });
  const answer = await buffer.createAnswer({ promptRunItemId: itemId, rawResponse: answerText,
    visibilityScore: null, positionScore: null, sentimentScore: null, firstMentionPos: null, citationCount: null, summary: null });
  await buffer.createMention({ answerId: answer.id, span: "Example Brand", isAlias: false, sentiment: "positive" });
  await buffer.updateAnswer(answer.id, { visibilityScore: "50", sentimentScore: "60", positionScore: "70", citationCount: 0 });
}

test("concurrent claims have one owner; attempts and generation survive recovery", async () => {
  const f = await fixture();
  const claims = await Promise.allSettled([store.claim(f.itemId, f.runId), store.claim(f.itemId, f.runId)]);
  assert.equal(claims.filter(c => c.status === "fulfilled").length, 1);
  const owner = claims.find(c => c.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof store.claim>>>;
  const token = owner.value.claimToken!;
  await store.begin(f.itemId, token, new Date(Date.now() + 60_000));
  await store.saveAttempt(f.itemId, token, { attemptCount: 1, continuationCount: 0, searchBudgetReserved: 0 });
  await store.saveGeneration(f.itemId, token, generation());
  await store.saveGeneration(f.itemId, token, generation());
  await store.release(f.itemId, token);
  const recovered = await store.claim(f.itemId, f.runId);
  assert.equal(recovered.answerText, answerText);
  assert.equal(recovered.ledger.attemptCount, 1);
  assert.equal(recovered.phase, "generated");
  await assert.rejects(store.saveGeneration(f.itemId, token, generation()), /ownership changed/);
});

test("score facts commit once; replay reuses the canonical answer", async () => {
  const f = await fixture(), owner = await store.claim(f.itemId, f.runId), token = owner.claimToken!;
  await store.saveGeneration(f.itemId, token, generation());
  await store.score(f.itemId, token, fakeStorage, buffer => score(buffer, f.itemId));
  await store.score(f.itemId, token, fakeStorage, () => { throw new Error("must not repeat scoring"); });
  const result = await pool.query("SELECT count(*)::int AS count FROM answers WHERE prompt_run_item_id=$1", [f.itemId]);
  assert.equal(result.rows[0].count, 1);
  assert.equal((await store.assertOwner(f.itemId, token)).phase, "scored");
});

test("partial scoring and late pause leave no partial answer; saved generation is recoverable", async () => {
  const f = await fixture(), owner = await store.claim(f.itemId, f.runId), token = owner.claimToken!;
  await store.saveGeneration(f.itemId, token, generation());
  await assert.rejects(store.score(f.itemId, token, fakeStorage, async buffer => {
    await score(buffer, f.itemId); throw new Error("interrupted scorer");
  }), /interrupted scorer/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM answers WHERE prompt_run_item_id=$1", [f.itemId])).rows[0].n, 0);
  await assert.rejects(store.score(f.itemId, token, fakeStorage, async buffer => {
    await score(buffer, f.itemId);
    await pool.query("UPDATE prompt_runs SET status='paused' WHERE id=$1", [f.runId]);
  }), /ownership changed/);
  assert.equal((await store.assertOwner(f.itemId, token)).answerText, answerText);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM answers WHERE prompt_run_item_id=$1", [f.itemId])).rows[0].n, 0);
  await store.release(f.itemId, token);
  await pool.query("UPDATE prompt_runs SET status='running' WHERE id=$1", [f.runId]);
  const resumed = await store.claim(f.itemId, f.runId);
  await store.score(f.itemId, resumed.claimToken!, fakeStorage, buffer => score(buffer, f.itemId));
});

test("expired workers cannot renew or save; deleting an unscored item cascades evidence", async () => {
  const f = await fixture(), owner = await store.claim(f.itemId, f.runId), token = owner.claimToken!;
  await store.saveGeneration(f.itemId, token, generation());
  await pool.query("UPDATE prompt_run_item_executions SET lease_until=now()-interval '1 second' WHERE item_id=$1", [f.itemId]);
  assert.equal(await store.renew(f.itemId, token), false);
  await assert.rejects(store.saveGeneration(f.itemId, token, generation()), /ownership changed/);
  const next = await store.claim(f.itemId, f.runId);
  assert.notEqual(next.claimToken, token);
  await pool.query("DELETE FROM prompt_run_items WHERE id=$1", [f.itemId]);
  assert.equal((await store.details(f.runId)).length, 0);
});

test("buffer preserves only canonical answer text; metadata cannot become a scoring input", async () => {
  for (const sourceCount of [0, 5, 50]) {
    const fakeNativeMetadata = Array.from({ length: sourceCount }, (_, id) => ({ title: `Other Brand ${id}` }));
    const buffer = stageNativeScoring(fakeStorage, "item", answerText);
    await score(buffer.storage, "item");
    assert.equal(buffer.answer().rawResponse, answerText);
    assert.equal(buffer.answer().visibilityScore, "50");
    assert.equal(buffer.mentions.length, 1);
    assert.ok(!JSON.stringify(buffer.answer()).includes("Other Brand"));
    assert.equal(fakeNativeMetadata.length, sourceCount);
  }
});

test("native worker saves before the sibling barrier; pause preserves text and recovery never repeats generation", async () => {
  const env = {
    POLARIS_NATIVE_WEB_SEARCH_ENABLED: "true", POLARIS_NATIVE_WEB_SEARCH_OPENAI_ENABLED: "true",
    POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT: "fixture",
    POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS: JSON.stringify({ openai: "fixture-account" }),
    POLARIS_NATIVE_WEB_SEARCH_APPROVALS: JSON.stringify([{
      provider: "openai", model: "fixture-model", tool: "web_search", environment: "fixture",
      accountRef: "fixture-account", validatedAt: "2026-10-20T00:00:00.000Z", evidenceRef: "fixture-only",
    }]),
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const f = await fixture(), secondId = randomUUID();
  await pool.query("INSERT INTO prompt_run_items(id,prompt_run_id) VALUES($1,$2)", [secondId, f.runId]);
  const config = { ...createSearchConfig(true), models: { m: { vendor: "OpenAI", model: "fixture-model" } },
    actor: { userId: "operator", tenantId: "fixture", validation: false } };
  let paused = false, callbacks = 0;
  const control = () => { if (paused) throw new Error("Job paused"); };
  const storage = {
    getPromptRun: async () => ({ id: f.runId, status: paused ? "paused" : "running", totalPrompts: 2 }),
    getAiModel: async () => ({ id: "m", vendor: "OpenAI", model: "fixture-model", enabled: true, internalOnly: false }),
  } as unknown as IStorage;
  let unblock!: () => void;
  const sibling = new Promise<void>(resolve => { unblock = resolve; });
  let calls = 0;
  const worker = new NativeRunWorker(storage, f.runId, config, control, {
    store, role: async () => "admin", vendorPaused: async () => false,
    execute: async options => {
      options.checkControl(); await options.assertEligible();
      await options.saveAttempt({ attemptCount: 1, continuationCount: 0, searchBudgetReserved: 0 });
      if (++calls === 2) await sibling;
      return generation();
    },
  });
  try {
    const batch = executeBatch([f.itemId, secondId].map(id => ({
      id, modelId: "m", promptId: "p", promptText: "Fixture", vendor: "OpenAI", model: "fixture-model",
    })), { runId: f.runId, executeItem: item => worker.execute(item),
      checkCancellation: control, onItemComplete: async () => { callbacks++; } });
    // Attach rejection immediately; the intentional pause below must not become
    // an unhandled rejection while inspecting the durable checkpoint.
    const outcome = batch.then(() => null, error => error as Error);
    const until = Date.now() + 5000;
    while ((await store.details(f.runId)).filter(row => row.answerText === answerText).length === 0) {
      if (Date.now() > until) throw new Error("Native checkpoint was not saved before the sibling barrier.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(callbacks, 0);
    paused = true;
    await pool.query("UPDATE prompt_runs SET status='paused' WHERE id=$1", [f.runId]);
    unblock();
    assert.equal((await outcome)?.message, "Job paused");
    assert.equal(callbacks, 0);
    assert.equal((await store.details(f.runId)).filter(row => row.answerText === answerText).length, 2);
    await worker.close();
    paused = false;
    await pool.query("UPDATE prompt_runs SET status='running' WHERE id=$1", [f.runId]);
    const resumed = new NativeRunWorker(storage, f.runId, config, control, { store,
      execute: async () => { throw new Error("Saved generation must not issue another provider call."); } });
    try {
      const result = await resumed.execute({ id: f.itemId, modelId: "m", promptId: "p",
        promptText: "Fixture", vendor: "OpenAI", model: "fixture-model" });
      assert.equal(result.result?.rawResponse, answerText);
      await resumed.score(f.itemId, buffer => score(buffer, f.itemId));
    } finally { await resumed.close(); }
  } finally {
    unblock(); await worker.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("native display exports retain inline citation mapping without changing canonical answer", () => {
  const native = generation();
  native.evidence.invocationStatus = "invoked" as "not_invoked";
  native.evidence.sources = [{ id: "s1", kind: "cited", url: "https://example.com/source", title: "Example" }];
  native.evidence.citations = [{ sourceIds: ["s1"], textStart: 0, textEnd: answerText.length,
    association: "block", providerLocator: { blockIndex: 0, unit: "block" } }];
  const exported = formatNativeAnswerForDisplay(answerText, native.evidence);
  assert.ok(exported.includes(`${answerText} [1](https://example.com/source)`));
  assert.ok(exported.includes("Cited sources"));
  assert.equal(formatNativeAnswerForDisplay(answerText), answerText);
});

test("pilot reservations are cumulative and concurrent admissions cannot exceed the approved allowance", async () => {
  const names = ["POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT", "POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS",
    "POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.POLARIS_NATIVE_WEB_SEARCH_ENVIRONMENT = "fixture";
  process.env.POLARIS_NATIVE_WEB_SEARCH_ACCOUNT_REFS = JSON.stringify({ openai: "fixture-account" });
  process.env.POLARIS_NATIVE_WEB_SEARCH_VALIDATION_COHORTS = JSON.stringify([{
    environment: "fixture", accountRef: "fixture-account", provider: "openai", model: "fixture-model",
    tenantId: "fixture-tenant", operatorId: "fixture-operator", approvalRef: "fixture-cumulative-pilot",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), maxItems: 2, spendCeilingUsd: 1,
  }]);
  try {
    const config = { ...createSearchConfig(true),
      actor: { userId: "fixture-operator", tenantId: "fixture-tenant", validation: true },
      validationApprovals: ["fixture-cumulative-pilot"] };
    const attempts = await Promise.allSettled([
      store.reserveValidation(config, randomUUID(), 2),
      store.reserveValidation(config, randomUUID(), 2),
    ]);
    assert.equal(attempts.filter(attempt => attempt.status === "fulfilled").length, 1);
    await assert.rejects(store.reserveValidation(config, randomUUID(), 1), /allowance is exhausted/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("a failed mandatory generation save cannot enter scoring; completion cannot overwrite a late pause", async () => {
  const f = await fixture(), owner = await store.claim(f.itemId, f.runId), token = owner.claimToken!;
  await pool.query("UPDATE prompt_run_item_executions SET lease_until=now()-interval '1 second' WHERE item_id=$1", [f.itemId]);
  await assert.rejects(store.saveGeneration(f.itemId, token, generation()), /ownership changed/);
  await assert.rejects(store.score(f.itemId, token, fakeStorage, buffer => score(buffer, f.itemId)), /ownership changed/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM answers WHERE prompt_run_item_id=$1", [f.itemId])).rows[0].n, 0);
  await pool.query("UPDATE prompt_runs SET status='paused' WHERE id=$1", [f.runId]);
  await store.completeRun(f.runId, { status: "done" });
  assert.equal((await pool.query("SELECT status FROM prompt_runs WHERE id=$1", [f.runId])).rows[0].status, "paused");
});
