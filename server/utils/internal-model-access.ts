import type { Request } from "express";

/**
 * Internal model access is tenant-scoped. `currentClientRole` is resolved from
 * the current database membership for the selected client by the global
 * tenant guard and by per-route `requireRole` middleware. Session-wide admin
 * hints must never grant access because a user may administer a different org
 * or may have been demoted since login.
 */
export function canAccessInternalModels(req: Request): boolean {
  return (req as Request & { currentClientRole?: string }).currentClientRole === "admin";
}