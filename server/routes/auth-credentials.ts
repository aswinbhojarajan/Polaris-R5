import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  userOrgMemberships,
  projectMemberships,
  clients,
  forgotPasswordSchema,
  redeemGrantSchema,
  changePasswordSchema,
  type User,
} from "@shared/schema";
import {
  hashPassword,
  verifyPassword,
  bumpUserSessionEpoch,
  recordPasswordHistory,
  requireAuth,
} from "../auth";
import { assertPasswordAllowed } from "../services/passwords";
import {
  issueGrant,
  findGrantByToken,
  consumeGrant,
  revokeActiveGrantsForEmail,
  classifyGrant,
} from "../services/credential-grants";
import { recordAudit } from "../services/audit";
import { checkRateLimit } from "../services/rate-limit";

/**
 * Public credential routes (Task #18).
 *
 *   POST /api/v1/auth/forgot-password
 *     Always 202; never reveals account existence. Issues a `password_reset`
 *     grant only when an `active` user with that email exists.
 *
 *   POST /api/v1/auth/credential-grants/:token/redeem
 *     Atomically consume a grant and apply its effect:
 *       - invitation:     create user (or attach to existing) + memberships,
 *                         set password, mark `active`.
 *       - password_reset: replace the user's password.
 *       - magic_link:     primitive only; reserved for a future task. The
 *                         redeem endpoint rejects this kind today.
 *       - temp_password:  not redeemed via this endpoint — see login flow
 *                         (the temp password IS the password until the next
 *                         change-password). Calls here return 400.
 *     On success: bumps session_epoch, revokes sibling grants, returns
 *     `{ ok: true, kind, mustChangePassword, redirect }`.
 *
 *   POST /api/v1/auth/change-password (authenticated)
 *     Verifies current password, applies policy + history checks, hashes
 *     and stores the new password, clears `mustChangeOnNextLogin`, bumps
 *     session_epoch (other sessions are invalidated; this session's
 *     snapshot is refreshed so the caller stays signed in).
 */
export function registerAuthCredentialRoutes(app: Express) {
  app.post("/api/v1/auth/forgot-password", async (req, res, next) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        // Even on bad payload we 202 to avoid signal — but log for debugging.
        console.warn("[forgot-password] invalid payload", parsed.error.flatten());
        return res.status(202).json({ ok: true });
      }
      const email = parsed.data.email.toLowerCase().trim();
      // Throttle by both IP and email so attackers can't pivot one axis.
      const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();
      for (const key of [`ip:${ip}`, `email:${email}`]) {
        const rl = await checkRateLimit(key, {
          scope: "forgot_password",
          limit: 5,
          windowMs: 15 * 60 * 1000,
        });
        if (!rl.allowed) {
          res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
          // Still return 202 — anti-enumeration must hold even when
          // throttled — but skip the actual issuance work.
          return res.status(202).json({ ok: true });
        }
      }
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      // We log a single uniform line for every forgot-password request so
      // log aggregators don't become an enumeration oracle (the API itself
      // already returns a uniform 202; an attacker with read access to
      // application logs must not be able to tell known from unknown
      // emails either). The grant id, when one was issued, is recorded
      // in the access-controlled audit log instead.
      console.info(`[forgot-password] processed request`);
      if (user && user.status === "active") {
        const { grant } = await issueGrant({
          kind: "password_reset",
          email,
          userId: user.id,
        });
        // The raw token is intentionally NOT logged — that would leak a
        // live credential into log aggregators. Until email delivery is
        // wired (out of scope for Task #18), operators must use the admin
        // "Reset link" action, which surfaces the token via the one-shot
        // reveal modal.
        await recordAudit({
          action: "auth.forgot_password.issued",
          targetType: "user",
          targetId: user.id,
          metadata: { email, grantId: grant.id },
        });
      }
      res.status(202).json({ ok: true });
    } catch (err) {
      console.error("[forgot-password] error:", err);
      res.status(202).json({ ok: true });
    }
  });

  // GET status — used by the reset/accept page to render the right copy
  // before asking for a password.
  app.get("/api/v1/auth/credential-grants/:token", async (req, res, next) => {
    try {
      const { token } = req.params;
      const grant = await findGrantByToken(token);
      if (!grant) throw new ApiError({ status: 404, code: "not_found", message: "Invalid or expired link" });
      const status = classifyGrant(grant);
      if (status !== "valid") {
        throw new ApiError({ status: 410, code: "gone", message: `Link is ${status}`, details: { status, kind: grant.kind } });
      }
      res.json({
        status,
        kind: grant.kind,
        email: grant.email,
        expiresAt: grant.expiresAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/auth/credential-grants/:token/redeem", async (req, res, next) => {
    try {
      const { token } = req.params;
      const grant = await findGrantByToken(token);
      if (!grant) throw new ApiError({ status: 404, code: "not_found", message: "Invalid or expired link" });
      const status = classifyGrant(grant);
      if (status !== "valid") {
        throw new ApiError({ status: 410, code: "gone", message: `Link is ${status}`, details: { status } });
      }
      if (grant.kind === "temp_password") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Sign in with the temporary password instead — you'll be prompted to change it.", details: {
        } });
      }
      // Magic-link grants exist as a primitive in the schema but the
      // passwordless redeem flow is intentionally out of scope for
      // Task #18 (no email delivery wired). Reject explicitly here so a
      // magic_link token cannot be repurposed as a password-set vector.
      if (grant.kind === "magic_link") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Magic-link sign-in is not yet enabled. Use the password sign-in flow instead.", details: {
        } });
      }
      const parsed = redeemGrantSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
      }
      const { password, displayName } = parsed.data;

      // Find or create the user.
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, grant.email))
        .limit(1);
      let user: User | undefined = existing[0];

      await assertPasswordAllowed(user?.id ?? null, password, {
        email: grant.email,
        displayName: displayName ?? user?.displayName ?? null,
      });

      const passwordHash = await hashPassword(password);

      // Atomically claim the grant first; only the winner proceeds.
      const claimed = await consumeGrant(grant.id, {
        ip: req.ip ?? null,
        ua: req.headers["user-agent"] ?? null,
      });
      if (!claimed) {
        throw new ApiError({ status: 409, code: "conflict", message: "Link is no longer valid — please request a new one." });
      }

      if (!user) {
        const [created] = await db
          .insert(users)
          .values({
            email: grant.email,
            passwordHash,
            displayName: displayName ?? null,
            status: "active",
            passwordChangedAt: new Date(),
          })
          .returning();
        user = created;
      } else {
        const [updated] = await db
          .update(users)
          .set({
            passwordHash,
            status: "active",
            passwordChangedAt: new Date(),
            mustChangeOnNextLogin: false,
            failedLoginCount: 0,
            lockedUntil: null,
            sessionEpoch: sql`${users.sessionEpoch} + 1`,
            ...(displayName ? { displayName } : {}),
          })
          .where(eq(users.id, user.id))
          .returning();
        user = updated;
      }
      await recordPasswordHistory(user.id, passwordHash);

      // For invitations, attach memberships scoped to the grant.
      if (grant.kind === "invitation" && grant.orgId) {
        await db
          .insert(userOrgMemberships)
          .values({ userId: user.id, orgId: grant.orgId, role: grant.role ?? "member" })
          .onConflictDoNothing();
        // The legacy single-project field still applies for project_invitation
        // grants. Org invitations may *also* carry a `metadata.clientIds`
        // list (Task #26) — admins pre-select projects when issuing the
        // invite. Both paths converge on `project_memberships`. We
        // deliberately re-validate org membership for each clientId so a
        // forged metadata array can't grant access to foreign-org projects.
        const clientIdsToGrant: string[] = [];
        if (grant.clientId) clientIdsToGrant.push(grant.clientId);
        const meta = (grant.metadata ?? null) as { clientIds?: unknown } | null;
        if (meta && Array.isArray(meta.clientIds)) {
          for (const cid of meta.clientIds) {
            if (typeof cid === "string" && cid.length > 0) clientIdsToGrant.push(cid);
          }
        }
        if (clientIdsToGrant.length > 0) {
          const orgClients = await db
            .select({ id: clients.id })
            .from(clients)
            .where(eq(clients.orgId, grant.orgId));
          const allowed = new Set(orgClients.map((c) => c.id));
          for (const cid of clientIdsToGrant) {
            if (!allowed.has(cid)) continue;
            await db
              .insert(projectMemberships)
              .values({
                clientId: cid,
                userId: user.id,
                grantedByUserId: grant.issuedByUserId ?? null,
              })
              .onConflictDoNothing();
          }
        }
      }

      // Revoke any other active grants for this email (a fresh password
      // invalidates outstanding reset grants).
      await revokeActiveGrantsForEmail(grant.email, `redeem.${grant.kind}`, user.id);

      await recordAudit({
        actorUserId: user.id,
        orgId: grant.orgId ?? undefined,
        action: `credential.redeem.${grant.kind}`,
        targetType: "user",
        targetId: user.id,
        metadata: { grantId: grant.id, ip: req.ip },
      });

      // Task #19: also emit the unified `credential_grant.*.accept`
      // events for invitation redemptions so the audit-log family stays
      // consistent across create / revoke / accept and surfaces in the
      // admin audit-log UI under one badge family.
      if (grant.kind === "invitation" && grant.orgId) {
        await recordAudit({
          actorUserId: user.id,
          orgId: grant.orgId,
          action: "credential_grant.invitation.accept",
          targetType: "credential_grant",
          targetId: grant.id,
          metadata: { email: grant.email, role: grant.role },
        });
        if (grant.clientId) {
          await recordAudit({
            actorUserId: user.id,
            orgId: grant.orgId,
            action: "credential_grant.project_invitation.accept",
            targetType: "credential_grant",
            targetId: grant.id,
            metadata: { email: grant.email, clientId: grant.clientId },
          });
        }
      }

      res.json({
        ok: true,
        kind: grant.kind,
        mustChangePassword: false,
        redirect: "/login",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/auth/change-password", requireAuth, async (req, res, next) => {
    try {
      const me = req.user as User;
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid payload", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
      }
      const { currentPassword, newPassword } = parsed.data;

      const ok = await verifyPassword(currentPassword, me.passwordHash);
      if (!ok) throw new ApiError({ status: 400, code: "bad_request", message: "Current password is incorrect" });
      if (currentPassword === newPassword) {
        throw new ApiError({ status: 400, code: "bad_request", message: "New password must differ from the current one" });
      }

      await assertPasswordAllowed(me.id, newPassword, {
        email: me.email,
        displayName: me.displayName,
      });

      const passwordHash = await hashPassword(newPassword);
      const newEpoch = (me.sessionEpoch ?? 0) + 1;
      const [updated] = await db
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangeOnNextLogin: false,
          sessionEpoch: newEpoch,
        })
        .where(eq(users.id, me.id))
        .returning();
      await recordPasswordHistory(me.id, passwordHash);
      // Refresh THIS session's snapshot so the user stays signed in even
      // though every other session is now stale.
      (req.session as unknown as { sessionEpoch?: number }).sessionEpoch = newEpoch;
      // Revoke any other outstanding reset grants for this email so the
      // password change closes every other recovery path. (Magic-link
      // grants exist as a primitive but no UI/redeem flow is wired yet.)
      await revokeActiveGrantsForEmail(me.email, "password.changed", me.id);

      await recordAudit({
        actorUserId: me.id,
        action: "auth.password.change",
        targetType: "user",
        targetId: me.id,
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}
