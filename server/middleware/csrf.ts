import type { Request, Response, NextFunction, RequestHandler } from "express";
import { randomBytes } from "crypto";
import { ApiError } from "../utils/api-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set by csrfTokenIssuer so downstream handlers can echo the
      // current token back into responses if they need to.
      csrfToken?: string;
    }
  }
}

/**
 * CSRF double-submit cookie middleware (Task #37).
 *
 * Strategy: a non-`httpOnly` `polaris.csrf` cookie carries a random token
 * that the SPA echoes in the `x-csrf-token` request header on every
 * state-changing call. We never accept a request whose header value does
 * not equal the cookie value. The token is rotated on the first
 * authenticated GET that doesn't already have a cookie.
 *
 * Skip rules:
 *   - GET/HEAD/OPTIONS — never enforced (these are read-only).
 *   - Bypass when `TEST_AUTH_BYPASS=true` and `NODE_ENV=test` (the
 *     integration suite would otherwise 403 every test).
 *   - Path-prefix exemptions for endpoints that have no session cookie
 *     attached — login, register, forgot-password, and the
 *     credential-grant status / redeem endpoints (the raw token IS the
 *     authenticator there).
 */

const CSRF_COOKIE = "polaris.csrf";
const CSRF_HEADER = "x-csrf-token";

// Narrow exemption list. Logout is intentionally NOT exempted (Task #37
// review): the SPA always echoes the cookie in the header, and any
// caller without the header should not be able to terminate someone
// else's session via a forged POST.
//
// SOURCE OF TRUTH: this is the single exemption list used by both the
// global CSRF middleware AND the route-level public-path guard in
// `server/routes/index.ts` (which re-exports `isCsrfExempt` as
// `isCsrfExemptApiV1`). Adding to this list weakens CSRF protection.
const EXEMPT_API_V1_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
]);

const EXEMPT_API_V1_PREFIXES = [
  "/auth/credential-grants/", // status (GET) and redeem (POST) — raw token authenticates
];

/**
 * Returns true if the given /api/v1-relative path is CSRF-exempt.
 * The path argument must be the path WITHOUT the `/api/v1` mount prefix
 * (e.g. `/auth/login`, not `/api/v1/auth/login`).
 */
export function isCsrfExempt(apiV1RelativePath: string): boolean {
  if (EXEMPT_API_V1_PATHS.has(apiV1RelativePath)) return true;
  return EXEMPT_API_V1_PREFIXES.some((p) => apiV1RelativePath.startsWith(p));
}

function isExemptFullPath(fullPath: string): boolean {
  if (!fullPath.startsWith("/api/v1")) return false;
  const relative = fullPath.slice("/api/v1".length) || "/";
  return isCsrfExempt(relative);
}

function isTestBypass(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.TEST_AUTH_BYPASS === "true"
  );
}

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const parts = header.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Issues the `polaris.csrf` cookie on every response that doesn't already
 * have one set on the request. Must be mounted globally (before the API
 * guards) so the SPA receives a token on its first GET.
 */
export function csrfTokenIssuer(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const existing = readCookie(req, CSRF_COOKIE);
    if (!existing) {
      const token = generateToken();
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        // Do not set maxAge — session cookie is fine; rotated on next
        // request after the browser drops it.
      });
      // Also expose the just-issued token on the request so any handler
      // that needs to set it back can read it.
      req.csrfToken = token;
    } else {
      req.csrfToken = existing;
    }
    next();
  };
}

/**
 * Validates `x-csrf-token === polaris.csrf` on state-changing requests.
 * Mount AFTER `csrfTokenIssuer()` and BEFORE the route handlers.
 */
export function csrfProtect(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isTestBypass()) return next();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }
    if (isExemptFullPath(req.path)) return next();

    const cookie = readCookie(req, CSRF_COOKIE);
    const header = req.headers[CSRF_HEADER];
    const headerVal = Array.isArray(header) ? header[0] : header;
    if (!cookie || !headerVal || cookie !== headerVal) {
      // Task #113 — route through global error middleware so the
      // unified `{ error: { code, message, requestId } }` envelope is
      // emitted instead of a legacy ad-hoc body.
      return next(
        new ApiError({
          status: 403,
          code: "csrf_failed",
          message: "CSRF token missing or invalid",
        }),
      );
    }
    next();
  };
}
