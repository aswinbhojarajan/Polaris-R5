/**
 * Integration tests for the per-user project-access admin endpoints
 * Mirrors the real-DB pattern from `credential-grants.test.ts`:
 *
 *   - Skips gracefully if Postgres is unreachable.
 *   - Each test owns its own org / users / projects, cleaned up at the end.
 *   - Uses TEST_AUTH_BYPASS so we don't have to drive a login flow — but the
 *     `requireRole({ scope: 'org' })` guard still runs and is bypassed
 *     identically. The tenant-isolation assertion below validates that the
 *     handler's own constraint (filtering project IDs to the org) holds
 *     regardless of role-guard bypass.
 *
 * Run with:    npx tsx --test server/tests/project-access.test.ts
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.TEST_AUTH_BYPASS = "true";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import request from "supertest";
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";

let app: Express;
let dbReady = false;
let db: typeof import("../db").db;
let schema: typeof import("@shared/schema");
const FIXTURE_TAG = `t26-${randomBytes(4).toString("hex")}`;

let dbModule: typeof import("../db");
before(async () => {
  try {
    dbModule = await import("../db");
    await dbModule.pool.query("SELECT 1");
    db = dbModule.db;
    dbReady = true;
  } catch (err) {
    console.warn(
      "[project-access.test] DB unreachable — skipping suite:",
      (err as Error).message,
    );
    return;
  }
  schema = await import("@shared/schema");
  // The TEST_AUTH_BYPASS shim in server/auth.ts synthesises req.user with
  // id="test-user" — make sure that row exists so FK constraints on
  // granted_by_user_id (project_memberships) and actor_user_id (audit_log)
  // resolve. ON CONFLICT keeps the suite re-runnable.
  await dbModule.pool.query(
    `INSERT INTO users (id, email, password_hash, display_name)
     VALUES ('test-user', 'test-user@test.invalid', 'x', 'Test User')
     ON CONFLICT (id) DO NOTHING`,
  );
  const { registerAdminUserRoutes } = await import("../routes/admin-users");
  app = express();
  app.use(express.json());
  registerAdminUserRoutes(app);
});

after(async () => {
  if (!dbReady) return;
  try {
    const dbModule = await import("../db");
    await dbModule.pool.query(
      `DELETE FROM organizations WHERE name LIKE $1`,
      [`%${FIXTURE_TAG}%`],
    );
    await dbModule.pool.query(
      `DELETE FROM users WHERE email LIKE $1`,
      [`%${FIXTURE_TAG}%@test.invalid`],
    );
  } catch {
    // ignore
  }
});

async function makeOrg() {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Org-${FIXTURE_TAG}-${randomBytes(3).toString("hex")}` })
    .returning();
  return org;
}

async function makeUser(orgId: string, role: "admin" | "member" | "viewer" = "member") {
  const email = `${role}-${randomBytes(4).toString("hex")}-${FIXTURE_TAG}@test.invalid`;
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: "x",
      displayName: email,
    })
    .returning();
  await db.insert(schema.userOrgMemberships).values({
    userId: u.id,
    orgId,
    role,
  });
  return u;
}

async function makeProject(orgId: string, ownerUserId: string | null = null) {
  const tag = randomBytes(4).toString("hex");
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId,
      name: `client-${tag}`,
      projectName: `proj-${tag}`,
      ownerUserId: ownerUserId ?? undefined,
    })
    .returning();
  return c;
}

test("new member starts with zero project memberships (no auto-grandfather)", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const member = await makeUser(org.id, "member");
  await makeProject(org.id);
  await makeProject(org.id);

  const rows = await db
    .select()
    .from(schema.projectMemberships)
    .where(eq(schema.projectMemberships.userId, member.id));
  assert.equal(rows.length, 0, "freshly added member must NOT auto-receive project memberships");
});

test("fresh member sees [] when listing org clients (acceptance)", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  // Asserts the acceptance criterion at the storage boundary that backs
  // GET /api/v1/clients — a fresh non-admin member with no grants must
  // see zero projects, even when projects exist in the org.
  const org = await makeOrg();
  const member = await makeUser(org.id, "member");
  await makeProject(org.id);
  await makeProject(org.id);
  await makeProject(org.id);

  const { storage } = await import("../storage");
  const visible = await storage.getClients(org.id, { userId: member.id, role: "member" });
  assert.deepEqual(visible, [], "fresh non-admin member must see no projects until granted");

  // Sanity: an admin in the same org sees all three projects via the
  // same call, proving the empty result is access-driven, not data-driven.
  const admin = await makeUser(org.id, "admin");
  const adminVisible = await storage.getClients(org.id, { userId: admin.id, role: "admin" });
  assert.equal(adminVisible.length, 3, "admin must see every active project");
});

test("GET project-access reports owner / member / none correctly", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const user = await makeUser(org.id, "member");
  const ownedByUser = await makeProject(org.id, user.id);
  const sharedWithUser = await makeProject(org.id);
  const notShared = await makeProject(org.id);

  await db.insert(schema.projectMemberships).values({
    clientId: sharedWithUser.id,
    userId: user.id,
    grantedByUserId: null,
  });

  const res = await request(app).get(
    `/api/v1/admin/orgs/${org.id}/users/${user.id}/project-access`,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  type ProjectRow = { clientId: string; source: "owner" | "member" | "none"; hasAccess: boolean };
  const byId: Record<string, ProjectRow> = {};
  for (const p of res.body.projects as ProjectRow[]) byId[p.clientId] = p;
  assert.equal(byId[ownedByUser.id].source, "owner");
  assert.equal(byId[ownedByUser.id].hasAccess, true);
  assert.equal(byId[sharedWithUser.id].source, "member");
  assert.equal(byId[sharedWithUser.id].hasAccess, true);
  assert.equal(byId[notShared.id].source, "none");
  assert.equal(byId[notShared.id].hasAccess, false);
});

test("PUT project-access reconciles add+remove and emits audit rows", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const admin = await makeUser(org.id, "admin");
  const target = await makeUser(org.id, "member");
  const projA = await makeProject(org.id);
  const projB = await makeProject(org.id);
  const owned = await makeProject(org.id, target.id);

  // Pre-existing membership on B that should be revoked.
  await db.insert(schema.projectMemberships).values({
    clientId: projB.id,
    userId: target.id,
    grantedByUserId: admin.id,
  });

  const res = await request(app)
    .put(`/api/v1/admin/orgs/${org.id}/users/${target.id}/project-access`)
    .set("x-test-actor-user-id", admin.id)
    .send({ clientIds: [projA.id, owned.id] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.added, 1);
  assert.equal(res.body.removed, 1);

  const memberships = await db
    .select()
    .from(schema.projectMemberships)
    .where(eq(schema.projectMemberships.userId, target.id));
  const ids = memberships.map((m) => m.clientId).sort();
  assert.deepEqual(ids, [projA.id].sort(), "owner project should NOT get a redundant membership row");

  const audits = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, org.id));
  const grants = audits.filter((a) => a.action === "project.member.grant");
  const revokes = audits.filter((a) => a.action === "project.member.revoke");
  assert.deepEqual(grants.map((g) => g.targetId).sort(), [projA.id].sort());
  assert.deepEqual(revokes.map((r) => r.targetId).sort(), [projB.id].sort());
});

test("PUT project-access is idempotent — replaying the same set is a no-op", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const target = await makeUser(org.id, "member");
  const proj = await makeProject(org.id);

  const url = `/api/v1/admin/orgs/${org.id}/users/${target.id}/project-access`;
  const r1 = await request(app).put(url).send({ clientIds: [proj.id] });
  assert.equal(r1.body.added, 1);
  const r2 = await request(app).put(url).send({ clientIds: [proj.id] });
  assert.equal(r2.body.added, 0);
  assert.equal(r2.body.removed, 0);
});

test("PUT project-access ignores cross-tenant project IDs", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const orgA = await makeOrg();
  const orgB = await makeOrg();
  const user = await makeUser(orgA.id, "member");
  const foreign = await makeProject(orgB.id);

  const res = await request(app)
    .put(`/api/v1/admin/orgs/${orgA.id}/users/${user.id}/project-access`)
    .send({ clientIds: [foreign.id] });
  assert.equal(res.status, 200);
  assert.equal(res.body.added, 0, "foreign-org project IDs must be silently dropped");

  const rows = await db
    .select()
    .from(schema.projectMemberships)
    .where(eq(schema.projectMemberships.userId, user.id));
  assert.equal(rows.length, 0);
});

test("PUT project-access rejects unknown user (404)", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const res = await request(app)
    .put(`/api/v1/admin/orgs/${org.id}/users/00000000-0000-0000-0000-000000000000/project-access`)
    .send({ clientIds: [] });
  assert.equal(res.status, 404);
});

test("PUT project-access returns 403 for cross-tenant target user", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  // Admin in orgA targets a real user who only belongs to orgB. Per spec,
  // this is a tenant-isolation failure and must surface as 403, not 404.
  const orgA = await makeOrg();
  const orgB = await makeOrg();
  const userInOrgB = await makeUser(orgB.id, "member");

  const getRes = await request(app).get(
    `/api/v1/admin/orgs/${orgA.id}/users/${userInOrgB.id}/project-access`,
  );
  assert.equal(getRes.status, 403, JSON.stringify(getRes.body));
  const putRes = await request(app)
    .put(`/api/v1/admin/orgs/${orgA.id}/users/${userInOrgB.id}/project-access`)
    .send({ clientIds: [] });
  assert.equal(putRes.status, 403, JSON.stringify(putRes.body));
});

test("PUT project-access validates body shape (400)", async (t) => {
  if (!dbReady) return t.skip("db unreachable");
  const org = await makeOrg();
  const user = await makeUser(org.id, "member");
  const res = await request(app)
    .put(`/api/v1/admin/orgs/${org.id}/users/${user.id}/project-access`)
    .send({ clientIds: "not-an-array" });
  assert.equal(res.status, 400);
});
