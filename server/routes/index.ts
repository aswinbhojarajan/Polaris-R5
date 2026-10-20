import type { Express } from "express";
import { createServer, type Server } from "http";

import { registerClientRoutes } from "./clients";
import { registerOnboardingRoutes } from "./onboarding";
import { registerJobRoutes } from "./jobs";
import { registerCompetitorRoutes } from "./competitors";
import { registerAiModelRoutes } from "./ai-models";
import { registerTopicRoutes } from "./topics";
import { registerPromptRoutes } from "./prompts";
import { registerPromptRunRoutes } from "./prompt-runs";
import { registerScoreColorRoutes } from "./score-colors";
import { registerDashboardRoutes } from "./dashboard";
import { registerOpportunityRoutes } from "./opportunities";
import { registerXRayRoutes } from "./xray";
import { registerCrawlerRoutes } from "./crawler";
import { registerReportRoutes } from "./reports";
import { registerOpenApiRoutes } from "./openapi";
import { registerAdminRoutes } from "./admin";
import { registerAdminUserRoutes } from "./admin-users";
import { registerAuthCredentialRoutes } from "./auth-credentials";
import { registerAdminProjectRoutes } from "./admin-projects";
import { registerAdminJobRoutes } from "./admin-jobs";
import { registerProjectSharingRoutes } from "./projects-sharing";
import { registerActivityRoutes } from "./activity";
import { requireAuth, requireTenantAccessIfPresent, requireRole } from "../auth";
import { csrfTokenIssuer, csrfProtect } from "../middleware/csrf";
import { forgotPasswordRateLimiter } from "../middleware/auth-rate-limit";
import { countActiveUserSessions } from "../services/sessions";
import { jobQueue } from "./_shared";

/**
 * Paths under /api/v1 that DO NOT require authentication. Auth/login,
 * logout, the current-user probe, forgot-password, and the credential-grant
 * status/redeem endpoints (which use the raw token as the authenticator)
 * must be reachable anonymously. Everything else is locked down by the
 * global guard mounted in registerRoutes.
 */
const PUBLIC_API_V1_PATHS = new Set<string>([
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/auth/register",
  "/auth/forgot-password",
]);

/**
 * /api/v1 paths that BYPASS the CSRF double-submit check. Re-exported
 * from `server/middleware/csrf.ts` so there is exactly one source of
 * truth shared by the global middleware and the route-mount guard in
 * `server/index.ts`.
 */
export { isCsrfExempt as isCsrfExemptApiV1 } from "../middleware/csrf";

function isPublicApiV1(path: string): boolean {
  if (PUBLIC_API_V1_PATHS.has(path)) return true;
  // GET status + POST redeem on credential grants are anonymous; the token
  // itself authenticates the request.
  if (path.startsWith("/auth/credential-grants/")) {
    return true;
  }
  return false;
}

// Re-export the shared job queue so legacy callers (e.g. `server/index.ts`)
// that previously imported it from the monolithic `server/routes.ts` keep
// working after the per-domain split.
export { jobQueue };

/**
 * Splits the previous monolithic `server/routes.ts` (87 routes, 2925 lines)
 * into per-domain modules under `server/routes/`. Each `register*Routes`
 * function attaches its handlers to the shared Express app.
 *
 * Notable changes vs the monolith:
 *   - Tenancy parameters standardized via the `_helpers` module: routes accept
 *     the `x-client-id` header (preferred), `?clientId=` (recommended) and
 *     legacy `?client_id=` (kept for backwards compatibility).
 *   - Duplicate `/api/v1/jobs` and `/api/v1/jobs/:id` registrations
 *     consolidated into a single jobs module.
 *   - OpenAPI spec auto-generated from existing Zod schemas via
 *     `@asteasolutions/zod-to-openapi`, served at `/openapi.json`. A small
 *     Swagger UI viewer is mounted at `/api/docs`.
 */
export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware to extract client ID from headers (back-compat with legacy code
  // that reads `(req as any).clientId`). Must run before any /api/v1 handlers.
  app.use("/api/v1", (req, _res, next) => {
    const headerClientId = req.headers["x-client-id"];
    if (typeof headerClientId === "string" && headerClientId.length > 0) {
      (req as any).clientId = headerClientId;
    }
    next();
  });

  // CSRF middleware is mounted in server/index.ts BEFORE setupAuth so
  // that auth/session routes registered there (logout, sessions, etc.)
  // actually pass through csrfProtect — Express runs middleware in
  // registration order, so a `app.use(csrf)` here would be a no-op for
  // anything mounted earlier.

  // Per-IP rate limiter on /auth/forgot-password. The credential-routes
  // module also applies its own service-level limiter keyed by IP+email
  // (so attackers can't bypass by rotating one axis).
  app.use("/api/v1/auth/forgot-password", forgotPasswordRateLimiter);

  // Global RBAC guard (Task #7): every /api/v1 endpoint requires auth and
  // (when a tenant id is present in the request) verifies the caller has a
  // membership in that tenant. Public paths (login, logout, /me, register
  // probe, forgot-password, credential-grant status/redeem) are allowed
  // through. Per-route role checks (member/admin) are layered on top via
  // `requireRole` in each domain module.
  app.use("/api/v1", (req, res, next) => {
    if (isPublicApiV1(req.path)) return next();
    return requireAuth(req, res, next);
  });
  app.use("/api/v1", (req, res, next) => {
    if (isPublicApiV1(req.path)) return next();
    return requireTenantAccessIfPresent()(req, res, next);
  });

  // Public + authenticated credential routes (Task #18): forgot-password,
  // grant status/redeem, change-password.
  registerAuthCredentialRoutes(app);

  // Task #56: register the activity routes BEFORE the client domain so the
  // static `/api/v1/clients/activity-summary` path resolves to its handler
  // rather than being shadowed by the dynamic `/api/v1/clients/:id` GET
  // (Express runs routes in registration order; first match wins).
  registerActivityRoutes(app);

  // Register API domains in (mostly) the same order as the original file.
  registerClientRoutes(app);
  registerOnboardingRoutes(app);
  registerJobRoutes(app);
  registerCompetitorRoutes(app);
  registerAiModelRoutes(app);
  registerTopicRoutes(app);
  registerPromptRoutes(app);
  registerPromptRunRoutes(app);
  registerScoreColorRoutes(app);
  registerDashboardRoutes(app);
  registerOpportunityRoutes(app);
  registerXRayRoutes(app);
  registerCrawlerRoutes(app);
  registerReportRoutes(app);

  // Admin module: members, invitations, audit, project owner / soft-delete.
  registerAdminUserRoutes(app);
  registerAdminProjectRoutes(app);
  registerProjectSharingRoutes(app);
  // Task #115 — admin retry/cancel + failed-job listing.
  registerAdminJobRoutes(app);

  // Production monitoring endpoints (/health, /api/admin/queue).
  // /health is intentionally outside /api/v1 so the load balancer can probe
  // it anonymously. /api/admin/queue is under /api/admin (also outside
  // /api/v1) so it bypasses the guard above; we wrap it with auth +
  // requireRole({ scope: 'none', minRole: 'admin' }) inline.
  //
  // Task #5: external probes (queue-monitor, uptime checkers) can call
  // /api/admin/queue with `Authorization: Bearer <MONITORING_TOKEN>` (or the
  // `x-monitoring-token` header) to bypass session auth. This handler is
  // registered BEFORE the `app.use("/api/admin", requireAuth, ...)` mount so
  // the bearer-token path responds first; missing/invalid tokens fall
  // through to the normal admin auth chain below.
  app.get("/api/admin/queue", async (req, res, next) => {
    const expected = process.env.MONITORING_TOKEN;
    if (!expected) return next();
    const header = req.headers.authorization ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    const provided =
      bearer ||
      (typeof req.headers["x-monitoring-token"] === "string"
        ? (req.headers["x-monitoring-token"] as string)
        : "");
    if (provided && provided === expected) {
      const sessions = await countActiveUserSessions();
      return res.json({ ...jobQueue.getConfig(), activeUserSessions: sessions });
    }
    return next();
  });
  app.use("/api/admin", requireAuth, requireRole({ minRole: "admin", scope: "none" }));
  registerAdminRoutes(app);

  // Auto-generated API documentation.
  registerOpenApiRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
