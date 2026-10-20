import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  clients,
  userOrgMemberships,
  updateClientAdminSchema,
  type User,
} from "@shared/schema";
import { requireRole } from "../auth";
import { recordAudit } from "../services/audit";

/**
 * Admin-module API for projects (clients): rename, change project owner,
 * soft-delete (deactivate). Hard delete remains on /api/v1/clients/:id under
 * the admin-only role check enforced via `requireRole`.
 */
export function registerAdminProjectRoutes(app: Express) {
  app.patch(
    "/api/v1/admin/clients/:id",
    requireRole({ minRole: "admin", scope: "client" }),
    async (req, res, next) => {
      try {
        const { id } = req.params;
        const parsed = updateClientAdminSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const existing = await db
          .select()
          .from(clients)
          .where(eq(clients.id, id))
          .limit(1);
        if (existing.length === 0) {
          throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });
        }
        const project = existing[0];

        // Validate ownerUserId is a member of the project's org if provided
        // (and not nulling it out).
        if (parsed.data.ownerUserId) {
          const membership = await db
            .select({ id: userOrgMemberships.id })
            .from(userOrgMemberships)
            .where(
              and(
                eq(userOrgMemberships.userId, parsed.data.ownerUserId),
                eq(userOrgMemberships.orgId, project.orgId),
              ),
            )
            .limit(1);
          if (membership.length === 0) {
            throw new ApiError({ status: 400, code: "bad_request", message: "ownerUserId must be a member of the project's organization", details: {
            } });
          }
        }

        const update: Record<string, unknown> = {};
        if (parsed.data.name !== undefined) update.name = parsed.data.name;
        if (parsed.data.projectName !== undefined)
          update.projectName = parsed.data.projectName;
        if (parsed.data.ownerUserId !== undefined)
          update.ownerUserId = parsed.data.ownerUserId;
        if (parsed.data.isActive !== undefined)
          update.isActive = parsed.data.isActive;

        if (Object.keys(update).length === 0) {
          throw new ApiError({ status: 400, code: "bad_request", message: "No fields to update" });
        }

        // Stamp updatedAt + updatedByUserId on every admin mutation
        // (Task #17 — keep metadata consistent with the storage layer).
        update.updatedAt = new Date();
        const actor = req.user as User | undefined;
        if (actor?.id) update.updatedByUserId = actor.id;

        const [updated] = await db
          .update(clients)
          .set(update)
          .where(eq(clients.id, id))
          .returning();

        await recordAudit({
          req,
          orgId: project.orgId,
          action: "project.update",
          targetType: "client",
          targetId: id,
          metadata: {
            from: {
              name: project.name,
              projectName: project.projectName,
              ownerUserId: project.ownerUserId,
              isActive: project.isActive,
            },
            to: update,
          },
        });

        res.json({ project: updated });
      } catch (error) {
        next(error);
    }
    },
  );
}
