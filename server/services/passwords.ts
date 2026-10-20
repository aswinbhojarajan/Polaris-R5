import { randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify, Algorithm } from "@node-rs/argon2";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { passwordHistory, validatePasswordPolicy, type PasswordPolicyContext } from "@shared/schema";

/**
 * Argon2id is the only accepted hash format (Task #19). The verify-only
 * scrypt fallback was removed after the rotation sweep flagged every
 * legacy-hash user as `must_change_on_next_login=true`, so any remaining
 * scrypt hashes will be replaced via the change-password interstitial on
 * the user's next successful sign-in.
 */

const PASSWORD_HISTORY_DEPTH = 5;

// OWASP-recommended argon2id parameters (Sep 2023): m=19MiB, t=2, p=1.
const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTS);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith("$argon2")) return false;
  try {
    return await argon2Verify(stored, password);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random temporary password that satisfies
 * the policy (length 16, mixed classes). Returned in plaintext — caller
 * must surface it via the reveal modal exactly once.
 */
export function generateTempPassword(): string {
  // Avoid ambiguous chars (0/O, 1/l/I).
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const symbol = "!@#$%^&*-_=+";
  const all = upper + lower + digit + symbol;

  const pickFrom = (chars: string): string => {
    const idx = randomBytes(1)[0] % chars.length;
    return chars[idx];
  };

  // 16 chars, guaranteed >= 1 of each class.
  const out = [pickFrom(upper), pickFrom(lower), pickFrom(digit), pickFrom(symbol)];
  while (out.length < 16) out.push(pickFrom(all));
  // Shuffle (Fisher–Yates with crypto random).
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

/**
 * Throws if the candidate password violates the shared policy or matches
 * one of the user's last N passwords.
 */
export async function assertPasswordAllowed(
  userId: string | null,
  candidate: string,
  ctx: PasswordPolicyContext,
): Promise<void> {
  const policy = validatePasswordPolicy(candidate, ctx);
  if (!policy.ok) {
    const err = new Error(policy.reason);
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }
  if (!userId) return;
  const recent = await db
    .select({ passwordHash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(PASSWORD_HISTORY_DEPTH);
  for (const row of recent) {
    if (await verifyPassword(candidate, row.passwordHash)) {
      const err = new Error("Cannot reuse one of your last 5 passwords");
      (err as Error & { statusCode: number }).statusCode = 400;
      throw err;
    }
  }
}

/**
 * Append a hash to the per-user history and prune to the last N entries.
 * Best-effort — failures here log but do not block the password change.
 */
export async function recordPasswordHistory(userId: string, passwordHashValue: string): Promise<void> {
  try {
    await db.insert(passwordHistory).values({ userId, passwordHash: passwordHashValue });
    // Prune anything older than the most recent N entries.
    const rows = await db
      .select({ id: passwordHistory.id })
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt));
    const toDelete = rows.slice(PASSWORD_HISTORY_DEPTH).map((r) => r.id);
    if (toDelete.length > 0) {
      // drizzle's inArray import would force another import; do it inline.
      for (const id of toDelete) {
        await db.delete(passwordHistory).where(eq(passwordHistory.id, id));
      }
    }
  } catch (err) {
    console.error("[passwords] recordPasswordHistory failed:", err);
  }
}
