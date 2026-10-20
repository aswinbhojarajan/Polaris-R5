import { db } from "../db";
import {
  clients,
  projectMemberships,
  userOrgMemberships,
  organizations,
} from "@shared/schema";
import { and, eq, asc, isNull, ne, sql } from "drizzle-orm";

/**
 * Idempotent backfill that grandfathers all existing org members onto every
 * existing project, and stamps a creator on legacy projects whose
 * `ownerUserId` is null.
 *
 * - For every org, find the bootstrap admin (oldest admin by createdAt).
 * - For every client in the org with `ownerUserId IS NULL`, set it to the
 *   bootstrap admin (if one exists).
 * - For every (client, non-admin org member) pair where no
 *   `project_memberships` row exists, insert one. Admins are intentionally
 *   skipped because the access helper short-circuits to admin.
 *
 * Safe to re-run: ON CONFLICT DO NOTHING on the unique (clientId, userId).
 */
export async function backfillProjectMemberships(): Promise<{
  ownersStamped: number;
  membershipsCreated: number;
}> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let ownersStamped = 0;
  let membershipsCreated = 0;

  for (const org of orgs) {
    const admins = await db
      .select({
        userId: userOrgMemberships.userId,
        createdAt: userOrgMemberships.createdAt,
      })
      .from(userOrgMemberships)
      .where(
        and(
          eq(userOrgMemberships.orgId, org.id),
          eq(userOrgMemberships.role, "admin"),
        ),
      )
      .orderBy(asc(userOrgMemberships.createdAt));
    const bootstrapAdmin = admins[0]?.userId;

    if (bootstrapAdmin) {
      const stamped = await db
        .update(clients)
        .set({ ownerUserId: bootstrapAdmin })
        .where(and(eq(clients.orgId, org.id), isNull(clients.ownerUserId)))
        .returning({ id: clients.id });
      ownersStamped += stamped.length;
    }

    // Backfill memberships: every non-admin member gets a project_memberships
    // row for every client in the org. Admins are excluded because they
    // already have implicit access via the role short-circuit.
    const result = await db.execute<{ client_id: string }>(sql`
      INSERT INTO project_memberships (client_id, user_id, granted_by_user_id, granted_at)
      SELECT c.id, m.user_id, c.owner_user_id, c.created_at
      FROM clients c
      JOIN user_org_memberships m ON m.org_id = c.org_id
      WHERE c.org_id = ${org.id}
        AND m.role <> 'admin'
        AND m.user_id <> COALESCE(c.owner_user_id, '')
      ON CONFLICT (client_id, user_id) DO NOTHING
      RETURNING client_id
    `);
    membershipsCreated += result.rows.length;
  }

  return { ownersStamped, membershipsCreated };
}

// CLI entrypoint when invoked directly via `tsx server/scripts/backfill-project-memberships.ts`.
import { fileURLToPath } from "node:url";
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  backfillProjectMemberships()
    .then((r) => {
      console.log(
        `[backfill] ownersStamped=${r.ownersStamped} membershipsCreated=${r.membershipsCreated}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill] failed", err);
      process.exit(1);
    });
}
