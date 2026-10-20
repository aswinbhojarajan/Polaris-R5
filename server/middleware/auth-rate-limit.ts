import rateLimit, { type Options } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ApiError } from "../utils/api-error";

/**
 * Per-IP rate limiters for auth endpoints (Task #37).
 *
 *   - login:           AUTH_LOGIN_RATE_PER_MIN per IP per minute (default 10)
 *   - register:        AUTH_REGISTER_RATE_PER_HOUR per IP per hour (default 5)
 *   - forgot-password: AUTH_FORGOT_RATE_PER_HOUR per IP per hour (default 5)
 *
 * Limiters bypass on `NODE_ENV=test` OR when the explicit opt-in
 * `RATE_LIMIT_BYPASS=true` is set. This is intentionally a SEPARATE
 * knob from the CSRF/auth `TEST_AUTH_BYPASS` flag: the integration
 * suite needs CSRF + auth ON while still letting supertest replay from
 * a single loopback IP without tripping the per-IP throttle. The
 * dedicated rate-limit test in `server/tests/sessions.test.ts` briefly
 * switches `NODE_ENV=production` to exercise the real limiter contract.
 *
 * 429 responses return `{ message, retryAfterSeconds }`.
 */

function isTestBypass(): boolean {
  // Bypass the limiter under NODE_ENV=test OR when the explicit opt-in
  // RATE_LIMIT_BYPASS=true is set. The CSRF and route-auth bypass uses
  // the separate TEST_AUTH_BYPASS flag — the limiter has its own knob
  // because the integration suite needs CSRF + auth ON while still
  // letting supertest replay from a single loopback IP without tripping
  // the per-IP throttle. The dedicated rate-limit test in
  // server/tests/sessions.test.ts briefly sets NODE_ENV=production to
  // exercise the real limiter contract.
  return (
    process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_BYPASS === "true"
  );
}

function makeLimiter(opts: {
  windowMs: number;
  limit: number;
  scope: string;
}): RequestHandler {
  const limiter = rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => isTestBypass(),
    handler: (_req: Request, _res: Response, next: NextFunction, options: Options) => {
      // Task #113 — route through global error middleware so the
      // unified envelope is emitted. The route-scope is exposed under
      // `details.scope` so callers can still distinguish login vs
      // register vs forgot-password without a custom error code.
      const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
      next(
        new ApiError({
          status: 429,
          code: "rate_limited",
          message: `Too many ${opts.scope} attempts — try again in ${retryAfterSeconds}s`,
          details: { scope: opts.scope, retryAfterSeconds },
        }),
      );
    },
  });
  return limiter;
}

const LOGIN_PER_MIN = parseInt(
  process.env.AUTH_LOGIN_RATE_PER_MIN || "10",
  10,
);
const REGISTER_PER_HOUR = parseInt(
  process.env.AUTH_REGISTER_RATE_PER_HOUR || "5",
  10,
);
const FORGOT_PER_HOUR = parseInt(
  process.env.AUTH_FORGOT_RATE_PER_HOUR || "5",
  10,
);

export const loginRateLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: LOGIN_PER_MIN,
  scope: "login",
});

export const registerRateLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: REGISTER_PER_HOUR,
  scope: "register",
});

export const forgotPasswordRateLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: FORGOT_PER_HOUR,
  scope: "forgot_password",
});
