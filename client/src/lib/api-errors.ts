/**
 * Task #131 — Shared helpers for turning a thrown `ApiError` (or a long-tail
 * plain `Error`) into clear, user-facing copy.
 *
 * The backend error contract (Task #113) gives every non-2xx `/api/v1`
 * response a typed `{ code, message, requestId }`. The most important
 * distinction for users is *permission* failures (403): a generic
 * "Failed to…" toast hides the fact that the action was blocked by their
 * role, which is exactly what made the create-project lockout incident so
 * confusing. These helpers detect that case and produce a friendly,
 * actionable message instead.
 */
import { ApiError } from "./queryClient";

/** Narrow an unknown thrown value to `ApiError` when possible. */
export function getApiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

/**
 * True when the failure is a permission/authorization problem (HTTP 403 or
 * the `forbidden` error code). Falls back to a string match for the rare
 * call site that still throws a plain `Error` with the legacy
 * "<status>: <message>" shape.
 */
export function isPermissionError(error: unknown): boolean {
  const apiErr = getApiError(error);
  if (apiErr) return apiErr.status === 403 || apiErr.code === "forbidden";
  if (error instanceof Error) return /(^|\D)403(\D|$)/.test(error.message);
  return false;
}

// The server's role guard returns a terse "Forbidden: member+ role required"
// which isn't helpful to a non-technical user. When the server message looks
// like that generic guard, prefer our friendly fallback instead.
const GENERIC_FORBIDDEN = /^forbidden\b/i;

export const DEFAULT_PERMISSION_MESSAGE =
  "You don't have permission to do this. Ask an org admin to upgrade your role.";

/** Strip the leading "<status>: " that `ApiError.message` carries. */
export function cleanErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.replace(/^\d{3}:\s*/, "");
  }
  return "Something went wrong. Please try again.";
}

/**
 * A friendly permission message. Prefers a specific server message when it
 * isn't the generic role guard; otherwise uses `fallback` (or the default).
 */
export function permissionMessage(error: unknown, fallback?: string): string {
  const apiErr = getApiError(error);
  const serverMsg = apiErr?.message?.replace(/^\d{3}:\s*/, "") ?? "";
  if (serverMsg && !GENERIC_FORBIDDEN.test(serverMsg)) return serverMsg;
  return fallback ?? DEFAULT_PERMISSION_MESSAGE;
}
