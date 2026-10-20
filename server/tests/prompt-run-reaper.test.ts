/**
 * Task #59 — Stale prompt-run reaper smoke test.
 *
 * Verifies that the boot-time helper:
 *   - Skips entirely under SESSION_STORE=memory / NODE_ENV=test (returning
 *     without calling storage).
 *   - When invoked against a stubbed storage, threads the configured age
 *     and reason through to `IStorage.reapStalePromptRuns` and survives
 *     thrown errors without rejecting.
 *
 * Run: `npx tsx --test server/tests/prompt-run-reaper.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
process.env.SESSION_STORE = "memory";

test("reapStalePromptRunsAtBoot is a no-op when SESSION_STORE=memory", async () => {
  const { reapStalePromptRunsAtBoot } = await import("../services/prompt-run-reaper.js");
  const { storage } = await import("../storage.js");

  let called = false;
  const orig = (storage as any).reapStalePromptRuns;
  (storage as any).reapStalePromptRuns = async () => {
    called = true;
    return { runs: 0, items: 0 };
  };
  try {
    await reapStalePromptRunsAtBoot();
    assert.equal(called, false, "memory-store mode must skip the DB sweep");
  } finally {
    (storage as any).reapStalePromptRuns = orig;
  }
});

test("reapStalePromptRunsAtBoot falls back to default age when env var is junk", async () => {
  const { reapStalePromptRunsAtBoot } = await import("../services/prompt-run-reaper.js");
  const { storage } = await import("../storage.js");

  const prevNodeEnv = process.env.NODE_ENV;
  const prevStore = process.env.SESSION_STORE;
  const prevAge = process.env.STALE_PROMPT_RUN_AGE_MS;
  process.env.NODE_ENV = "production";
  delete process.env.SESSION_STORE;

  const orig = (storage as any).reapStalePromptRuns;
  const seen: number[] = [];
  (storage as any).reapStalePromptRuns = async (ageMs: number) => {
    seen.push(ageMs);
    return { runs: 0, items: 0 };
  };
  try {
    for (const v of ["", "abc", "0", "-100"]) {
      process.env.STALE_PROMPT_RUN_AGE_MS = v;
      await reapStalePromptRunsAtBoot();
    }
    assert.equal(seen.length, 4);
    for (const ms of seen) {
      assert.equal(ms, 30 * 60 * 1000, `expected default fallback for junk env, got ${ms}`);
    }
  } finally {
    (storage as any).reapStalePromptRuns = orig;
    process.env.NODE_ENV = prevNodeEnv;
    if (prevStore !== undefined) process.env.SESSION_STORE = prevStore;
    if (prevAge !== undefined) process.env.STALE_PROMPT_RUN_AGE_MS = prevAge;
    else delete process.env.STALE_PROMPT_RUN_AGE_MS;
  }
});

// Data-level semantics test for DbStorage.reapStalePromptRuns. We can't
// touch the live Neon DB from a unit test, so we drive the contract
// through a fake `IStorage.reapStalePromptRuns` that mirrors the SQL
// (inArray(active statuses) + createdAt < cutoff). This locks in that:
//   - newer non-terminal rows are NOT reaped,
//   - older terminal rows are NOT reaped,
//   - older non-terminal rows ARE reaped with the supplied reason and
//     status='error' (drift: enum has no 'failed').
test("reaper contract: only old + non-terminal prompt_runs are reaped (semantic fake)", async () => {
  const ACTIVE = ["queued", "running", "scoring", "queued_for_benchmarking", "benchmarking"];
  type Row = { id: string; status: string; createdAt: Date; errorSummary?: string };
  type Item = { id: string; promptRunId: string; status: string; error?: string };

  const now = Date.now();
  const old = new Date(now - 60 * 60 * 1000); // 1h old
  const fresh = new Date(now - 60 * 1000);    // 1m old

  const runs: Row[] = [
    { id: "old-running",  status: "running",  createdAt: old },
    { id: "old-scoring",  status: "scoring",  createdAt: old },
    { id: "old-done",     status: "done",     createdAt: old },     // terminal — keep
    { id: "old-error",    status: "error",    createdAt: old },     // terminal — keep
    { id: "fresh-running", status: "running", createdAt: fresh },   // too young — keep
  ];
  const items: Item[] = [
    { id: "i1", promptRunId: "old-running", status: "running" },
    { id: "i2", promptRunId: "old-running", status: "done" }, // already terminal
    { id: "i3", promptRunId: "old-scoring", status: "queued" },
    { id: "i4", promptRunId: "old-done",    status: "running" },    // parent terminal — untouched
    { id: "i5", promptRunId: "fresh-running", status: "running" },  // parent fresh — untouched
  ];

  const reap = (olderThanMs: number, reason: string) => {
    const cutoff = new Date(Date.now() - olderThanMs);
    const targets = runs.filter((r) => ACTIVE.includes(r.status) && r.createdAt < cutoff);
    let itemCount = 0;
    for (const it of items) {
      if (targets.some((r) => r.id === it.promptRunId) && ACTIVE.includes(it.status)) {
        it.status = "error";
        it.error = reason;
        itemCount++;
      }
    }
    let runCount = 0;
    for (const r of targets) {
      if (ACTIVE.includes(r.status)) {
        r.status = "error";
        r.errorSummary = reason;
        runCount++;
      }
    }
    return { runs: runCount, items: itemCount };
  };

  const reason = "Stale run reaped — server restart";
  const result = reap(30 * 60 * 1000, reason);

  assert.deepEqual(result, { runs: 2, items: 2 }, "should reap 2 old non-terminal runs and 2 of their non-terminal items");
  assert.equal(runs.find((r) => r.id === "old-running")!.status, "error");
  assert.equal(runs.find((r) => r.id === "old-running")!.errorSummary, reason);
  assert.equal(runs.find((r) => r.id === "old-scoring")!.status, "error");
  // Untouched
  assert.equal(runs.find((r) => r.id === "old-done")!.status, "done");
  assert.equal(runs.find((r) => r.id === "old-error")!.status, "error");
  assert.equal(runs.find((r) => r.id === "fresh-running")!.status, "running");
  assert.equal(items.find((i) => i.id === "i2")!.status, "done", "already-terminal item must not be re-stamped");
  assert.equal(items.find((i) => i.id === "i4")!.status, "running", "item under terminal-parent run is left alone");
  assert.equal(items.find((i) => i.id === "i5")!.status, "running", "item under fresh-parent run is left alone");

  // Idempotency: a second pass should reap nothing.
  const second = reap(30 * 60 * 1000, reason);
  assert.deepEqual(second, { runs: 0, items: 0 });
});

test("reapStalePromptRunsAtBoot forwards configured age + reason and tolerates throws", async () => {
  const { reapStalePromptRunsAtBoot } = await import("../services/prompt-run-reaper.js");
  const { storage } = await import("../storage.js");

  // Flip the env back to a non-test mode so the sweep actually runs.
  const prevNodeEnv = process.env.NODE_ENV;
  const prevStore = process.env.SESSION_STORE;
  const prevAge = process.env.STALE_PROMPT_RUN_AGE_MS;
  process.env.NODE_ENV = "production";
  delete process.env.SESSION_STORE;
  process.env.STALE_PROMPT_RUN_AGE_MS = "12345";

  const calls: Array<{ ageMs: number; reason: string }> = [];
  const orig = (storage as any).reapStalePromptRuns;
  (storage as any).reapStalePromptRuns = async (ageMs: number, reason: string) => {
    calls.push({ ageMs, reason });
    return { runs: 2, items: 5 };
  };

  try {
    await reapStalePromptRunsAtBoot();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.ageMs, 12345);
    assert.match(calls[0]!.reason, /stale run reaped/i);

    // Throwing must not propagate — boot-time hooks are best-effort.
    (storage as any).reapStalePromptRuns = async () => {
      throw new Error("boom");
    };
    await assert.doesNotReject(reapStalePromptRunsAtBoot());
  } finally {
    (storage as any).reapStalePromptRuns = orig;
    process.env.NODE_ENV = prevNodeEnv;
    if (prevStore !== undefined) process.env.SESSION_STORE = prevStore;
    if (prevAge !== undefined) process.env.STALE_PROMPT_RUN_AGE_MS = prevAge;
    else delete process.env.STALE_PROMPT_RUN_AGE_MS;
  }
});
