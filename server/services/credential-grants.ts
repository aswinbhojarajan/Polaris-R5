import { randomBytes, createHash } from "crypto";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  credentialGrants,
  type CredentialGrant,
  type CredentialGrantKind,
} from "@shared/schema";
import { recordAudit } from "./audit";

/**
 * Unified credential-bearing grants (Task #18). Sole source of truth for
 * invitation, password-reset, magic-link, and temp-password tokens after
 * Task #19 retired the legacy `invitations` table. Every grant:
 *   - Carries a sha256-hashed token (raw token shown to admin once).
 *   - Has a kind-specific TTL (see GRANT_TTL_MS).
 *   - Is consumed atomically (single-use, no double-redemption races).
 *   - Can be revoked individually or in bulk for a user/email.
 *   - Emits audit-log entries on every lifecycle event.
 */

const TOKEN_PREFIX: Record<CredentialGrantKind, string> = {
  invitation: "crg_inv_",
  password_reset: "crg_rst_",
  magic_link: "crg_mlk_",
  temp_password: "crg_tmp_",
};

const GRANT_TTL_MS: Record<CredentialGrantKind, number> = {
  invitation: 7 * 24 * 60 * 60 * 1000, // 7 days
  password_reset: 60 * 60 * 1000, // 1 hour
  magic_link: 15 * 60 * 1000, // 15 minutes
  temp_password: 24 * 60 * 60 * 1000, // 24 hours
};

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateToken(kind: CredentialGrantKind): string {
  // 20 random bytes -> 40 hex chars; comfortably above 128 bits of entropy.
  return TOKEN_PREFIX[kind] + randomBytes(20).toString("hex");
}

export interface IssueGrantInput {
  kind: CredentialGrantKind;
  email: string;
  userId?: string | null;
  orgId?: string | null;
  clientId?: string | null;
  role?: "admin" | "member" | "viewer" | null;
  issuedByUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IssuedGrant {
  grant: CredentialGrant;
  rawToken: string;
}

/**
 * Issue a new grant. Revokes any existing un-consumed grants of the same
 * kind for the same email so there is at most one active grant per
 * (email, kind) at a time.
 */
export async function issueGrant(input: IssueGrantInput): Promise<IssuedGrant> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const rawToken = generateToken(input.kind);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS[input.kind]);

  // Revoke siblings so there is at most one active grant per logical
  // bucket. CRITICAL tenant boundary (Task #19): for invitations, the
  // bucket is (email, kind, orgId, clientId) — issuing an org B invite
  // for an email must NOT revoke an outstanding org A invite for the
  // same address. For password_reset / temp_password / magic_link the
  // bucket stays (email, kind) because there is exactly one user per
  // email, so issuing a fresh credential should always invalidate the
  // previous one.
  const isInvitation = input.kind === "invitation";
  const siblingFilters = [
    eq(credentialGrants.email, normalizedEmail),
    eq(credentialGrants.kind, input.kind),
    isNull(credentialGrants.consumedAt),
    isNull(credentialGrants.revokedAt),
  ];
  if (isInvitation) {
    siblingFilters.push(
      input.orgId
        ? eq(credentialGrants.orgId, input.orgId)
        : isNull(credentialGrants.orgId),
    );
    siblingFilters.push(
      input.clientId
        ? eq(credentialGrants.clientId, input.clientId)
        : isNull(credentialGrants.clientId),
    );
  }
  await db
    .update(credentialGrants)
    .set({ revokedAt: new Date() })
    .where(and(...siblingFilters));

  const [grant] = await db
    .insert(credentialGrants)
    .values({
      kind: input.kind,
      tokenHash,
      email: normalizedEmail,
      userId: input.userId ?? null,
      orgId: input.orgId ?? null,
      clientId: input.clientId ?? null,
      role: input.role ?? null,
      issuedByUserId: input.issuedByUserId ?? null,
      expiresAt,
      metadata: input.metadata ?? null,
    })
    .returning();

  await recordAudit({
    actorUserId: input.issuedByUserId ?? undefined,
    orgId: input.orgId ?? undefined,
    action: `credential.issue.${input.kind}`,
    targetType: "credential_grant",
    targetId: grant.id,
    metadata: { email: normalizedEmail, expiresAt },
  });

  return { grant, rawToken };
}

/**
 * Look up a grant by raw token. Returns the row if it exists, regardless of
 * status — callers should inspect `consumedAt`/`revokedAt`/`expiresAt` to
 * decide whether to honor it. Anti-enumeration callers (forgot-password)
 * can simply ignore null returns.
 */
export async function findGrantByToken(rawToken: string): Promise<CredentialGrant | null> {
  if (!rawToken) return null;
  const rows = await db
    .select()
    .from(credentialGrants)
    .where(eq(credentialGrants.tokenHash, hashToken(rawToken)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically consume a grant. Only the first request to flip
 * `consumed_at` from NULL wins; concurrent redemptions get null back and
 * must respond with a generic error.
 */
export async function consumeGrant(
  grantId: string,
  meta: { ip?: string | null; ua?: string | null },
): Promise<CredentialGrant | null> {
  const [claimed] = await db
    .update(credentialGrants)
    .set({
      consumedAt: new Date(),
      consumedIp: meta.ip ?? null,
      consumedUa: meta.ua ?? null,
    })
    .where(
      and(
        eq(credentialGrants.id, grantId),
        isNull(credentialGrants.consumedAt),
        isNull(credentialGrants.revokedAt),
        gt(credentialGrants.expiresAt, new Date()),
      ),
    )
    .returning();
  return claimed ?? null;
}

/**
 * Optional scoping filters for `revokeActiveGrantsForEmail`. Without any
 * filters set, EVERY active grant for the email is revoked — that is
 * appropriate for "user disabled" and "password changed", where every
 * outstanding credential becomes irrelevant. When the caller is acting
 * within a tenant boundary (e.g. revoking a single invitation), it MUST
 * pass the appropriate filters so unrelated grants for the same email
 * (other orgs, other kinds) are not touched.
 */
export interface RevokeGrantsScope {
  /** Only revoke grants of this kind. */
  kind?: CredentialGrantKind;
  /** Only revoke grants scoped to this org. */
  orgId?: string;
}

/**
 * Revoke active grants for the given email, optionally narrowed by
 * `kind` and/or `orgId`. Returns the number of grants revoked.
 *
 * Callers from tenant-scoped admin actions (e.g. invitation revoke)
 * MUST pass `{ kind, orgId }` so they cannot accidentally affect grants
 * belonging to other tenants or other credential kinds.
 */
export async function revokeActiveGrantsForEmail(
  email: string,
  reason: string,
  actorUserId?: string,
  scope: RevokeGrantsScope = {},
): Promise<number> {
  const normalizedEmail = email.toLowerCase().trim();
  const conditions = [
    eq(credentialGrants.email, normalizedEmail),
    isNull(credentialGrants.consumedAt),
    isNull(credentialGrants.revokedAt),
  ];
  if (scope.kind) conditions.push(eq(credentialGrants.kind, scope.kind));
  if (scope.orgId) conditions.push(eq(credentialGrants.orgId, scope.orgId));

  const rows = await db
    .update(credentialGrants)
    .set({
      revokedAt: new Date(),
      // Merge a `revokeReason` key into existing metadata without
      // dropping prior context. Use parameterised JSON.stringify so the
      // value is bound safely instead of interpolated.
      metadata: sql`coalesce(${credentialGrants.metadata}, '{}'::jsonb) || ${JSON.stringify({ revokeReason: reason })}::jsonb`,
    })
    .where(and(...conditions))
    .returning({ id: credentialGrants.id });
  if (rows.length > 0) {
    await recordAudit({
      actorUserId,
      action: "credential.revoke_bulk",
      targetType: "email",
      targetId: normalizedEmail,
      metadata: { count: rows.length, reason, scope },
    });
  }
  return rows.length;
}

/**
 * Status helper used by the public redeem endpoint and by the admin UI to
 * categorize a grant for the user.
 */
export function classifyGrant(g: CredentialGrant): "valid" | "consumed" | "revoked" | "expired" {
  if (g.consumedAt) return "consumed";
  if (g.revokedAt) return "revoked";
  if (g.expiresAt.getTime() < Date.now()) return "expired";
  return "valid";
}

export const GRANT_TTLS = GRANT_TTL_MS;
