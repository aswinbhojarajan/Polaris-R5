import { isNull, or, lt, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { users } from "@shared/schema";

/**
 * Password rotation sweep (Task #19, step 3).
 *
 * Flags every user whose `password_changed_at` is null or predates the
 * Task #18/#19 policy bump as `must_change_on_next_login = true` so they
 * are routed through the change-password interstitial on next sign-in.
 *
 * Idempotent: re-running the sweep is a no-op for users already flagged.
 *
 * Run via:
 *   npx tsx server/scripts/rotation-sweep.ts
 *
 * The script also runs automatically from `post_merge_setup.sh` after the
 * Task #19 merge so production catches the cutoff without a manual step.
 */

// Cutoff is the date the new ≥12-char policy shipped (Task #18 merge).
// Users whose passwords pre-date this need to rotate.
export const ROTATION_CUTOFF = new Date("2026-04-01T00:00:00.000Z");

export interface RotationSweepResult {
  flagged: number;
  alreadyFlagged: number;
  cutoff: Date;
}

export async function runRotationSweep(
  cutoff: Date = ROTATION_CUTOFF,
): Promise<RotationSweepResult> {
  // Count rows that need flagging BEFORE the update so we can report a
  // meaningful number on subsequent (idempotent) re-runs.
  const candidates = await db
    .select({ id: users.id, mustChange: users.mustChangeOnNextLogin })
    .from(users)
    .where(
      or(
        isNull(users.passwordChangedAt),
        lt(users.passwordChangedAt, cutoff),
      ),
    );

  const toFlip = candidates.filter((u) => !u.mustChange);
  const alreadyFlagged = candidates.length - toFlip.length;

  if (toFlip.length > 0) {
    await db
      .update(users)
      .set({ mustChangeOnNextLogin: true })
      .where(
        sql`${users.id} IN (${sql.join(
          toFlip.map((u) => sql`${u.id}`),
          sql`, `,
        )})`,
      );
  }

  return { flagged: toFlip.length, alreadyFlagged, cutoff };
}

// CLI entrypoint
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runRotationSweep()
    .then((r) => {
      console.log(
        `[rotation-sweep] cutoff=${r.cutoff.toISOString()} flagged=${r.flagged} alreadyFlagged=${r.alreadyFlagged}`,
      );
      return pool.end();
    })
    .catch((err) => {
      console.error("[rotation-sweep] failed:", err);
      process.exit(1);
    });
}
