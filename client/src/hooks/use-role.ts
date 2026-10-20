import { useAuth } from "@/lib/auth";
import type { UserRole } from "@/lib/auth";

export type { UserRole };

const RANK: Record<UserRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
};

export function roleAtLeast(role: UserRole | undefined, min: UserRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/**
 * Returns the caller's role in a given org (defaults to the first org the
 * user belongs to). Used to gate write/admin UI and to disable execute
 * actions for viewers.
 */
export function useRole(orgId?: string) {
  const { session } = useAuth();
  const memberships = session?.memberships;
  const targetOrgId = orgId || memberships?.[0]?.orgId;
  const role = memberships?.find((m) => m.orgId === targetOrgId)?.role;

  return {
    role,
    orgId: targetOrgId,
    isViewer: role === "viewer",
    canWrite: roleAtLeast(role, "member"),
    canAdmin: roleAtLeast(role, "admin"),
    atLeast: (min: UserRole) => roleAtLeast(role, min),
  };
}
