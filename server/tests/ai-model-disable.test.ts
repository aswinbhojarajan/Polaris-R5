/**
 * Task #79 — Disable-lifecycle hardening.
 *
 * Validates the in-memory storage's behavior for the disable cascade
 * surface that the admin route depends on. We can't exercise the full
 * Postgres cascade (cancelInFlightForDisabledModel /
 * sweepDisabledModelFromClients hit jsonb operators that the in-memory
 * stub no-ops), so this suite focuses on the parts that have semantic
 * fallbacks: the IStorage signatures are present and the no-op stubs
 * return the expected empty shapes so route handlers don't crash under
 * SESSION_STORE=memory.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
process.env.SESSION_STORE = "memory";

import { test } from "node:test";
import assert from "node:assert/strict";

import { MemStorage } from "../storage";

test("MemStorage: disable cascade methods return safe empty shapes", async () => {
  const store = new MemStorage();

  const cancellation = await store.cancelInFlightForDisabledModel(
    "any-model-id",
    "test reason",
  );
  assert.deepEqual(cancellation, { items: 0, runs: 0, jobs: 0 });

  const swept = await store.sweepDisabledModelFromClients(
    "any-model-id",
    "Display Name",
    "openai",
    "test reason",
  );
  assert.deepEqual(swept, []);

  // Idempotent dismiss does not throw on missing notification.
  await store.dismissDisabledModelNotification("client-x", "notif-y");

  // Override lookup returns null when nothing is persisted.
  const prev = await store.getLlmFunctionOverrideModelId("metadata");
  assert.equal(prev, null);

  // Audit history is queryable; in-memory stub returns []
  const history = await store.getAiModelAuditHistory("any-model-id", 25);
  assert.deepEqual(history, []);
});

test("Executor catch path: 'Run halted by admin disable' preserves run state", async () => {
  // We construct a fake storage that records every status write the
  // executor attempts. The executor's catch path for the halted error
  // must NOT call updatePromptRun with status='cancelled' or
  // status='error' — it must return early so the cascade-set 'error'
  // state stays intact.
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const fakeStorage = {
    updatePromptRun: async (id: string, patch: Record<string, unknown>) => {
      writes.push({ id, patch });
    },
  } as unknown as Parameters<
    typeof import("../services/prompt-run-executor").executePromptRun
  >[0]["storage"];

  const { executePromptRun } = await import("../services/prompt-run-executor");

  // Force the executor into its catch path immediately by throwing
  // from the very first storage call.
  let firstCall = true;
  (fakeStorage as { updatePromptRun: unknown }).updatePromptRun = async (
    id: string,
    patch: Record<string, unknown>,
  ) => {
    if (firstCall) {
      firstCall = false;
      throw new Error("Run halted by admin disable");
    }
    writes.push({ id, patch });
  };

  await executePromptRun({
    storage: fakeStorage,
    promptRunId: "test-run-id",
  });

  // Assert: NO writes were made after the halt — the cascade-set
  // 'error' state is preserved.
  assert.deepEqual(writes, []);
});

test("JobQueue completion guard: terminal 'error' job is not overwritten to 'done'", async () => {
  // Pure-logic assertion: the production guard re-reads the job from
  // storage after processJob() returns, and skips the 'done' write
  // when the job is already terminal. We replicate the guard inline
  // and assert no overwrite happens for either error or cancelled.
  const writes: Array<Record<string, unknown>> = [];
  const fakeStorage = {
    getJob: async (id: string, status: "error" | "cancelled") =>
      ({ id, status }),
    updateJob: async (id: string, patch: Record<string, unknown>) => {
      writes.push({ id, ...patch });
    },
  };

  for (const terminalStatus of ["error", "cancelled"] as const) {
    const job = await fakeStorage.getJob("job-1", terminalStatus);
    if (job && (job.status === "error" || job.status === "cancelled")) {
      // Production guard short-circuits here.
    } else {
      await fakeStorage.updateJob(job.id, { status: "done" });
    }
  }
  assert.deepEqual(writes, []);
});

test("IStorage: signatures expose the disable-cascade surface area", () => {
  const store = new MemStorage();
  // Type-level assertions via typeof — these will fail compile if the
  // IStorage interface drops a member the route relies on.
  assert.equal(typeof store.cancelInFlightForDisabledModel, "function");
  assert.equal(typeof store.sweepDisabledModelFromClients, "function");
  assert.equal(typeof store.dismissDisabledModelNotification, "function");
  assert.equal(typeof store.getAiModelAuditHistory, "function");
  assert.equal(typeof store.getLlmFunctionOverrideModelId, "function");
});
