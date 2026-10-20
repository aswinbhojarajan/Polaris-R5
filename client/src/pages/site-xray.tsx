import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useErrorToast } from "@/hooks/use-error-toast";
import { SlowQueryNotice } from "@/components/feedback/SlowQueryNotice";
import { RetryCard } from "@/components/feedback/RetryCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ApiError } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Globe,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  Lightbulb,
  AlertTriangle,
  Sparkles,
  ListChecks,
  RefreshCw,
  Play,
  Loader2,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";
import { useActiveItemOfKind, describeStarter, invalidateActivityQueries } from "@/hooks/use-client-activity";
import { useAuth } from "@/lib/auth";

interface XRayLastJob {
  jobId: string;
  status: string;
  error: string | null;
  progress: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  startedByUserId: string | null;
  startedByDisplayName: string | null;
  startedByEmail: string | null;
}

interface XRaySite {
  id: string;
  domain: string;
  siteType: string;
  avgScores: { content: number; seo: number; structure: number } | null;
  pageCount: number;
  totalIssues: number;
  totalRecommendations: number;
  robotsTxt: boolean;
  aiTxt: boolean;
  crawlStatus: string;
  healthProbeStatus?: 'pending' | 'completed' | 'failed';
  lastProbedAt?: string | null;
  // Task #64: latest xray_analysis job for this site (any user, any tab).
  lastAnalysisJob: XRayLastJob | null;
  // Set when lastAnalysisJob is queued/running — used by the SiteAccordion
  // to adopt an in-flight job after a page refresh or for runs started by
  // a teammate.
  activeJobId: string | null;
}

interface XRayPage {
  id: string;
  url: string;
  title: string | null;
  pageType: string | null;
  wordCount: number | null;
  scores: any;
  issueCount: number;
  recommendationCount: number;
}

interface PageStructure {
  headings: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
  images: { total: number; withAlt: number; withoutAlt: number };
  links: { internal: number; external: number };
}

interface PageAnalysis {
  scores: { content: number; seo: number; structure: number };
  qualityAssessment: string;
  seoIssues: Array<{ type: string; issue: string; priority: string; fix: string }>;
  contentGaps: string[];
  recommendations: Array<{ action: string; effort: string; impact: string; category: string; rationale: string }>;
  entities: {
    people: string[];
    products: string[];
    companies: string[];
    locations: string[];
    technologies: string[];
  };
}


export default function SiteXRay() {
  const [location] = useLocation();
  const [expandedSite, setExpandedSite] = useState<string>("");
  const { toast } = useToast();
  const errorToast = useErrorToast();
  
  // Prefer the URL `?clientId=` over the stored value so deep links work in
  // freshly-opened tabs. See `useUrlClientId` for the rationale.
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();

  const selectedClientId = urlClientId || storedClientId;
  // Task #56: when a project-wide site X-Ray is in flight (started by us
  // or another user), the per-site Refresh button below soft-disables and
  // surfaces "started by {name} {Xago}" in its tooltip.
  const activeXrayItem = useActiveItemOfKind(selectedClientId, "site_xray");
  const siteXrayActive = !!activeXrayItem;
  const { user: meUser } = useAuth();
  const xrayTooltip = activeXrayItem
    ? `${describeStarter(activeXrayItem, meUser?.id ?? null)} started a site X-Ray ${formatDistanceToNow(new Date(activeXrayItem.startedAt), { addSuffix: true })}.`
    : undefined;

  // URL → store sync is handled centrally in ProtectedRoute; keep the
  // backfill that writes a shareable ?clientId=… into the URL.
  useEffect(() => {
    if (selectedClientId && !urlClientId) {
      const newUrl = `/app/site-xray?clientId=${selectedClientId}`;
      window.history.replaceState(null, '', newUrl);
    }
  }, [selectedClientId, urlClientId]);

  const { data: sites = [], isLoading: isLoadingSites, error: sitesError, refetch: refetchSites } = useQuery<XRaySite[]>({
    queryKey: [`/api/v1/xray/sites?clientId=${selectedClientId}`],
    enabled: !!selectedClientId,
    // Auto-poll every 3s if any site has a pending health probe OR an
    // in-flight xray_analysis run (Task #64) — the latter keeps the
    // "last analysis" row's progress / status text fresh for runs the
    // current tab didn't kick off (e.g. a teammate's run, or after a
    // page refresh while the worker was still chewing through batches).
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasPendingProbe = data?.some(site => site.healthProbeStatus === 'pending');
      const hasActiveJob = data?.some(site => !!site.activeJobId);
      return hasPendingProbe || hasActiveJob ? 3000 : false;
    },
  });

  const refreshHealthMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest("POST", `/api/v1/xray/sites/${siteId}/refresh-health`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/v1/xray/sites?clientId=${selectedClientId}`] });
      invalidateActivityQueries(selectedClientId);
      toast({
        title: "Health check refreshed",
        description: "Site health data has been updated successfully.",
      });
    },
    onError: (err) => {
      errorToast("Refresh failed", err);
    },
  });

  const getStatusBadge = (status: string) => {
    if (status === 'ok') {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800" data-testid="badge-status-ok">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Accessible
        </Badge>
      );
    }
    if (status === 'blocked') {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800" data-testid="badge-status-blocked">
          <XCircle className="h-3 w-3 mr-1" />
          Blocked
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800" data-testid={`badge-status-${status}`}>
        <AlertCircle className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const getSiteTypeBadge = (type: string) => {
    const colors = {
      internal: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800",
      external: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-800",
      competitor: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800",
    };
    return (
      <Badge variant="outline" className={colors[type as keyof typeof colors] || colors.internal} data-testid={`badge-site-type-${type}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </Badge>
    );
  };

  const getPageTypeBadge = (type: string | null) => {
    if (!type) return null;
    return (
      <Badge variant="secondary" className="text-xs" data-testid={`badge-page-type-${type}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </Badge>
    );
  };

  const getScoreColor = (score: number) => {
    if (score >= 8.0) return "text-green-600 dark:text-green-500";
    if (score >= 6.0) return "text-amber-600 dark:text-amber-500";
    return "text-red-600 dark:text-red-500";
  };

  // Task #64 — render the most recent xray_analysis run for a site card.
  function LastAnalysisRow({ site }: { site: XRaySite }) {
    const job = site.lastAnalysisJob;
    if (!job) {
      // The standalone xray_analysis job worker only landed in Task #58. Sites
      // first analyzed via the embedded generateMetadata({ enableSiteXRay: true })
      // pipeline have xray_page_analysis rows but no xray_analysis job row, so
      // we'd otherwise mislabel them as "never analyzed". If the site has any
      // analyzed pages, suppress the row entirely (the page count + scores in
      // the card header already communicate that an analysis exists). Only
      // show the empty-state copy when the site truly has zero analyses.
      if (site.pageCount > 0) return null;
      return (
        <p
          className="text-xs text-muted-foreground mt-2"
          data-testid={`text-last-analysis-${site.id}`}
        >
          No X-Ray analysis has been run for this site yet.
        </p>
      );
    }

    const who =
      meUser && job.startedByUserId === meUser.id
        ? "you"
        : job.startedByDisplayName || job.startedByEmail || "another user";

    const when = (() => {
      const ts = job.finishedAt || job.startedAt || job.createdAt;
      return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : "recently";
    })();

    let badge: React.ReactNode;
    let detail: React.ReactNode = null;
    const stop = (e: React.MouseEvent) => e.stopPropagation();

    if (job.status === "queued" || job.status === "running") {
      badge = (
        <Badge
          variant="outline"
          className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800"
          data-testid={`badge-last-analysis-status-${site.id}`}
        >
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          {job.status === "queued" ? "Queued" : `Running${job.progress != null ? ` ${job.progress}%` : ""}`}
        </Badge>
      );
    } else if (job.status === "done") {
      badge = (
        <Badge
          variant="outline"
          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
          data-testid={`badge-last-analysis-status-${site.id}`}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Succeeded
        </Badge>
      );
    } else if (job.status === "completed_with_errors") {
      badge = (
        <Badge
          variant="outline"
          className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800"
          data-testid={`badge-last-analysis-status-${site.id}`}
        >
          <AlertTriangle className="h-3 w-3 mr-1" />
          Finished with warnings
        </Badge>
      );
      if (job.error?.trim()) {
        detail = (
          <p
            className="text-xs text-amber-700 dark:text-amber-400 mt-1"
            data-testid={`text-last-analysis-error-${site.id}`}
            onClick={stop}
          >
            {job.error}
          </p>
        );
      }
    } else if (job.status === "cancelled") {
      badge = (
        <Badge
          variant="outline"
          className="bg-muted text-muted-foreground border-border"
          data-testid={`badge-last-analysis-status-${site.id}`}
        >
          <X className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    } else {
      // error or any unknown terminal status
      badge = (
        <Badge
          variant="outline"
          className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800"
          data-testid={`badge-last-analysis-status-${site.id}`}
        >
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
      if (job.error?.trim()) {
        detail = (
          <p
            className="text-xs text-red-700 dark:text-red-400 mt-1"
            data-testid={`text-last-analysis-error-${site.id}`}
            onClick={stop}
          >
            {job.error}
          </p>
        );
      }
    }

    return (
      <div className="mt-2" data-testid={`row-last-analysis-${site.id}`}>
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <span>Last X-Ray analysis</span>
          {badge}
          <span data-testid={`text-last-analysis-meta-${site.id}`}>
            {when} · started by {who}
          </span>
        </div>
        {detail}
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <ActiveOperationsBanner clientId={selectedClientId} />
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-site-xray">Site X-Ray</h1>
        <p className="text-muted-foreground mt-1">
          Real-time website intelligence from crawled content
        </p>
      </div>

      <div>
        {!selectedClientId ? (
          <Card data-testid="card-no-client">
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-4">
                  Pick a project from the switcher in the top right to view site analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : sitesError ? (
          <RetryCard
            error={sitesError}
            onRetry={() => refetchSites()}
            title="Couldn't load Site X-Ray data"
          />
        ) : isLoadingSites ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" data-testid={`skeleton-site-${i}`} />
            ))}
            <SlowQueryNotice
              loading={isLoadingSites}
              queryKey={[`/api/v1/xray/sites?clientId=${selectedClientId}`]}
              requestId={sitesError instanceof ApiError ? sitesError.requestId : null}
            />
          </div>
        ) : sites.length === 0 ? (
          <Card data-testid="card-no-data">
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  No Site X-Ray data available
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Generate metadata for this client to analyze website content and structure
                </p>
                <Link href="/app/client-config">
                  <a className="text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid="link-client-config">
                    Go to Project Settings
                    <ChevronRight className="h-3 w-3" />
                  </a>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Accordion 
            type="single" 
            collapsible 
            className="space-y-4"
            value={expandedSite}
            onValueChange={setExpandedSite}
          >
            {sites.map((site) => (
              <SiteAccordion key={site.id} site={site} isExpanded={expandedSite === site.id} />
            ))}
          </Accordion>
        )}
      </div>
    </div>
  );

  function SiteAccordion({ site, isExpanded }: { site: XRaySite; isExpanded: boolean }) {
    const [expandedPage, setExpandedPage] = useState<string>("");
    // Task #61: track the batch xray job we just kicked off so we can poll
    // its status and surface success / failure toasts to the user.
    // Task #64: the sites endpoint now exposes the latest xray_analysis
    // job per site (including queued/running ones), so we initialize from
    // there. That covers the "page refresh while a run is in flight" and
    // "teammate started a run" cases without having to peek at the
    // project-level activity feed first.
    const [activeJobId, setActiveJobId] = useState<string | null>(
      site.activeJobId,
    );
    // Remember the job id we last toasted to terminal so we don't
    // re-adopt it on the next sites refetch (the server's
    // site.activeJobId can briefly still point at a job we already saw
    // reach done/error/cancelled before the sites query gets refreshed).
    // Without this guard the adoption effect would re-set activeJobId,
    // the polling effect would see the terminal status again, and the
    // user would get repeat toasts.
    const handledTerminalJobIdRef = useRef<string | null>(null);
    useEffect(() => {
      const incoming = site.activeJobId;
      if (!incoming) return;
      if (activeJobId === incoming) return;
      if (handledTerminalJobIdRef.current === incoming) return;
      setActiveJobId(incoming);
    }, [site.activeJobId, activeJobId]);

    const analyzeMutation = useMutation({
      mutationFn: async () => {
        const response = await apiRequest("POST", "/api/v1/xray/analyze/batch", {
          siteId: site.id,
        });
        return (await response.json()) as { jobId: string; status: string };
      },
      onSuccess: (data) => {
        setActiveJobId(data.jobId);
        invalidateActivityQueries(selectedClientId);
        toast({
          title: "Analysis started",
          description: "Re-analyzing pages for this site. This may take a few minutes.",
        });
      },
      onError: (err) => {
        errorToast("Could not start analysis", err);
      },
    });

    // Task #63: cancel an in-flight batch X-Ray job. The terminal-status
    // toast (above) handles the user-facing "Analysis cancelled" message
    // once polling sees the job flip to `cancelled`.
    const cancelMutation = useMutation({
      mutationFn: async (jobId: string) => {
        const response = await apiRequest(
          "POST",
          `/api/v1/jobs/${jobId}/cancel`,
          {},
        );
        return await response.json();
      },
      onError: (err) => {
        errorToast("Could not cancel analysis", err);
      },
    });

    // Poll the job we just started until it reaches a terminal status.
    const { data: activeJob, error: activeJobError } = useQuery<{
      id: string;
      status: string;
      error: string | null;
      progress: number | null;
    }>({
      queryKey: ["/api/v1/jobs", activeJobId],
      enabled: !!activeJobId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status) return 2000;
        if (status === "done" || status === "error" || status === "cancelled" || status === "completed_with_errors") {
          return false;
        }
        return 2000;
      },
    });

    useEffect(() => {
      if (!activeJob || !activeJobId) return;
      if (activeJob.status === "done" || activeJob.status === "completed_with_errors") {
        toast({
          title: activeJob.status === "completed_with_errors" ? "Analysis finished with warnings" : "Analysis complete",
          description:
            activeJob.status === "completed_with_errors"
              ? "Some pages could not be fully analyzed. Refreshed results below."
              : "Site X-Ray analysis finished successfully.",
        });
        // Refresh the X-Ray data so new analyses appear.
        queryClient.invalidateQueries({ queryKey: [`/api/v1/xray/sites?clientId=${selectedClientId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/v1/xray/sites/${site.id}/pages`] });
        invalidateActivityQueries(selectedClientId);
        handledTerminalJobIdRef.current = activeJobId;
        setActiveJobId(null);
      } else if (activeJob.status === "error" || activeJob.status === "cancelled") {
        const fallback =
          activeJob.status === "cancelled"
            ? "The X-Ray analysis was cancelled before it finished."
            : "The X-Ray analysis did not complete. Please try again or contact support if this keeps happening.";
        errorToast(
          activeJob.status === "cancelled" ? "Analysis cancelled" : "Analysis failed",
          new Error(activeJob.error?.trim() || fallback),
        );
        invalidateActivityQueries(selectedClientId);
        handledTerminalJobIdRef.current = activeJobId;
        setActiveJobId(null);
      }
    }, [activeJob?.status, activeJob?.error, activeJobId, site.id, selectedClientId, toast]);

    // If polling itself fails (network/API), tell the user instead of silently spinning forever.
    useEffect(() => {
      if (!activeJobId || !activeJobError) return;
      errorToast("Lost connection to analysis", activeJobError);
      setActiveJobId(null);
    }, [activeJobError, activeJobId, errorToast]);

    const analysisRunning =
      analyzeMutation.isPending ||
      (!!activeJob &&
        activeJob.status !== "done" &&
        activeJob.status !== "error" &&
        activeJob.status !== "cancelled" &&
        activeJob.status !== "completed_with_errors");
    const analyzeDisabled = analysisRunning || siteXrayActive;
    const analyzeLabel = analyzeMutation.isPending
      ? "Starting…"
      : analysisRunning
        ? activeJob?.progress != null
          ? `Analyzing… ${activeJob.progress}%`
          : "Analyzing…"
        : siteXrayActive
          ? "Already running…"
          : "Re-analyze pages";

    return (
      <AccordionItem
        value={site.id}
        className="border rounded-lg bg-card"
        data-testid={`accordion-site-${site.id}`}
      >
        <AccordionTrigger className="px-6 py-4 hover:no-underline" data-testid={`trigger-site-${site.id}`}>
          <div className="flex items-start justify-between w-full pr-4">
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Globe className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                <p className="text-base font-semibold" data-testid={`text-domain-${site.id}`}>{site.domain}</p>
                {getSiteTypeBadge(site.siteType)}
                {getStatusBadge(site.crawlStatus)}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span data-testid={`text-page-count-${site.id}`}>{site.pageCount} pages</span>
                <span className="text-amber-600" data-testid={`text-issue-count-${site.id}`}>
                  {site.totalIssues} issue{site.totalIssues !== 1 ? 's' : ''}
                </span>
                <span className="text-green-600" data-testid={`text-recommendation-count-${site.id}`}>
                  {site.totalRecommendations} recommendation{site.totalRecommendations !== 1 ? 's' : ''}
                </span>
              </div>
              {/* Task #64: surface the most recent xray_analysis run for
                  this site so users can tell whether the data below is
                  fresh, stale, or from a failed attempt without expanding
                  the card or kicking off a new run. */}
              <LastAnalysisRow site={site} />
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <div className="space-y-6 pt-2">
            {/* Site Health Overview */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Site Health</h4>
                <div className="flex items-center gap-2">
                  {site.lastProbedAt && (
                    <span className="text-xs text-muted-foreground" data-testid={`text-last-checked-${site.id}`}>
                      Checked {formatDistanceToNow(new Date(site.lastProbedAt))} ago
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      refreshHealthMutation.mutate(site.id);
                    }}
                    disabled={refreshHealthMutation.isPending || siteXrayActive}
                    data-testid={`button-refresh-health-${site.id}`}
                    title={xrayTooltip}
                  >
                    <RefreshCw className={`h-3 w-3 ${(refreshHealthMutation.isPending || siteXrayActive) ? 'animate-spin' : ''}`} />
                    <span className="ml-1">{siteXrayActive ? 'Already running…' : 'Refresh'}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      analyzeMutation.mutate();
                    }}
                    disabled={analyzeDisabled}
                    data-testid={`button-analyze-site-${site.id}`}
                    title={xrayTooltip}
                  >
                    {analysisRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    <span className="ml-1">{analyzeLabel}</span>
                  </Button>
                  {analysisRunning && activeJobId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelMutation.mutate(activeJobId);
                      }}
                      disabled={cancelMutation.isPending}
                      data-testid={`button-cancel-analysis-${site.id}`}
                      title="Cancel the running analysis"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      <span className="ml-1">
                        {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
              <div className="bg-muted/30 border border-border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {/* Robots.txt Status */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {site.robotsTxt ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
                      )}
                      <span className="text-xs font-medium" data-testid={`text-robots-${site.id}`}>Robots.txt</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {site.robotsTxt 
                        ? 'File found. Helps search engines index your site properly.'
                        : 'Not found. May affect search engine visibility.'}
                    </p>
                  </div>
                  
                  {/* AI.txt Status */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {site.aiTxt ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
                      )}
                      <span className="text-xs font-medium" data-testid={`text-aitxt-${site.id}`}>AI.txt</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {site.aiTxt 
                        ? 'File found. Controls which AI models can access your content.'
                        : 'Not found. Consider adding to manage AI bot access.'}
                    </p>
                  </div>
                  
                  {/* Crawl Access Status */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusBadge(site.crawlStatus)}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {site.crawlStatus === 'ok' && 'Site accessible to crawlers. No bot protection detected.'}
                      {site.crawlStatus === 'blocked' && 'Bot protection detected. Used advanced browser crawling to analyze your site.'}
                      {site.crawlStatus === 'captcha' && 'CAPTCHA protection active. Used browser-based crawling to collect data successfully.'}
                      {site.crawlStatus === 'rate_limited' && 'Rate limiting detected. Adjusted crawling speed to gather data successfully.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pages List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Pages ({site.pageCount})</h4>
              {isExpanded && (
                <PagesAccordion 
                  siteId={site.id} 
                  expandedPage={expandedPage}
                  setExpandedPage={setExpandedPage}
                />
              )}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  function PagesAccordion({ 
    siteId, 
    expandedPage, 
    setExpandedPage 
  }: { 
    siteId: string; 
    expandedPage: string;
    setExpandedPage: (id: string) => void;
  }) {
    const { data: pages = [], isLoading: isLoadingPages, error: pagesError, refetch: refetchPages } = useQuery<XRayPage[]>({
      queryKey: [`/api/v1/xray/sites/${siteId}/pages`],
      enabled: true, // Loads when parent site accordion expands
    });

    if (isLoadingPages) {
      return (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" data-testid={`skeleton-page-${i}`} />
          ))}
        </div>
      );
    }

    if (pagesError) {
      return (
        <div className="bg-muted/30 border border-border rounded-lg" data-testid="card-pages-error">
          <ErrorState
            error={pagesError}
            onRetry={() => refetchPages()}
            title="Couldn't load pages"
            compact
          />
        </div>
      );
    }

    if (pages.length === 0) {
      return (
        <div className="text-center py-6 bg-muted/30 border border-border rounded-lg" data-testid="card-no-pages">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">
            No pages analyzed for this site
          </p>
        </div>
      );
    }

    return (
      <Accordion 
        type="single" 
        collapsible 
        className="space-y-2"
        value={expandedPage}
        onValueChange={setExpandedPage}
      >
        {pages.map((page) => (
          <PageAccordion key={page.id} page={page} isExpanded={expandedPage === page.id} />
        ))}
      </Accordion>
    );
  }

  function PageAccordion({ page, isExpanded }: { page: XRayPage; isExpanded: boolean }) {
    return (
      <AccordionItem
        value={page.id}
        className="border rounded-md"
        data-testid={`accordion-page-${page.id}`}
      >
        <AccordionTrigger className="px-4 py-3 hover:no-underline" data-testid={`trigger-page-${page.id}`}>
          <div className="flex items-start justify-between w-full pr-4">
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="text-sm font-medium line-clamp-1" data-testid={`text-url-${page.id}`}>{page.url}</p>
                {getPageTypeBadge(page.pageType)}
              </div>
              {page.title && (
                <p className="text-xs text-muted-foreground line-clamp-1 mb-1" data-testid={`text-title-${page.id}`}>
                  {page.title}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs flex-wrap">
                {page.wordCount && (
                  <span className="text-muted-foreground" data-testid={`text-word-count-${page.id}`}>
                    {page.wordCount} words
                  </span>
                )}
                <span className="text-orange-600 dark:text-orange-400" data-testid={`text-issue-count-${page.id}`}>
                  {page.issueCount} issues
                </span>
                <span className="text-blue-600 dark:text-blue-400" data-testid={`text-recommendation-count-${page.id}`}>
                  {page.recommendationCount} recommendations
                </span>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          {isExpanded && <PageDetails pageId={page.id} />}
        </AccordionContent>
      </AccordionItem>
    );
  }

  function PageDetails({ pageId }: { pageId: string }) {
    const { data: pageData, isLoading, error } = useQuery({
      queryKey: [`/api/v1/xray/pages/${pageId}`],
      enabled: true, // Loads when parent page accordion expands
    });

    if (isLoading) {
      return (
        <div className="space-y-3 pt-2">
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-32 rounded-md" />
          <Skeleton className="h-24 rounded-md" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-6" data-testid="card-page-details-error">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
          <p className="text-xs text-muted-foreground">
            Failed to load page details
          </p>
        </div>
      );
    }

    const structure = (pageData as any)?.structure as PageStructure | undefined;
    const analysis = (pageData as any)?.analysis as PageAnalysis | undefined;

    return (
      <div className="space-y-4 pt-2">
        {/* AI Analysis */}
        {analysis && (
          <div className="space-y-3">
            {/* Quality Assessment */}
            {analysis.qualityAssessment && (
              <div>
                <h5 className="text-xs font-semibold mb-2 flex items-center gap-1">
                  <Lightbulb className="h-3 w-3" />
                  Quality Assessment
                </h5>
                <div className="bg-muted/30 border border-border rounded-md p-3">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap" data-testid={`text-quality-${pageId}`}>
                    {analysis.qualityAssessment}
                  </p>
                </div>
              </div>
            )}

            {/* Issues & Recommendations - Always Expanded */}
            {((analysis.seoIssues && analysis.seoIssues.length > 0) || 
              (analysis.contentGaps && analysis.contentGaps.length > 0) || 
              (analysis.recommendations && analysis.recommendations.length > 0)) && (
              <div className="space-y-3" data-testid={`section-issues-${pageId}`}>
                  {/* SEO Issues */}
                  {analysis.seoIssues && analysis.seoIssues.length > 0 && (
                    <div>
                      <h5 className="text-xs font-semibold mb-2 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-amber-600" />
                        SEO Issues ({analysis.seoIssues.length})
                      </h5>
                      <div className="bg-background/50 border border-border rounded-md p-3">
                        <ul className="space-y-2" data-testid={`list-seo-issues-${pageId}`}>
                          {analysis.seoIssues.map((item, idx) => (
                            <li key={idx} className="text-xs">
                              <div className="flex gap-2 items-start">
                                <span className="text-amber-600">•</span>
                                <div className="flex-1">
                                  <p className="text-muted-foreground font-medium">{typeof item === 'string' ? item : item.issue}</p>
                                  {typeof item === 'object' && item.fix && (
                                    <p className="text-green-600 mt-1">Fix: {item.fix}</p>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Content Gaps */}
                  {analysis.contentGaps && analysis.contentGaps.length > 0 && (
                    <div>
                      <h5 className="text-xs font-semibold mb-2 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 text-blue-600" />
                        Content Gaps ({analysis.contentGaps.length})
                      </h5>
                      <div className="bg-background/50 border border-border rounded-md p-3">
                        <ul className="space-y-1" data-testid={`list-content-gaps-${pageId}`}>
                          {analysis.contentGaps.map((gap, idx) => (
                            <li key={idx} className="text-xs text-muted-foreground flex gap-2">
                              <span className="text-blue-600">•</span>
                              <span className="flex-1">{gap}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {analysis.recommendations && analysis.recommendations.length > 0 && (
                    <div>
                      <h5 className="text-xs font-semibold mb-2 flex items-center gap-1">
                        <ListChecks className="h-3 w-3 text-green-600" />
                        Recommendations ({analysis.recommendations.length})
                      </h5>
                      <div className="bg-background/50 border border-border rounded-md p-3">
                        <ol className="space-y-2" data-testid={`list-recommendations-${pageId}`}>
                          {analysis.recommendations.map((item, idx) => (
                            <li key={idx} className="text-xs">
                              <div className="flex gap-2 items-start">
                                <span className="text-green-600 font-medium">{idx + 1}.</span>
                                <div className="flex-1">
                                  <p className="text-muted-foreground font-medium">{typeof item === 'string' ? item : item.action}</p>
                                  {typeof item === 'object' && item.rationale && (
                                    <p className="text-muted-foreground/70 mt-1 text-[11px]">{item.rationale}</p>
                                  )}
                                  {typeof item === 'object' && (item.effort || item.impact) && (
                                    <div className="flex gap-2 mt-1">
                                      {item.effort && <span className="text-blue-600 text-[11px]">Effort: {item.effort}</span>}
                                      {item.impact && <span className="text-purple-600 text-[11px]">Impact: {item.impact}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

      </div>
    );
  }
}
