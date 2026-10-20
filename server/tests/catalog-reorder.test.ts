/**
 * Task #146 — Confirm the catalog really reorders after opening a project.
 *
 * The "Last Opened" default sort depends on a fire-and-forget
 * POST /api/v1/clients/:id/open (CSRF-protected) plus a per-viewer join in
 * GET /api/v1/clients. A silent failure anywhere in that chain degrades the
 * sort to created-date without any visible error. This suite exercises the
 * whole chain against the real middleware stack (CSRF double-submit, real
 * requireAuth, real tenant guard — NO TEST_AUTH_BYPASS) and a real database:
 *
 *   1. Open endpoint success: authenticated member with CSRF header gets
 *      200 {ok:true} and the listing's lastOpenedAt reflects the open.
 *   2. Reorder proof: with two projects where the newest-created one would
 *      win under the created-date fallback, opening the OLDER project moves
 *      it to the top under the catalog's exact comparator.
 *   3. Idempotent upsert: a second open bumps the timestamp (no unique-
 *      constraint failure).
 *   4. 401 when unauthenticated (CSRF cookie present but no session).
 *   5. 403 for a project the caller has no access to.
 *   6. 403 csrf_failed when the x-csrf-token header is missing — this is
 *      the exact silent-degradation path the frontend's fire-and-forget
 *      call would hit if the CSRF-aware apiRequest helper were bypassed.
 *
 * Run with:    npx tsx --test server/tests/catalog-reorder.test.ts
 *
 * Mirrors the real-DB pattern from `sessions.test.ts`: skips gracefully if
 * Postgres is unreachable; fixtures are tagged and cleaned up in after().
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-only-session-secret-do-not-use-in-prod";
process.env.ALLOW_PUBLIC_REGISTRATION = "true";
// Deliberately NOT setting TEST_AUTH_BYPASS — assertClientAccess and the
// CSRF middleware must run for real in this suite.
delete process.env.TEST_AUTH_BYPASS;

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import request from "supertest";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";

let app: Express;
let dbReady = false;
let db: typeof import("../db").db;
let schema: typeof import("@shared/schema");
let jobQueue: { stopAcceptingJobs: () => void } | undefined;
let pool: { end: () => Promise<void>; query: (q: string, p?: unknown[]) => Promise<unknown> } | undefined;

const FIXTURE_TAG = `t146-${randomBytes(4).toString("hex")}`;
const STRONG_PASSWORD = "CorrectHorseBattery9!";

// Fixture ids populated in before()
let orgId: string;
let olderClientId: string; // created first — loses the created-date fallback
let newerClientId: string; // created second — wins the created-date fallback

function uniqueEmail(prefix: string): string {
  return `${prefix}-${FIXTURE_TAG}-${randomBytes(4).toString("hex")}@test.invalid`;
}

function getCookie(res: request.Response, name: string): string | undefined {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) return undefined;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of arr) {
    const first = raw.split(";")[0];
    const eqIdx = first.indexOf("=");
    if (eqIdx < 0) continue;
    if (first.slice(0, eqIdx) === name) return first.slice(eqIdx + 1);
  }
  return undefined;
}

before(async () => {
  try {
    const dbModule = await import("../db");
    await dbModule.pool.query("SELECT 1");
    db = dbModule.db;
    pool = dbModule.pool as typeof pool;
    dbReady = true;
  } catch (err) {
    console.warn(
      "[catalog-reorder.test] DB unreachable — skipping suite:",
      (err as Error).message,
    );
    return;
  }
  schema = await import("@shared/schema");

  // Wire the app EXACTLY like production order (server/index.ts):
  // csrf issuer → csrf protect on /api/v1 → setupAuth → requireAuth guard
  // → tenant guard → client routes → error handler.
  const { setupAuth, requireAuth, requireTenantAccessIfPresent } = await import(
    "../auth"
  );
  const { csrfTokenIssuer, csrfProtect, isCsrfExempt } = await import(
    "../middleware/csrf"
  );
  const { errorHandler } = await import("../middleware/error-handler");
  const clientsModule = await import("../routes/clients");
  // `routes/clients.ts` transitively constructs the JobQueue via _shared;
  // grab it so after() can stop its polling interval.
  jobQueue = (await import("../routes/_shared")).jobQueue;

  app = express();
  app.use(express.json());
  app.use(csrfTokenIssuer());
  app.use("/api/v1", (req, res, next) => {
    if (isCsrfExempt(req.path)) return next();
    return csrfProtect()(req, res, next);
  });
  setupAuth(app);
  // Same public-path shape as routes/index.ts: auth endpoints are public,
  // everything else requires a session + tenant membership when present.
  const isPublic = (p: string) => p.startsWith("/auth/");
  app.use("/api/v1", (req, res, next) =>
    isPublic(req.path) ? next() : requireAuth(req, res, next),
  );
  app.use("/api/v1", (req, res, next) =>
    isPublic(req.path) ? next() : requireTenantAccessIfPresent()(req, res, next),
  );
  clientsModule.registerClientRoutes(app);
  app.use(errorHandler());

  // Fixtures: one org, two projects with a deliberate created-date gap so
  // the fallback ordering is deterministic (newer-created sorts first).
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Org ${FIXTURE_TAG}` })
    .returning();
  orgId = org.id;

  const [older] = await db
    .insert(schema.clients)
    .values({
      orgId,
      projectName: `Older-${FIXTURE_TAG}`,
      name: `Older ${FIXTURE_TAG}`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  olderClientId = older.id;

  const [newer] = await db
    .insert(schema.clients)
    .values({
      orgId,
      projectName: `Newer-${FIXTURE_TAG}`,
      name: `Newer ${FIXTURE_TAG}`,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    })
    .returning();
  newerClientId = newer.id;
});

after(async () => {
  jobQueue?.stopAcceptingJobs();
  if (!dbReady) return;
  try {
    await pool!.query(`DELETE FROM clients WHERE project_name LIKE $1`, [
      `%${FIXTURE_TAG}%`,
    ]);
    await pool!.query(`DELETE FROM organizations WHERE name LIKE $1`, [
      `%${FIXTURE_TAG}%`,
    ]);
    await pool!.query(`DELETE FROM users WHERE email LIKE $1`, [
      `%${FIXTURE_TAG}%@test.invalid`,
    ]);
    await pool!.end();
  } catch {
    // ignore
  }
});

/**
 * Register a fresh user (agent keeps cookies), optionally granting them a
 * membership role in the fixture org. Returns the CSRF token to echo in
 * x-csrf-token on state-changing calls.
 */
async function registerAndLogin(opts: { orgRole?: "admin" | "member" | "viewer" } = {}) {
  const agent = request.agent(app);
  const primer = await agent.get("/api/v1/auth/me");
  const csrf = getCookie(primer, "polaris.csrf") || "";
  assert.ok(csrf, "csrf cookie should be issued on the priming GET");
  const email = uniqueEmail("cat");
  const reg = await agent
    .post("/api/v1/auth/register")
    .send({ email, password: STRONG_PASSWORD, displayName: "Catalog Test" });
  assert.equal(reg.status, 201, `register failed: ${JSON.stringify(reg.body)}`);
  const userId: string = reg.body.user.id;
  if (opts.orgRole) {
    await db
      .insert(schema.userOrgMemberships)
      .values({ userId, orgId, role: opts.orgRole })
      .onConflictDoNothing();
  }
  return { agent, csrf, userId, email };
}

type ListedClient = {
  id: string;
  createdAt: string;
  lastOpenedAt: string | null;
};

/**
 * EXACT replica of the catalog's default "Last Opened" (desc) comparator in
 * client/src/pages/client-catalog.tsx — never-opened projects fall back to
 * their created date. If the frontend comparator changes, update this in
 * lockstep so the test keeps proving the real ordering.
 */
function sortLikeCatalog(rows: ListedClient[]): ListedClient[] {
  return [...rows].sort((a, b) => {
    const aTime = a.lastOpenedAt
      ? new Date(a.lastOpenedAt).getTime()
      : new Date(a.createdAt).getTime();
    const bTime = b.lastOpenedAt
      ? new Date(b.lastOpenedAt).getTime()
      : new Date(b.createdAt).getTime();
    return -(aTime - bTime); // desc
  });
}

async function listCatalog(agent: request.SuperAgentTest): Promise<ListedClient[]> {
  const res = await agent.get(`/api/v1/clients?org_id=${orgId}`);
  assert.equal(res.status, 200, `listing failed: ${JSON.stringify(res.body)}`);
  return (res.body as ListedClient[]).filter(
    (c) => c.id === olderClientId || c.id === newerClientId,
  );
}

// ---------------------------------------------------------------------------
// The full reorder chain
// ---------------------------------------------------------------------------

test("catalog reorders: opening the older project moves it to the top", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  const { agent, csrf } = await registerAndLogin({ orgRole: "admin" });

  // Baseline: neither project opened → created-date fallback puts the
  // NEWER project first. This makes the post-open flip meaningful.
  const beforeRows = await listCatalog(agent);
  assert.equal(beforeRows.length, 2, "both fixture projects must be visible");
  for (const row of beforeRows) {
    assert.equal(row.lastOpenedAt, null, "no opens recorded yet");
  }
  assert.equal(sortLikeCatalog(beforeRows)[0].id, newerClientId);

  // Open the OLDER project (same call the catalog fires on click).
  const open = await agent
    .post(`/api/v1/clients/${olderClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(open.status, 200, `open failed: ${JSON.stringify(open.body)}`);
  assert.equal(open.body.ok, true);

  // Back on the catalog: the older project now carries a lastOpenedAt and
  // wins the default sort.
  const afterRows = await listCatalog(agent);
  const olderRow = afterRows.find((r) => r.id === olderClientId)!;
  const newerRow = afterRows.find((r) => r.id === newerClientId)!;
  assert.ok(olderRow.lastOpenedAt, "open must surface in the listing join");
  assert.equal(newerRow.lastOpenedAt, null, "other project untouched");
  assert.equal(
    sortLikeCatalog(afterRows)[0].id,
    olderClientId,
    "opened project must sort to the top under the catalog comparator",
  );
});

test("open endpoint is an idempotent upsert that bumps the timestamp", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  const { agent, csrf } = await registerAndLogin({ orgRole: "admin" });

  const first = await agent
    .post(`/api/v1/clients/${newerClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(first.status, 200);
  const t1 = (await listCatalog(agent)).find((r) => r.id === newerClientId)!
    .lastOpenedAt!;

  await new Promise((r) => setTimeout(r, 20));
  const second = await agent
    .post(`/api/v1/clients/${newerClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(second.status, 200, "second open must not hit a unique constraint");
  const t2 = (await listCatalog(agent)).find((r) => r.id === newerClientId)!
    .lastOpenedAt!;
  assert.ok(
    new Date(t2).getTime() > new Date(t1).getTime(),
    `re-open must bump lastOpenedAt (${t1} → ${t2})`,
  );
});

test("per-viewer isolation: one user's open never leaks into another viewer's listing", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  // The previous tests already recorded opens for other users. A fresh
  // member must still see lastOpenedAt=null everywhere.
  const { agent } = await registerAndLogin({ orgRole: "admin" });
  const rows = await listCatalog(agent);
  for (const row of rows) {
    assert.equal(
      row.lastOpenedAt,
      null,
      "listing must join opens per-viewer, not globally",
    );
  }
});

test("a member with an explicit project grant can record an open too", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  const { agent, csrf, userId } = await registerAndLogin({ orgRole: "member" });
  await db
    .insert(schema.projectMemberships)
    .values({ clientId: olderClientId, userId, grantedByUserId: null })
    .onConflictDoNothing();

  const open = await agent
    .post(`/api/v1/clients/${olderClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(open.status, 200, JSON.stringify(open.body));

  // Members only see owned + granted projects; the granted one must carry
  // the fresh lastOpenedAt.
  const rows = await listCatalog(agent);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, olderClientId);
  assert.ok(rows[0].lastOpenedAt);
});

// ---------------------------------------------------------------------------
// Failure modes of the fire-and-forget chain
// ---------------------------------------------------------------------------

test("POST /open without a session is 401", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  const agent = request.agent(app);
  const primer = await agent.get("/api/v1/auth/me");
  const csrf = getCookie(primer, "polaris.csrf") || "";
  const res = await agent
    .post(`/api/v1/clients/${olderClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(res.status, 401);
});

test("POST /open on a forbidden project is 403", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  // Authenticated, but no org membership, not owner, no project grant.
  const { agent, csrf } = await registerAndLogin();
  const res = await agent
    .post(`/api/v1/clients/${olderClientId}/open`)
    .set("x-csrf-token", csrf)
    .send({});
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("POST /open without the CSRF header is rejected (the silent-degradation path)", async (t) => {
  if (!dbReady) return t.skip("DB not available");
  const { agent } = await registerAndLogin({ orgRole: "admin" });
  const res = await agent
    .post(`/api/v1/clients/${olderClientId}/open`)
    .send({});
  assert.equal(res.status, 403);
  assert.equal(res.body.error?.code, "csrf_failed");
  // And crucially: the failed call must NOT have recorded an open.
  const rows = await listCatalog(agent);
  const older = rows.find((r) => r.id === olderClientId)!;
  assert.equal(older.lastOpenedAt, null);
});
