import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { RunDetailsSection } from "@/components/run-details-section";
import { StartRunDialog } from "@/components/start-run-dialog";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Plus, 
  Upload, 
  Eye, 
  Edit2,
  Pause,
  Play,
  Square,
  Check,
  Clock,
  Trash2,
  RotateCw
} from "lucide-react";
import type { PromptRun } from "@shared/schema";
import { RetryCard } from "@/components/feedback/RetryCard";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";
import { useClientActivityItems, invalidateActivityQueries } from "@/hooks/use-client-activity";

// Task #107: source-side guard. Rerun has no meaning while the source is
// still queued/running/scoring/benchmarking — wait for it to settle one way
// or the other. Mirrors `ACTIVE_PROMPT_RUN_STATUSES` on the server.
const NON_TERMINAL_RUN_STATUSES = new Set<string>([
  'queued',
  'running',
  'scoring',
  'queued_for_benchmarking',
  'benchmarking',
  'paused',
]);

// Task #107: client-side preview of the iteration name. The server is the
// canonical source (it scans existing runs to compute the next N) — this
// is best-effort for the confirm dialog so the user knows roughly what the
// new row will be called. Always shows `(iteration max(2, K+1))`.
function previewIterationName(sourceName: string): string {
  const trimmed = (sourceName || "").trim();
  const m = trimmed.match(/^(.*?)\s*\(iteration\s+(\d+)\)\s*$/i);
  if (m) {
    const base = m[1].trim() || "Run";
    const n = Number.parseInt(m[2], 10);
    const next = Number.isFinite(n) ? n + 1 : 2;
    return `${base} (iteration ${next})`;
  }
  return `${trimmed || "Run"} (iteration 2)`;
}

// Task #107: strip suffix so we send the server a clean base to compute from.
function stripIterationSuffix(name: string): string {
  return (name || "").replace(/\s*\(iteration\s+\d+\)\s*$/i, "").trim();
}

interface EnrichedPromptRun extends PromptRun {
  modelCount?: number;
  avgVisibilityScore?: number;
  avgSentimentScore?: number;
  avgPositionScore?: number;
}

export default function PromptsTracker() {
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isStartRunDialogOpen, setIsStartRunDialogOpen] = useState(false);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [stopRunId, setStopRunId] = useState<string | null>(null);
  const [renameRunId, setRenameRunId] = useState<string | null>(null);
  const [newRunName, setNewRunName] = useState('');
  const [rerunRun, setRerunRun] = useState<EnrichedPromptRun | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();
  const errorToast = useErrorToast();
  const RUNS_PER_PAGE = 10;
  const previousRunsRef = useRef<Record<string, string>>({});

  const hasActiveRuns = (runs: any[]) => {
    return runs.some(run => run.status === 'running' || run.status === 'queued');
  };

  // Server-side pagination + filters: the endpoint is bounded, so paging,
  // status filtering and name search all happen in SQL against the full
  // history instead of slicing a truncated client-side list.
  const { data: runPage, isLoading, isError, error, refetch } = useQuery<{
    runs: EnrichedPromptRun[];
    total: number;
  }>({
    queryKey: ['/api/v1/prompt-runs', selectedClientId, currentPage, statusFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({
        client_id: selectedClientId!,
        limit: String(RUNS_PER_PAGE),
        offset: String((currentPage - 1) * RUNS_PER_PAGE),
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const response = await fetch(`/api/v1/prompt-runs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch prompt runs');
      return response.json();
    },
    enabled: !!selectedClientId,
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const data = query.state.data as { runs: any[] } | undefined;
      return data && hasActiveRuns(data.runs) ? 3000 : false;
    }
  });
  const promptRuns = runPage?.runs ?? [];
  const totalRuns = runPage?.total ?? 0;

  // Detect any active→terminal status change. We invalidate per-run results
  // caches so any open drawer/section refreshes immediately, and toast on
  // completion.
  useEffect(() => {
    if (promptRuns.length === 0) return;

    const ACTIVE = new Set([
      'queued',
      'running',
      'scoring',
      'queued_for_benchmarking',
      'benchmarking',
    ]);
    const TERMINAL = new Set(['done', 'failed', 'stopped', 'cancelled', 'error']);

    promptRuns.forEach((run) => {
      const previousStatus = previousRunsRef.current[run.id];

      if (previousStatus && ACTIVE.has(previousStatus) && TERMINAL.has(run.status)) {
        // Bust per-run results cache so any open detail view refreshes.
        queryClient.invalidateQueries({
          queryKey: ['/api/v1/prompt-runs', run.id, 'results', selectedClientId],
        });

        if (run.status === 'done') {
          toast({
            title: "Prompt run completed",
            description: `Run with ${run.totalPrompts} prompts has finished. Click to view results.`,
            action: <Button size="sm" onClick={() => setSelectedRunId(run.id)}>View Results</Button>,
            duration: 10000,
          });
        }
      }

      previousRunsRef.current[run.id] = run.status;
    });
  }, [promptRuns, toast, selectedClientId]);

  const stopMutation = useMutation({
    mutationFn: async (runId: string) => {
      await apiRequest('POST', `/api/v1/prompt-runs/${runId}/stop`, undefined);
    },
    onSuccess: () => {
      toast({
        title: "Run stopped",
        description: "The prompt run has been cancelled.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      setStopRunId(null);
    },
    onError: (err) => {
      errorToast("Failed to stop run", err);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (runId: string) => {
      await apiRequest('DELETE', `/api/v1/prompt-runs/${runId}`, undefined);
    },
    onSuccess: () => {
      toast({
        title: "Run deleted",
        description: "The prompt run and all its data have been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      setDeleteRunId(null);
    },
    onError: (err) => {
      errorToast("Failed to delete run", err);
    }
  });

  // Task #139 — True pause/resume. Pause suspends an in-flight run while
  // keeping completed work; resume continues from the checkpoint so already
  // completed prompts are not re-run (and not re-paid for).
  const pauseMutation = useMutation({
    mutationFn: async (runId: string) => {
      await apiRequest('POST', `/api/v1/prompt-runs/${runId}/pause`, undefined);
    },
    onSuccess: () => {
      toast({
        title: "Run paused",
        description: "Completed prompts are kept. Resume any time to continue.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      invalidateActivityQueries(selectedClientId);
    },
    onError: (err) => {
      errorToast("Failed to pause run", err);
    }
  });

  const resumeMutation = useMutation({
    mutationFn: async (runId: string) => {
      await apiRequest('POST', `/api/v1/prompt-runs/${runId}/resume`, undefined);
    },
    onSuccess: () => {
      toast({
        title: "Run resumed",
        description: "Continuing from where it left off.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      invalidateActivityQueries(selectedClientId);
    },
    onError: (err) => {
      errorToast("Failed to resume run", err);
    }
  });

  // Task #107: rerun a previous run by re-posting to the existing create
  // endpoint with the same prompts + models. We send `iterationOf` (the
  // stripped base name) so the server computes the canonical
  // `(iteration N)` suffix from sibling runs — concurrent reruns can't
  // collide on the same N because each request reads max() at create time.
  // Source selections are fetched on-demand via the existing
  // `GET /api/v1/prompt-runs/:id/selections` endpoint (Task #56) so we
  // don't bypass any project-scoped auth.
  type RerunSelections = {
    runId: string;
    promptIds: string[];
    modelIds: string[];
  };
  const rerunSelectionsQueryKey = (runId: string) =>
    ['/api/v1/prompt-runs', runId, 'selections'] as const;
  const fetchRerunSelections = async (runId: string): Promise<RerunSelections> => {
    const res = await fetch(`/api/v1/prompt-runs/${runId}/selections`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  };
  const { data: rerunSelections, isLoading: rerunSelectionsLoading } = useQuery<RerunSelections>({
    queryKey: rerunSelectionsQueryKey(rerunRun?.id ?? ''),
    queryFn: () => fetchRerunSelections(rerunRun!.id),
    enabled: !!rerunRun,
  });

  const activityItems = useClientActivityItems(selectedClientId);
  // Task #107: surface the same "another prompt run is already in flight"
  // warning the StartRunDialog shows, so users see it before confirming
  // a rerun too. Project-scoped — any in-flight prompt_run for this
  // project counts (not just overlapping selections, mirroring the
  // tracker's existing soft-guard).
  const otherPromptRunActive = activityItems.some(
    (i) => i.kind === 'prompt_run',
  );

  const rerunMutation = useMutation({
    mutationFn: async (source: EnrichedPromptRun) => {
      // Task #116: don't depend on a render-closure `rerunSelections`. Read
      // the selections directly from the query cache, falling back to a
      // fresh fetch when the cache is empty (e.g. Radix auto-closed the
      // dialog before the query resolved, or `gcTime` evicted the entry
      // between opens). This makes the rerun click race-safe.
      const key = rerunSelectionsQueryKey(source.id);
      let selections = queryClient.getQueryData<RerunSelections>(key);
      if (!selections) {
        selections = await queryClient.fetchQuery({
          queryKey: key,
          queryFn: () => fetchRerunSelections(source.id),
        });
      }
      const res = await apiRequest('POST', '/api/v1/prompt-runs', {
        clientId: source.clientId,
        promptIds: selections.promptIds,
        modelIds: selections.modelIds,
        iterationOf: stripIterationSuffix(source.name) || source.name,
      });
      return res.json() as Promise<{ run: PromptRun }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Rerun queued",
        description: `"${data.run.name}" is now queued.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      invalidateActivityQueries(selectedClientId);
      setRerunRun(null);
    },
    onError: (err) => {
      errorToast("Failed to rerun", err);
    }
  });

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!renameRunId) throw new Error("No run selected");
      return apiRequest('PATCH', `/api/v1/prompt-runs/${renameRunId}`, { name: newRunName.trim() });
    },
    onSuccess: () => {
      toast({
        title: "Run renamed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/prompt-runs', selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/v1/dashboard/recent-runs', selectedClientId] });
      setRenameRunId(null);
      setNewRunName('');
    },
    onError: (err) => {
      errorToast("Failed to rename run", err);
    }
  });

  if (!selectedClientId) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Project Selected</h2>
          <p className="text-muted-foreground">Pick a project from the switcher in the top right to view prompt runs.</p>
        </div>
      </div>
    );
  }


  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'done':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            <Check className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            <Clock className="h-3 w-3 mr-1" />
            Running
          </Badge>
        );
      case 'paused':
        return (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid={`badge-status-paused`}>
            <Pause className="h-3 w-3 mr-1" />
            Paused
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Filtering, sorting and paging are done server-side; the query above
  // already returns exactly the current page (newest first).
  const filteredRuns = promptRuns;

  // Pagination (server-driven)
  const totalPages = Math.max(Math.ceil(totalRuns / RUNS_PER_PAGE), 1);
  const startIndex = (currentPage - 1) * RUNS_PER_PAGE;
  const endIndex = Math.min(startIndex + filteredRuns.length, totalRuns);
  const paginatedRuns = filteredRuns;
  // Windowed page buttons so huge histories don't render hundreds of buttons.
  const pageWindow = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2);

  return (
    <div className="fade-in">
      {/* Task #56: surface other in-flight work for this project (X-Ray, metadata,
          report, copy, …) on both list and run-detail views. Prompt runs are
          excluded — they're rendered as table rows / dedicated detail UI below. */}
      {selectedClientId && (
        <div className="page-content pb-0">
          <ActiveOperationsBanner clientId={selectedClientId} excludeKinds={["prompt_run"]} />
        </div>
      )}

      {/* Show details section when a run is selected */}
      {selectedRunId && (
        <RunDetailsSection runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      )}

      {/* Show list view when no run is selected */}
      <div className={selectedRunId ? 'hidden' : 'block'}>
      {/* Header */}
      <div className="page-content border-b border-border bg-card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">Prompts Tracker</h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Monitor and analyze prompt execution results</p>
          </div>
          <div className="button-group-responsive">
            <Button variant="outline" data-testid="button-upload-csv" className="w-full sm:w-auto">
              <Upload className="mr-2 h-4 w-4" />
              Upload CSV
            </Button>
            <Button onClick={() => setIsStartRunDialogOpen(true)} data-testid="button-start-run" className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Start New Run
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="page-content bg-muted/30 border-b border-border">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setCurrentPage(1); }}>
            <SelectTrigger className="w-full sm:w-40" data-testid="filter-status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="done">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
            </SelectContent>
          </Select>
          
          <Input 
            placeholder="Search run names..." 
            className="flex-1 w-full sm:max-w-sm"
            data-testid="input-search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>
      </div>

      {/* Table */}
      {isError ? (
        <RetryCard error={error} onRetry={() => refetch()} title="Couldn't load prompt runs" />
      ) : (
      <div className="table-responsive">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[60px] text-center">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prompts</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Avg Score</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="loading-skeleton h-4 w-8 rounded mx-auto"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-4 w-32 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-6 w-20 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-4 w-8 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-4 w-8 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-4 w-12 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-4 w-16 rounded"></div></TableCell>
                  <TableCell><div className="loading-skeleton h-8 w-16 rounded"></div></TableCell>
                </TableRow>
              ))
            ) : filteredRuns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <p className="text-muted-foreground">
                    {searchQuery || statusFilter !== 'all' ? 'No runs match your filters' : 'No prompt runs found for this client.'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Start a new run to begin analyzing prompts'}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              paginatedRuns.map((run, pageIndex) => {
                const globalIndex = startIndex + pageIndex;
                return (
                <TableRow 
                  key={run.id} 
                  className="hover:bg-[#EDE8FF] cursor-pointer" 
                  data-testid={`row-run-${run.id}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {globalIndex + 1}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-foreground">
                      {run.name}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(run.status)}</TableCell>
                  <TableCell className="text-sm text-foreground">{run.totalPrompts || 0}</TableCell>
                  <TableCell className="text-sm text-foreground">{run.modelCount || '-'}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {run.status === 'done' && run.avgVisibilityScore !== undefined ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="text-foreground">V: {(run.avgVisibilityScore || 0).toFixed(1)}</span>
                        <span className="text-green-600">S: {(run.avgSentimentScore || 0).toFixed(1)}</span>
                        <span className="text-blue-600">P: {(run.avgPositionScore || 0).toFixed(1)}</span>
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="text-sm text-foreground">
                        {format(new Date(run.createdAt), 'MMM d, yyyy \'at\' h:mm a')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center space-x-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setRenameRunId(run.id);
                          setNewRunName(run.name);
                        }}
                        data-testid={`button-edit-${run.id}`}
                        title="Rename"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {(run.status === 'queued' || run.status === 'running') && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => pauseMutation.mutate(run.id)}
                          disabled={pauseMutation.isPending}
                          data-testid={`button-pause-${run.id}`}
                          title="Pause (keeps completed work)"
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}
                      {run.status === 'paused' && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => resumeMutation.mutate(run.id)}
                          disabled={resumeMutation.isPending}
                          data-testid={`button-resume-${run.id}`}
                          title="Resume from where it left off"
                        >
                          <Play className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {NON_TERMINAL_RUN_STATUSES.has(run.status) && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setStopRunId(run.id)}
                          disabled={stopMutation.isPending}
                          data-testid={`button-stop-${run.id}`}
                          title="Stop"
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRerunRun(run)}
                        disabled={
                          rerunMutation.isPending ||
                          NON_TERMINAL_RUN_STATUSES.has(run.status)
                        }
                        data-testid={`button-rerun-${run.id}`}
                        title={
                          NON_TERMINAL_RUN_STATUSES.has(run.status)
                            ? "Wait for this run to finish before rerunning"
                            : "Rerun with same prompts & models"
                        }
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setDeleteRunId(run.id)}
                        data-testid={`button-delete-${run.id}`}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Mobile Card View */}
        {!isLoading && filteredRuns.length > 0 && (
          <div className="table-card-mobile space-y-3">
            {paginatedRuns.map((run, pageIndex) => {
              const globalIndex = startIndex + pageIndex;
              return (
              <div 
                key={run.id} 
                className="mobile-table-card"
                data-testid={`card-run-${run.id}-mobile`}
                onClick={() => setSelectedRunId(run.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 flex items-center gap-2">
                    <div className="text-sm text-muted-foreground font-medium">
                      {globalIndex + 1}
                    </div>
                    <div className="text-base font-medium text-foreground">
                      {run.name}
                    </div>
                  </div>
                  {getStatusBadge(run.status)}
                </div>
                
                <div className="space-y-2">
                  <div className="mobile-table-row">
                    <span className="mobile-table-label">Prompts</span>
                    <span className="mobile-table-value">{run.totalPrompts || 0}</span>
                  </div>
                  <div className="mobile-table-row">
                    <span className="mobile-table-label">Models</span>
                    <span className="mobile-table-value">{run.modelCount || '-'}</span>
                  </div>
                  {run.status === 'done' && run.avgVisibilityScore !== undefined && (
                    <div className="mobile-table-row">
                      <span className="mobile-table-label">Avg Scores</span>
                      <div className="flex flex-col gap-0.5 text-xs text-right">
                        <span className="text-foreground">V: {(run.avgVisibilityScore || 0).toFixed(1)}</span>
                        <span className="text-green-600">S: {(run.avgSentimentScore || 0).toFixed(1)}</span>
                        <span className="text-blue-600">P: {(run.avgPositionScore || 0).toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                  <div className="mobile-table-row">
                    <span className="mobile-table-label">Created</span>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="mobile-table-value text-xs">{format(new Date(run.createdAt), 'MMM d, yyyy \'at\' h:mm a')}</span>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => {
                      setRenameRunId(run.id);
                      setNewRunName(run.name);
                    }}
                    data-testid={`button-edit-${run.id}-mobile`}
                  >
                    <Edit2 className="h-4 w-4 mr-1" /> Rename
                  </Button>
                  {(run.status === 'queued' || run.status === 'running') && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => pauseMutation.mutate(run.id)}
                      disabled={pauseMutation.isPending}
                      data-testid={`button-pause-${run.id}-mobile`}
                    >
                      <Pause className="h-4 w-4 mr-1" /> Pause
                    </Button>
                  )}
                  {run.status === 'paused' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => resumeMutation.mutate(run.id)}
                      disabled={resumeMutation.isPending}
                      data-testid={`button-resume-${run.id}-mobile`}
                    >
                      <Play className="h-4 w-4 mr-1 text-green-600" /> Resume
                    </Button>
                  )}
                  {NON_TERMINAL_RUN_STATUSES.has(run.status) && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => setStopRunId(run.id)}
                      disabled={stopMutation.isPending}
                      data-testid={`button-stop-${run.id}-mobile`}
                    >
                      <Square className="h-4 w-4 mr-1" /> Stop
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setRerunRun(run)}
                    disabled={
                      rerunMutation.isPending ||
                      NON_TERMINAL_RUN_STATUSES.has(run.status)
                    }
                    data-testid={`button-rerun-${run.id}-mobile`}
                  >
                    <RotateCw className="h-4 w-4 mr-1" /> Rerun
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => setDeleteRunId(run.id)}
                    data-testid={`button-delete-${run.id}-mobile`}
                  >
                    <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Pagination */}
      {filteredRuns.length > 0 && (
        <div className="page-content border-t border-border bg-card">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {endIndex} of {totalRuns} result{totalRuns !== 1 ? 's' : ''}
            </div>
            <div className="flex items-center space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
                data-testid="button-previous"
              >
                Previous
              </Button>
              {pageWindow.map((page) => (
                <Button 
                  key={page}
                  size="sm" 
                  variant={currentPage === page ? "default" : "outline"}
                  onClick={() => setCurrentPage(page)}
                  data-testid={`button-page-${page}`}
                >
                  {page}
                </Button>
              ))}
              <Button 
                variant="outline" 
                size="sm" 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
                data-testid="button-next"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      </div>
      {/* End of list view wrapper */}

      {/* Start Run Dialog */}
      {selectedClientId && (
        <StartRunDialog
          isOpen={isStartRunDialogOpen}
          onClose={() => setIsStartRunDialogOpen(false)}
          clientId={selectedClientId}
        />
      )}

      {/* Stop Confirmation Dialog */}
      <AlertDialog open={!!stopRunId} onOpenChange={() => setStopRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Prompt Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the currently running prompt run. Any completed prompts will remain, but pending prompts will be marked as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => stopRunId && stopMutation.mutate(stopRunId)}
            >
              Stop Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Prompt Run?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRunId && NON_TERMINAL_RUN_STATUSES.has(
                promptRuns.find((r) => r.id === deleteRunId)?.status ?? ''
              )
                ? "This run is still active. Deleting it will stop it first, then permanently remove the run and all associated data (answers, citations, mentions, and rankings). This action cannot be undone."
                : "This will permanently delete the prompt run and all associated data including answers, citations, mentions, and rankings. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && deleteMutation.mutate(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task #107: Rerun Confirmation Dialog. Shows source name + status,
          prompt/model counts (separately + their product), a name preview
          using the iteration convention, and the same concurrent-run warning
          the StartRunDialog shows when another prompt_run is already in
          flight for the project. Cancel is the default-focused action so an
          accidental Enter press is safe. */}
      <AlertDialog open={!!rerunRun} onOpenChange={(open) => { if (!open) setRerunRun(null); }}>
        <AlertDialogContent data-testid={rerunRun ? `dialog-rerun-${rerunRun.id}` : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Rerun this prompt run?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {rerunRun && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">Source:</span>
                    <span className="font-medium text-foreground" data-testid={`text-rerun-source-name-${rerunRun.id}`}>
                      {rerunRun.name}
                    </span>
                    {getStatusBadge(rerunRun.status)}
                  </div>
                )}
                {rerunRun && (
                  <div data-testid={`text-rerun-counts-${rerunRun.id}`}>
                    {rerunSelectionsLoading || !rerunSelections ? (
                      <span className="text-muted-foreground">Loading prompt &amp; model counts…</span>
                    ) : (
                      <span>
                        Will re-execute{" "}
                        <span className="font-medium text-foreground">
                          {rerunSelections.promptIds.length} prompt
                          {rerunSelections.promptIds.length === 1 ? "" : "s"}
                        </span>{" "}
                        ×{" "}
                        <span className="font-medium text-foreground">
                          {rerunSelections.modelIds.length} model
                          {rerunSelections.modelIds.length === 1 ? "" : "s"}
                        </span>{" "}
                        ={" "}
                        <span className="font-medium text-foreground">
                          {rerunSelections.promptIds.length * rerunSelections.modelIds.length} items
                        </span>
                        .
                      </span>
                    )}
                  </div>
                )}
                {rerunRun && (
                  <div>
                    <span className="text-muted-foreground">New run name preview:</span>{" "}
                    <span className="font-mono text-foreground" data-testid={`text-rerun-name-preview-${rerunRun.id}`}>
                      {previewIterationName(rerunRun.name)}
                    </span>
                    <div className="text-xs text-muted-foreground mt-1">
                      The server picks the final iteration number from existing siblings, so it may
                      bump higher if other reruns have happened.
                    </div>
                  </div>
                )}
                {rerunRun && otherPromptRunActive && (
                  <div
                    className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs"
                    data-testid={`warning-concurrent-rerun-${rerunRun.id}`}
                  >
                    Another prompt run for this project is already executing — possibly started by
                    another user. Starting now will run in parallel and consume additional API
                    credits. Continue anyway?
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid={rerunRun ? `button-cancel-rerun-${rerunRun.id}` : undefined}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rerunRun && rerunMutation.mutate(rerunRun)}
              disabled={rerunMutation.isPending || rerunSelectionsLoading || !rerunSelections}
              data-testid={rerunRun ? `button-confirm-rerun-${rerunRun.id}` : undefined}
            >
              {rerunMutation.isPending ? "Queueing…" : "Rerun"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={!!renameRunId} onOpenChange={() => {
        setRenameRunId(null);
        setNewRunName('');
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Prompt Run</DialogTitle>
            <DialogDescription>
              Enter a new name for this run
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="run-name">Run Name</Label>
              <Input
                id="run-name"
                value={newRunName}
                onChange={(e) => setNewRunName(e.target.value)}
                placeholder="Enter new name"
                maxLength={200}
                autoFocus
                data-testid="input-rename-run"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newRunName.trim()) {
                    renameMutation.mutate();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setRenameRunId(null);
                setNewRunName('');
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => renameMutation.mutate()}
              disabled={!newRunName.trim() || renameMutation.isPending}
              data-testid="button-save-rename"
            >
              {renameMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
