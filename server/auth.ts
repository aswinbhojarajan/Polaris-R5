import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { ApiError } from "./utils/api-error";
import session from "express-session";
import createMemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { eq, and, sql } from "drizzle-orm";
import { db, pool } from "./db";
import {
  users,
  userOrgMemberships,
  clients,
  projectMemberships,
  loginSchema,
  registerUserSchema,
  validatePasswordPolicy,
  type User,
  type ProjectMembership,
} from "@shared/schema";
import type { UserRole } from "./auth-types";
import { roleAtLeast } from "./privileges";
import {
  hashPassword as hashPasswordImpl,
  verifyPassword as verifyPasswordImpl,
  recordPasswordHistory,
} from "./services/passwords";
import { recordAudit } from "./services/audit";
import {
  recordUserSession,
  touchUserSession,
  deleteUserSession,
  deleteUserSessionsForUser,
  listUserSessionsForUser,
  pruneOrphanUserSessions,
} from "./services/sessions";
import {
  loginRateLimiter,
  registerRateLimiter,
} from "./middleware/auth-rate-limit";

// Re-export so existing call sites (admin-users.ts, etc.) keep working.
// Argon2id is the only accepted hash format (Task #19).
export const hashPassword = hashPasswordImpl;
export const verifyPassword = verifyPasswordImpl;

// Lockout policy (Task #18). After LOCKOUT_THRESHOLD consecutive failures,
// the account is locked for LOCKOUT_DURATION_MS. Successful login resets
// the counter.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Session timeout policy (Task #37). Two complementary clocks:
//   - Idle:     log out if no request for N ms (rolling window).
//   - Absolute: log out N ms after sign-in regardless of activity.
// Defaults: 24h idle for admins, 7d idle for everyone else, 30d absolute.
// Overridable via env so operators can tighten without a code change.
const SESSION_IDLE_MS = parseInt(
  process.env.SESSION_IDLE_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const SESSION_ADMIN_IDLE_MS = parseInt(
  process.env.SESSION_ADMIN_IDLE_MS || String(24 * 60 * 60 * 1000),
  10,
);
const SESSION_ABSOLUTE_MAX_AGE_MS = parseInt(
  process.env.SESSION_ABSOLUTE_MAX_AGE_MS || String(30 * 24 * 60 * 60 * 1000),
  10,
);
// "Remember me" cookie lifetime (only applied when the login payload
// includes `rememberMe: true`). Otherwise the cookie is a session cookie
// (no maxAge) and dies with the browser process.
const SESSION_REMEMBER_ME_MS = parseInt(
  process.env.SESSION_REMEMBER_ME_MS || String(30 * 24 * 60 * 60 * 1000),
  10,
);
// Throttle the lastSeenAt DB write to once per minute per session — a
// busy SPA otherwise hammers the row on every poll.
const LAST_SEEN_BUMP_INTERVAL_MS = 60 * 1000;

interface SessionMetaShape {
  sessionEpoch?: number;
  signedInAt?: number;
  lastSeenAt?: number;
  rememberMe?: boolean;
  isAdmin?: boolean;
}

function getSessionMeta(req: Request): SessionMetaShape {
  return req.session as unknown as SessionMetaShape;
}

declare global {
  namespace Express {
    // Make req.user typed as our domain User
    // (passport's default is {} which loses typing)
    interface User extends Omit<import("@shared/schema").User, never> {}
  }
}

async function findUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

async function findUserById(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/**
 * Returns the org ids the given user has access to.
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: userOrgMemberships.orgId })
    .from(userOrgMemberships)
    .where(eq(userOrgMemberships.userId, userId));
  return rows.map((r) => r.orgId);
}

/**
 * Returns true if the user has membership in the given org.
 */
export async function userHasOrgAccess(userId: string, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userOrgMemberships.id })
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, userId), eq(userOrgMemberships.orgId, orgId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Returns true if the user has access to the given client.
 *
 * Resolution order (per Task #17):
 *   1. Reject if the client doesn't exist.
 *   2. Reject if the user has no membership in the client's org.
 *   3. Allow if the user is an org admin (admins implicitly see every project).
 *   4. Allow if the user is the project's owner (creator stamp).
 *   5. Allow if a `project_memberships` row exists for (clientId, userId).
 *   6. Otherwise reject.
 */
export async function userHasClientAccess(userId: string, clientId: string): Promise<boolean> {
  const rows = await db
    .select({ orgId: clients.orgId, ownerUserId: clients.ownerUserId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (rows.length === 0) return false;
  const { orgId, ownerUserId } = rows[0];

  const role = await getUserRoleInOrg(userId, orgId);
  if (!role) return false;
  if (role === "admin") return true;
  if (ownerUserId && ownerUserId === userId) return true;

  const m = await db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.clientId, clientId),
        eq(projectMemberships.userId, userId),
      ),
    )
    .limit(1);
  return m.length > 0;
}

/**
 * Returns the project_memberships row (if any) for the given (clientId,
 * userId) pair. Used by the sharing endpoints.
 */
export async function getProjectMembership(
  clientId: string,
  userId: string,
): Promise<ProjectMembership | undefined> {
  const rows = await db
    .select()
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.clientId, clientId),
        eq(projectMemberships.userId, userId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Express helper: the caller must be the project's owner (creator) or an
 * org admin in the project's org. Used by the per-project sharing routes —
 * `requireRole` would force admin, but project owners also need access.
 *
 * Returns true on success; on failure writes a 401/403/404 response and
 * returns false (caller should `return` immediately).
 */
export async function requireProjectOwnerOrAdmin(
  req: Request,
  res: Response,
  clientId: string,
): Promise<boolean> {
  if (process.env.NODE_ENV === "test" && process.env.TEST_AUTH_BYPASS === "true") {
    return true;
  }
  const user = req.user as User | undefined;
  if (!user) {
    throw new ApiError({ status: 401, code: "unauthenticated", message: "Authentication required" });
  }
  const rows = await db
    .select({ orgId: clients.orgId, ownerUserId: clients.ownerUserId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (rows.length === 0) {
    throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });
  }
  const { orgId, ownerUserId } = rows[0];
  if (ownerUserId === user.id) return true;
  const role = await getUserRoleInOrg(user.id, orgId);
  if (role === "admin") return true;
  throw new ApiError({ status: 403, code: "forbidden", message: "Forbidden: project owner or org admin required" });
}

/**
 * Express helper: assert the authenticated user has access to the given
 * org id. Returns true on success; on failure writes a 401/403 response
 * and returns false (caller should `return` immediately).
 *
 * Honors the same `TEST_AUTH_BYPASS` escape hatch as the global guards so
 * the legacy integration suite does not need to mock memberships.
 */
export async function assertOrgAccess(
  req: Request,
  res: Response,
  orgId: string,
): Promise<boolean> {
  if (process.env.NODE_ENV === "test" && process.env.TEST_AUTH_BYPASS === "true") {
    return true;
  }
  const user = req.user as User | undefined;
  if (!user) {
    throw new ApiError({ status: 401, code: "unauthenticated", message: "Authentication required" });
  }
  const ok = await userHasOrgAccess(user.id, orgId);
  if (!ok) {
    throw new ApiError({ status: 403, code: "forbidden", message: "Forbidden: cross-tenant access" });
  }
  return true;
}

/**
 * Returns the role the user holds in the given org, or undefined if no
 * membership exists.
 */
export async function getUserRoleInOrg(
  userId: string,
  orgId: string,
): Promise<UserRole | undefined> {
  const rows = await db
    .select({ role: userOrgMemberships.role })
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, userId), eq(userOrgMemberships.orgId, orgId)))
    .limit(1);
  return rows[0]?.role as UserRole | undefined;
}

/**
 * Returns the role the user holds for the given client (resolved via the
 * client's org), or undefined if the client doesn't exist or the user has
 * no membership.
 */
export async function getUserRoleForClient(
  userId: string,
  clientId: string,
): Promise<UserRole | undefined> {
  // Mirror userHasClientAccess: org role short-circuits, project owner is
  // admin-equivalent on their project, and explicit project_memberships
  // grants viewer-level access. This keeps `requireRole({scope:'client'})`
  // and `userHasClientAccess` in lockstep so they cannot diverge.
  const rows = await db
    .select({ orgId: clients.orgId, ownerUserId: clients.ownerUserId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (rows.length === 0) return undefined;
  const orgRole = await getUserRoleInOrg(userId, rows[0].orgId);
  if (orgRole) return orgRole;
  if (rows[0].ownerUserId === userId) return "admin";
  const membership = await getProjectMembership(clientId, userId);
  if (membership) return "viewer";
  return undefined;
}

/**
 * Returns the org id associated with a request — body.orgId, ?org_id=,
 * ?orgId=, or the orgId derived from a clientId in the same locations
 * (header, query, body, or `:clientId`/`:id` path param under
 * /api/v1/clients/:id and /api/v1/admin/clients/:id).
 *
 * Used by the role middleware (`requireRole`) and by
 * `requireTenantAccessIfPresent`.
 */
export async function resolveTenant(
  req: Request,
): Promise<{ orgId?: string; clientId?: string }> {
  const orgFromReq =
    (req.body && typeof req.body === "object" ? (req.body as any).orgId : undefined) ||
    (req.query.org_id as string | undefined) ||
    (req.query.orgId as string | undefined) ||
    (req.params as any)?.orgId;

  // Prefer the client id embedded in the URL path for the `/clients/:id`
  // family. The resource named in the path is the authoritative tenant
  // for the request, independent of whichever project the caller
  // currently has selected (the `x-client-id` header). Without this, a
  // brand-new user creating their first project has no selected project —
  // so no `x-client-id` header is sent — and the onboarding wizard's
  // per-step `PUT /api/v1/clients/:id` could not resolve a tenant,
  // failing with 400 "clientId is required" and freezing the wizard on
  // "Next". The pattern tolerates the `/api/v1` route prefix.
  let pathClientId: string | undefined;
  {
    const m = req.path.match(
      /^(?:\/api\/v\d+)?\/(?:admin\/)?clients\/([^\/]+)(?:\/|$)/,
    );
    if (
      m &&
      m[1] &&
      m[1] !== "validate-project-name" &&
      m[1] !== "activity-summary"
    ) {
      pathClientId = m[1];
    }
  }

  const clientId: string | undefined =
    (req.params as any)?.clientId ||
    pathClientId ||
    (req.body && typeof req.body === "object" ? (req.body as any).clientId : undefined) ||
    (req.query.client_id as string | undefined) ||
    (req.query.clientId as string | undefined) ||
    (req.headers["x-client-id"] as string | undefined);

  if (orgFromReq) return { orgId: orgFromReq, clientId };
  if (clientId) {
    const rows = await db
      .select({ orgId: clients.orgId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (rows[0]?.orgId) return { orgId: rows[0].orgId, clientId };
  }
  return { orgId: undefined, clientId };
}

/**
 * Middleware factory: requires the caller to have at least `minRole` in the
 * relevant tenant. `scope: 'org'` resolves the role from the request's org
 * id; `scope: 'client'` resolves from the request's client id (looked up
 * via the client's org); `scope: 'none'` resolves against any org the
 * caller is a member of (used for cross-tenant utility routes like
 * onboarding/crawler that don't carry a tenant id).
 *
 * Returns 401 if not authenticated, 400 if the scoped tenant id is
 * missing, 403 if the role check fails.
 */
export function requireRole(opts: {
  minRole: UserRole;
  scope: "org" | "client" | "none";
  /** Trusted resource lookup, never a client-supplied selected-project hint. */
  resolveClientId?: (req: Request) => Promise<string>;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      if (isTestBypass()) {
        applyTestBypass(req);
        (req as any).tenantRole = "admin";
        return next();
      }
      if (!req.user) {
        return next(new ApiError({ status: 401, code: "unauthenticated", message: "Authentication required" }));
      }
      const userId = (req.user as User).id;
      const tenant = await resolveTenant(req);

      if (opts.scope === "org") {
        if (!tenant.orgId) {
          return next(new ApiError({ status: 400, code: "bad_request", message: "orgId is required for this endpoint" }));
        }
        const role = await getUserRoleInOrg(userId, tenant.orgId);
        if (!roleAtLeast(role, opts.minRole)) {
          return next(new ApiError({ status: 403, code: "forbidden", message: `Forbidden: ${opts.minRole}+ role required` }));
        }
        (req as any).tenantRole = role;
        (req as any).currentClientRole = role;
        return next();
      }

      if (opts.scope === "client") {
        const clientId = opts.resolveClientId ? await opts.resolveClientId(req) : tenant.clientId;
        if (!clientId) {
          return next(new ApiError({ status: 400, code: "bad_request", message: "clientId is required for this endpoint" }));
        }
        const role = await getUserRoleForClient(userId, clientId);
        if (!roleAtLeast(role, opts.minRole)) {
          return next(new ApiError({ status: 403, code: "forbidden", message: `Forbidden: ${opts.minRole}+ role required` }));
        }
        (req as any).tenantRole = role;
        (req as any).currentClientRole = role;
        return next();
      }

      // scope === 'none': require the caller to hold `minRole` in *some* org.
      const memberships = await db
        .select({ role: userOrgMemberships.role })
        .from(userOrgMemberships)
        .where(eq(userOrgMemberships.userId, userId));
      const ok = memberships.some((m) => roleAtLeast(m.role as UserRole, opts.minRole));
      if (!ok) {
        return next(new ApiError({ status: 403, code: "forbidden", message: `Forbidden: ${opts.minRole}+ role required` }));
      }
      return next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * When TEST_AUTH_BYPASS=true (set only by the integration-test harness in
 * `server/tests/*`) the auth/role middleware short-circuits and synthesizes
 * an authenticated admin user. This keeps the legacy 813-line route test
 * suite working under the new global RBAC guard without forcing it to
 * stand up a full session/passport login per request. Production code
 * never sets this env var.
 */
function isTestBypass(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.TEST_AUTH_BYPASS === "true"
  );
}

function applyTestBypass(req: Request) {
  (req as any).user = {
    id: "test-user",
    email: "test@local",
    displayName: "Test",
    passwordHash: "",
    createdAt: new Date(),
  } as User;
  (req as any).isAuthenticated = () => true;
}

function destroyAndReject(
  req: Request,
  res: Response,
  status: number,
  body: Record<string, unknown>,
) {
  const sessionId = req.sessionID;
  // Capture user + reason BEFORE we logout / destroy — otherwise the
  // audit row loses its actorUserId and we can't reconstruct who got
  // signed out and why.
  const actorUserId = (req.user as User | undefined)?.id;
  const reason = typeof body.reason === "string" ? (body.reason as string) : "unknown";
  if (actorUserId) {
    // Capture ip + user-agent so termination rows are searchable the
    // same way as login.success / logout / sessions.revoke_one rows.
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.ip ||
      undefined;
    const userAgent = req.get?.("user-agent") || undefined;
    void recordAudit({
      req,
      actorUserId,
      action: "auth.session.terminated",
      targetType: "user",
      targetId: actorUserId,
      metadata: { reason, sessionId, ip, userAgent },
    });
  }
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("polaris.sid");
      if (sessionId) void deleteUserSession(sessionId);
      res.status(status).json(body);
    });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isTestBypass()) {
    applyTestBypass(req);
    return next();
  }
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    // Session-epoch kill switch (Task #18). When an admin signs a user out
    // everywhere or a password reset/change occurs, the user's session_epoch
    // is bumped — every existing session whose snapshot is now stale is
    // immediately rejected on its next request.
    const user = req.user as User;
    const meta = getSessionMeta(req);
    // Strict snapshot match: every authenticated session must carry an
    // epoch snapshot AND that snapshot must equal the user's current
    // epoch. Sessions that pre-date the snapshot field, or whose epoch
    // was bumped (admin sign-out / password change / disable), are
    // immediately invalidated.
    if (typeof meta.sessionEpoch !== "number" || meta.sessionEpoch !== user.sessionEpoch) {
      return destroyAndReject(req, res, 401, {
        message: "Session expired — please sign in again",
        reason: "session_revoked",
      });
    }
    // Refuse disabled accounts even if a stale session exists.
    if (user.status === "disabled") {
      return destroyAndReject(req, res, 401, {
        message: "Account disabled",
        reason: "account_disabled",
      });
    }

    // Idle / absolute timeout enforcement (Task #37). Admins get a tighter
    // idle window. Both clocks are checked on every authenticated request.
    const now = Date.now();
    const signedInAt = typeof meta.signedInAt === "number" ? meta.signedInAt : now;
    const lastSeenAt = typeof meta.lastSeenAt === "number" ? meta.lastSeenAt : now;
    const idleMs = meta.isAdmin ? SESSION_ADMIN_IDLE_MS : SESSION_IDLE_MS;
    if (now - lastSeenAt > idleMs) {
      return destroyAndReject(req, res, 401, {
        message: "Session timed out — please sign in again",
        reason: "idle_timeout",
      });
    }
    if (now - signedInAt > SESSION_ABSOLUTE_MAX_AGE_MS) {
      return destroyAndReject(req, res, 401, {
        message: "Session reached its maximum age — please sign in again",
        reason: "absolute_timeout",
      });
    }
    // Bump lastSeenAt — in-session always; DB row at most once per minute.
    meta.lastSeenAt = now;
    if (now - lastSeenAt > LAST_SEEN_BUMP_INTERVAL_MS && req.sessionID) {
      void touchUserSession(req.sessionID);
    }

    return next();
  }
  return next(new ApiError({ status: 401, code: "unauthenticated", message: "Authentication required" }));
}

/**
 * Middleware that auto-detects an org_id or clientId in common request locations
 * and verifies the authenticated user has access to it.
 *
 * - Skips checks for routes that don't carry any tenant id.
 * - Returns 403 if the user lacks access.
 *
 * Detection order:
 *   - org id:    body.orgId, query.org_id, query.orgId
 *   - client id: params.clientId, body.clientId, query.client_id,
 *                query.clientId, header x-client-id, and `:id` for
 *                paths under /api/v1/clients/:id (and its sub-routes).
 */
export function requireTenantAccessIfPresent(): RequestHandler {
  return async (req, res, next) => {
    try {
      if (isTestBypass()) return next();
      if (!req.user) return next();
      const userId = (req.user as User).id;

      // org id
      const orgId =
        (req.body && typeof req.body === "object" ? (req.body as any).orgId : undefined) ||
        (req.query.org_id as string | undefined) ||
        (req.query.orgId as string | undefined);

      if (orgId) {
        const ok = await userHasOrgAccess(userId, orgId);
        if (!ok) {
          return next(new ApiError({ status: 403, code: "forbidden", message: "Forbidden: no access to this organization" }));
        }
      }

      // client id
      let clientId: string | undefined =
        (req.params as any)?.clientId ||
        (req.body && typeof req.body === "object" ? (req.body as any).clientId : undefined) ||
        (req.query.client_id as string | undefined) ||
        (req.query.clientId as string | undefined) ||
        (req.headers["x-client-id"] as string | undefined);

      // Special case: /api/v1/clients/:id and its sub-routes treat :id as a clientId
      if (!clientId) {
        const path = req.path; // already relative to mount point /api/v1
        const m = path.match(/^\/clients\/([^\/]+)(?:\/|$)/);
        // Exclude collection-style sub-routes that aren't actually
        // `/clients/:id/...` patterns (the segment is a verb, not a UUID).
        const NON_CLIENT_ID_SEGMENTS = new Set([
          "validate-project-name",
          "activity-summary",
        ]);
        if (m && m[1] && !NON_CLIENT_ID_SEGMENTS.has(m[1])) {
          clientId = m[1];
        }
      }

      if (clientId) {
        // Resolve and attach the caller's current role for this exact client.
        // Downstream tenant-sensitive feature gates must not rely on cached,
        // session-wide admin metadata (which may belong to another org or be
        // stale after a role change).
        const role = await getUserRoleForClient(userId, clientId);
        if (!role) {
          return next(new ApiError({ status: 403, code: "forbidden", message: "Forbidden: no access to this client" }));
        }
        (req as any).tenantRole = role;
        (req as any).currentClientRole = role;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Helper to assert client access from inside a route handler.
 * Returns true if access is allowed; otherwise sends a 403 and returns false.
 */
export async function assertClientAccess(
  req: Request,
  res: Response,
  clientId: string,
): Promise<boolean> {
  if (process.env.NODE_ENV === "test" && process.env.TEST_AUTH_BYPASS === "true") {
    return true;
  }
  if (!req.user) {
    throw new ApiError({ status: 401, code: "unauthenticated", message: "Authentication required" });
  }
  const ok = await userHasClientAccess((req.user as User).id, clientId);
  if (!ok) {
    throw new ApiError({ status: 403, code: "forbidden", message: "Forbidden: no access to this client" });
  }
  return true;
}

/**
 * Returns the session store to use for express-session.
 *
 * In production / development we persist sessions to Postgres via
 * connect-pg-simple so users stay signed in across server restarts and the
 * app can scale horizontally. In tests (or when SESSION_STORE=memory is
 * set) we fall back to the in-process memorystore to avoid touching the
 * database.
 */
function createSessionStore(): session.Store {
  const useMemory =
    process.env.SESSION_STORE === "memory" || process.env.NODE_ENV === "test";

  if (useMemory) {
    const MemoryStore = createMemoryStore(session);
    return new MemoryStore({
      checkPeriod: 1000 * 60 * 60, // prune expired entries hourly
    });
  }

  const PgStore = connectPgSimple(session);
  return new PgStore({
    pool: pool as any,
    tableName: "session",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60, // prune expired sessions hourly (seconds)
  });
}

// Hourly sweep that deletes `user_sessions` rows whose underlying
// express-session row has already been pruned by connect-pg-simple
// (Task #42). Without this the active-sessions UI lists "active"
// sessions whose cookie is dead and the revoke buttons quietly no-op.
// `listUserSessionsForUser` / `countActiveUserSessions` already filter
// orphans on read; this sweep keeps the table from growing unbounded
// for users who never log in again.
const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let orphanSweepTimer: NodeJS.Timeout | null = null;
function startOrphanSweep() {
  if (orphanSweepTimer) return;
  if (process.env.SESSION_STORE === "memory" || process.env.NODE_ENV === "test") {
    return;
  }
  orphanSweepTimer = setInterval(() => {
    void pruneOrphanUserSessions().then((n) => {
      if (n > 0) {
        console.log(`[sessions] pruned ${n} orphan user_sessions row(s)`);
      }
    });
  }, ORPHAN_SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive for this background timer.
  if (typeof orphanSweepTimer.unref === "function") orphanSweepTimer.unref();
  // Run once on boot so a freshly-restarted server reconciles
  // immediately rather than waiting an hour.
  void pruneOrphanUserSessions();
}

function sanitizeUser(user: User) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function setSessionEpochSnapshot(req: Request, user: User) {
  const meta = getSessionMeta(req);
  meta.sessionEpoch = user.sessionEpoch;
}

/**
 * Stamp the per-session metadata used by the idle / absolute timeout
 * checks and the sessions UI. Called immediately after a successful
 * `req.session.regenerate(...)` followed by `req.login(...)`.
 */
async function stampNewSession(req: Request, user: User, rememberMe: boolean) {
  const meta = getSessionMeta(req);
  meta.sessionEpoch = user.sessionEpoch;
  meta.signedInAt = Date.now();
  meta.lastSeenAt = Date.now();
  meta.rememberMe = rememberMe;
  // Cache the admin flag on the session so requireAuth can pick the
  // tighter idle window without a per-request DB hit. Conservative:
  // only flip when at least one membership has admin role.
  try {
    const memberships = await db
      .select({ role: userOrgMemberships.role })
      .from(userOrgMemberships)
      .where(eq(userOrgMemberships.userId, user.id));
    meta.isAdmin = memberships.some((m) => m.role === "admin");
  } catch {
    meta.isAdmin = false;
  }
  // Apply the per-login cookie lifetime. When rememberMe is false the
  // cookie becomes a "session" cookie that dies with the browser process.
  if (req.session.cookie) {
    if (rememberMe) {
      req.session.cookie.maxAge = SESSION_REMEMBER_ME_MS;
    } else {
      // express-session: clearing expires/originalMaxAge yields a
      // session cookie that dies with the browser process. The Cookie
      // type from @types/express-session models these as nullable, so
      // no cast is needed.
      const cookie = req.session.cookie as session.Cookie & {
        expires: Date | null;
        originalMaxAge: number | null;
      };
      cookie.expires = null;
      cookie.originalMaxAge = null;
      cookie.maxAge = undefined as unknown as number;
    }
  }
  if (req.sessionID) {
    await recordUserSession({ sessionId: req.sessionID, userId: user.id, req });
  }
}

export async function bumpUserSessionEpoch(userId: string): Promise<number> {
  const [updated] = await db
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(eq(users.id, userId))
    .returning({ sessionEpoch: users.sessionEpoch });
  // Also drop the per-user session ledger so the "active sessions" UI
  // reflects the kill-switch immediately. The cookie-side enforcement
  // is still the authoritative gate (handled by requireAuth's epoch
  // snapshot check) — this just keeps the UI honest.
  await deleteUserSessionsForUser(userId);
  return updated?.sessionEpoch ?? 0;
}

export { recordPasswordHistory };

/**
 * Wires session middleware, passport, and the /api/v1/auth/* routes onto the
 * given Express app. Must be called BEFORE routes that need authentication.
 */
export function setupAuth(app: Express) {
  const sessionSecret =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === "production"
      ? (() => {
          throw new Error("SESSION_SECRET must be set in production");
        })()
      : "dev-only-insecure-session-secret-change-me");

  app.set("trust proxy", 1);

  app.use(
    session({
      name: "polaris.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
      store: createSessionStore(),
    }),
  );

  startOrphanSweep();

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        // All failure paths return the SAME generic message to avoid
        // leaking which accounts exist, are disabled, or are locked.
        const GENERIC = { message: "Invalid email or password" };
        try {
          const user = await findUserByEmail(email.toLowerCase().trim());
          if (!user) return done(null, false, GENERIC);

          // Refuse `disabled` and `invited` accounts. `invited` users have
          // no usable password until they redeem their invitation grant.
          if (user.status === "disabled" || user.status === "invited") {
            return done(null, false, GENERIC);
          }

          // Lockout window still active.
          if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
            return done(null, false, GENERIC);
          }

          const ok = await verifyPassword(password, user.passwordHash);
          if (!ok) {
            // Bump the failure counter; lock when the threshold is crossed.
            const nextCount = (user.failedLoginCount ?? 0) + 1;
            const updates: Partial<User> = { failedLoginCount: nextCount };
            if (nextCount >= LOCKOUT_THRESHOLD) {
              updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
              updates.failedLoginCount = 0;
              await recordAudit({
                action: "auth.login.locked",
                targetType: "user",
                targetId: user.id,
                metadata: { thresholdHits: LOCKOUT_THRESHOLD },
              });
            }
            await db.update(users).set(updates).where(eq(users.id, user.id));
            return done(null, false, GENERIC);
          }

          // Success — reset failure state. Legacy scrypt hashes were
          // retired in Task #19 (any user still on a non-Argon2id hash was
          // flagged `must_change_on_next_login=true` by the rotation sweep,
          // so the change-password interstitial will rotate them).
          const [updated] = await db
            .update(users)
            .set({ failedLoginCount: 0, lockedUntil: null })
            .where(eq(users.id, user.id))
            .returning();
          return done(null, updated ?? user);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await findUserById(id);
      if (!user) return done(null, false);
      done(null, user);
    } catch (err) {
      done(err as Error);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // ----- Auth routes -----

  // Current user. Returns the user, the orgIds the caller belongs to, and
  // the per-org role memberships (used by the frontend to gate admin UI
  // and disable execute actions for viewers).
  // Auth probe. Routed through `requireAuth` so it shares the same
  // idle/absolute-timeout, epoch-mismatch, and disabled-account checks
  // as every other protected endpoint — otherwise the SPA could think
  // it was still signed in long after a real call would 401.
  app.get("/api/v1/auth/me", requireAuth, async (req, res) => {
    const user = req.user as User;
    const memberships = await db
      .select({
        orgId: userOrgMemberships.orgId,
        role: userOrgMemberships.role,
      })
      .from(userOrgMemberships)
      .where(eq(userOrgMemberships.userId, user.id));
    const orgIds = memberships.map((m) => m.orgId);
    res.json({
      user: sanitizeUser(user),
      orgIds,
      memberships,
      mustChangePassword: !!user.mustChangeOnNextLogin,
      status: user.status,
    });
  });

  // Self-service profile update (Task #47). Currently only the
  // displayName is editable here — email changes require a verification
  // flow (out of scope) and password changes go through
  // /api/v1/auth/change-password which carries its own current-password
  // re-auth check. Empty/whitespace displayName is normalized to NULL so
  // the topbar falls back to email.
  app.patch("/api/v1/auth/me", requireAuth, async (req, res, next) => {
    try {
      const me = req.user as User;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(body, "displayName")) {
        return next(new ApiError({ status: 400, code: "bad_request", message: "No fields to update" }));
      }
      const raw = body.displayName;
      let normalized: string | null;
      if (raw === null || raw === undefined) {
        normalized = null;
      } else if (typeof raw !== "string") {
        return next(new ApiError({ status: 400, code: "bad_request", message: "displayName must be a string or null" }));
      } else {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          normalized = null;
        } else if (trimmed.length > 60) {
          return next(new ApiError({ status: 400, code: "bad_request", message: "Display name must be 60 characters or fewer" }));
        } else {
          normalized = trimmed;
        }
      }
      const [updated] = await db
        .update(users)
        .set({ displayName: normalized })
        .where(eq(users.id, me.id))
        .returning();
      const memberships = await db
        .select({
          orgId: userOrgMemberships.orgId,
          role: userOrgMemberships.role,
        })
        .from(userOrgMemberships)
        .where(eq(userOrgMemberships.userId, updated.id));
      const orgIds = memberships.map((m) => m.orgId);
      res.json({
        user: sanitizeUser(updated),
        orgIds,
        memberships,
        mustChangePassword: !!updated.mustChangeOnNextLogin,
        status: updated.status,
      });
    } catch (err) {
      console.error("[patch /auth/me] error:", err);
      return next(new ApiError({ status: 500, code: "internal_error", message: "Failed to update profile" }));
    }
  });

  // Login. Per-IP rate-limited (Task #37) and session-id is regenerated
  // on success to defeat session-fixation: anything an attacker
  // pre-planted in the anonymous session is dropped before req.login
  // attaches the authenticated user.
  app.post("/api/v1/auth/login", loginRateLimiter, (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError({ status: 400, code: "bad_request", message: "Invalid login payload" }));
    }
    const rememberMe =
      typeof req.body === "object" &&
      req.body !== null &&
      (req.body as { rememberMe?: unknown }).rememberMe === true;
    passport.authenticate("local", (err: any, user: User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return next(new ApiError({ status: 401, code: "unauthenticated", message: info?.message || "Invalid email or password"  }));
      }
      // Regenerate the session id BEFORE attaching the authenticated user
      // — this is the textbook session-fixation fix. After regenerate the
      // old session row is destroyed and req.session is a fresh object.
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, async (loginErr) => {
          if (loginErr) return next(loginErr);
          await stampNewSession(req, user, rememberMe);
          const memberships = await db
            .select({
              orgId: userOrgMemberships.orgId,
              role: userOrgMemberships.role,
            })
            .from(userOrgMemberships)
            .where(eq(userOrgMemberships.userId, user.id));
          const orgIds = memberships.map((m) => m.orgId);
          await recordAudit({
            req,
            actorUserId: user.id,
            action: "auth.login.success",
            targetType: "user",
            targetId: user.id,
            metadata: {
              rememberMe,
              ip: req.ip,
              userAgent: req.get("user-agent") || null,
            },
          });
          res.json({
            user: sanitizeUser(user),
            orgIds,
            memberships,
            mustChangePassword: !!user.mustChangeOnNextLogin,
            status: user.status,
          });
        });
      });
    })(req, res, next);
  });

  // Register. Public registration is OFF by default — set
  // ALLOW_PUBLIC_REGISTRATION=true to re-enable. In all other deployments
  // operators should add new users via the admin module's invitation flow.
  app.post("/api/v1/auth/register", registerRateLimiter, async (req, res, next) => {
    if (process.env.ALLOW_PUBLIC_REGISTRATION !== "true") {
      return next(new ApiError({ status: 403, code: "forbidden", message: "Public registration is disabled. Ask an org admin for an invitation." }));
    }
    try {
      const parsed = registerUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError({ status: 400, code: "bad_request", message: "Invalid registration payload" }));
      }
      const { email, password, displayName, orgId } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      const existing = await findUserByEmail(normalizedEmail);
      if (existing) {
        return next(new ApiError({ status: 409, code: "conflict", message: "An account with that email already exists" }));
      }

      const policy = validatePasswordPolicy(password, {
        email: normalizedEmail,
        displayName: displayName ?? null,
      });
      if (!policy.ok) {
        return next(new ApiError({ status: 400, code: "bad_request", message: policy.reason  }));
      }
      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          displayName: displayName ?? null,
          status: "active",
          passwordChangedAt: new Date(),
        })
        .returning();
      const user = inserted[0];
      await recordPasswordHistory(user.id, passwordHash);

      // Optionally attach to an org as a member if one was provided
      if (orgId) {
        await db
          .insert(userOrgMemberships)
          .values({ userId: user.id, orgId, role: "member" })
          .onConflictDoNothing();
      }

      // Same session-fixation fix as login: regenerate before req.login.
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, async (loginErr) => {
          if (loginErr) return next(loginErr);
          await stampNewSession(req, user, false);
          const memberships = await db
            .select({
              orgId: userOrgMemberships.orgId,
              role: userOrgMemberships.role,
            })
            .from(userOrgMemberships)
            .where(eq(userOrgMemberships.userId, user.id));
          const orgIds = memberships.map((m) => m.orgId);
          await recordAudit({
            req,
            actorUserId: user.id,
            action: "auth.register.success",
            targetType: "user",
            targetId: user.id,
            metadata: { ip: req.ip, orgId: orgId ?? null },
          });
          res.status(201).json({
            user: sanitizeUser(user),
            orgIds,
            memberships,
            mustChangePassword: false,
            status: user.status,
          });
        });
      });
    } catch (err) {
      next(err);
    }
  });

  // Logout
  app.post("/api/v1/auth/logout", (req, res, next) => {
    const sessionId = req.sessionID;
    const userId = req.user ? (req.user as User).id : undefined;
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr);
        res.clearCookie("polaris.sid");
        if (sessionId) void deleteUserSession(sessionId);
        if (userId) {
          void recordAudit({
            req,
            actorUserId: userId,
            action: "auth.logout",
            targetType: "user",
            targetId: userId,
            metadata: {
              sessionId,
              reason: "manual",
              ip: req.ip,
              userAgent: req.get("user-agent") || null,
            },
          });
        }
        res.json({ ok: true });
      });
    });
  });

  // ----- Active-sessions API (Task #37) -----
  // List the authenticated user's known sessions. Each row carries the
  // session id (so the UI can highlight "this device"), a parsed
  // user-agent string, the IP we recorded at sign-in, and the timestamps.
  app.get("/api/v1/auth/sessions", requireAuth, async (req, res) => {
    const me = req.user as User;
    const rows = await listUserSessionsForUser(me.id);
    res.json({
      currentSessionId: req.sessionID,
      sessions: rows.map((r) => ({
        sessionId: r.sessionId,
        userAgent: r.userAgent,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        current: r.sessionId === req.sessionID,
      })),
    });
  });

  // Revoke a specific session. The user-facing "Sign out everywhere else"
  // is implemented as a separate endpoint below; this one targets a
  // single row by id. Always 204 even when the row is missing — we don't
  // want to leak whether a foreign id exists.
  app.delete("/api/v1/auth/sessions/:id", requireAuth, async (req, res) => {
    const me = req.user as User;
    const { id } = req.params;
    // Ownership check — only the row's owner may delete it.
    const rows = await listUserSessionsForUser(me.id);
    const row = rows.find((r) => r.sessionId === id);
    if (!row) {
      return res.status(204).end();
    }
    // Real revocation: destroy the express-session store row so the
    // cookie tied to that sessionId is no longer valid on its next
    // request. Deleting only the user_sessions mirror would leave the
    // session authenticated until idle/absolute timeout, defeating the
    // point of the revoke. The mirror row is then deleted to remove the
    // entry from the UI.
    // express-session stamps the active store onto req.sessionStore at
    // request time. Cast through `unknown` to a minimal structural type
    // so we can call destroy(sid, cb) without a blanket `any`.
    const store = (req as unknown as {
      sessionStore?: { destroy?: (sid: string, cb: (err?: unknown) => void) => void };
    }).sessionStore;
    await new Promise<void>((resolve) => {
      if (store && typeof store.destroy === "function") {
        store.destroy(id, () => resolve());
      } else {
        resolve();
      }
    });
    await deleteUserSession(id);
    const isCurrent = id === req.sessionID;
    await recordAudit({
      req,
      actorUserId: me.id,
      action: "auth.sessions.revoke_one",
      targetType: "user",
      targetId: me.id,
      metadata: {
        sessionId: id,
        current: isCurrent,
        reason: "manual",
        ip: req.ip,
        userAgent: req.get("user-agent") || null,
      },
    });
    // If the caller revoked their own current session, end the
    // express-session for THIS request and clear the cookie BEFORE
    // sending the response — otherwise res.clearCookie would race the
    // already-flushed 204 and yield inconsistent client state.
    if (isCurrent) {
      await new Promise<void>((resolve) => {
        req.logout((logoutErr) => {
          if (logoutErr) return resolve();
          req.session.destroy(() => resolve());
        });
      });
      res.clearCookie("polaris.sid");
    }
    res.status(204).end();
  });

  // Sign out of every session except the current one. Bumps the user's
  // session_epoch which immediately invalidates every other session's
  // snapshot on its next request. The current session's snapshot is
  // refreshed so the caller stays signed in.
  app.post("/api/v1/auth/sessions/sign-out-others", requireAuth, async (req, res) => {
    const me = req.user as User;
    const newEpoch = await bumpUserSessionEpoch(me.id);
    // bumpUserSessionEpoch wipes the session ledger; re-record the
    // current row so the UI still shows "this device".
    await recordUserSession({ sessionId: req.sessionID, userId: me.id, req });
    const meta = getSessionMeta(req);
    meta.sessionEpoch = newEpoch;
    await recordAudit({
      req,
      actorUserId: me.id,
      action: "auth.sessions.sign_out_others",
      targetType: "user",
      targetId: me.id,
      metadata: {
        keptSessionId: req.sessionID,
        newEpoch,
        reason: "user_signout_all",
        ip: req.ip,
        userAgent: req.get("user-agent") || null,
      },
    });
    res.json({ ok: true, newEpoch });
  });
}
