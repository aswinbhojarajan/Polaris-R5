import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRole } from "@/hooks/use-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Activity, Hourglass, AlertTriangle, Cog, RotateCcw, XCircle, OctagonX } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AdminForbidden,
  AdminPageShell,
  PageHeader,
  StatRow,
  TableState,
} from "./_shared";
import type { Job } from "@shared/schema";

interface QueueSnapshot {
  active: number;
  queued: number;
  stale: number;
  shuttingDown: boolean;
  heartbeatIntervalMs: number;
  staleThresholdMs: number;
  maxResumeAttempts: number;
  maxConcurrentJobs: number;
  defaultTimeoutMs: number;
}

const REFRESH_INTERVAL_MS = 5000;
const FAILED_JOBS_KEY = ["/api/v1/admin/jobs/failed"] as const;
const QUEUED_JOBS_KEY = ["/api/v1/admin/jobs/queued"] as const;
const RUNNING_JOBS_KEY = ["/api/v1/admin/jobs/running"] as const;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s % 1 === 0 ? s : s.toFixed(1)} s`;
  const m = s / 60;
  return `${m % 1 === 0 ? m : m.toFixed(1)} min`;
}

function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function AdminQueuePage() {
  const { canAdmin } = useRole();
  const { toast } = useToast();

  const queueQuery = useQuery<QueueSnapshot>({
    queryKey: ["/api/admin/queue"],
    enabled: canAdmin,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Task #115 — recent failed jobs feed for the admin Retry UI.
  const failedJobsQuery = useQuery<Job[]>({
    queryKey: FAILED_JOBS_KEY,
    enabled: canAdmin,
    refetchInterval: REFRESH_INTERVAL_MS * 3,
    refetchIntervalInBackground: false,
  });

  // Task #115 — currently-queued jobs for the Cancel UI. Lives in its
  // own table because the failed-jobs feed is terminal-only, which
  // made the per-row Cancel button effectively unreachable.
  const queuedJobsQuery = useQuery<Job[]>({
    queryKey: QUEUED_JOBS_KEY,
    enabled: canAdmin,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Task #121 — currently-running jobs for the Halt UI. Uses the
  // in-process JobQueue.cancelJob() channel via POST /jobs/:id/halt
  // so the executor's cooperative cancellation check trips and the
  // worker exits at the next checkpoint.
  const runningJobsQuery = useQuery<Job[]>({
    queryKey: RUNNING_JOBS_KEY,
    enabled: canAdmin,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/v1/admin/jobs/${jobId}/retry`, {});
      return await res.json();
    },
    onSuccess: (data: { id: string; retryAttempt: number }) => {
      toast({
        title: "Job re-enqueued",
        description: `Retry attempt #${data.retryAttempt} (new job ${data.id.slice(0, 8)})`,
      });
      queryClient.invalidateQueries({ queryKey: FAILED_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
    },
    onError: (err) => {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/v1/admin/jobs/${jobId}/cancel`, {});
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Job cancelled" });
      queryClient.invalidateQueries({ queryKey: FAILED_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: QUEUED_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
    },
    onError: (err) => {
      toast({
        title: "Cancel failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  // Task #121 — Halt a currently running job via the in-process
  // JobQueue.cancelJob() channel. Asks for confirmation because
  // halting a running job typically loses partial work.
  const haltMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/v1/admin/jobs/${jobId}/halt`, {});
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Halt signal sent",
        description: "The worker will exit at its next checkpoint.",
      });
      queryClient.invalidateQueries({ queryKey: RUNNING_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: FAILED_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
    },
    onError: (err) => {
      toast({
        title: "Halt failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const [haltTarget, setHaltTarget] = useState<Job | null>(null);

  if (!canAdmin) {
    return <AdminForbidden what="view the job queue" />;
  }

  const data = queueQuery.data;
  const lastUpdated = queueQuery.dataUpdatedAt ? new Date(queueQuery.dataUpdatedAt) : null;

  const headerStatus = (() => {
    if (queueQuery.isLoading && !data) {
      return (
        <span className="text-sm text-muted-foreground" data-testid="text-queue-loading">
          Loading…
        </span>
      );
    }
    if (queueQuery.isError) {
      return (
        <span className="text-sm text-destructive" data-testid="text-queue-error">
          Failed to load queue stats
        </span>
      );
    }
    return (
      <div className="flex items-center gap-2">
        {data?.shuttingDown && (
          <Badge variant="destructive" data-testid="badge-shutting-down">
            Shutting down
          </Badge>
        )}
        {lastUpdated && (
          <span className="text-xs text-muted-foreground" data-testid="text-queue-last-refresh">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>
    );
  })();

  const failedJobs = failedJobsQuery.data ?? [];
  const queuedJobs = queuedJobsQuery.data ?? [];
  const runningJobs = runningJobsQuery.data ?? [];

  return (
    <AdminPageShell>
      <PageHeader
        title="Job Queue"
        subtitle={`Live counters and tunables for the background job queue. Auto-refreshes every ${REFRESH_INTERVAL_MS / 1000}s.`}
        actions={headerStatus}
      />

      <StatRow
        tiles={[
          {
            label: "Active",
            value: data?.active ?? "—",
            icon: Activity,
            tone: "blue",
            hint: "Currently processing",
            testid: "stat-active",
          },
          {
            label: "Queued",
            value: data?.queued ?? "—",
            icon: Hourglass,
            tone: "amber",
            hint: "Waiting to be picked up",
            testid: "stat-queued",
          },
          {
            label: "Stale",
            value: (
              <span className={data && data.stale > 0 ? "text-destructive" : undefined}>
                {data?.stale ?? "—"}
              </span>
            ),
            icon: AlertTriangle,
            tone: data && data.stale > 0 ? "rose" : "slate",
            hint: "Heartbeat overdue",
            testid: "stat-stale",
          },
          {
            label: "Concurrency",
            value: data?.maxConcurrentJobs ?? "—",
            icon: Cog,
            tone: "purple",
            hint: "Max concurrent jobs",
            testid: "stat-concurrency",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tunables</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Heartbeat interval</dt>
              <dd className="font-mono" data-testid="config-heartbeat">
                {data ? formatMs(data.heartbeatIntervalMs) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Stale threshold</dt>
              <dd className="font-mono" data-testid="config-stale-threshold">
                {data ? formatMs(data.staleThresholdMs) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Max resume attempts</dt>
              <dd className="font-mono" data-testid="config-max-resume">
                {data?.maxResumeAttempts ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Max concurrent jobs</dt>
              <dd className="font-mono" data-testid="config-concurrency-detail">
                {data?.maxConcurrentJobs ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b pb-2">
              <dt className="text-muted-foreground">Default timeout</dt>
              <dd className="font-mono" data-testid="config-default-timeout">
                {data ? formatMs(data.defaultTimeoutMs) : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Task #121 — Running jobs surface for the Halt action. */}
      <Card data-testid="card-running-jobs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            Running jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Jobs currently being processed by a worker. Halting sends a
            cooperative cancellation signal — the worker exits at its
            next checkpoint, so partial work is typically lost. The DB
            row flips to <code>cancelled</code> immediately.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-2">Job</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Started at</th>
                  <th className="text-left py-2 pr-2">Last heartbeat</th>
                  <th className="text-right py-2 pl-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={runningJobsQuery.isLoading}
                  empty={!runningJobsQuery.isLoading && runningJobs.length === 0}
                  error={runningJobsQuery.error}
                  onRetry={() => runningJobsQuery.refetch()}
                  emptyText="No jobs are running right now."
                  colSpan={5}
                />
                {runningJobs.map((job) => {
                  const haltPending =
                    haltMutation.isPending && haltMutation.variables === job.id;
                  return (
                    <tr
                      key={job.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                      data-testid={`row-running-job-${job.id}`}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">
                        {job.id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className="text-xs">
                          {job.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(job.startedAt)}
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(job.lastHeartbeat)}
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
                          disabled={haltPending}
                          onClick={() => setHaltTarget(job)}
                          title="Halt running job"
                          data-testid={`button-halt-running-job-${job.id}`}
                        >
                          <OctagonX className="h-3 w-3" />
                          {haltPending ? "Halting…" : "Halt"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Task #115 — recent failed jobs with Retry / Cancel actions. */}
      <Card data-testid="card-failed-jobs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            Recent failed jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Last 50 jobs with status <code>error</code> or <code>cancelled</code>.
            Retry re-enqueues a new job carrying the original payload + a{" "}
            <code>retry_attempt</code> counter; the original row is preserved
            for audit. To cancel a job that's still waiting to run, use the
            Queued jobs table below.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-2">Job</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Failed at</th>
                  <th className="text-left py-2 pr-2">Error</th>
                  <th className="text-right py-2 pl-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={failedJobsQuery.isLoading}
                  empty={!failedJobsQuery.isLoading && failedJobs.length === 0}
                  error={failedJobsQuery.error}
                  onRetry={() => failedJobsQuery.refetch()}
                  emptyText="No failed jobs in the queue."
                  colSpan={5}
                />
                {failedJobs.map((job) => {
                  const retryPending =
                    retryMutation.isPending && retryMutation.variables === job.id;
                  const cancelPending =
                    cancelMutation.isPending && cancelMutation.variables === job.id;
                  return (
                    <tr
                      key={job.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                      data-testid={`row-failed-job-${job.id}`}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">
                        {job.id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className="text-xs">
                          {job.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}
                      </td>
                      <td className="py-2 pr-2 max-w-md">
                        <div
                          className="text-xs text-rose-700 dark:text-rose-300 truncate"
                          title={job.error ?? ""}
                          data-testid={`text-job-error-${job.id}`}
                        >
                          {job.error ?? "—"}
                        </div>
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="mr-2 gap-1"
                          disabled={retryPending}
                          onClick={() => retryMutation.mutate(job.id)}
                          data-testid={`button-retry-job-${job.id}`}
                        >
                          <RotateCcw className="h-3 w-3" />
                          {retryPending ? "Retrying…" : "Retry"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Task #115 — Queued jobs surface for the Cancel action. */}
      <Card data-testid="card-queued-jobs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-amber-500" />
            Queued jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Jobs waiting for a worker to pick them up. Cancel is atomic —
            if a worker claims the job between your click and the request
            arriving, the cancel is rejected with a 409 and the run
            proceeds normally.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-2">Job</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Queued at</th>
                  <th className="text-right py-2 pl-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={queuedJobsQuery.isLoading}
                  empty={!queuedJobsQuery.isLoading && queuedJobs.length === 0}
                  error={queuedJobsQuery.error}
                  onRetry={() => queuedJobsQuery.refetch()}
                  emptyText="No jobs in the queue right now."
                  colSpan={4}
                />
                {queuedJobs.map((job) => {
                  const cancelPending =
                    cancelMutation.isPending && cancelMutation.variables === job.id;
                  return (
                    <tr
                      key={job.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                      data-testid={`row-queued-job-${job.id}`}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">
                        {job.id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className="text-xs">
                          {job.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(job.createdAt)}
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-muted-foreground"
                          disabled={cancelPending}
                          onClick={() => cancelMutation.mutate(job.id)}
                          title="Cancel queued job"
                          data-testid={`button-cancel-queued-job-${job.id}`}
                        >
                          <XCircle className="h-3 w-3" />
                          {cancelPending ? "Cancelling…" : "Cancel"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={haltTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHaltTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-halt">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Halt running job{haltTarget ? ` ${haltTarget.id.slice(0, 8)}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {haltTarget ? `Type: ${haltTarget.type}. ` : ""}The worker will exit
              at its next checkpoint. Partial work will typically be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-halt">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                if (haltTarget) haltMutation.mutate(haltTarget.id);
                setHaltTarget(null);
              }}
              data-testid="button-confirm-halt"
            >
              Halt job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}
