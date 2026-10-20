/**
 * Task #10 — Per-project AI model selection persistence.
 *
 * Regression test against the real dev database: clients.selected_ai_model_ids
 * is the canonical store; DbStorage.updateClientModels writes it (validating
 * enabled IDs) and getClientModels reads it back. Specifically exercises a
 * project selecting an OLDER + NEWER version in the same model family
 * (e.g. Claude Opus 4.1 and 4.5) to guard against "latest-only" collapsing.
 *
 * Run: `npx tsx --test server/tests/client-model-selection.test.ts`
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

import { db } from "../db";
import { DbStorage } from "../db-storage";
import { organizations, clients, aiModels } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

const storage = new DbStorage();
const cleanup: { orgId?: string; clientId?: string; modelIds: string[] } = { modelIds: [] };

after(async () => {
  if (cleanup.clientId) await db.delete(clients).where(eq(clients.id, cleanup.clientId));
  if (cleanup.orgId) await db.delete(organizations).where(eq(organizations.id, cleanup.orgId));
  if (cleanup.modelIds.length) await db.delete(aiModels).where(inArray(aiModels.id, cleanup.modelIds));
});

async function setup() {
  const [org] = await db.insert(organizations).values({ name: "task10-test-org" }).returning();
  cleanup.orgId = org.id;
  const [client] = await db
    .insert(clients)
    .values({ orgId: org.id, projectName: "task10-test-project", name: "Task10 Co" })
    .returning();
  cleanup.clientId = client.id;

  const rows = await db
    .insert(aiModels)
    .values([
      { vendor: "anthropic", model: "task10-claude-opus-4-1", displayName: "T10 Claude Opus 4.1", enabled: true },
      { vendor: "anthropic", model: "task10-claude-opus-4-5", displayName: "T10 Claude Opus 4.5", enabled: true },
      { vendor: "openai", model: "task10-gpt-x", displayName: "T10 GPT X", enabled: true },
      { vendor: "openai", model: "task10-disabled", displayName: "T10 Disabled", enabled: false },
    ])
    .returning();
  cleanup.modelIds = rows.map((r) => r.id);
  return { client, models: rows };
}

test("per-project model selection persists, incl. two versions of the same family", async () => {
  const { client, models } = await setup();
  const [opus41, opus45, gptx, disabled] = models;

  // Save older + newer version of the same family together.
  await storage.updateClientModels(client.id, [opus41.id, opus45.id]);

  // Canonical column holds exactly the selection.
  const [row] = await db
    .select({ selectedAiModelIds: clients.selectedAiModelIds })
    .from(clients)
    .where(eq(clients.id, client.id));
  assert.deepEqual(row.selectedAiModelIds, [opus41.id, opus45.id]);

  // Read path returns exactly the selection (not all enabled models).
  const selected = await storage.getClientModels(client.id);
  assert.deepEqual(
    selected.map((m) => m.id),
    [opus41.id, opus45.id],
  );

  // Re-save with a different set replaces the previous selection.
  await storage.updateClientModels(client.id, [gptx.id]);
  const replaced = await storage.getClientModels(client.id);
  assert.deepEqual(replaced.map((m) => m.id), [gptx.id]);

  // Disabled model ids are rejected — no silent partial writes.
  await assert.rejects(
    () => storage.updateClientModels(client.id, [gptx.id, disabled.id]),
    /Invalid or disabled/,
  );
  const afterReject = await storage.getClientModels(client.id);
  assert.deepEqual(afterReject.map((m) => m.id), [gptx.id]);

  // Empty selection is stored as an explicit empty array.
  await storage.updateClientModels(client.id, []);
  assert.deepEqual(await storage.getClientModels(client.id), []);

  // Model disabled AFTER selection is filtered out on read.
  await storage.updateClientModels(client.id, [opus41.id, gptx.id]);
  await db.update(aiModels).set({ enabled: false }).where(eq(aiModels.id, opus41.id));
  const filtered = await storage.getClientModels(client.id);
  assert.deepEqual(filtered.map((m) => m.id), [gptx.id]);

  // Unknown client id errors instead of silently succeeding.
  await assert.rejects(() => storage.updateClientModels("00000000-0000-0000-0000-000000000000", []));
});

test("Task #15 — null selection backfills enabled core models instead of all-model fanout", async () => {
  // Fresh client with NULL selected_ai_model_ids (legacy project).
  const [legacy] = await db
    .insert(clients)
    .values({ orgId: cleanup.orgId!, projectName: "task15-legacy-project", name: "Task15 Co" })
    .returning();
  const legacyId = legacy.id;

  // Dedicated marker models: one enabled core, one enabled additional, one disabled core.
  const rows = await db
    .insert(aiModels)
    .values([
      { vendor: "test", model: "task15-core-on", displayName: "T15 Core On", enabled: true, category: "core" },
      { vendor: "test", model: "task15-additional-on", displayName: "T15 Additional On", enabled: true, category: "additional" },
      { vendor: "test", model: "task15-core-off", displayName: "T15 Core Off", enabled: false, category: "core" },
    ])
    .returning();
  cleanup.modelIds.push(...rows.map((r) => r.id));
  const [coreOn, additionalOn, coreOff] = rows;

  try {
    const result = await storage.getClientModels(legacyId);
    const resultIds = new Set(result.map((m) => m.id));

    // Returns exactly the enabled core catalog — no additional/disabled models.
    const enabledCore = await db
      .select({ id: aiModels.id })
      .from(aiModels)
      .where(and(eq(aiModels.enabled, true), eq(aiModels.category, "core")));
    assert.deepEqual(resultIds, new Set(enabledCore.map((r) => r.id)));
    assert.ok(resultIds.has(coreOn.id));
    assert.ok(!resultIds.has(additionalOn.id));
    assert.ok(!resultIds.has(coreOff.id));

    // The default is persisted on the row (no longer NULL).
    const [row] = await db
      .select({ selectedAiModelIds: clients.selectedAiModelIds })
      .from(clients)
      .where(eq(clients.id, legacyId));
    assert.ok(Array.isArray(row.selectedAiModelIds));
    assert.deepEqual(new Set(row.selectedAiModelIds as string[]), resultIds);

    // Second read is served from the persisted selection (stable).
    const again = await storage.getClientModels(legacyId);
    assert.deepEqual(new Set(again.map((m) => m.id)), resultIds);

    // An explicit user selection is never overwritten by the backfill path.
    await storage.updateClientModels(legacyId, [additionalOn.id]);
    const explicit = await storage.getClientModels(legacyId);
    assert.deepEqual(explicit.map((m) => m.id), [additionalOn.id]);

    // Nonexistent client returns [] rather than fanning out to all models.
    assert.deepEqual(await storage.getClientModels("00000000-0000-0000-0000-000000000000"), []);
  } finally {
    await db.delete(clients).where(eq(clients.id, legacyId));
  }
});
