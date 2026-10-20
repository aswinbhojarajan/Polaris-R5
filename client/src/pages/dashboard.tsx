import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SlowQueryNotice } from "@/components/feedback/SlowQueryNotice";
import { RetryCard } from "@/components/feedback/RetryCard";
import { ApiError, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow, format } from "date-fns";
import { Plus, Eye, Quote, TrendingUp, Info } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getScoreColor, getScoreBgColor } from "@/lib/score-config";
import { RunFilterBar } from "@/components/RunFilterBar";
import { ComparisonTable } from "@/components/ComparisonTable";
import { useSelectedClientId, useUrlClientId } from "@/hooks/use-selected-client-id";
import { ActiveOperationsBanner } from "@/components/activity/active-operations-banner";

interface DashboardStats {
  totalPrompts: number;
  avgVisibilityScore: number;
  avgSentimentScore: number;
  avgPositionScore: number;
  totalCitations: number;
  activeModels: number;
  totalRuns: number;
  completedRuns: number;
}

interface CompetitorRanking {
  id: string;
  name: string;
  competitorId: string | null;
  isClient: boolean;
  visibilityScore: number;
  sentimentScore: number;
  positionScore: string;
  overallScore: string;
  rank: number;
}

interface HistoricalScore {
  runId: string;
  runName: string;
  createdAt: string;
  avgVisibilityScore: number;
  avgSentimentScore: number;
  avgPositionScore: number;
  totalCitations: number;
}

export default function Dashboard() {
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = urlClientId || storedClientId;
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  // Check for active prompt runs to determine if we should auto-refresh
  const { data: promptRunPage } = useQuery<{ runs: any[]; total: number }>({
    queryKey: ["/api/v1/prompt-runs", selectedClientId],
    queryFn: async () => {
      // Only the newest page is needed here (active-run detection); the
      // endpoint is paginated server-side.
      const response = await fetch("/api/v1/prompt-runs?limit=50", {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch prompt runs");
      return response.json();
    },
    enabled: !!selectedClientId,
    refetchInterval: 3000, // Check for active runs every 3 seconds
  });
  const promptRuns = promptRunPage?.runs ?? [];

  // Determine if there are active runs (queued or running)
  const hasActiveRuns = promptRuns.some(
    (run: any) => run.status === "queued" || run.status === "running",
  );

  const { data: stats, isLoading: isLoadingStats, isError: isErrorStats, error: errorStats, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ["/api/v1/dashboard/stats", selectedClientId],
    queryFn: async () => {
      const response = await fetch("/api/v1/dashboard/stats", {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch dashboard stats");
      return response.json();
    },
    enabled: !!selectedClientId,
  });

  const { data: historicalScores = [], isLoading: isLoadingHistory, isError: isErrorHistory, error: errorHistory, refetch: refetchHistory } = useQuery<
    HistoricalScore[]
  >({
    queryKey: [
      "/api/v1/dashboard/historical-scores",
      selectedClientId,
      showAllRuns ? 100 : 5,
      selectedRunIds, // Include in cache key
    ],
    queryFn: async () => {
      const params = new URLSearchParams();

      // Determine limit based on selection mode
      let limit: number;
      if (selectedRunIds.length > 1) {
        // Multi-run aggregation: need all selected runs (plus padding for safety)
        limit = Math.max(selectedRunIds.length + 10, 100);
        params.set("runIds", selectedRunIds.join(","));
      } else if (selectedRunIds.length === 1) {
        // Single-run: always fetch all runs (up to 1000) to ensure we have the selected run + previous
        // Don't filter by runIds - we need the full dataset to compare against previous run
        limit = 1000;
      } else {
        // Default view: just need recent runs
        limit = showAllRuns ? 1000 : 5;
      }

      params.set("limit", limit.toString());

      const response = await fetch(
        `/api/v1/dashboard/historical-scores?${params.toString()}`,
        {
          headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        },
      );
      if (!response.ok) throw new Error("Failed to fetch historical scores");
      const data = await response.json();

      // Defensive checks
      if (selectedRunIds.length > 1) {
        // Multi-run: verify we got all selected runs for accurate aggregation
        const returnedRunIds = new Set(data.map((run: any) => run.runId));
        const missingRuns = selectedRunIds.filter(
          (id) => !returnedRunIds.has(id),
        );
        if (missingRuns.length > 0) {
          console.error(
            `ERROR: Missing ${missingRuns.length} selected runs from API response. This will produce incorrect aggregated data.`,
          );
          console.error("Missing run IDs:", missingRuns);
        }
      } else if (selectedRunIds.length === 1) {
        // Single-run: verify the selected run exists in the dataset
        const selectedRunExists = data.some(
          (run: any) => run.runId === selectedRunIds[0],
        );
        if (!selectedRunExists) {
          console.error(
            `ERROR: Selected run ${selectedRunIds[0]} not found in historical scores. Falling back to latest run.`,
          );
        }
      }

      return data;
    },
    enabled: !!selectedClientId,
    refetchInterval: hasActiveRuns ? 3000 : false, // Only refresh when runs are active
  });

  const { data: competitorRankings = [], isLoading: isLoadingRankings, isError: isErrorRankings, error: errorRankings, refetch: refetchRankings } =
    useQuery<CompetitorRanking[]>({
      queryKey: [
        "/api/v1/dashboard/competitor-rankings",
        selectedClientId,
        selectedRunIds,
      ],
      queryFn: async () => {
        const params = new URLSearchParams();

        // Filter competitor rankings for any run selection (single or multi)
        // This ensures the table shows data for the selected run(s) only
        if (selectedRunIds.length > 0) {
          params.set("runIds", selectedRunIds.join(","));
        }

        const url = params.toString()
          ? `/api/v1/dashboard/competitor-rankings?${params.toString()}`
          : "/api/v1/dashboard/competitor-rankings";

        const response = await fetch(url, {
          headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
        });
        if (!response.ok)
          throw new Error("Failed to fetch competitor rankings");
        return response.json();
      },
      enabled: !!selectedClientId,
      refetchInterval: hasActiveRuns ? 3000 : false, // Only refresh when runs are active
    });

  if (!selectedClientId) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            No Project Selected
          </h2>
          <p className="text-muted-foreground">
            Pick a project from the switcher in the top right to view the dashboard.
          </p>
        </div>
      </div>
    );
  }

  const isLoading = isLoadingStats || isLoadingHistory || isLoadingRankings;
  const firstError = errorStats || errorHistory || errorRankings;
  const lastRequestId =
    firstError instanceof ApiError ? firstError.requestId : null;
  const hasError = isErrorStats || isErrorHistory || isErrorRankings;

  if (hasError) {
    return (
      <div className="p-6">
        <RetryCard
          error={firstError}
          onRetry={() => {
            if (isErrorStats) refetchStats();
            if (isErrorHistory) refetchHistory();
            if (isErrorRankings) refetchRankings();
          }}
          title="Couldn't load dashboard"
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="loading-skeleton h-8 w-64 mb-6 rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="loading-skeleton h-24 rounded-lg"></div>
          ))}
        </div>
        <SlowQueryNotice
          loading={isLoading}
          requestId={lastRequestId}
          onCancel={() => {
            void queryClient.cancelQueries({ queryKey: ["/api/v1/dashboard/stats", selectedClientId] });
            void queryClient.cancelQueries({ queryKey: ["/api/v1/dashboard/historical-scores", selectedClientId] });
            void queryClient.cancelQueries({ queryKey: ["/api/v1/dashboard/competitor-rankings", selectedClientId] });
          }}
        />
      </div>
    );
  }

  // Historical scores are already sorted DESC (newest first) from the backend
  const isMultiRunView = selectedRunIds.length > 1;

  // For multi-run view, ensure we only use the selected runs (defensive filtering)
  const selectedHistoricalScores = isMultiRunView
    ? historicalScores.filter((run) => selectedRunIds.includes(run.runId))
    : historicalScores;

  // For single-run selection, find the selected run and the one before it
  const isSingleRunView = selectedRunIds.length === 1;
  const selectedRunIndex = isSingleRunView
    ? historicalScores.findIndex((run) => run.runId === selectedRunIds[0])
    : -1;

  // Fallback to latest run if selected run not found (safety)
  const latestRun =
    isSingleRunView && selectedRunIndex >= 0
      ? historicalScores[selectedRunIndex]
      : selectedHistoricalScores[0];

  const previousRun =
    isSingleRunView && selectedRunIndex >= 0
      ? historicalScores[selectedRunIndex + 1]
      : historicalScores[1];

  const visibilityScore =
    isMultiRunView && selectedHistoricalScores.length > 0
      ? selectedHistoricalScores.reduce(
          (sum, run) => sum + (run.avgVisibilityScore || 0),
          0,
        ) / selectedHistoricalScores.length
      : latestRun?.avgVisibilityScore || 0;

  const sentimentScore =
    isMultiRunView && selectedHistoricalScores.length > 0
      ? selectedHistoricalScores.reduce(
          (sum, run) => sum + (run.avgSentimentScore || 0),
          0,
        ) / selectedHistoricalScores.length
      : latestRun?.avgSentimentScore || 0;

  const positionScore =
    isMultiRunView && selectedHistoricalScores.length > 0
      ? selectedHistoricalScores.reduce(
          (sum, run) => sum + (run.avgPositionScore || 0),
          0,
        ) / selectedHistoricalScores.length
      : latestRun?.avgPositionScore || 0;

  const totalCitations =
    isMultiRunView && selectedHistoricalScores.length > 0
      ? selectedHistoricalScores.reduce(
          (sum, run) => sum + (run.totalCitations || 0),
          0,
        )
      : latestRun?.totalCitations || 0;

  const getChangeIndicator = (
    current: number,
    previous: number | undefined,
  ) => {
    // Don't show change indicators for multi-run aggregated views
    if (isMultiRunView) return null;

    if (previous === undefined) return null;
    const change = current - previous;
    if (Math.abs(change) < 0.1) return null;

    // Calculate percentage change
    const percentChange = previous !== 0 ? (change / previous) * 100 : 0;

    return {
      value: Math.abs(change).toFixed(1),
      percent: Math.abs(percentChange).toFixed(1),
      isPositive: change >= 0,
    };
  };

  // Determine subtitle text based on selection
  const getSubtitleText = () => {
    if (selectedRunIds.length === 0) {
      return "Stats below show the latest run compared to the previous run by default";
    } else if (selectedRunIds.length === 1) {
      const runName = latestRun?.runName || "selected run";
      return `Showing data for ${runName}`;
    } else {
      return `Showing aggregated data across ${selectedRunIds.length} selected runs`;
    }
  };

  const statCards = [
    {
      title: "Visibility Score",
      value: visibilityScore,
      change: getChangeIndicator(
        visibilityScore,
        previousRun?.avgVisibilityScore,
      ),
      icon: Eye,
      color: getScoreColor(visibilityScore),
      bgColor: getScoreBgColor(visibilityScore),
      description: "Visibility measures how frequently your brand appears in AI-generated responses. A higher score indicates stronger brand presence and recall across AI models, with mentions appearing in both content body and prominent heading positions.",
    },
    {
      title: "Sentiment Score",
      value: sentimentScore,
      change: getChangeIndicator(
        sentimentScore,
        previousRun?.avgSentimentScore,
      ),
      icon: TrendingUp,
      color: getScoreColor(sentimentScore),
      bgColor: getScoreBgColor(sentimentScore),
      description: "Sentiment evaluates the tone and context of brand mentions in AI responses. This score reflects whether your brand is portrayed positively, neutrally, or negatively, helping you understand how AI models perceive and communicate about your brand.",
    },
    {
      title: "Position Score",
      value: positionScore,
      change: getChangeIndicator(positionScore, previousRun?.avgPositionScore),
      icon: TrendingUp,
      color: getScoreColor(positionScore),
      bgColor: getScoreBgColor(positionScore),
      description: "Position tracks your brand's ranking in AI-generated lists and recommendations. A higher score means your brand consistently appears in top positions when AI models provide comparative recommendations or rankings.",
    },
    {
      title: "Total Citations",
      value: totalCitations,
      change: getChangeIndicator(totalCitations, previousRun?.totalCitations),
      icon: Quote,
      color: "text-gray-900 dark:text-gray-100",
      bgColor: "bg-purple-600",
      description: "Total Citations counts the number of external sources and references that AI models cite when discussing your brand. More citations indicate stronger evidence-based mentions and authoritative presence.",
    },
  ];

  return (
    <div className="fade-in">
      <div className="page-content pt-4">
        <ActiveOperationsBanner clientId={selectedClientId} />
      </div>
      {/* Header with Filter */}
      <div className="page-content border-b border-border bg-card pb-3">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
              Dashboard Overview
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Brand visibility insights
            </p>
            <p className="text-xs text-muted-foreground/80 mt-0.5 italic">
              {getSubtitleText()}
            </p>
          </div>

          <div className="lg:min-w-[400px]">
            <RunFilterBar
              selectedClientId={selectedClientId}
              selectedRunIds={selectedRunIds}
              onRunSelect={setSelectedRunIds}
            />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="page-content pt-3 pb-2 stats-grid">
        {statCards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card
              key={index}
              data-testid={`stat-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-muted-foreground">
                        {stat.title}
                      </p>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help hover:text-muted-foreground" data-testid={`info-${stat.title.toLowerCase().replace(/\s+/g, "-")}`} />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs bg-white dark:bg-gray-900 border border-border shadow-lg">
                            <p className="text-sm text-foreground">{stat.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className={`text-2xl font-bold mt-1 ${stat.color}`}>
                      <span>{typeof stat.value === "number" && stat.value % 1 !== 0
                        ? stat.value.toFixed(1)
                        : stat.value.toLocaleString()}</span>{stat.title.includes("Score") && (
                        <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                      )}
                    </p>
                    {stat.change && (
                      <p
                        className={`text-xs font-medium mt-1 ${stat.change.isPositive ? "text-green-600" : "text-red-600"}`}
                      >
                        {stat.change.isPositive ? "↑" : "↓"} {stat.change.value}{" "}
                        ({stat.change.percent}%) from last run
                      </p>
                    )}
                  </div>
                  <div
                    className={`w-10 h-10 ${stat.bgColor}/10 rounded-lg flex items-center justify-center`}
                  >
                    <Icon className={`${stat.color} h-5 w-5`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Score Trends - Full Width */}
      <div className="page-content pt-2 pb-2">
        <Card>
          <CardHeader className="pb-2 pt-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Score Trends</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Historical performance across prompt runs
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllRuns(!showAllRuns)}
                data-testid="button-toggle-runs"
                className="w-full sm:w-auto"
              >
                {showAllRuns ? "Show Last 5" : "Show All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {historicalScores.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No completed runs yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Complete your first prompt run to see score trends
                </p>
              </div>
            ) : (
              <div className="chart-responsive">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={[...historicalScores]
                      .reverse()
                      .map((score: HistoricalScore) => ({
                        name: score.runName,
                        Visibility: Number(score.avgVisibilityScore.toFixed(1)),
                        Sentiment: Number(score.avgSentimentScore.toFixed(1)),
                        Position: Number(score.avgPositionScore.toFixed(1)),
                      }))}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <RechartsTooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="Visibility"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "#8b5cf6" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Sentiment"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "#10b981" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Position"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "#3b82f6" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Competitor Rankings - Responsive Table */}
      <div className="page-content pt-2 pb-4">
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-base">Competitor Rankings</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest overall performance comparison
            </p>
          </CardHeader>
          <CardContent>
            {competitorRankings.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No competitor data yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Complete a prompt run to see competitor rankings
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                {/* Desktop Table */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Rank</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Visibility</TableHead>
                      <TableHead className="text-right">Sentiment</TableHead>
                      <TableHead className="text-right">Position</TableHead>
                      <TableHead className="text-right">Overall</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {competitorRankings.map((comp) => (
                      <TableRow
                        key={comp.id}
                        className={comp.isClient ? "bg-primary/5" : ""}
                        data-testid={`competitor-${comp.rank}`}
                      >
                        <TableCell className="font-bold text-lg">
                          #{comp.rank}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{comp.name}</span>
                            {comp.isClient && (
                              <Badge variant="default" className="text-xs">
                                You
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={`text-right font-medium ${getScoreColor(comp.visibilityScore)}`}>
                          {comp.visibilityScore.toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${getScoreColor(comp.sentimentScore)}`}>
                          {comp.sentimentScore.toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${getScoreColor(parseFloat(comp.positionScore))}`}>
                          {parseFloat(comp.positionScore).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-gray-900 dark:text-gray-100 text-lg">
                          {parseFloat(comp.overallScore).toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Mobile Card View */}
                <div className="table-card-mobile space-y-3">
                  {competitorRankings.map((comp) => (
                    <div
                      key={comp.id}
                      className={`mobile-table-card ${comp.isClient ? "border-primary" : ""}`}
                      data-testid={`competitor-${comp.rank}-mobile`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-primary">
                            #{comp.rank}
                          </span>
                          <div>
                            <span className="font-medium text-base">
                              {comp.name}
                            </span>
                            {comp.isClient && (
                              <Badge variant="default" className="text-xs ml-2">
                                You
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="mobile-table-row">
                          <span className="mobile-table-label">Visibility</span>
                          <span className={`mobile-table-value font-medium ${getScoreColor(comp.visibilityScore)}`}>
                            {comp.visibilityScore.toFixed(1)}
                          </span>
                        </div>
                        <div className="mobile-table-row">
                          <span className="mobile-table-label">Sentiment</span>
                          <span className={`mobile-table-value font-medium ${getScoreColor(comp.sentimentScore)}`}>
                            {comp.sentimentScore.toFixed(1)}
                          </span>
                        </div>
                        <div className="mobile-table-row">
                          <span className="mobile-table-label">Position</span>
                          <span className={`mobile-table-value font-medium ${getScoreColor(parseFloat(comp.positionScore))}`}>
                            {parseFloat(comp.positionScore).toFixed(1)}
                          </span>
                        </div>
                        <div className="mobile-table-row">
                          <span className="mobile-table-label">Overall</span>
                          <span className="mobile-table-value font-bold text-gray-900 dark:text-gray-100 text-lg">
                            {parseFloat(comp.overallScore).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Run Comparison Section - Only shows when 2+ runs selected */}
      {selectedRunIds.length > 1 && selectedHistoricalScores.length > 1 && (
        <div className="page-content pt-0">
          <ComparisonTable runs={selectedHistoricalScores} />
        </div>
      )}
    </div>
  );
}
