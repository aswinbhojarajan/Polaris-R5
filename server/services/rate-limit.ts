/**
 * Tiny in-memory token-bucket-ish rate limiter for credential issuance
 * (Task #18). Anything that hands out a single-use credential is a
 * brute-force / enumeration target and must be throttled.
 *
 * Process-local — fine for single-instance deploys; if Polaris ever runs
 * behind multiple workers this should move to Redis. Documented as
 * tech-debt rather than blocking the rollout.
 */
import { recordAudit } from "./audit";

interface Bucket {
  windowStart: number;
  count: number;
}

const BUCKETS = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Logical name — used as the key prefix and the audit action. */
  scope: string;
  /** Max events allowed per window per key. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now();
  const composite = `${opts.scope}:${key}`;
  const bucket = BUCKETS.get(composite);
  if (!bucket || now - bucket.windowStart >= opts.windowMs) {
    BUCKETS.set(composite, { windowStart: now, count: 1 });
    return { allowed: true, remaining: opts.limit - 1, retryAfterMs: 0 };
  }
  if (bucket.count >= opts.limit) {
    const retryAfterMs = opts.windowMs - (now - bucket.windowStart);
    // Audit the throttle so abuse patterns surface in the audit log.
    await recordAudit({
      action: `rate_limit.${opts.scope}`,
      targetType: "rate_limit",
      targetId: key,
      metadata: { limit: opts.limit, windowMs: opts.windowMs, retryAfterMs },
    }).catch(() => undefined);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
  bucket.count += 1;
  return { allowed: true, remaining: opts.limit - bucket.count, retryAfterMs: 0 };
}

/** Test-only — clears every bucket. */
export function _resetRateLimitBuckets() {
  BUCKETS.clear();
}
