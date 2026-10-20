import type { Request, Response } from "express";
import { ApiError } from "../utils/api-error";

/**
 * Standardized tenancy extraction.
 *
 * Reads `clientId` (recommended) from, in priority order:
 *   1. `x-client-id` request header (set by middleware into `req.clientId`)
 *   2. `?clientId=` query string  (recommended)
 *   3. `?client_id=` query string (legacy snake_case, kept for backwards compat)
 *
 * Returns `undefined` if none provided.
 */
export function getClientId(req: Request): string | undefined {
  const headerVal = (req as any).clientId as string | undefined;
  if (headerVal) return headerVal;
  const camel = req.query.clientId;
  if (typeof camel === "string" && camel.length > 0) return camel;
  const snake = req.query.client_id;
  if (typeof snake === "string" && snake.length > 0) return snake;
  return undefined;
}

/**
 * Same as {@link getClientId} but writes a 400 response and returns null when
 * the tenancy parameter is missing.
 */
export function requireClientId(req: Request, _res?: Response): string {
  // Task #113 — throws ApiError so the global error middleware emits the
  // unified `{ error: { code, message, requestId } }` envelope. The legacy
  // signature kept `res` so callers could write `if (!id) return;` — we
  // still accept (and ignore) `res` so the existing call sites compile
  // unchanged, but the function now never returns null.
  const clientId = getClientId(req);
  if (!clientId) {
    throw new ApiError({
      status: 400,
      code: "bad_request",
      message:
        "clientId is required (provide via x-client-id header, ?clientId= query param, or legacy ?client_id= query param)",
    });
  }
  return clientId;
}

/**
 * Standardized organization-id extraction.
 *
 * Accepts `?orgId=` (recommended) and `?org_id=` (legacy snake_case).
 */
export function getOrgId(req: Request): string | undefined {
  const camel = req.query.orgId;
  if (typeof camel === "string" && camel.length > 0) return camel;
  const snake = req.query.org_id;
  if (typeof snake === "string" && snake.length > 0) return snake;
  return undefined;
}
