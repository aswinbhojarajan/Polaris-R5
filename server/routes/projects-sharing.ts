import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  credentialGrants,
  users,
  userOrgMemberships,
  grantProjectMemberSchema,
  createProjectInvitationSchema,
  type User,
} from "@shared/schema";
import { storage } from "../storage";
import { requireProjectOwnerOrAdmin, assertClientAccess } from "../auth";
import { recordAudit } from "../services/audit";
import { issueGrant } from "../services/credential-grants";

/**
 * Per-project sharing API (Task #17, modernised in Task #19 to use the
 * unified credential_grants table for project-scoped invitations).
 *
 * Routes are gated by `requireProjectOwnerOrAdmin`: org admins always pass,
 * and the project's creator (`clients.ownerUserId`) passes for their own
 * projects. Plain members and viewers cannot share — even on projects they
 * have access to via `project_memberships`.
 */

function projectInvitationFromGrant(g: typeof credentialGrants.$inferSelect) {
  return {
    id: g.id,
    orgId: g.orgId,
    clientId: g.clientId,
    email: g.email,
    role: g.role,
    invitedByUserId: g.issuedByUserId,
    expiresAt: g.expiresAt,
    acceptedAt: g.consumedAt,
    revokedAt: g.revokedAt,
    createdAt: g.issuedAt,
  };
}

export function registerProjectSharingRoutes(app: Express) {
  // ----- Members -----

  app.get("/api/v1/clients/:id/members", async (req, res, next) => {
    try {
      const { id } = req.params;
      // Anyone with access to the project can see the member list — only
      // mutations are restricted to owner / org-admin.
      if (!(await assertClientAccess(req, res, id))) return;
      const members = await storage.listProjectMembers(id);
      res.json({ members });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/clients/:id/members", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await requireProjectOwnerOrAdmin(req, res, id))) return;
      const parsed = grantProjectMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
      }
      const project = await storage.getClient(id);
      if (!project) throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });

      const targetEmail = parsed.data.email.toLowerCase().trim();
      const userRow = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, targetEmail))
        .limit(1);
      if (userRow.length === 0) {
        throw new ApiError({ status: 404, code: "not_found", message: "No user with that email exists yet — send an invitation instead.", details: {
        } });
      }
      const targetUserId = userRow[0].id;

      // Target user must already be in the project's org. Cross-org grants
      // would silently bypass org membership; force the inviter to invite
      // them to the org first.
      const orgMember = await db
        .select({ role: userOrgMemberships.role })
        .from(userOrgMemberships)
        .where(
          and(
            eq(userOrgMemberships.userId, targetUserId),
            eq(userOrgMemberships.orgId, project.orgId),
          ),
        )
        .limit(1);
      if (orgMember.length === 0) {
        throw new ApiError({ status: 404, code: "not_found", message: "User must be a member of this organization. Invite them to the org first.", details: {
        } });
      }

      // Reject if the user already has effective access — owner, org admin,
      // or an existing explicit project_memberships row (Task #17 contract).
      if (project.ownerUserId === targetUserId) {
        throw new ApiError({ status: 409, code: "conflict", message: "User is already the project owner", details: {
        } });
      }
      if (orgMember[0].role === "admin") {
        throw new ApiError({ status: 409, code: "conflict", message: "User is an org admin and already has access to all projects", details: {
        } });
      }

      const actor = req.user as User;
      const { created, membership } = await storage.addProjectMember(
        id,
        targetUserId,
        actor.id,
      );
      if (!created) {
        return next(new ApiError({ status: 409, code: "conflict", message: "User already has access to this project" }));
      }
      await recordAudit({
        req,
        orgId: project.orgId,
        action: "project.share.grant",
        targetType: "client",
        targetId: id,
        metadata: { userId: targetUserId, email: targetEmail },
      });
      res.status(201).json({ membership });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/v1/clients/:id/members/:userId", async (req, res, next) => {
    try {
      const { id, userId } = req.params;
      const actor = req.user as User | undefined;
      // Self-revoke is allowed for any member with project access
      // (someone removing themselves). All other revokes require
      // owner / org-admin.
      const isSelfRevoke = !!actor && actor.id === userId;
      if (isSelfRevoke) {
        if (!(await assertClientAccess(req, res, id))) return;
      } else {
        if (!(await requireProjectOwnerOrAdmin(req, res, id))) return;
      }
      const project = await storage.getClient(id);
      if (!project) throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });
      if (project.ownerUserId === userId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Cannot revoke the project owner. Transfer ownership in the admin panel first.", details: {
        } });
      }
      const removed = await storage.removeProjectMember(id, userId);
      if (!removed) {
        throw new ApiError({ status: 404, code: "not_found", message: "User does not have explicit access to this project" });
      }
      await recordAudit({
        req,
        orgId: project.orgId,
        action: "project.share.revoke",
        targetType: "client",
        targetId: id,
        metadata: { userId },
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // ----- Project-scoped invitations -----
  // Backed by credential_grants (Task #19): every project invitation is a
  // grant with kind='invitation' and clientId set to this project.

  app.get("/api/v1/clients/:id/invitations", async (req, res, next) => {
    try {
      const { id } = req.params;
      // Anyone with access to the project can see pending invitations.
      if (!(await assertClientAccess(req, res, id))) return;
      const rows = await db
        .select()
        .from(credentialGrants)
        .where(
          and(
            eq(credentialGrants.kind, "invitation"),
            eq(credentialGrants.clientId, id),
          ),
        )
        .orderBy(desc(credentialGrants.issuedAt));
      res.json({ invitations: rows.map(projectInvitationFromGrant) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/clients/:id/invitations", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await requireProjectOwnerOrAdmin(req, res, id))) return;
      const project = await storage.getClient(id);
      if (!project) throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });

      const parsed = createProjectInvitationSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
      }
      const actor = req.user as User;
      const email = parsed.data.email.toLowerCase().trim();
      const { rawToken, grant } = await issueGrant({
        kind: "invitation",
        email,
        orgId: project.orgId,
        clientId: id,
        role: parsed.data.role,
        issuedByUserId: actor.id,
      });

      await recordAudit({
        req,
        orgId: project.orgId,
        action: "credential_grant.project_invitation.create",
        targetType: "credential_grant",
        targetId: grant.id,
        metadata: { email, clientId: id, role: parsed.data.role },
      });

      res.status(201).json({
        invitation: projectInvitationFromGrant(grant),
        token: rawToken,
        acceptUrl: `/reset-password/${rawToken}`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/v1/clients/:id/invitations/:invId", async (req, res, next) => {
    try {
      const { id, invId } = req.params;
      if (!(await requireProjectOwnerOrAdmin(req, res, id))) return;
      const project = await storage.getClient(id);
      if (!project) throw new ApiError({ status: 404, code: "not_found", message: "Project not found" });
      const target = await db
        .select()
        .from(credentialGrants)
        .where(
          and(
            eq(credentialGrants.id, invId),
            eq(credentialGrants.kind, "invitation"),
            eq(credentialGrants.clientId, id),
          ),
        )
        .limit(1);
      if (target.length === 0) {
        throw new ApiError({ status: 404, code: "not_found", message: "Invitation not found" });
      }
      await db
        .update(credentialGrants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(credentialGrants.id, invId),
            isNull(credentialGrants.revokedAt),
            isNull(credentialGrants.consumedAt),
          ),
        );
      await recordAudit({
        req,
        orgId: project.orgId,
        action: "credential_grant.project_invitation.revoke",
        targetType: "credential_grant",
        targetId: invId,
        metadata: { email: target[0].email, clientId: id },
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}
