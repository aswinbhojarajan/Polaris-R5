/**
 * Task #113 — Global error middleware.
 *
 * Single source of truth for the `/api/v1` error wire format. Replaces the
 * previous handler that did `res.status(...).json({message}); throw err;`
 * (the re-throw triggered Express's default "headersSent" branch which
 * sometimes printed a stack and ALWAYS bypassed downstream logging, on
 * top of leaving the connection state ambiguous for the client).
 *
 * Behavior:
 *   - Skip if a response was already sent (defensive — handler should be
 *     mounted LAST).
 *   - ApiError → serialize as-is.
 *   - Postgres driver errors → translate via `translatePgError`.
 *   - ZodError → 422 with `details.fieldErrors`.
 *   - Everything else → 500 with a generic message in prod, the real
 *     message + stack in dev.
 *   - Always emits a single `[error]` log line correlated with `req.id`.
 *   - NEVER re-throws.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError, type ApiErrorBody } from "../utils/api-error";
import { translatePgError } from "../utils/db-errors";
import { getRequestId } from "./request-id";

const isProd = process.env.NODE_ENV === "production";

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ApiError({
      code: "validation_failed",
      message: "Request body failed validation.",
      details: { fieldErrors: err.flatten().fieldErrors },
      cause: err,
    });
  }

  const pg = translatePgError(err);
  if (pg) return pg;

  // Some legacy code throws `{ status, message }`-shaped objects; honor
  // them when present so the contract is consistent.
  if (err && typeof err === "object") {
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return new ApiError({
        code: status >= 500 ? "internal_error" : "bad_request",
        message: e.message || "Request failed",
        status,
        exposeMessage: status < 500,
        cause: err,
      });
    }
  }

  return new ApiError({
    code: "internal_error",
    message: err instanceof Error ? err.message : "Internal Server Error",
    status: 500,
    exposeMessage: false,
    cause: err,
  });
}

export function errorHandler(): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      // Express's contract: once headers are flushed we can't re-respond.
      // Hand off to the default finalizer to close the socket; do NOT
      // re-throw (that's exactly the foot-gun we're fixing).
      return next(err);
    }

    const apiErr = toApiError(err);
    const requestId = getRequestId(req);

    // Log everything 4xx as info-ish, 5xx as error, with the request id
    // and the original cause so on-call can grep one line.
    const cause = (apiErr as { cause?: unknown }).cause;
    const stack =
      cause instanceof Error
        ? cause.stack
        : apiErr.stack;
    const logLine =
      `[error] req=${requestId} status=${apiErr.status} code=${apiErr.code} ` +
      `method=${req.method} path=${req.originalUrl || req.url} msg=${JSON.stringify(apiErr.message)}`;
    if (apiErr.status >= 500) {
      // eslint-disable-next-line no-console
      console.error(logLine);
      if (stack) {
        // eslint-disable-next-line no-console
        console.error(stack);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(logLine);
    }

    // Task #113 contract: in development, the stack is exposed under
    // `details.stack` (NOT as a top-level sibling) so the wire shape
    // stays stable — `details` is the documented escape hatch for
    // anything beyond {code,message,requestId}. Stripped in production.
    const details =
      !isProd && stack
        ? {
            ...(apiErr.details && typeof apiErr.details === "object"
              ? (apiErr.details as Record<string, unknown>)
              : apiErr.details !== undefined
                ? { value: apiErr.details }
                : {}),
            stack,
          }
        : apiErr.details;

    const body: ApiErrorBody = {
      error: {
        code: apiErr.code,
        message:
          apiErr.exposeMessage || !isProd
            ? apiErr.message
            : "Internal Server Error",
        requestId,
        ...(details !== undefined ? { details } : {}),
      },
    };

    res.status(apiErr.status).json(body);
  };
}
