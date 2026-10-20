import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { auditLog } from "@shared/schema";

/**
 * Audit-log action rename migration (Task #19, step 2).
 *
 * Folds the legacy `invitation.*` and `project.invitation.*` action names
 * into the unified `credential_grant.*` family. The original metadata is
 * preserved verbatim — only the `action` column is rewritten.
 *
 * Idempotent: only rows whose action matches one of the legacy names get
 * rewritten, so re-running is a no-op.
 *
 * Run via:
 *   npx tsx server/scripts/audit-rename.ts
 *
 * Auto-runs from `post_merge_setup.sh` after the Task #19 merge.
 */

export const AUDIT_RENAME_MAP: Record<string, string> = {
  "invitation.create": "credential_grant.invitation.create",
  "invitation.revoke": "credential_grant.invitation.revoke",
  "invitation.accept": "credential_grant.invitation.accept",
  "project.invitation.create": "credential_grant.project_invitation.create",
  "project.invitation.revoke": "credential_grant.project_invitation.revoke",
  "project.invitation.accept": "credential_grant.project_invitation.accept",
};

export interface AuditRenameResult {
  renamed: Record<string, number>;
  total: number;
}

export async function runAuditRename(): Promise<AuditRenameResult> {
  const renamed: Record<string, number> = {};
  let total = 0;
  for (const [from, to] of Object.entries(AUDIT_RENAME_MAP)) {
    const result = await db.execute(
      sql`UPDATE ${auditLog} SET action = ${to} WHERE action = ${from}`,
    );
    // pg returns rowCount on the result object; drizzle exposes it as
    // `rowCount` (node-postgres) or via the affected-rows shape depending
    // on driver. Fall back to 0.
    const count =
      (result as unknown as { rowCount?: number }).rowCount ??
      (result as unknown as { count?: number }).count ??
      0;
    renamed[from] = count;
    total += count;
  }
  return { renamed, total };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runAuditRename()
    .then((r) => {
      console.log(
        `[audit-rename] total=${r.total} ${Object.entries(r.renamed)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      );
      return pool.end();
    })
    .catch((err) => {
      console.error("[audit-rename] failed:", err);
      process.exit(1);
    });
}
