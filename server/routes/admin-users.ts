import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { and, desc, eq, isNull, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  users,
  userOrgMemberships,
  auditLog,
  organizations,
  credentialGrants,
  clients,
  projectMemberships,
  createInvitationSchema,
  updateMembershipSchema,
  type User,
} from "@shared/schema";
import { hashPassword, requireRole, bumpUserSessionEpoch } from "../auth";
import { recordAudit } from "../services/audit";
import {
  issueGrant,
  revokeActiveGrantsForEmail,
} from "../services/credential-grants";
import { generateTempPassword, recordPasswordHistory } from "../services/passwords";
import { checkRateLimit } from "../services/rate-limit";
import { adminUserActionSchema } from "@shared/schema";
import { storage } from "../storage";

/**
 * Project the credential_grants row into the legacy invitation response
 * shape so admin-UI consumers don't need to change. `acceptedAt` maps to
 * `consumedAt`; `createdAt` to `issuedAt`. The token hash is intentionally
 * omitted.
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

/**
 * Admin-module API: org member listing/role updates/removal, invitations
 * (create/list/revoke), and audit log read.
 *
 * All routes are gated by `requireRole({ scope: 'org', minRole: 'admin' })`
 * (admin-only across the board). The mounted middleware in `routes/index.ts`
 * already enforces auth + tenancy access, so we focus here on role checks
 * and write logic.
 */
export function registerAdminUserRoutes(app: Express) {
  // ----- Members -----

  app.get(
    "/api/v1/admin/orgs/:orgId/members",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const rows = await db
          .select({
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
            status: users.status,
            mustChangeOnNextLogin: users.mustChangeOnNextLogin,
            lockedUntil: users.lockedUntil,
            role: userOrgMemberships.role,
            membershipId: userOrgMemberships.id,
            joinedAt: userOrgMemberships.createdAt,
          })
          .from(userOrgMemberships)
          .innerJoin(users, eq(users.id, userOrgMemberships.userId))
          .where(eq(userOrgMemberships.orgId, orgId));
        res.json({ members: rows });
      } catch (error) {
        next(error);
    }
    },
  );

  // POST is supported as a convenience to add an existing user by email
  // (in addition to the invitation flow). Useful for first-party admins.
  app.post(
    "/api/v1/admin/orgs/:orgId/members",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const schema = z.object({
          email: z.string().email(),
          role: z.enum(["admin", "member", "viewer"]).default("member"),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const { email, role } = parsed.data;
        const userRow = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);
        if (userRow.length === 0) {
          throw new ApiError({ status: 404, code: "not_found", message: "User not found — send an invitation instead" });
        }
        await db
          .insert(userOrgMemberships)
          .values({ userId: userRow[0].id, orgId, role })
          .onConflictDoNothing();
        await recordAudit({
          req,
          orgId,
          action: "member.add",
          targetType: "user",
          targetId: userRow[0].id,
          metadata: { role, email },
        });
        res.status(201).json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  app.patch(
    "/api/v1/admin/orgs/:orgId/members/:userId",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const parsed = updateMembershipSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }

        // Prevent self-demotion lockout: a user cannot change their own org
        // role. Demoting yourself out of admin would strip your access to the
        // admin screens with no way to undo it. Role changes to oneself must
        // be performed by a different admin.
        if (userId === (req.user as User).id) {
          throw new ApiError({ status: 403, code: "forbidden", message: "You cannot change your own role — ask another admin." });
        }

        // Don't let the last admin demote themselves and orphan the org.
        const adminCount = await db
          .select({ id: userOrgMemberships.id })
          .from(userOrgMemberships)
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.role, "admin"),
            ),
          );
        const target = await db
          .select()
          .from(userOrgMemberships)
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.userId, userId),
            ),
          )
          .limit(1);
        if (target.length === 0) {
          throw new ApiError({ status: 404, code: "not_found", message: "Membership not found" });
        }
        if (
          target[0].role === "admin" &&
          parsed.data.role !== "admin" &&
          adminCount.length <= 1
        ) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Cannot demote the last admin" });
        }

        await db
          .update(userOrgMemberships)
          .set({ role: parsed.data.role })
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.userId, userId),
            ),
          );
        await recordAudit({
          req,
          orgId,
          action: "member.role_change",
          targetType: "user",
          targetId: userId,
          metadata: { from: target[0].role, to: parsed.data.role },
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  app.delete(
    "/api/v1/admin/orgs/:orgId/members/:userId",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const adminCount = await db
          .select({ id: userOrgMemberships.id })
          .from(userOrgMemberships)
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.role, "admin"),
            ),
          );
        const target = await db
          .select()
          .from(userOrgMemberships)
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.userId, userId),
            ),
          )
          .limit(1);
        if (target.length === 0) {
          throw new ApiError({ status: 404, code: "not_found", message: "Membership not found" });
        }
        if (target[0].role === "admin" && adminCount.length <= 1) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Cannot remove the last admin" });
        }
        await db
          .delete(userOrgMemberships)
          .where(
            and(
              eq(userOrgMemberships.orgId, orgId),
              eq(userOrgMemberships.userId, userId),
            ),
          );
        await recordAudit({
          req,
          orgId,
          action: "member.remove",
          targetType: "user",
          targetId: userId,
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  // ----- Invitations -----

  app.get(
    "/api/v1/admin/orgs/:orgId/invitations",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const rows = await db
          .select()
          .from(credentialGrants)
          .where(
            and(
              eq(credentialGrants.kind, "invitation"),
              eq(credentialGrants.orgId, orgId),
              isNull(credentialGrants.clientId),
            ),
          )
          .orderBy(desc(credentialGrants.issuedAt));
        res.json({ invitations: rows.map(projectInvitationFromGrant) });
      } catch (error) {
        next(error);
    }
    },
  );

  app.post(
    "/api/v1/admin/orgs/:orgId/invitations",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const parsed = createInvitationSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const orgExists = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        if (orgExists.length === 0) {
          throw new ApiError({ status: 404, code: "not_found", message: "Organization not found" });
        }

        const email = parsed.data.email.toLowerCase().trim();
        const inviterId = (req.user as User).id;

        // Filter pre-selected projects to those in *this*
        // org before persisting so a malicious payload can't smuggle a
        // cross-tenant clientId onto the grant for redemption.
        let scopedClientIds: string[] = [];
        if (parsed.data.clientIds && parsed.data.clientIds.length > 0) {
          const rows = await db
            .select({ id: clients.id })
            .from(clients)
            .where(eq(clients.orgId, orgId));
          const orgIds = new Set(rows.map((r) => r.id));
          scopedClientIds = parsed.data.clientIds.filter((id) => orgIds.has(id));
        }

        const { rawToken, grant } = await issueGrant({
          kind: "invitation",
          email,
          orgId,
          role: parsed.data.role,
          issuedByUserId: inviterId,
          metadata:
            scopedClientIds.length > 0 ? { clientIds: scopedClientIds } : undefined,
        });

        await recordAudit({
          req,
          orgId,
          action: "credential_grant.invitation.create",
          targetType: "credential_grant",
          targetId: grant.id,
          metadata: {
            email,
            role: parsed.data.role,
            ...(scopedClientIds.length > 0 ? { clientIds: scopedClientIds } : {}),
          },
        });

        // The raw token is returned exactly once; the inviter must capture it
        // and deliver it (typically via email) to the invitee.
        res.status(201).json({
          invitation: projectInvitationFromGrant(grant),
          token: rawToken,
          acceptUrl: `/reset-password/${rawToken}`,
        });
      } catch (error) {
        next(error);
    }
    },
  );

  app.delete(
    "/api/v1/admin/orgs/:orgId/invitations/:id",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, id } = req.params;
        const target = await db
          .select()
          .from(credentialGrants)
          .where(
            and(
              eq(credentialGrants.id, id),
              eq(credentialGrants.kind, "invitation"),
              eq(credentialGrants.orgId, orgId),
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
              eq(credentialGrants.id, id),
              isNull(credentialGrants.revokedAt),
              isNull(credentialGrants.consumedAt),
            ),
          );
        await recordAudit({
          req,
          orgId,
          action: "credential_grant.invitation.revoke",
          targetType: "credential_grant",
          targetId: id,
          metadata: { email: target[0].email },
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  // ----- Per-user admin actions (Task #18) -----
  //
  // All four operate on a user under a specific org so the org-admin role
  // check applies. Critically, every handler also verifies that the target
  // userId is a member of that org before mutating — without this an org
  // admin could mutate any user across tenants by guessing IDs.

  async function loadOrgMember(orgId: string, userId: string) {
    const rows = await db
      .select({ user: users })
      .from(users)
      .innerJoin(
        userOrgMemberships,
        and(
          eq(userOrgMemberships.userId, users.id),
          eq(userOrgMemberships.orgId, orgId),
        ),
      )
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.user ?? null;
  }

  /**
   * Per-user admin actions distinguish three cases for cross-tenant safety
   * the user is in this org (proceed), the user exists but in a
   * different org (403 — admin in org A may not manage org B), or the user
   * does not exist at all (404). The latter two are deliberately split so
   * cross-tenant escalation attempts surface as authz failures, not as
   * benign "not found" responses an attacker could enumerate against.
   */
  async function resolveOrgUser(
    orgId: string,
    userId: string,
  ): Promise<{ status: 200; user: User } | { status: 403 | 404 }> {
    const u = await loadOrgMember(orgId, userId);
    if (u) return { status: 200, user: u };
    const exists = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { status: exists.length > 0 ? 403 : 404 };
  }

  app.post(
    "/api/v1/admin/orgs/:orgId/users/:userId/reset-password",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const parsed = adminUserActionSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const u = await loadOrgMember(orgId, userId);
        if (!u) throw new ApiError({ status: 404, code: "not_found", message: "User not found in this org" });
        // Throttle issuance per (admin, target) so a compromised admin
        // session can't be used to flood credential grants.
        const rl = await checkRateLimit(
          `${(req.user as User).id}:${userId}`,
          { scope: "admin_reset_password", limit: 5, windowMs: 60 * 60 * 1000 },
        );
        if (!rl.allowed) {
          res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
          throw new ApiError({ status: 429, code: "rate_limited", message: "Too many reset requests; try again shortly." });
        }
        // Design choice (Task #18): admins do NOT escrow the raw token
        // from a public /forgot-password request — that grant is sealed
        // and only the user's email link can redeem it. Instead, the
        // admin re-issues a fresh single-use grant here, which atomically
        // revokes any of the target user's outstanding self-service
        // grants so only one valid recovery link exists at a time. The
        // raw token below is the forwardable artifact.
        const revokedSelfService = await revokeActiveGrantsForEmail(
          u.email,
          "admin.reset_password.supersede",
          (req.user as User).id,
        );
        const { rawToken, grant } = await issueGrant({
          kind: "password_reset",
          email: u.email,
          userId: u.id,
          orgId,
          issuedByUserId: (req.user as User).id,
          metadata: { reason: parsed.data.reason, revokedSelfService },
        });
        // Spec requires admin-issued resets to sign the target user out
        // everywhere immediately so a hijacked session can't outrun the
        // new password.
        const newEpoch = await bumpUserSessionEpoch(userId);
        await recordAudit({
          req,
          orgId,
          action: "admin.user.reset_password",
          targetType: "user",
          targetId: userId,
          metadata: {
            grantId: grant.id,
            reason: parsed.data.reason,
            sessionEpoch: newEpoch,
            revokedSelfService,
          },
        });
        res.status(201).json({
          token: rawToken,
          expiresAt: grant.expiresAt,
          acceptUrl: `/reset-password/${rawToken}`,
          revokedSelfService,
        });
      } catch (error) {
        next(error);
    }
    },
  );

  app.post(
    "/api/v1/admin/orgs/:orgId/users/:userId/temp-password",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const parsed = adminUserActionSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const u = await loadOrgMember(orgId, userId);
        if (!u) throw new ApiError({ status: 404, code: "not_found", message: "User not found in this org" });
        const rl = await checkRateLimit(
          `${(req.user as User).id}:${userId}`,
          { scope: "admin_temp_password", limit: 5, windowMs: 60 * 60 * 1000 },
        );
        if (!rl.allowed) {
          res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
          throw new ApiError({ status: 429, code: "rate_limited", message: "Too many temp-password requests; try again shortly." });
        }

        const tempPassword = generateTempPassword();
        const passwordHash = await hashPassword(tempPassword);
        const [updated] = await db
          .update(users)
          .set({
            passwordHash,
            passwordChangedAt: new Date(),
            mustChangeOnNextLogin: true,
            failedLoginCount: 0,
            lockedUntil: null,
            sessionEpoch: sql`${users.sessionEpoch} + 1`,
            status: "active",
          })
          .where(eq(users.id, userId))
          .returning();
        await recordPasswordHistory(userId, passwordHash);

        // Audit-trail row for the issuance (no usable token — temp password
        // IS the credential — but we want a record).
        await issueGrant({
          kind: "temp_password",
          email: u.email,
          userId: u.id,
          orgId,
          issuedByUserId: (req.user as User).id,
          metadata: { reason: parsed.data.reason },
        });

        await revokeActiveGrantsForEmail(u.email, "admin.temp_password", (req.user as User).id);

        await recordAudit({
          req,
          orgId,
          action: "admin.user.temp_password",
          targetType: "user",
          targetId: userId,
          metadata: { reason: parsed.data.reason, sessionEpoch: updated?.sessionEpoch },
        });

        res.status(201).json({
          tempPassword,
          mustChangeOnNextLogin: true,
        });
      } catch (error) {
        next(error);
    }
    },
  );

  app.post(
    "/api/v1/admin/orgs/:orgId/users/:userId/disable",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const parsed = adminUserActionSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        if (userId === (req.user as User).id) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Refusing to disable your own account" });
        }
        const u = await loadOrgMember(orgId, userId);
        if (!u) throw new ApiError({ status: 404, code: "not_found", message: "User not found in this org" });
        await db
          .update(users)
          .set({ status: "disabled", sessionEpoch: sql`${users.sessionEpoch} + 1` })
          .where(eq(users.id, userId));
        await revokeActiveGrantsForEmail(u.email, "admin.disable", (req.user as User).id);
        await recordAudit({
          req,
          orgId,
          action: "admin.user.disable",
          targetType: "user",
          targetId: userId,
          metadata: { reason: parsed.data.reason },
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  app.post(
    "/api/v1/admin/orgs/:orgId/users/:userId/enable",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const u = await loadOrgMember(orgId, userId);
        if (!u) throw new ApiError({ status: 404, code: "not_found", message: "User not found in this org" });
        await db.update(users).set({ status: "active" }).where(eq(users.id, userId));
        await recordAudit({
          req,
          orgId,
          action: "admin.user.enable",
          targetType: "user",
          targetId: userId,
        });
        res.json({ ok: true });
      } catch (error) {
        next(error);
    }
    },
  );

  app.post(
    "/api/v1/admin/orgs/:orgId/users/:userId/sign-out-everywhere",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const u = await loadOrgMember(orgId, userId);
        if (!u) throw new ApiError({ status: 404, code: "not_found", message: "User not found in this org" });
        const newEpoch = await bumpUserSessionEpoch(userId);
        await recordAudit({
          req,
          orgId,
          action: "admin.user.sign_out_everywhere",
          targetType: "user",
          targetId: userId,
          metadata: { newEpoch },
        });
        res.json({ ok: true, sessionEpoch: newEpoch });
      } catch (error) {
        next(error);
    }
    },
  );

  // ----- Pending self-service resets (Task #18) -----
  //
  // Surfaces every active password_reset credential grant for users in
  // the given org so admins can monitor self-service forgot-password
  // flows and (if needed) re-issue a fresh link via the standard admin
  // reset endpoint, which surfaces the new token through the one-shot
  // reveal modal. Token hashes are never returned.
  app.get(
    "/api/v1/admin/orgs/:orgId/pending-resets",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const memberRows = await db
          .select({ userId: userOrgMemberships.userId })
          .from(userOrgMemberships)
          .where(eq(userOrgMemberships.orgId, orgId));
        const memberIds = memberRows.map((r) => r.userId);
        if (memberIds.length === 0) return res.json({ pendingResets: [] });
        const rows = await db
          .select({
            id: credentialGrants.id,
            email: credentialGrants.email,
            userId: credentialGrants.userId,
            createdAt: credentialGrants.issuedAt,
            expiresAt: credentialGrants.expiresAt,
            issuedByUserId: credentialGrants.issuedByUserId,
          })
          .from(credentialGrants)
          .where(
            and(
              eq(credentialGrants.kind, "password_reset"),
              isNull(credentialGrants.consumedAt),
              isNull(credentialGrants.revokedAt),
              gt(credentialGrants.expiresAt, new Date()),
              inArray(credentialGrants.userId, memberIds),
            ),
          )
          .orderBy(desc(credentialGrants.issuedAt));
        res.json({ pendingResets: rows });
      } catch (error) {
        next(error);
    }
    },
  );

  // Org-wide users × projects access grid for the admin matrix view.
  // Returns one shot to avoid N+1 from the client.
  app.get(
    "/api/v1/admin/orgs/:orgId/access-matrix",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const memberRows = await db
          .select({
            userId: users.id,
            email: users.email,
            displayName: users.displayName,
            role: userOrgMemberships.role,
          })
          .from(users)
          .innerJoin(
            userOrgMemberships,
            and(
              eq(userOrgMemberships.userId, users.id),
              eq(userOrgMemberships.orgId, orgId),
            ),
          );
        const projectRows = await db
          .select({
            clientId: clients.id,
            name: clients.name,
            projectName: clients.projectName,
            ownerUserId: clients.ownerUserId,
          })
          .from(clients)
          .where(and(eq(clients.orgId, orgId), eq(clients.isActive, true)));
        const projectIds = projectRows.map((p) => p.clientId);
        const grants: Array<{ userId: string; clientId: string; source: "owner" | "member" }> = [];
        for (const p of projectRows) {
          if (p.ownerUserId) {
            grants.push({ userId: p.ownerUserId, clientId: p.clientId, source: "owner" });
          }
        }
        if (projectIds.length > 0) {
          const m = await db
            .select({
              userId: projectMemberships.userId,
              clientId: projectMemberships.clientId,
            })
            .from(projectMemberships)
            .where(inArray(projectMemberships.clientId, projectIds));
          for (const row of m) {
            grants.push({ userId: row.userId, clientId: row.clientId, source: "member" });
          }
        }
        res.json({
          users: memberRows,
          projects: projectRows,
          grants,
        });
      } catch (error) {
        next(error);
    }
    },
  );

  // Per-user project access. GET lists every active org project with
  // hasAccess + source ("owner" | "member" | "none"). PUT reconciles
  // memberships to exactly `clientIds`; owner rows are immutable here
  // (change via /api/v1/admin/clients/:id). Emits project.member.grant/
  // project.member.revoke audit rows.

  app.get(
    "/api/v1/admin/orgs/:orgId/users/:userId/project-access",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const access = await resolveOrgUser(orgId, userId);
        if (access.status === 404) throw new ApiError({ status: 404, code: "not_found", message: "User not found" });
        if (access.status === 403) throw new ApiError({ status: 403, code: "forbidden", message: "User belongs to a different organization" });

        // Active projects only; inactive memberships are preserved by
        // the matching filter on the PUT path's reconciliation universe.
        const projects = await db
          .select({
            id: clients.id,
            name: clients.name,
            projectName: clients.projectName,
            ownerUserId: clients.ownerUserId,
            isActive: clients.isActive,
          })
          .from(clients)
          .where(and(eq(clients.orgId, orgId), eq(clients.isActive, true)));

        const memberRows = await db
          .select({ clientId: projectMemberships.clientId })
          .from(projectMemberships)
          .where(eq(projectMemberships.userId, userId));
        const memberSet = new Set(memberRows.map((r) => r.clientId));

        const items = projects.map((p) => {
          const isOwner = p.ownerUserId === userId;
          const isMember = memberSet.has(p.id);
          return {
            clientId: p.id,
            name: p.name,
            projectName: p.projectName,
            isActive: p.isActive,
            hasAccess: isOwner || isMember,
            source: isOwner ? "owner" : isMember ? "member" : "none",
          };
        });
        res.json({ projects: items });
      } catch (error) {
        next(error);
    }
    },
  );

  app.put(
    "/api/v1/admin/orgs/:orgId/users/:userId/project-access",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId, userId } = req.params;
        const schema = z.object({
          clientIds: z.array(z.string().min(1)),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const access = await resolveOrgUser(orgId, userId);
        if (access.status === 404) throw new ApiError({ status: 404, code: "not_found", message: "User not found" });
        if (access.status === 403) throw new ApiError({ status: 403, code: "forbidden", message: "User belongs to a different organization" });

        // Active org projects only: rejects foreign IDs and avoids
        // revoking memberships on soft-deleted projects.
        const orgProjects = await db
          .select({ id: clients.id, ownerUserId: clients.ownerUserId })
          .from(clients)
          .where(and(eq(clients.orgId, orgId), eq(clients.isActive, true)));
        const orgIds = new Set(orgProjects.map((p) => p.id));
        const requested = new Set(
          parsed.data.clientIds.filter((id) => orgIds.has(id)),
        );

        // Owner rows do not need a membership row — exclude owner-projects
        // from reconciliation so we never insert redundant membership rows
        // and never try to "revoke" ownership through this endpoint.
        const ownerProjects = new Set(
          orgProjects.filter((p) => p.ownerUserId === userId).map((p) => p.id),
        );
        for (const oid of ownerProjects) requested.delete(oid);

        const existing = await db
          .select({ clientId: projectMemberships.clientId })
          .from(projectMemberships)
          .where(eq(projectMemberships.userId, userId));
        const existingSet = new Set(
          existing
            .map((r) => r.clientId)
            .filter((cid) => orgIds.has(cid) && !ownerProjects.has(cid)),
        );

        const toAdd = [...requested].filter((id) => !existingSet.has(id));
        const toRemove = [...existingSet].filter((id) => !requested.has(id));

        const actor = req.user as User;
        for (const cid of toAdd) {
          const { created } = await storage.addProjectMember(cid, userId, actor.id);
          if (created) {
            await recordAudit({
              req,
              orgId,
              action: "project.member.grant",
              targetType: "client",
              targetId: cid,
              metadata: { userId, via: "admin.user.project_access" },
            });
          }
        }
        for (const cid of toRemove) {
          const removed = await storage.removeProjectMember(cid, userId);
          if (removed) {
            await recordAudit({
              req,
              orgId,
              action: "project.member.revoke",
              targetType: "client",
              targetId: cid,
              metadata: { userId, via: "admin.user.project_access" },
            });
          }
        }

        res.json({ ok: true, added: toAdd.length, removed: toRemove.length });
      } catch (error) {
        next(error);
    }
    },
  );

  // ----- Audit log -----

  app.get(
    "/api/v1/admin/orgs/:orgId/audit",
    requireRole({ minRole: "admin", scope: "org" }),
    async (req, res, next) => {
      try {
        const { orgId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const rows = await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.orgId, orgId))
          .orderBy(desc(auditLog.createdAt))
          .limit(limit);
        res.json({ entries: rows });
      } catch (error) {
        next(error);
    }
    },
  );
}

