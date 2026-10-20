import type { Express } from "express";
import { storage } from "../storage";
import { assertClientAccess, getUserRoleInOrg, requireAuth } from "../auth";
import {
  getActivitySummaryForClients,
  listActiveActivitiesForClient,
} from "../services/activity-service";

/**
 * Task #56 — Active operations endpoints.
 *
 *   GET /api/v1/clients/:clientId/activity
 *     - Lists in-flight jobs/prompt runs/report jobs for a single project.
 *     - Auth: must have client access (RBAC layered atop org/grants).
 *
 *   GET /api/v1/clients/activity-summary?orgId=...
 *     - Returns per-client { count, kinds[] } for projects the caller can
 *       see, used by the catalog page to render the "in progress" chip.
 */
export function registerActivityRoutes(app: Express) {
  app.get(
    "/api/v1/clients/:clientId/activity",
    requireAuth,
    async (req, res, next) => {
      try {
        const { clientId } = req.params;
        if (!(await assertClientAccess(req, res, clientId))) return;
        const items = await listActiveActivitiesForClient(clientId);
        res.json({ items });
      } catch (error) {
        next(error);
    }
    },
  );

  app.get(
    "/api/v1/clients/activity-summary",
    requireAuth,
    async (req, res, next) => {
      try {
        const orgId =
          (req.query.orgId as string | undefined) ||
          (req.query.org_id as string | undefined) ||
          "default-org";
        const user = req.user as { id: string } | undefined;
        // Resolve the per-org role exactly like /api/v1/clients does so we
        // never surface progress chips for projects the caller cannot see
        // (Task #17 / #26 — global `req.user.role` is not org-scoped and
        // would over-expose for users with admin role in a different org).
        if (!user) return res.json({ summaries: [] });
        const role = await getUserRoleInOrg(user.id, orgId);
        if (!role) return res.json({ summaries: [] });
        const visibleClients = await storage.getClients(orgId, {
          userId: user.id,
          role,
        });
        const ids = visibleClients.map((c) => c.id);
        const summaries = await getActivitySummaryForClients(ids);
        res.json({ summaries });
      } catch (error) {
        next(error);
    }
    },
  );
}
