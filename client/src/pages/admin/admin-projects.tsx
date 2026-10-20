import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { ProjectSharingDialog } from "@/components/project-sharing-dialog";
import {
  AdminForbidden,
  AdminPageShell,
  PageHeader,
  StatRow,
  StatusBadge,
  TableState,
} from "./_shared";
import {
  FolderKanban,
  CheckCircle2,
  PauseCircle,
  Users,
  Search,
  ArrowUpDown,
  MoreHorizontal,
  Pencil,
  UserCog,
  Power,
  Download,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  projectName: string;
  ownerUserId: string | null;
  isActive: boolean;
}

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
}

type StatusFilter = "all" | "active" | "disabled";
type SortKey = "name" | "owner" | "status";

export default function AdminProjectsPage() {
  const errorToast = useErrorToast();
  const { orgId, canAdmin } = useRole();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<Partial<Project>>({});

  const projectsQuery = useQuery<Project[]>({
    queryKey: ["/api/v1/clients"],
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

  const update = useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Project> }) => {
      const res = await apiRequest("PATCH", `/api/v1/admin/clients/${input.id}`, input.patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/clients"] });
      toast({ title: "Project updated" });
    },
    onError: (err: any) =>
      errorToast("Update failed", err),
  });

  const members = membersQuery.data?.members ?? [];
  const memberByUserId = useMemo(() => {
    const m = new Map<string, Member>();
    for (const u of members) m.set(u.userId, u);
    return m;
  }, [members]);

  const allProjects = projectsQuery.data ?? [];

  const stats = useMemo(() => {
    const total = allProjects.length;
    const active = allProjects.filter((p) => p.isActive).length;
    const disabled = total - active;
    const owners = new Set(
      allProjects.map((p) => p.ownerUserId).filter((v): v is string => !!v),
    ).size;
    return { total, active, disabled, owners };
  }, [allProjects]);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = allProjects.filter((p) => {
      if (statusFilter === "active" && !p.isActive) return false;
      if (statusFilter === "disabled" && p.isActive) return false;
      if (ownerFilter === "unassigned" && p.ownerUserId) return false;
      if (ownerFilter !== "all" && ownerFilter !== "unassigned" && p.ownerUserId !== ownerFilter)
        return false;
      if (q) {
        const ownerEmail = p.ownerUserId ? memberByUserId.get(p.ownerUserId)?.email ?? "" : "";
        const hay = `${p.projectName} ${p.name} ${ownerEmail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let av = "";
      let bv = "";
      if (sortKey === "name") {
        av = a.projectName ?? "";
        bv = b.projectName ?? "";
      } else if (sortKey === "owner") {
        av = (a.ownerUserId ? memberByUserId.get(a.ownerUserId)?.email : "") ?? "";
        bv = (b.ownerUserId ? memberByUserId.get(b.ownerUserId)?.email : "") ?? "";
      } else {
        av = a.isActive ? "1" : "0";
        bv = b.isActive ? "1" : "0";
      }
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [allProjects, search, statusFilter, ownerFilter, sortKey, sortDir, memberByUserId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openSheet(p: Project) {
    setOpenProject(p);
    setDraft({
      name: p.name,
      projectName: p.projectName,
      ownerUserId: p.ownerUserId,
      isActive: p.isActive,
    });
  }

  function saveDraft() {
    if (!openProject) return;
    update.mutate(
      { id: openProject.id, patch: draft },
      { onSuccess: () => setOpenProject(null) },
    );
  }

  const [bulkPending, setBulkPending] = useState(false);

  async function bulkSetActive(active: boolean) {
    if (bulkPending) return;
    const ids = Array.from(selected);
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          apiRequest("PATCH", `/api/v1/admin/clients/${id}`, { isActive: active }),
        ),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;
      queryClient.invalidateQueries({ queryKey: ["/api/v1/clients"] });
      if (failed === 0) {
        toast({
          title: active
            ? `Activated ${succeeded} projects`
            : `Disabled ${succeeded} projects`,
        });
        setSelected(new Set());
      } else if (succeeded === 0) {
        errorToast(
          "Bulk update failed",
          new Error(`${failed} project${failed === 1 ? "" : "s"} could not be updated.`),
        );
      } else {
        errorToast(
          "Partial update",
          new Error(`${succeeded} updated, ${failed} failed.`),
        );
      }
    } finally {
      setBulkPending(false);
    }
  }

  function exportCsv() {
    const header = ["id", "projectName", "displayName", "ownerEmail", "isActive"];
    const lines = [header.join(",")];
    for (const p of visibleProjects) {
      const ownerEmail = p.ownerUserId ? memberByUserId.get(p.ownerUserId)?.email ?? "" : "";
      const row = [p.id, p.projectName, p.name, ownerEmail, p.isActive ? "true" : "false"]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
      lines.push(row);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!canAdmin) {
    return <AdminForbidden what="manage projects" />;
  }

  const visibleIds = visibleProjects.map((p) => p.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <AdminPageShell>
      <PageHeader
        title="Projects"
        subtitle="Manage project ownership, status, and membership across your organization."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            data-testid="button-export-projects"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      <StatRow
        tiles={[
          {
            label: "Total projects",
            value: stats.total,
            icon: FolderKanban,
            tone: "blue",
            testid: "stat-total-projects",
          },
          {
            label: "Active",
            value: stats.active,
            icon: CheckCircle2,
            tone: "emerald",
            testid: "stat-active-projects",
          },
          {
            label: "Disabled",
            value: stats.disabled,
            icon: PauseCircle,
            tone: "rose",
            testid: "stat-disabled-projects",
          },
          {
            label: "Owners",
            value: stats.owners,
            icon: Users,
            tone: "purple",
            hint: stats.total - stats.owners > 0 ? `${stats.total - stats.owners} unassigned` : undefined,
            testid: "stat-project-owners",
          },
        ]}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects, owners…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-projects"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-36" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-48" data-testid="select-filter-owner">
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={`${sortKey}:${sortDir}`}
            onValueChange={(v) => {
              const [k, d] = v.split(":") as [SortKey, "asc" | "desc"];
              setSortKey(k);
              setSortDir(d);
            }}
          >
            <SelectTrigger className="w-44" data-testid="select-sort">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name:asc">Name (A–Z)</SelectItem>
              <SelectItem value="name:desc">Name (Z–A)</SelectItem>
              <SelectItem value="owner:asc">Owner (A–Z)</SelectItem>
              <SelectItem value="owner:desc">Owner (Z–A)</SelectItem>
              <SelectItem value="status:desc">Status (Active first)</SelectItem>
              <SelectItem value="status:asc">Status (Disabled first)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.size > 0 && (
        <div
          className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-2"
          data-testid="bar-bulk-actions"
        >
          <span className="text-sm">
            <span className="font-medium" data-testid="text-selected-count">
              {selected.size}
            </span>{" "}
            selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkSetActive(true)}
              disabled={bulkPending}
              data-testid="button-bulk-activate"
            >
              Activate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkSetActive(false)}
              disabled={bulkPending}
              data-testid="button-bulk-disable"
            >
              Disable
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              data-testid="button-bulk-clear"
            >
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
                  checked={allVisibleSelected}
                  onCheckedChange={(c) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (c) visibleIds.forEach((id) => next.add(id));
                      else visibleIds.forEach((id) => next.delete(id));
                      return next;
                    });
                  }}
                  data-testid="checkbox-select-all"
                />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("name")}
                data-testid="header-sort-name"
              >
                Project
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("owner")}
                data-testid="header-sort-owner"
              >
                Owner
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("status")}
                data-testid="header-sort-status"
              >
                Status
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              loading={projectsQuery.isLoading}
              empty={!projectsQuery.isLoading && !projectsQuery.isError && visibleProjects.length === 0}
              error={projectsQuery.isError ? projectsQuery.error : undefined}
              onRetry={() => projectsQuery.refetch()}
              loadingText="Loading projects…"
              emptyText={
                allProjects.length === 0
                  ? "No projects yet."
                  : "No projects match your filters."
              }
              colSpan={5}
            />
            {visibleProjects.map((p) => {
              const owner = p.ownerUserId ? memberByUserId.get(p.ownerUserId) : undefined;
              const isSelected = selected.has(p.id);
              return (
                <TableRow
                  key={p.id}
                  data-testid={`row-project-${p.id}`}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-row-stop]")) return;
                    openSheet(p);
                  }}
                  onKeyDown={(e) => {
                    if ((e.target as HTMLElement).closest("[data-row-stop]")) return;
                    if (e.currentTarget !== e.target) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openSheet(p);
                    }
                  }}
                  tabIndex={0}
                >
                  <TableCell data-row-stop="true" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(c) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        });
                      }}
                      data-testid={`checkbox-row-${p.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium" data-testid={`text-project-name-${p.id}`}>
                      {p.projectName || p.name || "Untitled"}
                    </div>
                    {p.name && p.name !== p.projectName && (
                      <div className="text-xs text-muted-foreground">{p.name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {owner ? (
                      <span className="text-sm" data-testid={`text-owner-${p.id}`}>
                        {owner.displayName || owner.email}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <StatusBadge tone="active" testid={`badge-status-${p.id}`}>
                        Active
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="disabled" testid={`badge-status-${p.id}`}>
                        Disabled
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell data-row-stop="true" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          data-testid={`button-row-menu-${p.id}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(() => openSheet(p), 0);
                          }}
                          data-testid={`menu-edit-${p.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit project
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(() => setSharingProject(p), 0);
                          }}
                          data-testid={`menu-manage-members-${p.id}`}
                        >
                          <UserCog className="h-4 w-4" />
                          Manage members
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setTimeout(
                              () =>
                                update.mutate({
                                  id: p.id,
                                  patch: { isActive: !p.isActive },
                                }),
                              0,
                            );
                          }}
                          data-testid={`menu-toggle-active-${p.id}`}
                        >
                          <Power className="h-4 w-4" />
                          {p.isActive ? "Disable project" : "Activate project"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={!!openProject}
        onOpenChange={(next) => {
          if (!next) setOpenProject(null);
        }}
      >
        <SheetContent className="sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle>Project properties</SheetTitle>
            <SheetDescription>
              Update name, ownership, and status. Changes apply immediately on save.
            </SheetDescription>
          </SheetHeader>
          {openProject && (
            <div className="flex-1 overflow-y-auto space-y-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="sheet-project-name">Project name</Label>
                <Input
                  id="sheet-project-name"
                  value={draft.projectName ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, projectName: e.target.value }))}
                  data-testid="input-sheet-project-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sheet-display-name">Display name</Label>
                <Input
                  id="sheet-display-name"
                  value={draft.name ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  data-testid="input-sheet-display-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Owner</Label>
                <Select
                  value={draft.ownerUserId ?? "none"}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, ownerUserId: v === "none" ? null : v }))
                  }
                >
                  <SelectTrigger data-testid="select-sheet-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Unassigned —</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">
                    Inactive projects are hidden from non-admin members.
                  </div>
                </div>
                <Switch
                  checked={draft.isActive ?? false}
                  onCheckedChange={(c) => setDraft((d) => ({ ...d, isActive: c }))}
                  data-testid="switch-sheet-active"
                />
              </div>
              <div className="rounded-md border p-3 space-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Project ID:</span>{" "}
                  <code className="font-mono">{openProject.id}</code>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSharingProject(openProject);
                }}
                data-testid="button-sheet-manage-members"
              >
                <UserCog className="h-4 w-4 mr-2" />
                Manage members
              </Button>
            </div>
          )}
          <SheetFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setOpenProject(null)}
              data-testid="button-sheet-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={saveDraft}
              disabled={update.isPending}
              data-testid="button-sheet-save"
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {sharingProject && (
        <ProjectSharingDialog
          clientId={sharingProject.id}
          projectName={sharingProject.projectName}
          open={!!sharingProject}
          onOpenChange={(next) => {
            if (!next) setSharingProject(null);
          }}
        />
      )}
    </AdminPageShell>
  );
}
