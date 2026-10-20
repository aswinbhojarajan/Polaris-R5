/**
 * Task #115 — Operational health dashboard.
 *
 * Single-page summary of system health for admins:
 *   - Job queue snapshot (active / queued / stale)
 *   - Recent failed jobs (counts, last failure timestamp)
 *   - Per-provider rolling-24h error rate + pause state
 *   - Process health (memory, uptime, unhandled rejections from /health)
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useRole } from "@/hooks/use-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Hourglass,
  Server,
  ShieldAlert,
  Timer,
} from "lucide-react";
import {
  AdminForbidden,
  AdminPageShell,
  PageHeader,
  StatRow,
} from "./_shared";
import type { Job } from "@shared/schema";

const REFRESH_MS = 5000;

interface QueueSnapshot {
  active: number;
  queued: number;
  stale: number;
  shuttingDown: boolean;
  maxConcurrentJobs: number;
}

interface HealthPayload {
  status?: "ok" | "degraded" | "down";
  db?: "ok" | "degraded" | "down";
  queue?: { active: number; queued: number; stale: number; status?: string };
  memoryMb?: { rss: number; heapUsed: number; heapTotal: number };
  uptimeSec?: number;
  process?: {
    unhandledRejectionCount?: number;
    uncaughtExceptionCount?: number;
    lastUnhandledRejectionMessage?: string | null;
    lastUncaughtExceptionMessage?: string | null;
  };
}

interface ProviderRow {
  vendor: string;
  paused: boolean;
  last24hErrorRate: number | null;
  last24hErrorCount: number;
  last24hTotalCount: number;
  inFlightItemCount: number;
}

function formatUptime(sec: number | undefined): string {
  if (!sec || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function AdminDashboardPage() {
  const { canAdmin } = useRole();

  const queueQuery = useQuery<QueueSnapshot>({
    queryKey: ["/api/admin/queue"],
    enabled: canAdmin,
    refetchInterval: REFRESH_MS,
  });

  const inFlightRunsQuery = useQuery<{ count: number }>({
    queryKey: ["/api/v1/admin/prompt-runs/in-flight"],
    enabled: canAdmin,
    refetchInterval: REFRESH_MS,
  });

  const failedByTypeQuery = useQuery<{
    hours: number;
    rows: Array<{ type: string; count: number }>;
  }>({
    queryKey: ["/api/v1/admin/jobs/failed-by-type"],
    enabled: canAdmin,
    refetchInterval: REFRESH_MS * 6,
  });

  // /health is anonymous — fetch directly so we don't have to thread the
  // public path through apiRequest's CSRF helpers.
  const healthQuery = useQuery<HealthPayload>({
    queryKey: ["/health"],
    queryFn: async () => {
      const res = await fetch("/health", { credentials: "include" });
      return (await res.json()) as HealthPayload;
    },
    enabled: canAdmin,
    refetchInterval: REFRESH_MS * 2,
  });

  const failedJobsQuery = useQuery<Job[]>({
    queryKey: ["/api/v1/admin/jobs/failed"],
    enabled: canAdmin,
    refetchInterval: REFRESH_MS * 3,
  });

  const providersQuery = useQuery<ProviderRow[]>({
    queryKey: ["/api/v1/admin/providers"],
    enabled: canAdmin,
    refetchInterval: REFRESH_MS * 3,
  });

  if (!canAdmin) {
    return <AdminForbidden what="view the operational dashboard" />;
  }

  const q = queueQuery.data;
  const h = healthQuery.data;
  const failed = failedJobsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const inFlightRuns = inFlightRunsQuery.data?.count ?? 0;
  const failedByType = failedByTypeQuery.data?.rows ?? [];
  const failedByTypeHours = failedByTypeQuery.data?.hours ?? 24;

  const failed24h = failed.filter((j) => {
    const ts = j.finishedAt ? new Date(j.finishedAt as any).getTime() : 0;
    return ts && Date.now() - ts <= 24 * 60 * 60 * 1000;
  }).length;

  const unhandled = h?.process?.unhandledRejectionCount ?? 0;
  const dbOk = h?.db ? h.db === "ok" : true;
  const overallStatus = h?.status ?? (dbOk ? "ok" : "down");

  const StatusPill = () => {
    if (overallStatus === "ok") {
      return (
        <Badge
          variant="outline"
          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1"
          data-testid="badge-overall-status"
        >
          <CheckCircle2 className="h-3 w-3" />
          Healthy
        </Badge>
      );
    }
    if (overallStatus === "degraded") {
      return (
        <Badge
          variant="outline"
          className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1"
          data-testid="badge-overall-status"
        >
          <AlertTriangle className="h-3 w-3" />
          Degraded
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1" data-testid="badge-overall-status">
        <ShieldAlert className="h-3 w-3" />
        Down
      </Badge>
    );
  };

  return (
    <AdminPageShell>
      <PageHeader
        title="Operational Dashboard"
        subtitle={`Live system health, refreshes every ${REFRESH_MS / 1000}s. Use the queue and providers pages for deeper drill-downs.`}
        actions={<StatusPill />}
      />

      <StatRow
        tiles={[
          {
            label: "Active jobs",
            value: q?.active ?? "—",
            icon: Activity,
            tone: "blue",
            hint: `${q?.maxConcurrentJobs ?? "—"} max`,
            testid: "stat-dash-active",
          },
          {
            label: "Queued",
            value: q?.queued ?? "—",
            icon: Hourglass,
            tone: "amber",
            hint: "Waiting",
            testid: "stat-dash-queued",
          },
          {
            label: "Stale",
            value: (
              <span className={q && q.stale > 0 ? "text-destructive" : undefined}>
                {q?.stale ?? "—"}
              </span>
            ),
            icon: AlertTriangle,
            tone: q && q.stale > 0 ? "rose" : "slate",
            hint: "Heartbeat overdue",
            testid: "stat-dash-stale",
          },
          {
            label: "Failed (24h)",
            value: (
              <span className={failed24h > 0 ? "text-rose-600 dark:text-rose-400" : undefined}>
                {failed24h}
              </span>
            ),
            icon: AlertTriangle,
            tone: failed24h > 0 ? "rose" : "emerald",
            hint: "Across all job types",
            testid: "stat-dash-failed-24h",
          },
          {
            label: "Prompt runs in flight",
            value: inFlightRuns,
            icon: Activity,
            tone: inFlightRuns > 0 ? "blue" : "slate",
            hint: "System-wide",
            testid: "stat-dash-runs-in-flight",
          },
        ]}
      />

      <Card data-testid="card-failed-by-type">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Failures by kind (last {failedByTypeHours}h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failedByType.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {failedByTypeQuery.isLoading ? "Loading…" : "No failures in the window."}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {failedByType.map((r) => (
                <div
                  key={r.type}
                  className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
                  data-testid={`chip-failed-type-${r.type}`}
                >
                  <Badge variant="outline" className="text-xs">
                    {r.type}
                  </Badge>
                  <span
                    className={`font-mono ${r.count >= 5 ? "text-rose-600 dark:text-rose-400 font-medium" : ""}`}
                  >
                    {r.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="card-process-health">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Process health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between border-b pb-2">
                <dt className="text-muted-foreground">Database</dt>
                <dd data-testid="text-dash-db">
                  {dbOk ? (
                    <span className="text-emerald-600 dark:text-emerald-400">OK</span>
                  ) : (
                    <span className="text-destructive font-medium">Unreachable</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-b pb-2">
                <dt className="text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5" /> Uptime
                </dt>
                <dd className="font-mono" data-testid="text-dash-uptime">
                  {formatUptime(h?.uptimeSec)}
                </dd>
              </div>
              <div className="flex justify-between border-b pb-2">
                <dt className="text-muted-foreground">Memory (RSS / Heap)</dt>
                <dd className="font-mono text-xs" data-testid="text-dash-memory">
                  {h?.memoryMb
                    ? `${h.memoryMb.rss} / ${h.memoryMb.heapUsed} MB`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Unhandled rejections</dt>
                <dd
                  className={`font-mono ${unhandled > 0 ? "text-rose-600 dark:text-rose-400 font-medium" : ""}`}
                  data-testid="text-dash-unhandled"
                  title={h?.process?.lastUnhandledRejectionMessage ?? ""}
                >
                  {unhandled}
                </dd>
              </div>
              {unhandled > 0 && h?.process?.lastUnhandledRejectionMessage && (
                <div className="text-xs text-rose-700 dark:text-rose-300 pt-1 truncate">
                  Last: {h.process.lastUnhandledRejectionMessage}
                </div>
              )}
            </dl>
            <div className="pt-3 flex gap-2">
              <Link href="/app/admin/queue">
                <Button variant="outline" size="sm" data-testid="link-dash-queue">
                  View queue
                </Button>
              </Link>
              <Link href="/app/admin/audit">
                <Button variant="ghost" size="sm" data-testid="link-dash-audit">
                  Audit log
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-providers-health">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" /> Providers (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {providers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {providersQuery.isLoading ? "Loading…" : "No providers found."}
              </div>
            ) : (
              <div className="space-y-2">
                {providers.map((p) => {
                  const rate = p.last24hErrorRate;
                  const tone =
                    rate === null
                      ? "text-muted-foreground"
                      : rate >= 0.25
                        ? "text-rose-600 dark:text-rose-400"
                        : rate >= 0.05
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400";
                  return (
                    <div
                      key={p.vendor}
                      className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0"
                      data-testid={`row-dash-provider-${p.vendor.toLowerCase()}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.vendor}</span>
                        {p.paused && (
                          <Badge variant="destructive" className="text-[10px]">
                            paused
                          </Badge>
                        )}
                        {p.inFlightItemCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            · {p.inFlightItemCount} in flight
                          </span>
                        )}
                      </div>
                      <div
                        className={`font-mono text-xs ${tone}`}
                        title={
                          rate === null
                            ? "No traffic"
                            : `${p.last24hErrorCount} / ${p.last24hTotalCount}`
                        }
                      >
                        {rate === null
                          ? "no traffic"
                          : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="pt-3">
              <Link href="/app/admin/models">
                <Button variant="outline" size="sm" data-testid="link-dash-providers">
                  Manage providers
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-dash-recent-failures">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            Recent failures
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failed.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {failedJobsQuery.isLoading ? "Loading…" : "No recent failures."}
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {failed.slice(0, 5).map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-2 py-1.5 border-b last:border-b-0"
                  data-testid={`row-dash-failure-${j.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0">
                      {j.type}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {j.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-rose-700 dark:text-rose-300 truncate">
                      {j.error ?? "—"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {j.finishedAt
                      ? new Date(j.finishedAt as any).toLocaleString()
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-3">
            <Link href="/app/admin/queue">
              <Button variant="outline" size="sm" data-testid="link-dash-all-failures">
                View all in queue
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
