/**
 * Task #113 — Per-user rate limiters for expensive endpoints.
 *
 * Distinct from `auth-rate-limit.ts` (per-IP, login/register/forgot). These
 * keys are per-user (`req.user.id`) with the IP as the fallback so an
 * anonymous misfire still gets throttled. Limits are intentionally loose
 * — we are protecting the LLM/PDF/crawler budget, not blocking real work.
 *
 *   refresh-prompts      → REFRESH_PROMPTS_RATE_PER_HOUR (default 10/hr)
 *   reports/generate     → REPORTS_GENERATE_RATE_PER_HOUR (default 5/hr)
 *   prompt-runs          → PROMPT_RUNS_RATE_PER_HOUR (default 30/hr)
 *   xray/analyze/batch   → XRAY_BATCH_RATE_PER_HOUR (default 10/hr)
 *
 * Mirrors auth-rate-limit's bypass rules: skipped on `NODE_ENV=test` or
 * explicit `RATE_LIMIT_BYPASS=true`. 429 body uses the new error contract
 * (`code: "rate_limited"`, `details.retryAfterSeconds`) — wired through
 * the global error middleware via `next(new ApiError(...))`.
 */

import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ApiError } from "../utils/api-error";

function isTestBypass(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_BYPASS === "true"
  );
}

// Use express-rate-limit's `ipKeyGenerator` helper for the IP fallback so
// IPv6 addresses are normalized to their /64 prefix (the library refuses
// to start otherwise: ERR_ERL_KEY_GEN_IPV6).
function keyByUser(req: Request, res: Response): string {
  const u = (req as Request & { user?: { id?: string } }).user;
  if (u && typeof u.id === "string") return `user:${u.id}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

function makeLimiter(opts: {
  windowMs: number;
  limit: number;
  scope: string;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => isTestBypass(),
    keyGenerator: keyByUser,
    handler: (
      _req: Request,
      _res: Response,
      next: NextFunction,
      options: Options,
    ) => {
      const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
      next(
        new ApiError({
          code: "rate_limited",
          message: `Too many ${opts.scope} requests — try again in ${retryAfterSeconds}s.`,
          status: 429,
          details: { scope: opts.scope, retryAfterSeconds },
        }),
      );
    },
  });
}

const HOUR = 60 * 60 * 1000;

const REFRESH_PROMPTS_PER_HOUR = parseInt(
  process.env.REFRESH_PROMPTS_RATE_PER_HOUR || "10",
  10,
);
const REPORTS_GENERATE_PER_HOUR = parseInt(
  process.env.REPORTS_GENERATE_RATE_PER_HOUR || "5",
  10,
);
const PROMPT_RUNS_PER_HOUR = parseInt(
  process.env.PROMPT_RUNS_RATE_PER_HOUR || "30",
  10,
);
const XRAY_BATCH_PER_HOUR = parseInt(
  process.env.XRAY_BATCH_RATE_PER_HOUR || "10",
  10,
);

export const refreshPromptsLimiter = makeLimiter({
  windowMs: HOUR,
  limit: REFRESH_PROMPTS_PER_HOUR,
  scope: "refresh-prompts",
});

export const reportsGenerateLimiter = makeLimiter({
  windowMs: HOUR,
  limit: REPORTS_GENERATE_PER_HOUR,
  scope: "reports-generate",
});

export const promptRunsLimiter = makeLimiter({
  windowMs: HOUR,
  limit: PROMPT_RUNS_PER_HOUR,
  scope: "prompt-runs",
});

export const xrayBatchLimiter = makeLimiter({
  windowMs: HOUR,
  limit: XRAY_BATCH_PER_HOUR,
  scope: "xray-batch",
});
