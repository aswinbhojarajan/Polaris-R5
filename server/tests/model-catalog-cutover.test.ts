/**
 * DB-backed coverage for the final AI model catalog cutover.
 *
 * The migration is run twice to prove it is safe after either drizzle push or
 * an earlier successful cutover. Skipped only when the test database itself is
 * unavailable.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-only-session-secret-do-not-use-in-prod";

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RELEASED_MODELS = [
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-sonnet-4-5",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const CORE_MODELS = new Set([
  "gpt-5.6-terra",
  "claude-sonnet-5",
  "gemini-3.7-flash",
]);

test("catalog cutover is idempotent and produces the approved live state", async (t) => {
  let pool: typeof import("../db").pool;
  try {
    ({ pool } = await import("../db"));
    await pool.query("SELECT 1");
  } catch (error) {
    return t.skip(`DB unavailable: ${(error as Error).message}`);
  }

  const migrationPath = fileURLToPath(
    new URL("../../migrations/0013_finalize_ai_model_catalog.sql", import.meta.url),
  );
  const migrationSql = await readFile(migrationPath, "utf8");

  await pool.query(migrationSql);
  await pool.query(migrationSql);

  const {
    applyValidatedModelCatalogCutover,
    VALIDATED_CATALOG_CUTOVER_MARKER,
  } = await import("../seed");

  // Recreate representative pre-cutover state in the development test DB.
  // The cutover must repair it once and then preserve later admin choices by
  // becoming a no-op.
  await pool.query(
    `DELETE FROM audit_log
      WHERE action = 'system.ai_model_catalog.cutover'
        AND target_id = $1`,
    [VALIDATED_CATALOG_CUTOVER_MARKER],
  );
  await pool.query(
    `UPDATE ai_models
        SET enabled = false,
            internal_only = true,
            category = 'additional'
      WHERE model = ANY($1::text[])`,
    [RELEASED_MODELS],
  );
  await pool.query(
    `UPDATE ai_models
        SET category = 'core'
      WHERE model = ANY($1::text[])`,
    [["gpt-5.2", "gpt-5.4", "claude-sonnet-4-5", "gemini-2.5-pro"]],
  );

  assert.equal(await applyValidatedModelCatalogCutover(), true);
  assert.equal(await applyValidatedModelCatalogCutover(), false);

  const released = await pool.query<{
    model: string;
    enabled: boolean;
    internal_only: boolean;
    category: "core" | "additional";
  }>(
    `SELECT model, enabled, internal_only, category
       FROM ai_models
      WHERE model = ANY($1::text[])
      ORDER BY model`,
    [RELEASED_MODELS],
  );

  assert.equal(released.rows.length, RELEASED_MODELS.length);
  for (const model of released.rows) {
    assert.equal(model.enabled, true, `${model.model} should be enabled`);
    assert.equal(model.internal_only, false, `${model.model} should be public`);
    assert.equal(
      model.category,
      CORE_MODELS.has(model.model) ? "core" : "additional",
      `${model.model} has the wrong category`,
    );
  }

  const unexpectedCore = await pool.query<{ model: string }>(
    `SELECT model
       FROM ai_models
      WHERE category = 'core'
        AND NOT (model = ANY($1::text[]))`,
    [[...CORE_MODELS]],
  );
  assert.deepEqual(unexpectedCore.rows, []);

  const marker = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM audit_log
      WHERE action = 'system.ai_model_catalog.cutover'
        AND target_id = $1`,
    [VALIDATED_CATALOG_CUTOVER_MARKER],
  );
  assert.equal(marker.rows[0]?.count, "1");
});