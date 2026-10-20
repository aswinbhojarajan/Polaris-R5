import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { ErrorState } from "@/components/feedback/ErrorState";
import {
  Copy,
  ShieldCheck,
  Search,
  MoreHorizontal,
  UserPlus,
  Mail,
  KeyRound,
  Ban,
  LogOut,
  UserMinus,
  Users as UsersIcon,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AdminForbidden,
  AdminPageShell,
  PageHeader,
  StatRow,
  StatusBadge,
  TableState,
  roleBadgeClass,
  type StatusTone,
} from "./_shared";

type Role = "admin" | "member" | "viewer";

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  status: "active" | "disabled" | "invited";
  mustChangeOnNextLogin: boolean;
  lockedUntil: string | null;
  role: Role;
  membershipId: string;
  joinedAt: string;
}

interface PendingReset {
  id: string;
  email: string;
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  issuedByUserId: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// Single-use credential surfaced after issuing a reset link or temp
// password. Shown via a one-shot modal so the admin can copy it before
// it disappears — we do not store the raw value.
interface RevealedCredential {
  kind: "reset_link" | "temp_password";
  email: string;
  value: string;
  expiresAt?: string;
}

export default function AdminUsersPage() {
  const { orgId, canAdmin } = useRole();
  const { user } = useAuth();
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  // Optional projects to grant on invite acceptance; empty = no access.
  const [inviteClientIds, setInviteClientIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [accessMember, setAccessMember] = useState<Member | null>(null);
  const [activeTab, setActiveTab] = useState<"members" | "invites" | "matrix">("members");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<Role | "">("");
  const [inviteOpen, setInviteOpen] = useState(false);

  // Org-scoped explicitly: the default fetcher would call `/api/v1/clients`
  // without a query string and the backend would fall back to "default-org",
  // so non-default tenants would see an empty pre-grant list. Mirroring the
  // admin-projects.tsx pattern keeps the picker correct in every org.
  const inviteProjectsQuery = useQuery<Array<{ id: string; projectName: string; name: string }>>({
    queryKey: ["/api/v1/clients", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/v1/clients?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    enabled: !!orgId && canAdmin,
  });

  const membersQuery = useQuery<{ members: Member[] }>({
    queryKey: ["/api/v1/admin/orgs", orgId, "members"],
    enabled: !!orgId && canAdmin,
  });
  const invitesQuery = useQuery<{ invitations: Invitation[] }>({
    queryKey: ["/api/v1/admin/orgs", orgId, "invitations"],
    enabled: !!orgId && canAdmin,
  });
  const pendingResetsQuery = useQuery<{ pendingResets: PendingReset[] }>({
    queryKey: ["/api/v1/admin/orgs", orgId, "pending-resets"],
    enabled: !!orgId && canAdmin,
  });

  const updateRole = useMutation({
    mutationFn: async (input: { userId: string; role: Role }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/v1/admin/orgs/${orgId}/members/${input.userId}`,
        { role: input.role },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/orgs", orgId, "members"],
      });
      toast({ title: "Role updated" });
    },
    onError: (err: any) =>
      errorToast("Update failed", err),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/v1/admin/orgs/${orgId}/members/${userId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/orgs", orgId, "members"],
      });
      toast({ title: "Member removed" });
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/invitations`,
        {
          email: inviteEmail,
          role: inviteRole,
          ...(inviteClientIds.length > 0 ? { clientIds: inviteClientIds } : {}),
        },
      );
      return res.json() as Promise<{ token: string; acceptUrl: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/orgs", orgId, "invitations"],
      });
      const email = inviteEmail;
      const grantedCount = inviteClientIds.length;
      setInviteEmail("");
      setInviteClientIds([]);
      toast({
        title: "Invitation issued",
        description:
          grantedCount > 0
            ? `${grantedCount} project${grantedCount === 1 ? "" : "s"} will be granted on accept. Adjust later from the Project access action on their member row.`
            : "After they accept, grant project access from the Project access action on their member row.",
      });
      // Surface the one-shot token through the same reveal modal used by
      // the reset-link / temp-password actions instead of a toast — easier
      // to copy and harder to miss.
      const url = `${window.location.origin}/reset-password/${data.token}`;
      setRevealed({ kind: "reset_link", email, value: url });
    },
    onError: (err: any) =>
      errorToast("Invite failed", err),
  });

  const resetPassword = useMutation({
    mutationFn: async (member: Member) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/users/${member.userId}/reset-password`,
        {},
      );
      return { member, body: (await res.json()) as { token: string; expiresAt: string; acceptUrl: string } };
    },
    onSuccess: ({ member, body }) => {
      const url = `${window.location.origin}${body.acceptUrl}`;
      setRevealed({
        kind: "reset_link",
        email: member.email,
        value: url,
        expiresAt: body.expiresAt,
      });
    },
    onError: (err: unknown) => errorToast("Reset failed", err),
  });

  const tempPassword = useMutation({
    mutationFn: async (member: Member) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/users/${member.userId}/temp-password`,
        {},
      );
      return { member, body: (await res.json()) as { tempPassword: string } };
    },
    onSuccess: ({ member, body }) => {
      setRevealed({ kind: "temp_password", email: member.email, value: body.tempPassword });
    },
    onError: (err: unknown) => errorToast("Temp password failed", err),
  });

  const disableUser = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/users/${userId}/disable`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User disabled — sessions revoked" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/orgs", orgId, "members"] });
    },
    onError: (err: unknown) => errorToast("Disable failed", err),
  });

  const enableUser = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/users/${userId}/enable`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User re-enabled" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/orgs", orgId, "members"] });
    },
    onError: (err: unknown) => errorToast("Enable failed", err),
  });

  const signOutEverywhere = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/admin/orgs/${orgId}/users/${userId}/sign-out-everywhere`,
        {},
      );
      return res.json();
    },
    onSuccess: () => toast({ title: "All sessions for that user have been signed out" }),
    onError: (err: unknown) => errorToast("Sign-out failed", err),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/v1/admin/orgs/${orgId}/invitations/${id}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/orgs", orgId, "invitations"],
      });
      toast({ title: "Invitation revoked" });
    },
  });

  if (!canAdmin) {
    return <AdminForbidden what="manage users" />;
  }

  const allMembers = membersQuery.data?.members ?? [];
  const filteredMembers = allMembers.filter((m) => {
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${m.email} ${m.displayName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const initials = (m: Member) => {
    const src = m.displayName || m.email;
    return src
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";
  };
  const pendingInviteCount =
    invitesQuery.data?.invitations.filter(
      (i) =>
        !i.acceptedAt &&
        !i.revokedAt &&
        new Date(i.expiresAt).getTime() > Date.now(),
    ).length ?? 0;
  const pendingResetCount = pendingResetsQuery.data?.pendingResets.length ?? 0;
  const stats = {
    total: allMembers.length,
    active: allMembers.filter((m) => m.status === "active").length,
    invites: pendingInviteCount,
    admins: allMembers.filter((m) => m.role === "admin").length,
  };
  const visibleIds = filteredMembers.map((m) => m.userId);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      for (const id of visibleIds) next.delete(id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const id of visibleIds) next.add(id);
      setSelectedIds(next);
    }
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectedMembers = allMembers.filter((m) => selectedIds.has(m.userId));
  const applyBulkRole = () => {
    if (!bulkRole) return;
    // Never attempt to change your own role in a bulk action — the server
    // rejects it, so silently skip the caller's own row.
    selectedMembers
      .filter((m) => m.userId !== user?.id)
      .forEach((m) => updateRole.mutate({ userId: m.userId, role: bulkRole }));
    clearSelection();
    setBulkRole("");
  };
  const applyBulkDisable = () => {
    selectedMembers
      .filter((m) => m.status !== "disabled")
      .forEach((m) => disableUser.mutate(m.userId));
    clearSelection();
  };
  const applyBulkSignOut = () => {
    selectedMembers.forEach((m) => signOutEverywhere.mutate(m.userId));
    clearSelection();
  };
  const memberStatus = (m: Member): { tone: StatusTone; label: string } => {
    if (m.status === "disabled") return { tone: "disabled", label: "Disabled" };
    if (m.status === "invited") return { tone: "invited", label: "Invited" };
    if (m.mustChangeOnNextLogin) return { tone: "warning", label: "Needs password" };
    return { tone: "active", label: "Active" };
  };

  return (
    <AdminPageShell>
      <PageHeader
        title="Users"
        subtitle="Manage team members, roles, and access across your organization."
        actions={
          <Button onClick={() => setInviteOpen(true)} data-testid="button-open-invite">
            <UserPlus className="h-4 w-4 mr-2" />
            Invite User
          </Button>
        }
      />

      <StatRow
        tiles={[
          {
            label: "Total members",
            value: stats.total,
            icon: UsersIcon,
            tone: "blue",
            testid: "stat-total-members",
          },
          {
            label: "Active",
            value: stats.active,
            icon: CheckCircle2,
            tone: "emerald",
            testid: "stat-active",
          },
          {
            label: "Pending invites",
            value: stats.invites,
            icon: Mail,
            tone: "amber",
            testid: "stat-pending-invites",
          },
          {
            label: "Admins",
            value: stats.admins,
            icon: ShieldAlert,
            tone: "purple",
            testid: "stat-admins",
          },
        ]}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">
            Members
            <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1.5">{stats.total}</Badge>
          </TabsTrigger>
          <TabsTrigger value="invites" data-testid="tab-invites">
            Invitations &amp; Resets
            <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1.5">
              {pendingInviteCount + pendingResetCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="matrix" data-testid="tab-matrix">
            Access Matrix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-members"
              />
            </div>
            <div className="flex gap-1 rounded-md border p-1">
              {(["all", "admin", "member", "viewer"] as const).map((r) => (
                <Button
                  key={r}
                  variant={roleFilter === r ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setRoleFilter(r)}
                  className="h-7 px-3 capitalize"
                  data-testid={`filter-role-${r}`}
                >
                  {r === "all" ? "All" : r}
                </Button>
              ))}
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-4 py-2"
              data-testid="bulk-actions-bar"
            >
              <span className="text-sm font-medium" data-testid="text-selected-count">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as Role)}>
                  <SelectTrigger className="w-36 h-8" data-testid="select-bulk-role">
                    <SelectValue placeholder="Change role…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyBulkRole}
                  disabled={!bulkRole}
                  data-testid="button-apply-bulk-role"
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyBulkSignOut}
                  data-testid="button-bulk-signout"
                >
                  <LogOut className="h-3.5 w-3.5 mr-1" />
                  Sign out
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive" data-testid="button-bulk-disable">
                      <Ban className="h-3.5 w-3.5 mr-1" />
                      Disable
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disable {selectedIds.size} member(s)?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Each selected account will be locked out immediately and all of their sessions terminated. You can re-enable them later individually.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={applyBulkDisable} data-testid="confirm-bulk-disable">
                        Disable accounts
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" variant="ghost" onClick={clearSelection} data-testid="button-clear-selection">
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-10 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  loading={membersQuery.isLoading}
                  empty={!membersQuery.isLoading && !membersQuery.isError && filteredMembers.length === 0}
                  error={membersQuery.isError ? membersQuery.error : undefined}
                  onRetry={() => membersQuery.refetch()}
                  loadingText="Loading members…"
                  emptyText={
                    search || roleFilter !== "all"
                      ? "No members match your filters."
                      : "No members yet."
                  }
                  colSpan={5}
                />
                {!membersQuery.isLoading && filteredMembers.length > 0 && (
                  filteredMembers.map((m) => (
                    <TableRow
                      key={m.userId}
                      data-testid={`row-member-${m.userId}`}
                      className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open profile for ${m.email}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("[data-row-stop]")) return;
                        setAccessMember(m);
                      }}
                      onKeyDown={(e) => {
                        if ((e.target as HTMLElement).closest("[data-row-stop]")) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setAccessMember(m);
                        }
                      }}
                    >
                      <TableCell data-row-stop onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(m.userId)}
                          onCheckedChange={() => toggleOne(m.userId)}
                          data-testid={`checkbox-member-${m.userId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                              {initials(m)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-medium truncate" data-testid={`text-member-name-${m.userId}`}>
                              {m.displayName || m.email.split("@")[0]}
                            </div>
                            <div
                              className="text-xs text-muted-foreground truncate font-mono"
                              data-testid={`text-member-email-${m.userId}`}
                            >
                              {m.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`status-member-${m.userId}`}>
                        {(() => {
                          const s = memberStatus(m);
                          return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize ${roleBadgeClass(m.role)}`}
                          data-testid={`badge-role-${m.userId}`}
                        >
                          {m.role}
                        </Badge>
                      </TableCell>
                      <TableCell data-row-stop onClick={(e) => e.stopPropagation()} className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              data-testid={`button-row-menu-${m.userId}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              {m.email}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setTimeout(() => setAccessMember(m), 0);
                              }}
                              data-testid={`menu-manage-${m.userId}`}
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              Manage role &amp; access
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setTimeout(() => resetPassword.mutate(m), 0);
                              }}
                              disabled={resetPassword.isPending}
                              data-testid={`menu-reset-${m.userId}`}
                            >
                              <KeyRound className="h-4 w-4 mr-2" />
                              Send reset link
                            </DropdownMenuItem>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem
                                  onSelect={(e) => e.preventDefault()}
                                  data-testid={`menu-temp-${m.userId}`}
                                >
                                  <KeyRound className="h-4 w-4 mr-2" />
                                  Issue temp password
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Issue a temporary password?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will replace {m.email}'s password with a randomly-generated one and force them to choose a new password at next sign-in. All of their existing sessions will be terminated.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => tempPassword.mutate(m)}
                                    data-testid={`confirm-temp-password-${m.userId}`}
                                  >
                                    Issue temp password
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem
                                  onSelect={(e) => e.preventDefault()}
                                  data-testid={`menu-signout-${m.userId}`}
                                >
                                  <LogOut className="h-4 w-4 mr-2" />
                                  Sign out everywhere
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Sign {m.email} out everywhere?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Every active session for this user (web, API, mobile) will be invalidated on its next request.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => signOutEverywhere.mutate(m.userId)}
                                    data-testid={`confirm-signout-${m.userId}`}
                                  >
                                    Sign out everywhere
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <DropdownMenuSeparator />
                            {m.status === "disabled" ? (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTimeout(() => enableUser.mutate(m.userId), 0);
                                }}
                                data-testid={`menu-enable-${m.userId}`}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Re-enable account
                              </DropdownMenuItem>
                            ) : (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem
                                    onSelect={(e) => e.preventDefault()}
                                    className="text-destructive focus:text-destructive"
                                    data-testid={`menu-disable-${m.userId}`}
                                  >
                                    <Ban className="h-4 w-4 mr-2" />
                                    Disable account
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Disable {m.email}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The account will be locked out of sign-in immediately and all of their active sessions will be terminated. You can re-enable later.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => disableUser.mutate(m.userId)}
                                      data-testid={`confirm-disable-${m.userId}`}
                                    >
                                      Disable account
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setTimeout(() => removeMember.mutate(m.userId), 0);
                              }}
                              className="text-destructive focus:text-destructive"
                              data-testid={`menu-remove-${m.userId}`}
                            >
                              <UserMinus className="h-4 w-4 mr-2" />
                              Remove from org
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="invites" className="space-y-6 pt-4">
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Pending invitations
              <Badge variant="secondary">{pendingInviteCount}</Badge>
            </h2>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState
                    loading={invitesQuery.isLoading}
                    empty={
                      !invitesQuery.isLoading &&
                      !invitesQuery.isError &&
                      (invitesQuery.data?.invitations.length ?? 0) === 0
                    }
                    error={invitesQuery.isError ? invitesQuery.error : undefined}
                    onRetry={() => invitesQuery.refetch()}
                    loadingText="Loading invitations…"
                    emptyText="No invitations yet — use “Invite User” to issue one."
                    colSpan={5}
                  />
                  {!invitesQuery.isLoading && (invitesQuery.data?.invitations.length ?? 0) > 0 && (
                    invitesQuery.data!.invitations.map((inv) => {
                      const status = inv.acceptedAt
                        ? "Accepted"
                        : inv.revokedAt
                          ? "Revoked"
                          : new Date(inv.expiresAt).getTime() < Date.now()
                            ? "Expired"
                            : "Pending";
                      return (
                        <TableRow key={inv.id} data-testid={`row-invitation-${inv.id}`}>
                          <TableCell className="font-mono text-xs">{inv.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${roleBadgeClass(inv.role)}`}>
                              {inv.role}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`status-invitation-${inv.id}`}>
                            <StatusBadge
                              tone={
                                status === "Pending"
                                  ? "invited"
                                  : status === "Accepted"
                                    ? "active"
                                    : "neutral"
                              }
                            >
                              {status}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(inv.expiresAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {status === "Pending" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => revokeInvite.mutate(inv.id)}
                                data-testid={`button-revoke-invitation-${inv.id}`}
                              >
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Self-service password resets
              <Badge variant="secondary">{pendingResetCount}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Tokens issued via the public “Forgot password” page. Re-issue from the member's row menu to mint a fresh single-use link you can deliver out-of-band — that automatically revokes older pending resets.
            </p>
            <div className="rounded-md border">
              {pendingResetsQuery.isError ? (
                <div className="p-6">
                  <ErrorState
                    error={pendingResetsQuery.error}
                    onRetry={() => pendingResetsQuery.refetch()}
                    title="Couldn't load pending resets"
                  />
                </div>
              ) : pendingResetsQuery.isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : pendingResetCount === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-pending-resets">
                  No pending self-service resets.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingResetsQuery.data!.pendingResets.map((pr) => (
                      <TableRow key={pr.id} data-testid={`row-pending-reset-${pr.id}`}>
                        <TableCell
                          className="font-mono text-xs"
                          data-testid={`text-pending-reset-email-${pr.id}`}
                        >
                          {pr.email}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(pr.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(pr.expiresAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="matrix" className="pt-4">
          <AccessMatrixSection orgId={orgId} canAdmin={canAdmin} />
        </TabsContent>
      </Tabs>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite a new user</DialogTitle>
            <DialogDescription>
              Issue a single-use signup link. Optionally pre-grant project access so the invitee lands with the right visibility from day one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer — read-only</SelectItem>
                  <SelectItem value="member">Member — can run workflows</SelectItem>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteRole !== "admin" && inviteProjectsQuery.data && inviteProjectsQuery.data.length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Pre-grant projects (optional)</label>
                <p className="text-xs text-muted-foreground">
                  Selected projects are granted automatically when the invitee accepts. Leave empty to grant access later.
                </p>
                <div className="border rounded-md p-3 grid grid-cols-2 gap-2 max-h-48 overflow-auto">
                  {inviteProjectsQuery.data.map((p) => {
                    const checked = inviteClientIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                        data-testid={`label-invite-project-${p.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setInviteClientIds((prev) =>
                              v
                                ? Array.from(new Set([...prev, p.id]))
                                : prev.filter((x) => x !== p.id),
                            );
                          }}
                          data-testid={`checkbox-invite-project-${p.id}`}
                        />
                        <span className="truncate">{p.projectName || p.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                createInvite.mutate(undefined, {
                  onSuccess: () => setInviteOpen(false),
                });
              }}
              disabled={!inviteEmail || createInvite.isPending}
              data-testid="button-create-invite"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManageMemberDialog
        member={accessMember}
        orgId={orgId}
        onOpenChange={(open) => !open && setAccessMember(null)}
        onRoleChange={(role) =>
          accessMember && updateRole.mutate({ userId: accessMember.userId, role })
        }
        roleSaving={updateRole.isPending}
      />

      <Dialog open={!!revealed} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-revealed-title">
              {revealed?.kind === "reset_link" ? "Reset link" : "Temporary password"}
            </DialogTitle>
            <DialogDescription>
              For <span className="font-mono">{revealed?.email}</span>. This is shown only once — copy it now and deliver it through a secure channel.
              {revealed?.expiresAt && (
                <> The link expires {new Date(revealed.expiresAt).toLocaleString()}.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={revealed?.value ?? ""}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              data-testid="input-revealed-value"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (!revealed) return;
                navigator.clipboard.writeText(revealed.value).then(
                  () => toast({ title: "Copied to clipboard" }),
                  () => errorToast("Copy failed", new Error("Could not copy to clipboard")),
                );
              }}
              data-testid="button-copy-revealed"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealed(null)} data-testid="button-close-revealed">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageShell>
  );
}

interface ProjectAccessRow {
  clientId: string;
  name: string;
  projectName: string;
  isActive: boolean;
  hasAccess: boolean;
  source: "owner" | "member" | "none";
}

function ManageMemberDialog({
  member,
  orgId,
  onOpenChange,
  onRoleChange,
  roleSaving,
}: {
  member: Member | null;
  orgId: string | null;
  onOpenChange: (open: boolean) => void;
  onRoleChange: (role: Role) => void;
  roleSaving: boolean;
}) {
  const open = !!member;
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const { user } = useAuth();
  const isSelf = !!member && !!user && member.userId === user.id;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"role" | "access">("role");

  const accessQuery = useQuery<{ projects: ProjectAccessRow[] }>({
    queryKey: ["/api/v1/admin/orgs", orgId, "users", member?.userId, "project-access"],
    enabled: open && !!orgId && !!member,
  });

  useEffect(() => {
    if (accessQuery.data) {
      setSelected(
        new Set(accessQuery.data.projects.filter((p) => p.hasAccess).map((p) => p.clientId)),
      );
    }
  }, [accessQuery.data]);

  useEffect(() => {
    if (open) setTab("role");
  }, [open, member?.userId]);

  const save = useMutation({
    mutationFn: async () => {
      const memberSourced = (accessQuery.data?.projects ?? []).filter(
        (p) => p.source !== "owner",
      );
      const clientIds = memberSourced
        .filter((p) => selected.has(p.clientId))
        .map((p) => p.clientId);
      const res = await apiRequest(
        "PUT",
        `/api/v1/admin/orgs/${orgId}/users/${member!.userId}/project-access`,
        { clientIds },
      );
      return res.json() as Promise<{ added: number; removed: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Project access updated",
        description: `${data.added} added, ${data.removed} revoked.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/orgs", orgId, "users", member?.userId, "project-access"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/orgs", orgId, "access-matrix"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => errorToast("Update failed", err),
  });

  const projects = accessQuery.data?.projects ?? [];
  const isAdmin = member?.role === "admin";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle data-testid="title-manage-member">
            Manage member — {member?.email}
          </SheetTitle>
          <SheetDescription>
            Change this member's organization role and project access from one place.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "role" | "access")}
          className="flex-1 overflow-y-auto pt-2"
        >
          <TabsList>
            <TabsTrigger value="role" data-testid="tab-org-role">Org role</TabsTrigger>
            <TabsTrigger value="access" data-testid="tab-project-access">Project access</TabsTrigger>
          </TabsList>
          <TabsContent value="role" className="pt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Admins implicitly have access to every project. Members and viewers only see projects they own or are explicitly granted.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Role</span>
              <Select
                value={member?.role}
                onValueChange={(v) => onRoleChange(v as Role)}
                disabled={roleSaving || !member || isSelf}
              >
                <SelectTrigger className="w-40" data-testid="select-dialog-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isSelf && (
              <p className="text-sm text-muted-foreground" data-testid="text-self-role-note">
                You can't change your own role — ask another admin to do it for you.
              </p>
            )}
          </TabsContent>
          <TabsContent value="access" className="pt-3">
            {isAdmin ? (
              <p className="text-sm text-muted-foreground" data-testid="text-admin-access-note">
                Admins have implicit access to every project in the org. Demote to member or viewer to manage explicit grants.
              </p>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto border rounded-md">
                {accessQuery.isError ? (
                  <div className="p-4">
                    <ErrorState
                      error={accessQuery.error}
                      onRetry={() => accessQuery.refetch()}
                      title="Couldn't load project access"
                    />
                  </div>
                ) : accessQuery.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                ) : projects.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No projects in this org.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Active</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projects.map((p) => {
                        const isOwner = p.source === "owner";
                        const checked = isOwner ? true : selected.has(p.clientId);
                        return (
                          <TableRow key={p.clientId} data-testid={`row-access-${p.clientId}`}>
                            <TableCell>
                              <Checkbox
                                checked={checked}
                                disabled={isOwner}
                                onCheckedChange={(v) => {
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (v) next.add(p.clientId);
                                    else next.delete(p.clientId);
                                    return next;
                                  });
                                }}
                                data-testid={`checkbox-access-${p.clientId}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{p.projectName}</div>
                              <div className="text-xs text-muted-foreground">{p.name}</div>
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  p.source === "owner"
                                    ? "text-xs rounded-full bg-primary/15 px-2 py-0.5 text-primary"
                                    : p.source === "member"
                                      ? "text-xs rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
                                      : "text-xs text-muted-foreground"
                                }
                                data-testid={`badge-source-${p.clientId}`}
                              >
                                {p.source}
                              </span>
                            </TableCell>
                            <TableCell>{p.isActive ? "Yes" : "No"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
        <SheetFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {tab === "access" && !isAdmin && (
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || accessQuery.isLoading}
              data-testid="button-save-project-access"
            >
              Save access
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface AccessMatrixData {
  users: Array<{ userId: string; email: string; displayName: string | null; role: Role }>;
  projects: Array<{ clientId: string; name: string; projectName: string; ownerUserId: string | null }>;
  grants: Array<{ userId: string; clientId: string; source: "owner" | "member" }>;
}

/**
 * Filterable users × projects access matrix. Cells show the source
 * ("owner" | "member" | "admin"); admins see everything implicitly.
 */
function AccessMatrixSection({ orgId, canAdmin }: { orgId: string | undefined; canAdmin: boolean }) {
  const [userFilter, setUserFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const matrixQuery = useQuery<AccessMatrixData>({
    queryKey: ["/api/v1/admin/orgs", orgId, "access-matrix"],
    enabled: !!orgId && canAdmin,
  });

  if (matrixQuery.isError) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Access matrix</h2>
        <ErrorState
          error={matrixQuery.error}
          onRetry={() => matrixQuery.refetch()}
          title="Couldn't load access matrix"
        />
      </div>
    );
  }
  if (!matrixQuery.data) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Access matrix</h2>
        <p className="text-sm text-muted-foreground">
          {matrixQuery.isLoading ? "Loading…" : "No data."}
        </p>
      </div>
    );
  }

  const { users, projects, grants } = matrixQuery.data;
  const grantKey = (u: string, c: string) => `${u}::${c}`;
  const grantMap = new Map<string, "owner" | "member">();
  for (const g of grants) {
    const existing = grantMap.get(grantKey(g.userId, g.clientId));
    if (existing !== "owner") grantMap.set(grantKey(g.userId, g.clientId), g.source);
  }

  const visibleUsers = users.filter((u) =>
    userFilter ? u.email.toLowerCase().includes(userFilter.toLowerCase()) : true,
  );
  const visibleProjects = projects.filter((p) =>
    projectFilter
      ? (p.projectName + " " + p.name).toLowerCase().includes(projectFilter.toLowerCase())
      : true,
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Access matrix</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Who can see what, at a glance. Org admins (badge "admin") see every project implicitly. "owner" and "member" cells reflect explicit grants. Use the per-member "Project access" action above to change a row.
      </p>
      <div className="flex gap-2 mb-3 max-w-xl">
        <Input
          placeholder="Filter members by email"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          data-testid="input-matrix-user-filter"
        />
        <Input
          placeholder="Filter projects"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          data-testid="input-matrix-project-filter"
        />
      </div>
      <div className="overflow-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">Member</TableHead>
              <TableHead>Role</TableHead>
              {visibleProjects.map((p) => (
                <TableHead
                  key={p.clientId}
                  className="text-xs whitespace-nowrap"
                  data-testid={`matrix-col-${p.clientId}`}
                >
                  {p.projectName || p.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleUsers.map((u) => (
              <TableRow key={u.userId} data-testid={`matrix-row-${u.userId}`}>
                <TableCell className="sticky left-0 bg-background font-medium">{u.email}</TableCell>
                <TableCell>
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded-md ${
                      u.role === "admin"
                        ? "bg-purple-100 text-purple-800"
                        : u.role === "viewer"
                        ? "bg-gray-100 text-gray-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                    data-testid={`matrix-role-${u.userId}`}
                  >
                    {u.role}
                  </span>
                </TableCell>
                {visibleProjects.map((p) => {
                  const src = u.role === "admin" ? "admin" : grantMap.get(grantKey(u.userId, p.clientId));
                  return (
                    <TableCell
                      key={p.clientId}
                      className="text-center"
                      data-testid={`matrix-cell-${u.userId}-${p.clientId}`}
                    >
                      {src ? (
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] uppercase rounded ${
                            src === "owner"
                              ? "bg-amber-100 text-amber-800"
                              : src === "admin"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {src}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
