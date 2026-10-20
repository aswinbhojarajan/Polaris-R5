import { db } from "../db";
import {
  clients,
  projectMemberships,
  users,
  userOrgMemberships,
} from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * One-shot, opt-in audit (Task #26) that lists project_memberships rows
 * almost certainly synthesised by the legacy boot-time grandfather pass
 * (which Task #26 retired). The criteria are deliberately conservative
 * — false positives are far better than false negatives in a security
 * audit, but we tighten them enough that day-to-day admin grants are
 * not flagged:
 *
 *   - `granted_by_user_id IS NULL` — the legacy bulk insert never
 *     populated the granter column. Every admin grant goes through
 *     `storage.addProjectMember(_, _, actor.id)` and therefore *does*
 *     populate it. So a NULL granter is the strongest single signal of
 *     a synthesised row.
 *   - AND `granted_at` falls within the project's "backfill window" —
 *     i.e. within `WINDOW_SECONDS` of `clients.created_at`. Real admin
 *     grants happen later, when the admin actually opens the dialog
 *     and ticks a checkbox; the boot-time backfill ran in a single
 *     transaction immediately after seeding the project.
 *
 * Output is a JSON report on stdout — nothing is mutated. Operators can
 * pipe this into `jq`, review, then revoke via the admin Project Access
 * UI (`/app/admin/users` → member row → "Project access").
 *
 * Run with:
 *     tsx server/scripts/audit-grandfathered-access.ts > grandfathered.json
 */
const WINDOW_SECONDS = 60;

async function main() {
  const rows = await db
    .select({
      membershipId: projectMemberships.id,
      clientId: projectMemberships.clientId,
      projectName: clients.projectName,
      orgId: clients.orgId,
      userId: projectMemberships.userId,
      userEmail: users.email,
      role: userOrgMemberships.role,
      grantedByUserId: projectMemberships.grantedByUserId,
      grantedAt: projectMemberships.grantedAt,
      clientCreatedAt: clients.createdAt,
    })
    .from(projectMemberships)
    .innerJoin(clients, eq(clients.id, projectMemberships.clientId))
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .innerJoin(
      userOrgMemberships,
      and(
        eq(userOrgMemberships.userId, projectMemberships.userId),
        eq(userOrgMemberships.orgId, clients.orgId),
      ),
    )
    .where(
      and(
        isNull(projectMemberships.grantedByUserId),
        sql`abs(extract(epoch from (${projectMemberships.grantedAt} - ${clients.createdAt}))) <= ${WINDOW_SECONDS}`,
      ),
    );

  const report = {
    generatedAt: new Date().toISOString(),
    criteria: {
      grantedByUserIdIsNull: true,
      grantedAtWithinSecondsOfClientCreatedAt: WINDOW_SECONDS,
    },
    suspectedGrandfatheredCount: rows.length,
    rows,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

import { fileURLToPath } from "node:url";
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[audit-grandfathered-access] failed", err);
      process.exit(1);
    });
}
