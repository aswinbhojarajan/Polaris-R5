/**
 * Task #56 — Multi-user activity visibility smoke test.
 *
 * Verifies the cross-user surface end-to-end at the service layer (no HTTP):
 * user A enqueues a generate-metadata job for project P; the activity
 * service called by user B for the same project must return the job in
 * its `items[]` with attribution metadata so user B's banner / chip can
 * render "{name} started metadata generation {Xago}".
 *
 * Run: `npx tsx --test server/tests/activity-multiuser.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = "test";
process.env.SESSION_STORE = "memory";

test("activity service returns in-flight items with starter attribution for cross-user viewers", async () => {
  const { listActiveActivitiesForClients, getActivitySummaryForClients } =
    await import("../services/activity-service.js");
  const { storage } = await import("../storage.js");

  const CLIENT_ID = "client-aaa";
  const USER_A_ID = "user-aaa";

  const fakeJob = {
    id: "job-1",
    type: "generate_metadata",
    status: "running",
    progress: 42,
    startedAt: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - 60_000),
    startedByUserId: USER_A_ID,
    payload: { clientId: CLIENT_ID },
  };

  const origList = (storage as any).listActiveActivitySources;
  const origUsers = (storage as any).getUsersByIds;

  (storage as any).listActiveActivitySources = async () => ({
    jobs: [fakeJob],
    promptRuns: [],
    reports: [],
  });
  (storage as any).getUsersByIds = async () => [
    { id: USER_A_ID, displayName: "Alice", email: "alice@example.com" },
  ];

  try {
    // User B's perspective — same project, different viewer.
    const items = await listActiveActivitiesForClients([CLIENT_ID]);
    assert.equal(items.length, 1, "user B should see user A's in-flight job");
    const item = items[0]!;
    assert.equal(item.kind, "metadata_generation");
    assert.equal(item.clientId, CLIENT_ID);
    assert.equal(item.startedByUserId, USER_A_ID);
    assert.equal(item.startedByDisplayName, "Alice");
    assert.equal(item.startedByEmail, "alice@example.com");
    assert.equal(item.progress, 42);

    // Catalog summary surface must also include the item for tooltips.
    const summaries = await getActivitySummaryForClients([CLIENT_ID]);
    assert.equal(summaries.length, 1);
    const s = summaries[0]!;
    assert.equal(s.clientId, CLIENT_ID);
    assert.equal(s.count, 1);
    assert.deepEqual(s.kinds, ["metadata_generation"]);
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0]!.startedByDisplayName, "Alice");
  } finally {
    (storage as any).listActiveActivitySources = origList;
    (storage as any).getUsersByIds = origUsers;
  }
});
