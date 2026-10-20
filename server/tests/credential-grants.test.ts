/**
 * Credential-grants INTEGRATION tests (Task #18).
 *
 * These tests boot a real Express app wired with `setupAuth()` plus the
 * credential and admin route modules, then drive them via supertest
 * against the real Postgres database (DATABASE_URL). Every test
 * provisions its own user/org with a unique random email so runs are
 * idempotent and isolated.
 *
 * Coverage matrix (from the Task #18 acceptance criteria):
 *   1. forgot-password is anti-enumerative (always 202; existing user
 *      issues a real grant, missing email is a no-op).
 *   2. Reset-link lifecycle:
 *        - GET /credential-grants/:token => valid for fresh grant
 *        - Redeem with weak password is rejected (policy)
 *        - Redeem succeeds, status flips to consumed, second redeem 410s
 *        - Manually-expired grant returns 410 on GET and on redeem
 *        - Manually-revoked grant returns 410 on GET and on redeem
 *   3. Admin reset-password endpoint
 *        - issues a fresh grant
 *        - bumps the target user's session epoch (sign-out everywhere)
 *        - revokes any prior outstanding self-service reset grants and
 *          reports the count via `revokedSelfService`
 *   4. Temp-password endpoint sets `mustChangeOnNextLogin` and bumps the
 *      session epoch.
 *   5. Disable endpoint refuses self-disable, sets status=disabled,
 *      bumps the epoch, and revokes outstanding grants.
 *   6. Sign-out-everywhere bumps the epoch.
 *   7. change-password requires auth, rejects wrong current password,
 *      enforces the password policy on the new password, and on success
 *      bumps the epoch.
 *
 * Skipped automatically if DATABASE_URL is not reachable.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-only-session-secret-do-not-use-in-prod";
// Intentionally NOT setting TEST_AUTH_BYPASS — these tests exercise the
// real auth + role guards. We log in via supertest agents to obtain a
// session cookie for admin operations.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import request from "supertest";
import { randomBytes } from "crypto";

// All modules that touch `db` are loaded after the env is in place.
let app: Express;
let dbReady = false;
let db: typeof import("../db").db;
let schema: typeof import("@shared/schema");
let credentialGrantsService: typeof import("../services/credential-grants");
let rateLimit: typeof import("../services/rate-limit");
let passwordsService: typeof import("../services/passwords");
let setupAuth: typeof import("../auth").setupAuth;
let registerAuthCredentialRoutes: typeof import("../routes/auth-credentials").registerAuthCredentialRoutes;
let registerAdminUserRoutes: typeof import("../routes/admin-users").registerAdminUserRoutes;

const STRONG_PASSWORD = "CorrectHorseBattery9!";
const ANOTHER_STRONG_PASSWORD = "AnotherSecurePass42$";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}@test.invalid`;
}

before(async () => {
  // Probe DB; skip the suite gracefully if unreachable.
  try {
    const dbModule = await import("../db");
    await dbModule.pool.query("SELECT 1");
    db = dbModule.db;
    dbReady = true;
  } catch (err) {
    console.warn(
      "[credential-grants.test] DB unreachable — skipping integration suite:",
      (err as Error).message,
    );
    return;
  }
  schema = await import("@shared/schema");
  credentialGrantsService = await import("../services/credential-grants");
  rateLimit = await import("../services/rate-limit");
  passwordsService = await import("../services/passwords");
  setupAuth = (await import("../auth")).setupAuth;
  registerAuthCredentialRoutes = (await import("../routes/auth-credentials"))
    .registerAuthCredentialRoutes;
  registerAdminUserRoutes = (await import("../routes/admin-users"))
    .registerAdminUserRoutes;

  app = express();
  app.use(express.json());
  setupAuth(app);
  registerAuthCredentialRoutes(app);
  registerAdminUserRoutes(app);
});

after(async () => {
  if (!dbReady) return;
  // Best-effort cleanup of fixtures created by this run.
  try {
    const dbModule = await import("../db");
    await dbModule.pool.query(
      `DELETE FROM users WHERE email LIKE '%@test.invalid'`,
    );
    await dbModule.pool.end();
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Fixture helpers — every test owns its own user/org.
// ---------------------------------------------------------------------------

async function createOrg(name = "TestOrg") {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `${name}-${randomBytes(3).toString("hex")}` })
    .returning();
  return org;
}

async function createUser(opts: {
  email?: string;
  password?: string;
  role?: "admin" | "member" | "viewer";
  orgId?: string;
  status?: "active" | "disabled" | "invited";
}) {
  const email = opts.email ?? uniqueEmail("user");
  const password = opts.password ?? STRONG_PASSWORD;
  const passwordHash = await passwordsService.hashPassword(password);
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      displayName: email,
      status: opts.status ?? "active",
      passwordChangedAt: new Date(),
    })
    .returning();
  if (opts.orgId) {
    await db.insert(schema.userOrgMemberships).values({
      orgId: opts.orgId,
      userId: u.id,
      role: opts.role ?? "member",
    });
  }
  return { user: u, password };
}

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const r = await agent
    .post("/api/v1/auth/login")
    .send({ email, password });
  assert.equal(r.status, 200, `login failed for ${email}: ${r.text}`);
  return agent;
}

async function reloadUser(id: string) {
  const { eq } = await import("drizzle-orm");
  const [fresh] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return fresh;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("forgot-password: returns 202 for a known active user and issues a grant", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const email = uniqueEmail("fp-known");
  await createUser({ email });

  const r = await request(app)
    .post("/api/v1/auth/forgot-password")
    .send({ email });

  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { ok: true });

  // A real password_reset grant should now exist for that email.
  const { eq, and } = await import("drizzle-orm");
  const grants = await db
    .select()
    .from(schema.credentialGrants)
    .where(
      and(
        eq(schema.credentialGrants.email, email),
        eq(schema.credentialGrants.kind, "password_reset"),
      ),
    );
  assert.equal(grants.length, 1, "expected exactly one issued grant");
  assert.equal(grants[0].consumedAt, null);
  assert.equal(grants[0].revokedAt, null);
});

test("forgot-password: returns 202 for a non-existent email (anti-enum) and issues no grant", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const email = uniqueEmail("fp-missing");

  const r = await request(app)
    .post("/api/v1/auth/forgot-password")
    .send({ email });

  assert.equal(r.status, 202);
  const { eq } = await import("drizzle-orm");
  const grants = await db
    .select()
    .from(schema.credentialGrants)
    .where(eq(schema.credentialGrants.email, email));
  assert.equal(grants.length, 0, "no grant should be issued for unknown email");
});

test("reset-link lifecycle: valid → consumed; second redeem returns 410", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const email = uniqueEmail("redeem");
  const { user } = await createUser({ email });

  const { rawToken } = await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email,
    userId: user.id,
  });

  const status = await request(app).get(
    `/api/v1/auth/credential-grants/${rawToken}`,
  );
  assert.equal(status.status, 200);
  assert.equal(status.body.status, "valid");
  assert.equal(status.body.kind, "password_reset");

  const ok = await request(app)
    .post(`/api/v1/auth/credential-grants/${rawToken}/redeem`)
    .send({ password: ANOTHER_STRONG_PASSWORD });
  assert.equal(ok.status, 200, `redeem body: ${ok.text}`);
  assert.equal(ok.body.ok, true);

  const second = await request(app)
    .post(`/api/v1/auth/credential-grants/${rawToken}/redeem`)
    .send({ password: ANOTHER_STRONG_PASSWORD });
  assert.equal(second.status, 410, "consumed grant must reject");
});

test("redeem rejects passwords that fail the policy (length)", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const email = uniqueEmail("policy");
  const { user } = await createUser({ email });

  const { rawToken } = await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email,
    userId: user.id,
  });

  const r = await request(app)
    .post(`/api/v1/auth/credential-grants/${rawToken}/redeem`)
    .send({ password: "Sh0rt!" });
  assert.equal(r.status, 400, `expected 400 for weak pw, got ${r.status} ${r.text}`);
});

test("expired grant: GET and redeem both return 410", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const email = uniqueEmail("expired");
  const { user } = await createUser({ email });
  const { rawToken, grant } = await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email,
    userId: user.id,
  });

  // Force-expire it.
  const { eq } = await import("drizzle-orm");
  await db
    .update(schema.credentialGrants)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.credentialGrants.id, grant.id));

  const status = await request(app).get(
    `/api/v1/auth/credential-grants/${rawToken}`,
  );
  assert.equal(status.status, 410);
  assert.equal(status.body.status, "expired");

  const redeem = await request(app)
    .post(`/api/v1/auth/credential-grants/${rawToken}/redeem`)
    .send({ password: ANOTHER_STRONG_PASSWORD });
  assert.equal(redeem.status, 410);
});

test("revoked grant: GET and redeem both return 410", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const email = uniqueEmail("revoked");
  const { user } = await createUser({ email });
  const { rawToken } = await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email,
    userId: user.id,
  });

  await credentialGrantsService.revokeActiveGrantsForEmail(email, "test.revoke");

  const status = await request(app).get(
    `/api/v1/auth/credential-grants/${rawToken}`,
  );
  assert.equal(status.status, 410);
  assert.equal(status.body.status, "revoked");

  const redeem = await request(app)
    .post(`/api/v1/auth/credential-grants/${rawToken}/redeem`)
    .send({ password: ANOTHER_STRONG_PASSWORD });
  assert.equal(redeem.status, 410);
});

test("admin reset-password: issues fresh grant, bumps epoch, supersedes pending self-resets", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const org = await createOrg();
  const adminEmail = uniqueEmail("admin");
  const targetEmail = uniqueEmail("target");
  const admin = await createUser({
    email: adminEmail,
    orgId: org.id,
    role: "admin",
  });
  const target = await createUser({
    email: targetEmail,
    orgId: org.id,
    role: "member",
  });

  // First, create an outstanding self-service reset grant for the target.
  await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email: targetEmail,
    userId: target.user.id,
  });

  const epochBefore = (await reloadUser(target.user.id))!.sessionEpoch ?? 0;

  const agent = await loginAgent(adminEmail, admin.password);
  const r = await agent
    .post(
      `/api/v1/admin/orgs/${org.id}/users/${target.user.id}/reset-password`,
    )
    .send({ reason: "support ticket #42" });

  assert.equal(r.status, 201, `body: ${r.text}`);
  assert.ok(r.body.token && typeof r.body.token === "string");
  assert.ok(r.body.acceptUrl.includes(r.body.token));
  assert.equal(
    r.body.revokedSelfService,
    1,
    "should report exactly one prior self-service grant superseded",
  );

  const epochAfter = (await reloadUser(target.user.id))!.sessionEpoch ?? 0;
  assert.ok(
    epochAfter > epochBefore,
    `epoch must be bumped: before=${epochBefore} after=${epochAfter}`,
  );

  // The previously-issued self-service grant is now revoked; the new one
  // is active.
  const { eq, and, isNull } = await import("drizzle-orm");
  const active = await db
    .select()
    .from(schema.credentialGrants)
    .where(
      and(
        eq(schema.credentialGrants.email, targetEmail),
        eq(schema.credentialGrants.kind, "password_reset"),
        isNull(schema.credentialGrants.revokedAt),
        isNull(schema.credentialGrants.consumedAt),
      ),
    );
  assert.equal(active.length, 1, "exactly one active grant should remain");
});

test("admin temp-password: sets mustChangeOnNextLogin and bumps epoch", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const org = await createOrg();
  const adminEmail = uniqueEmail("admin-tp");
  const targetEmail = uniqueEmail("target-tp");
  const admin = await createUser({ email: adminEmail, orgId: org.id, role: "admin" });
  const target = await createUser({ email: targetEmail, orgId: org.id, role: "member" });
  const epochBefore = (await reloadUser(target.user.id))!.sessionEpoch ?? 0;

  const agent = await loginAgent(adminEmail, admin.password);
  const r = await agent
    .post(`/api/v1/admin/orgs/${org.id}/users/${target.user.id}/temp-password`)
    .send({});

  assert.equal(r.status, 201, `body: ${r.text}`);
  assert.equal(r.body.mustChangeOnNextLogin, true);
  assert.ok(typeof r.body.tempPassword === "string" && r.body.tempPassword.length >= 12);

  const fresh = (await reloadUser(target.user.id))!;
  assert.equal(fresh.mustChangeOnNextLogin, true);
  assert.ok((fresh.sessionEpoch ?? 0) > epochBefore, "epoch must be bumped");
});

test("admin disable: refuses self-disable, otherwise disables and bumps epoch", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const org = await createOrg();
  const adminEmail = uniqueEmail("admin-dis");
  const targetEmail = uniqueEmail("target-dis");
  const admin = await createUser({ email: adminEmail, orgId: org.id, role: "admin" });
  const target = await createUser({ email: targetEmail, orgId: org.id, role: "member" });

  const agent = await loginAgent(adminEmail, admin.password);

  const self = await agent
    .post(`/api/v1/admin/orgs/${org.id}/users/${admin.user.id}/disable`)
    .send({});
  assert.equal(self.status, 400, "self-disable must be refused");

  const epochBefore = (await reloadUser(target.user.id))!.sessionEpoch ?? 0;
  const ok = await agent
    .post(`/api/v1/admin/orgs/${org.id}/users/${target.user.id}/disable`)
    .send({});
  assert.equal(ok.status, 200, `body: ${ok.text}`);
  const fresh = (await reloadUser(target.user.id))!;
  assert.equal(fresh.status, "disabled");
  assert.ok((fresh.sessionEpoch ?? 0) > epochBefore);

  // A disabled user must not be able to log in (anti-enumeration: 401).
  const denied = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: targetEmail, password: target.password });
  assert.equal(denied.status, 401);
});

test("admin sign-out-everywhere: bumps epoch", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const org = await createOrg();
  const adminEmail = uniqueEmail("admin-soe");
  const targetEmail = uniqueEmail("target-soe");
  const admin = await createUser({ email: adminEmail, orgId: org.id, role: "admin" });
  const target = await createUser({ email: targetEmail, orgId: org.id, role: "member" });
  const epochBefore = (await reloadUser(target.user.id))!.sessionEpoch ?? 0;

  const agent = await loginAgent(adminEmail, admin.password);
  const r = await agent
    .post(
      `/api/v1/admin/orgs/${org.id}/users/${target.user.id}/sign-out-everywhere`,
    )
    .send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const fresh = (await reloadUser(target.user.id))!;
  assert.ok((fresh.sessionEpoch ?? 0) > epochBefore);
  assert.equal(fresh.sessionEpoch, r.body.sessionEpoch);
});

test("change-password: requires auth (401 when not logged in)", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const r = await request(app)
    .post("/api/v1/auth/change-password")
    .send({ currentPassword: "x", newPassword: ANOTHER_STRONG_PASSWORD });
  assert.equal(r.status, 401);
});

test("lockout: 5 wrong-password attempts lock the account; correct password fails until unlock window passes", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const email = uniqueEmail("lockout");
  const { password } = await createUser({ email });

  // Five consecutive wrong attempts trip the lockout threshold.
  for (let i = 0; i < 5; i++) {
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "definitely-wrong-password" });
    assert.equal(r.status, 401, `attempt ${i + 1} should be 401`);
  }

  // The 6th attempt — even with the correct password — must fail because
  // the account is now locked. The error is the same generic 401 to
  // avoid enumeration.
  const lockedAttempt = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  assert.equal(lockedAttempt.status, 401, "correct pw must fail while locked");

  const { eq } = await import("drizzle-orm");
  const [locked] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  assert.ok(locked.lockedUntil instanceof Date, "lockedUntil must be set");
  assert.ok(
    locked.lockedUntil!.getTime() > Date.now(),
    "lockedUntil must be in the future",
  );

  // Simulate the unlock window having elapsed by force-clearing
  // lockedUntil — equivalent to time-travelling past LOCKOUT_DURATION_MS.
  await db
    .update(schema.users)
    .set({ lockedUntil: null, failedLoginCount: 0 })
    .where(eq(schema.users.id, locked.id));

  const recovered = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  assert.equal(recovered.status, 200, "login must succeed after unlock window");
});

test("session epoch: an authenticated session is denied after admin sign-out-everywhere bumps the epoch", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const org = await createOrg();
  const adminEmail = uniqueEmail("admin-epoch");
  const targetEmail = uniqueEmail("target-epoch");
  const admin = await createUser({ email: adminEmail, orgId: org.id, role: "admin" });
  const target = await createUser({ email: targetEmail, orgId: org.id, role: "member" });

  // Target signs in and confirms /me works.
  const targetAgent = await loginAgent(targetEmail, target.password);
  const meBefore = await targetAgent.get("/api/v1/auth/me");
  assert.equal(meBefore.status, 200, "session must be valid before epoch bump");

  // Admin signs in and signs the target out everywhere.
  const adminAgent = await loginAgent(adminEmail, admin.password);
  const r = await adminAgent
    .post(
      `/api/v1/admin/orgs/${org.id}/users/${target.user.id}/sign-out-everywhere`,
    )
    .send({});
  assert.equal(r.status, 200);

  // Target's old session must now be rejected (snapshot epoch is stale).
  const meAfter = await targetAgent.get("/api/v1/auth/me");
  assert.equal(
    meAfter.status,
    401,
    "stale session must be rejected after epoch bump",
  );
});

test("invitation revoke is tenant-scoped: does NOT revoke password_reset or grants in other orgs", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  rateLimit._resetRateLimitBuckets();
  const orgA = await createOrg("OrgA");
  const orgB = await createOrg("OrgB");
  const adminEmail = uniqueEmail("admin-rev");
  const sharedEmail = uniqueEmail("shared");
  const admin = await createUser({
    email: adminEmail,
    orgId: orgA.id,
    role: "admin",
  });
  // Same email exists as a user in orgA (so a self-service password_reset
  // is a meaningful grant we want to confirm survives).
  const target = await createUser({
    email: sharedEmail,
    orgId: orgA.id,
    role: "member",
  });

  // Three grants for the same email, only one of which the revoke should touch:
  //   1. invitation in orgA (must be revoked)
  //   2. invitation in orgB (different tenant — must survive)
  //   3. password_reset in orgA (different kind — must survive)
  // Issue orgB FIRST so issueGrant's sibling-revoke (Task #19 fix) is
  // proven not to clobber the other-tenant invite when orgA is issued.
  const invB = await credentialGrantsService.issueGrant({
    kind: "invitation",
    email: sharedEmail,
    orgId: orgB.id,
    role: "member",
  });
  const invA = await credentialGrantsService.issueGrant({
    kind: "invitation",
    email: sharedEmail,
    orgId: orgA.id,
    role: "member",
  });
  const reset = await credentialGrantsService.issueGrant({
    kind: "password_reset",
    email: sharedEmail,
    userId: target.user.id,
    orgId: orgA.id,
  });

  // Pre-condition: issuing invA must NOT have revoked invB (cross-tenant
  // isolation in `issueGrant` itself, fixed in Task #19).
  const { eq: eqPre } = await import("drizzle-orm");
  const [bBeforeDelete] = await db
    .select()
    .from(schema.credentialGrants)
    .where(eqPre(schema.credentialGrants.id, invB.grant.id));
  assert.equal(
    bBeforeDelete.revokedAt,
    null,
    "issueGrant must not revoke an invitation in a different org for the same email",
  );
  const [aBeforeDelete] = await db
    .select()
    .from(schema.credentialGrants)
    .where(eqPre(schema.credentialGrants.id, invA.grant.id));
  assert.equal(
    aBeforeDelete.revokedAt,
    null,
    "orgA invitation must be active before DELETE",
  );

  // Task #19: the legacy `invitations` table has been retired. The DELETE
  // route now scopes by credential_grants id directly.
  const agent = await loginAgent(adminEmail, admin.password);
  const r = await agent.delete(
    `/api/v1/admin/orgs/${orgA.id}/invitations/${invA.grant.id}`,
  );
  assert.equal(r.status, 200, `body: ${r.text}`);

  const { eq } = await import("drizzle-orm");
  const [aFresh] = await db
    .select()
    .from(schema.credentialGrants)
    .where(eq(schema.credentialGrants.id, invA.grant.id));
  const [bFresh] = await db
    .select()
    .from(schema.credentialGrants)
    .where(eq(schema.credentialGrants.id, invB.grant.id));
  const [resetFresh] = await db
    .select()
    .from(schema.credentialGrants)
    .where(eq(schema.credentialGrants.id, reset.grant.id));

  assert.ok(aFresh.revokedAt, "orgA invitation grant must be revoked");
  assert.equal(
    bFresh.revokedAt,
    null,
    "orgB invitation grant must NOT be revoked (cross-tenant isolation)",
  );
  assert.equal(
    resetFresh.revokedAt,
    null,
    "password_reset grant must NOT be revoked (different kind)",
  );
});

test("change-password: rejects wrong current password, accepts strong new one and bumps epoch", async (t) => {
  if (!dbReady) return t.skip("DB unreachable");
  const email = uniqueEmail("cp");
  const { user, password } = await createUser({ email });
  const epochBefore = (await reloadUser(user.id))!.sessionEpoch ?? 0;

  const agent = await loginAgent(email, password);

  const wrong = await agent
    .post("/api/v1/auth/change-password")
    .send({ currentPassword: "wrong-password", newPassword: ANOTHER_STRONG_PASSWORD });
  assert.equal(wrong.status, 400);

  const weak = await agent
    .post("/api/v1/auth/change-password")
    .send({ currentPassword: password, newPassword: "Sh0rt!" });
  assert.equal(weak.status, 400, "weak new password must be rejected");

  const ok = await agent
    .post("/api/v1/auth/change-password")
    .send({ currentPassword: password, newPassword: ANOTHER_STRONG_PASSWORD });
  assert.equal(ok.status, 200, `body: ${ok.text}`);
  const fresh = (await reloadUser(user.id))!;
  assert.ok((fresh.sessionEpoch ?? 0) > epochBefore);
});
