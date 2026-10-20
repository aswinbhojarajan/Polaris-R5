/**
 * Task #19 migration-script idempotency tests.
 *
 * Verifies the audit-rename and rotation-sweep CLI scripts can be safely
 * re-run after the post_merge_setup hook fires (or after a manual retry)
 * without double-flipping or re-renaming rows.
 *
 * Skipped automatically if DATABASE_URL is not reachable.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-only-session-secret-do-not-use-in-prod";

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";

let dbReady = false;
let db: typeof import("../db").db;
let schema: typeof import("@shared/schema");
let runRotationSweep: typeof import("../scripts/rotation-sweep").runRotationSweep;
let runAuditRename: typeof import("../scripts/audit-rename").runAuditRename;
let AUDIT_RENAME_MAP: typeof import("../scripts/audit-rename").AUDIT_RENAME_MAP;

before(async () => {
  try {
    const dbModule = await import("../db");
    await dbModule.pool.query("SELECT 1");
    db = dbModule.db;
    dbReady = true;
  } catch (err) {
    console.warn(
      "[task19-migrations.test] DB unreachable — skipping:",
      (err as Error).message,
    );
    return;
  }
  schema = await import("@shared/schema");
  ({ runRotationSweep } = await import("../scripts/rotation-sweep"));
  const auditRename = await import("../scripts/audit-rename");
  runAuditRename = auditRename.runAuditRename;
  AUDIT_RENAME_MAP = auditRename.AUDIT_RENAME_MAP;
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}@test.invalid`;
}

test("rotation-sweep: flags users with null/old password_changed_at then is a no-op on re-run", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const { eq } = await import("drizzle-orm");

  // Three test users:
  //   - U1: password_changed_at NULL (legacy) -> should be flagged
  //   - U2: password_changed_at < cutoff      -> should be flagged
  //   - U3: password_changed_at > cutoff      -> should NOT be flagged
  const cutoff = new Date("2026-04-01T00:00:00.000Z");
  const u1Email = uniqueEmail("sweep-u1");
  const u2Email = uniqueEmail("sweep-u2");
  const u3Email = uniqueEmail("sweep-u3");
  const [u1] = await db.insert(schema.users).values({
    email: u1Email,
    passwordHash: "$argon2id$placeholder",
    passwordChangedAt: null,
    mustChangeOnNextLogin: false,
  }).returning();
  const [u2] = await db.insert(schema.users).values({
    email: u2Email,
    passwordHash: "$argon2id$placeholder",
    passwordChangedAt: new Date("2025-01-01T00:00:00.000Z"),
    mustChangeOnNextLogin: false,
  }).returning();
  const [u3] = await db.insert(schema.users).values({
    email: u3Email,
    passwordHash: "$argon2id$placeholder",
    passwordChangedAt: new Date("2026-09-01T00:00:00.000Z"),
    mustChangeOnNextLogin: false,
  }).returning();

  const first = await runRotationSweep(cutoff);
  assert.ok(first.flagged >= 2, `expected ≥2 flagged, got ${first.flagged}`);

  const u1After = (await db.select().from(schema.users).where(eq(schema.users.id, u1.id)))[0];
  const u2After = (await db.select().from(schema.users).where(eq(schema.users.id, u2.id)))[0];
  const u3After = (await db.select().from(schema.users).where(eq(schema.users.id, u3.id)))[0];
  assert.equal(u1After.mustChangeOnNextLogin, true, "U1 (null) flagged");
  assert.equal(u2After.mustChangeOnNextLogin, true, "U2 (old) flagged");
  assert.equal(u3After.mustChangeOnNextLogin, false, "U3 (fresh) untouched");

  // Idempotency: second run flags zero of OUR users (other races may flip
  // unrelated rows so we only assert on our three).
  const second = await runRotationSweep(cutoff);
  const u1Re = (await db.select().from(schema.users).where(eq(schema.users.id, u1.id)))[0];
  const u2Re = (await db.select().from(schema.users).where(eq(schema.users.id, u2.id)))[0];
  const u3Re = (await db.select().from(schema.users).where(eq(schema.users.id, u3.id)))[0];
  assert.equal(u1Re.mustChangeOnNextLogin, true);
  assert.equal(u2Re.mustChangeOnNextLogin, true);
  assert.equal(u3Re.mustChangeOnNextLogin, false);
  assert.ok(
    second.alreadyFlagged >= 2,
    `expected ≥2 already-flagged on re-run, got ${second.alreadyFlagged}`,
  );

  // Cleanup
  for (const id of [u1.id, u2.id, u3.id]) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
});

test("audit-rename: rewrites legacy invitation actions then is a no-op on re-run", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const { eq, and } = await import("drizzle-orm");

  // Seed one legacy row per mapping entry, scoped by a synthetic targetId
  // so we can find them again without relying on actorUserId / orgId.
  const marker = `task19-test-${randomBytes(4).toString("hex")}`;
  const legacyActions = Object.keys(AUDIT_RENAME_MAP);
  for (const action of legacyActions) {
    await db.insert(schema.auditLog).values({
      action,
      targetType: "test",
      targetId: marker,
      metadata: { marker },
    });
  }

  const first = await runAuditRename();
  assert.ok(first.total >= legacyActions.length);

  for (const [from, to] of Object.entries(AUDIT_RENAME_MAP)) {
    const stillLegacy = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, marker), eq(schema.auditLog.action, from)));
    assert.equal(stillLegacy.length, 0, `${from} should be renamed`);
    const renamed = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, marker), eq(schema.auditLog.action, to)));
    assert.equal(renamed.length, 1, `${to} should exist`);
  }

  // Second run is a no-op — no rows still match the legacy names.
  const second = await runAuditRename();
  for (const from of legacyActions) {
    assert.equal(
      second.renamed[from],
      0,
      `re-run should rename 0 of ${from}, got ${second.renamed[from]}`,
    );
  }

  // Cleanup
  await db.delete(schema.auditLog).where(eq(schema.auditLog.targetId, marker));
});
