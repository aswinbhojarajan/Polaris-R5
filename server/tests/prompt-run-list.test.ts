/**
 * Integration tests for the paginated prompt-run list endpoint.
 *
 * Covers the run-list performance work:
 *   1. `DbStorage.getPromptRunSummaries` — set-based aggregation correctness
 *      (modelCount + avg scores) against the real database, including NULL
 *      scores, items without answers, runs with no items, ordering,
 *      limit/offset bounds, status/search filters and tenant scoping.
 *   2. GET /api/v1/prompt-runs returns a `{ runs, total, limit, offset }`
 *      envelope with clamped pagination params.
 *
 * Run with:    npx tsx --test server/tests/prompt-run-list.test.ts
 * Requires DATABASE_URL (uses the dev database; all seeded rows are
 * created with fresh UUIDs and removed in cleanup).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { db } = await import('../db');
const { storage } = await import('../storage');
const schema = await import('@shared/schema');
const { eq, inArray } = await import('drizzle-orm');

describe('DbStorage.getPromptRunSummaries (real SQL)', async () => {
  const orgId = `test-org-${randomUUID()}`;
  const clientId = randomUUID();
  const otherClientId = randomUUID();
  const m1 = randomUUID();
  const m2 = randomUUID();
  const p1 = randomUUID();
  const runIds: string[] = [];
  const itemIds: string[] = [];

  // ---- Seed ----
  await db.insert(schema.organizations).values({ id: orgId, name: 'Test Org' });
  await db.insert(schema.clients).values([
    { id: clientId, orgId, projectName: `t-${clientId.slice(0, 8)}`, name: 'T' } as any,
    { id: otherClientId, orgId, projectName: `t-${otherClientId.slice(0, 8)}`, name: 'O' } as any,
  ]);
  await db.insert(schema.aiModels).values([
    { id: m1, vendor: 'test', model: `test-m1-${m1.slice(0, 8)}`, displayName: 'Test M1', enabled: false } as any,
    { id: m2, vendor: 'test', model: `test-m2-${m2.slice(0, 8)}`, displayName: 'Test M2', enabled: false } as any,
  ]);
  await db.insert(schema.prompts).values({ id: p1, clientId, text: 'test prompt', source: 'manual' } as any);

  const mkRun = async (name: string, status: string, createdAt: Date, cid = clientId) => {
    const id = randomUUID();
    runIds.push(id);
    await db.insert(schema.promptRuns).values({
      id, clientId: cid, name, createdBy: 'test', totalPrompts: 1, status, createdAt,
    } as any);
    return id;
  };
  const mkItem = async (runId: string, modelId: string) => {
    const id = randomUUID();
    itemIds.push(id);
    await db.insert(schema.promptRunItems).values({
      id, promptRunId: runId, promptId: p1, modelId, status: 'done',
    } as any);
    return id;
  };
  const mkAnswer = async (itemId: string, vis: string | null, sent: string | null, pos: string | null) => {
    await db.insert(schema.answers).values({
      id: randomUUID(), promptRunItemId: itemId, rawResponse: 'a',
      visibilityScore: vis, sentimentScore: sent, positionScore: pos,
    } as any);
  };

  // run1 (oldest): 2 items / 2 models; one answer full, one with NULL sentiment.
  const run1 = await mkRun('Alpha run', 'done', new Date('2026-01-01T00:00:00Z'));
  const i1 = await mkItem(run1, m1);
  const i2 = await mkItem(run1, m2);
  await mkAnswer(i1, '10', '20', '30');
  await mkAnswer(i2, '30', null, '50');
  // run2: one item, no answer.
  const run2 = await mkRun('Beta run', 'error', new Date('2026-01-02T00:00:00Z'));
  await mkItem(run2, m1);
  // run3 (newest): no items.
  const run3 = await mkRun('Alpha again', 'done', new Date('2026-01-03T00:00:00Z'));
  // Different tenant.
  await mkRun('Other tenant run', 'done', new Date('2026-01-04T00:00:00Z'), otherClientId);

  after(async () => {
    await db.delete(schema.answers).where(inArray(schema.answers.promptRunItemId, itemIds));
    await db.delete(schema.promptRunItems).where(inArray(schema.promptRunItems.id, itemIds));
    await db.delete(schema.promptRuns).where(inArray(schema.promptRuns.id, runIds));
    await db.delete(schema.prompts).where(eq(schema.prompts.id, p1));
    await db.delete(schema.aiModels).where(inArray(schema.aiModels.id, [m1, m2]));
    await db.delete(schema.clients).where(inArray(schema.clients.id, [clientId, otherClientId]));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  test('orders newest-first and respects limit/offset with accurate total', async () => {
    const page1 = await storage.getPromptRunSummaries(clientId, { limit: 2, offset: 0 });
    assert.equal(page1.total, 3);
    assert.deepEqual(page1.runs.map((r) => r.id), [run3, run2]);
    const page2 = await storage.getPromptRunSummaries(clientId, { limit: 2, offset: 2 });
    assert.equal(page2.total, 3);
    assert.deepEqual(page2.runs.map((r) => r.id), [run1]);
  });

  test('computes modelCount and NULL-aware score averages', async () => {
    const { runs } = await storage.getPromptRunSummaries(clientId, { limit: 10, offset: 0 });
    const byId = new Map(runs.map((r) => [r.id, r]));

    const r1 = byId.get(run1)!;
    assert.equal(r1.modelCount, 2);
    assert.equal(r1.avgVisibilityScore, 20); // (10+30)/2
    assert.equal(r1.avgSentimentScore, 20); // NULL ignored → 20/1, not (20+0)/2
    assert.equal(r1.avgPositionScore, 40); // (30+50)/2

    const r2 = byId.get(run2)!;
    assert.equal(r2.modelCount, 1);
    assert.equal(r2.avgVisibilityScore, 0);
    assert.equal(r2.avgSentimentScore, 0);
    assert.equal(r2.avgPositionScore, 0);

    const r3 = byId.get(run3)!;
    assert.equal(r3.modelCount, 0);
    assert.equal(r3.avgVisibilityScore, 0);
  });

  test('status and search filters apply to page AND total', async () => {
    const done = await storage.getPromptRunSummaries(clientId, { limit: 10, offset: 0, status: 'done' });
    assert.equal(done.total, 2);
    assert.deepEqual(done.runs.map((r) => r.id), [run3, run1]);

    const alpha = await storage.getPromptRunSummaries(clientId, { limit: 1, offset: 0, search: 'alpha' });
    assert.equal(alpha.total, 2); // total counts all matches, not just the page
    assert.deepEqual(alpha.runs.map((r) => r.id), [run3]);

    const none = await storage.getPromptRunSummaries(clientId, { limit: 10, offset: 0, search: 'zzz-no-match' });
    assert.equal(none.total, 0);
    assert.equal(none.runs.length, 0);
  });

  test("does not leak other clients' runs", async () => {
    const { runs, total } = await storage.getPromptRunSummaries(clientId, { limit: 10, offset: 0 });
    assert.equal(total, 3);
    assert.ok(runs.every((r) => r.clientId === clientId));
  });
});

describe('GET /api/v1/prompt-runs route envelope', async () => {
  const express = (await import('express')).default;
  const { registerPromptRunRoutes } = await import('../routes/prompt-runs');

  test('returns { runs, total, limit, offset } with clamped params', async () => {
    const app = express();
    app.use(express.json());
    registerPromptRunRoutes(app);

    const seen: any[] = [];
    const orig = (storage as any).getPromptRunSummaries;
    (storage as any).getPromptRunSummaries = async (clientId: string, opts: any) => {
      seen.push({ clientId, opts });
      return { runs: [], total: 0 };
    };
    try {
      const http = await import('node:http');
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as any).port;

      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/prompt-runs?client_id=c1&limit=999&offset=-5&status=done&q=alpha`,
      );
      const body = await res.json();
      server.close();

      assert.equal(res.status, 200);
      assert.deepEqual(body, { runs: [], total: 0, limit: 200, offset: 0 });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].clientId, 'c1');
      assert.deepEqual(seen[0].opts, { limit: 200, offset: 0, status: 'done', search: 'alpha' });
    } finally {
      (storage as any).getPromptRunSummaries = orig;
    }
  });
});
