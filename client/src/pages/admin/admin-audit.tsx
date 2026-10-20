import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/hooks/use-role";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollText, Activity, Clock, Search } from "lucide-react";
import {
  AdminForbidden,
  AdminPageShell,
  PageHeader,
  StatRow,
  TableState,
} from "./_shared";

interface AuditEntry {
  id: string;
  orgId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "member.add": "default",
  "member.role_change": "secondary",
  "member.remove": "destructive",
  "invitation.create": "default",
  "invitation.accept": "secondary",
  "invitation.revoke": "destructive",
  "project.update": "secondary",
  "project.share.grant": "default",
  "project.share.revoke": "destructive",
  "project.invitation.create": "default",
  "project.invitation.accept": "secondary",
  "project.invitation.revoke": "destructive",
  "credential_grant.invitation.create": "default",
  "credential_grant.invitation.accept": "secondary",
  "credential_grant.invitation.revoke": "destructive",
  "credential_grant.project_invitation.create": "default",
  "credential_grant.project_invitation.accept": "secondary",
  "credential_grant.project_invitation.revoke": "destructive",
};

export default function AdminAuditPage() {
  const { orgId, canAdmin } = useRole();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const auditQuery = useQuery<{ entries: AuditEntry[] }>({
    queryKey: ["/api/v1/admin/orgs", orgId, "audit"],
    enabled: !!orgId && canAdmin,
  });

  const entries = auditQuery.data?.entries ?? [];

  const actions = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.action));
    return Array.from(set).sort();
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      const hay = `${e.action} ${e.actorUserId ?? ""} ${e.targetType ?? ""} ${e.targetId ?? ""} ${
        e.metadata ? JSON.stringify(e.metadata) : ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, actionFilter, search]);

  const last24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return entries.filter((e) => new Date(e.createdAt).getTime() >= cutoff).length;
  }, [entries]);

  const lastActivity = entries[0]?.createdAt
    ? new Date(entries[0].createdAt).toLocaleString()
    : "—";

  if (!canAdmin) {
    return <AdminForbidden what="view the audit log" />;
  }

  return (
    <AdminPageShell>
      <PageHeader
        title="Audit Log"
        subtitle="Recent administrative activity across your organization."
      />

      <StatRow
        tiles={[
          {
            label: "Total entries",
            value: entries.length,
            icon: ScrollText,
            tone: "blue",
            testid: "stat-audit-total",
          },
          {
            label: "Last 24 hours",
            value: last24h,
            icon: Activity,
            tone: "emerald",
            testid: "stat-audit-24h",
          },
          {
            label: "Distinct actions",
            value: actions.length,
            icon: ScrollText,
            tone: "purple",
            testid: "stat-audit-actions",
          },
          {
            label: "Last activity",
            value: <span className="text-base font-semibold">{lastActivity}</span>,
            icon: Clock,
            tone: "amber",
            testid: "stat-audit-last",
          },
        ]}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search action, actor, target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-audit"
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-64" data-testid="select-filter-action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-56">Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              loading={auditQuery.isLoading}
              empty={!auditQuery.isLoading && visible.length === 0}
              loadingText="Loading audit entries…"
              emptyText={
                entries.length === 0
                  ? "No audit entries yet."
                  : "No entries match your filters."
              }
              colSpan={5}
            />
            {visible.map((e) => (
              <TableRow key={e.id} data-testid={`row-audit-${e.id}`}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={ACTION_TONE[e.action] ?? "outline"} data-testid={`badge-action-${e.id}`}>
                    {e.action}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.actorUserId ? e.actorUserId.slice(0, 8) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {e.targetType ? `${e.targetType}:${(e.targetId ?? "").slice(0, 8)}` : "—"}
                </TableCell>
                <TableCell className="text-xs max-w-md">
                  <code className="text-xs break-all">
                    {e.metadata && Object.keys(e.metadata).length > 0
                      ? JSON.stringify(e.metadata)
                      : "—"}
                  </code>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminPageShell>
  );
}
