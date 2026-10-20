/**
 * RBAC privilege matrix — single source of truth.
 *
 * Every mutating ("write") and side-effectful ("execute") API route in
 * `server/routes/*.ts` must be classified here. The role-enforcement
 * middleware (`requireRole`) reads this table; the integration-test sweep
 * walks it to assert that viewers receive 403 on every entry; the OpenAPI
 * generator surfaces the `minRole` as the `x-required-role` extension.
 *
 * Roles are ordered: viewer < member < admin.
 *
 * Buckets:
 *   - read     — GETs that only return data the caller's org owns.
 *   - write    — CRUD on the caller's org (member+).
 *   - execute  — kicks off an async job, calls an LLM, hits a third-party
 *                crawler, or otherwise spends budget / changes external
 *                state (member+).
 *   - admin    — membership / role / project-owner / rename / soft-delete /
 *                hard-delete / audit surfaces (admin only).
 */

import type { UserRole } from "./auth-types";

export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
};

export type Bucket = "read" | "write" | "execute" | "admin";

export interface PrivilegeEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Express-style route pattern, e.g. /api/v1/prompt-runs/:id/stop */
  path: string;
  bucket: Bucket;
  minRole: UserRole;
  /** Tenancy scope to resolve the user's role against. */
  scope: "client" | "org" | "none";
  notes?: string;
}

export function roleAtLeast(actual: UserRole | undefined, required: UserRole): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Authoritative matrix. Order is read → write → execute → admin within each
 * domain so the table is easy to audit by eye.
 *
 * NOTE: Read endpoints are not enumerated here — `requireAuth` +
 * `requireTenantAccessIfPresent` already cover them (any authenticated user
 * with a membership in the tenant org can read). Only write/execute/admin
 * endpoints need explicit `requireRole` middleware.
 */
export const PRIVILEGES: PrivilegeEntry[] = [
  // ----- clients -----
  { method: "POST",   path: "/api/v1/clients",                              bucket: "write",   minRole: "member", scope: "org" },
  { method: "PUT",    path: "/api/v1/clients/:id",                          bucket: "write",   minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/clients/:id",                          bucket: "admin",   minRole: "admin",  scope: "client", notes: "hard delete" },
  { method: "POST",   path: "/api/v1/clients/:id/copy",                     bucket: "write",   minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/clients/:id/generate-metadata",        bucket: "execute", minRole: "member", scope: "client" },
  { method: "PUT",    path: "/api/v1/clients/:id/models",                   bucket: "write",   minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/clients/:id/refresh-prompts",          bucket: "execute", minRole: "member", scope: "client" },

  // ----- per-project sharing (Task #17): owner OR org-admin enforced
  // inline via requireProjectOwnerOrAdmin, not via requireRole. Listed
  // here for the privilege-matrix audit trail. -----
  { method: "GET",    path: "/api/v1/clients/:id/members",                  bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate" },
  { method: "POST",   path: "/api/v1/clients/:id/members",                  bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate" },
  { method: "DELETE", path: "/api/v1/clients/:id/members/:userId",          bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate" },
  { method: "GET",    path: "/api/v1/clients/:id/invitations",              bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate; backed by credential_grants" },
  { method: "POST",   path: "/api/v1/clients/:id/invitations",              bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate; backed by credential_grants" },
  { method: "DELETE", path: "/api/v1/clients/:id/invitations/:invId",       bucket: "admin",   minRole: "member", scope: "client", notes: "owner-or-admin gate; backed by credential_grants" },

  // ----- onboarding (all execute — call LLMs / external APIs) -----
  { method: "POST",   path: "/api/v1/onboarding/enrich-urls",               bucket: "execute", minRole: "member", scope: "none" },
  { method: "POST",   path: "/api/v1/onboarding/enrich-profile",            bucket: "execute", minRole: "member", scope: "none" },
  { method: "POST",   path: "/api/v1/onboarding/enrich-competitors",        bucket: "execute", minRole: "member", scope: "none" },

  // ----- competitors -----
  { method: "POST",   path: "/api/v1/competitors",                          bucket: "write",   minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/competitors/:id",                      bucket: "write",   minRole: "member", scope: "client" },

  // ----- topics -----
  { method: "POST",   path: "/api/v1/topics",                               bucket: "write",   minRole: "member", scope: "client" },
  { method: "PUT",    path: "/api/v1/topics/:id",                           bucket: "write",   minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/topics/:id",                           bucket: "write",   minRole: "member", scope: "client" },

  // ----- prompts -----
  { method: "POST",   path: "/api/v1/prompts",                              bucket: "write",   minRole: "member", scope: "client" },
  { method: "PUT",    path: "/api/v1/prompts/:id",                          bucket: "write",   minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/prompts/:id",                          bucket: "write",   minRole: "member", scope: "client" },

  // ----- prompt-runs -----
  { method: "POST",   path: "/api/v1/prompt-runs",                          bucket: "execute", minRole: "member", scope: "client" },
  { method: "PATCH",  path: "/api/v1/prompt-runs/:id",                      bucket: "write",   minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/prompt-runs/:id/recalculate-position", bucket: "execute", minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/prompt-runs/:id",                      bucket: "write",   minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/prompt-runs/:id/stop",                 bucket: "execute", minRole: "member", scope: "client" },

  // ----- reports -----
  { method: "POST",   path: "/api/v1/reports/generate",                     bucket: "execute", minRole: "member", scope: "client" },
  { method: "DELETE", path: "/api/v1/reports/:id",                          bucket: "write",   minRole: "member", scope: "client" },

  // ----- xray -----
  { method: "POST",   path: "/api/v1/xray/sites/:siteId/refresh-health",    bucket: "execute", minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/xray/analyze/batch",                   bucket: "execute", minRole: "member", scope: "client" },

  // ----- opportunities -----
  { method: "POST",   path: "/api/v1/opportunities/recommendations",          bucket: "write",   minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/opportunities/recommendations/generate", bucket: "execute", minRole: "member", scope: "client" },
  { method: "POST",   path: "/api/v1/opportunities/content/generate",         bucket: "execute", minRole: "member", scope: "client" },

  // ----- crawler -----
  { method: "POST",   path: "/api/v1/crawler/execute",                      bucket: "execute", minRole: "member", scope: "none" },
  { method: "POST",   path: "/api/v1/crawler/execute/async",                bucket: "execute", minRole: "member", scope: "none" },
  { method: "POST",   path: "/api/v1/crawler/format-for-llm",               bucket: "execute", minRole: "member", scope: "none" },
  { method: "POST",   path: "/api/v1/crawler/crawl-and-format",             bucket: "execute", minRole: "member", scope: "none" },

  // ----- admin module -----
  { method: "GET",    path: "/api/v1/admin/orgs/:orgId/members",              bucket: "admin", minRole: "admin", scope: "org" },
  { method: "POST",   path: "/api/v1/admin/orgs/:orgId/members",              bucket: "admin", minRole: "admin", scope: "org" },
  { method: "PATCH",  path: "/api/v1/admin/orgs/:orgId/members/:userId",      bucket: "admin", minRole: "admin", scope: "org" },
  { method: "DELETE", path: "/api/v1/admin/orgs/:orgId/members/:userId",      bucket: "admin", minRole: "admin", scope: "org" },
  { method: "GET",    path: "/api/v1/admin/orgs/:orgId/invitations",          bucket: "admin", minRole: "admin", scope: "org" },
  { method: "POST",   path: "/api/v1/admin/orgs/:orgId/invitations",          bucket: "admin", minRole: "admin", scope: "org" },
  { method: "DELETE", path: "/api/v1/admin/orgs/:orgId/invitations/:id",      bucket: "admin", minRole: "admin", scope: "org" },
  { method: "GET",    path: "/api/v1/admin/orgs/:orgId/audit",                bucket: "admin", minRole: "admin", scope: "org" },
  { method: "PATCH",  path: "/api/v1/admin/clients/:id",                      bucket: "admin", minRole: "admin", scope: "client" },
  { method: "GET",    path: "/api/admin/queue",                               bucket: "admin", minRole: "admin", scope: "none" },
];

/**
 * Returns the subset of entries that should reject viewers (everything
 * except plain reads). Used by the integration-test sweep.
 */
export function viewerBlockedEntries(): PrivilegeEntry[] {
  return PRIVILEGES.filter((p) => p.minRole !== "viewer");
}

/**
 * Find a matching entry for an incoming request method/path, using simple
 * Express-pattern equivalence (`:param` matches a single non-slash segment).
 */
export function lookupPrivilege(method: string, path: string): PrivilegeEntry | undefined {
  for (const entry of PRIVILEGES) {
    if (entry.method !== method.toUpperCase()) continue;
    if (matchPath(entry.path, path)) return entry;
  }
  return undefined;
}

function matchPath(pattern: string, actual: string): boolean {
  const a = pattern.split("/");
  const b = actual.split("/");
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}
