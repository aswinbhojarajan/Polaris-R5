/**
 * Task #113 — Translate Postgres / Drizzle driver errors into ApiError
 * instances so the global error middleware can return a clean 4xx instead
 * of a generic 500. Mapped codes:
 *
 *   23505  unique_violation              → 409 conflict
 *   23503  foreign_key_violation         → 422 validation_failed
 *   23502  not_null_violation            → 422 validation_failed
 *   23514  check_violation               → 422 validation_failed
 *   40P01  deadlock_detected             → 503 database_error
 *   40001  serialization_failure         → 503 database_error
 *   53300  too_many_connections          → 503 database_error
 *   57014  query_canceled (e.g. timeout) → 504 timeout
 *
 * Anything else returns `null` and falls through to the catch-all 500.
 */

import { ApiError } from "./api-error";

interface PgLikeError {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
  message?: string;
}

function asPgError(err: unknown): PgLikeError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as PgLikeError & { cause?: unknown };
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  // Drizzle wraps the underlying driver error on `.cause` in some paths.
  if (e.cause) return asPgError(e.cause);
  return null;
}

export function translatePgError(err: unknown): ApiError | null {
  const pg = asPgError(err);
  if (!pg) return null;
  const code = pg.code!;
  const details: Record<string, unknown> = { pgCode: code };
  if (pg.constraint) details.constraint = pg.constraint;
  if (pg.table) details.table = pg.table;
  if (pg.column) details.column = pg.column;

  switch (code) {
    case "23505":
      return new ApiError({
        code: "conflict",
        message: "A record with these values already exists.",
        details,
        cause: err,
      });
    case "23503":
      return new ApiError({
        code: "validation_failed",
        message: "Referenced record does not exist.",
        details,
        cause: err,
      });
    case "23502":
      return new ApiError({
        code: "validation_failed",
        message: pg.column
          ? `Required field "${pg.column}" is missing.`
          : "A required field is missing.",
        details,
        cause: err,
      });
    case "23514":
      return new ApiError({
        code: "validation_failed",
        message: "Value violates a database constraint.",
        details,
        cause: err,
      });
    case "40P01":
    case "40001":
    case "53300":
      return new ApiError({
        code: "database_error",
        message: "The database is temporarily busy — please retry.",
        details,
        cause: err,
      });
    case "57014":
      return new ApiError({
        code: "timeout",
        message: "The database query timed out.",
        details,
        cause: err,
      });
    default:
      return null;
  }
}
