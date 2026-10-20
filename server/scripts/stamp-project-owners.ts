import { db } from "../db";
import {
  clients,
  userOrgMemberships,
  organizations,
} from "@shared/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * Idempotent owner-stamp pass: for every project whose `ownerUserId` is
 * NULL, fill it in with the bootstrap admin (the oldest admin) of that
 * project's org. This is genuinely a safety fix-up — it does not expand
 * access, it only prevents legacy projects from being permanently
 * un-owned. Safe to run on every boot.
 *
 * Split out from `backfillProjectMemberships` (Task #26) so the seed boot
 * path no longer grandfathers every non-admin org member onto every
 * project. The membership backfill remains available as an explicit
 * one-shot CLI in `backfill-project-memberships.ts` for legacy installs
 * that need it.
 */
export async function stampProjectOwners(): Promise<{ ownersStamped: number }> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let ownersStamped = 0;
  for (const org of orgs) {
    const admins = await db
      .select({ userId: userOrgMemberships.userId })
      .from(userOrgMemberships)
      .where(
        and(
          eq(userOrgMemberships.orgId, org.id),
          eq(userOrgMemberships.role, "admin"),
        ),
      )
      .orderBy(asc(userOrgMemberships.createdAt));
    const bootstrapAdmin = admins[0]?.userId;
    if (!bootstrapAdmin) continue;
    const stamped = await db
      .update(clients)
      .set({ ownerUserId: bootstrapAdmin })
      .where(and(eq(clients.orgId, org.id), isNull(clients.ownerUserId)))
      .returning({ id: clients.id });
    ownersStamped += stamped.length;
  }
  return { ownersStamped };
}
