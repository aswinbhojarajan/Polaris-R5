import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Check,
  Clock,
  FileText,
  TrendingUp,
  Award,
  MessageSquare,
  ExternalLink,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronRight,
  Copy,
  Loader2,
  RefreshCw,
  AlertCircle,
  Info,
  ListOrdered,
  Link2,
  Eye,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useScoreColor } from "@/hooks/use-score-color";

import { queryClient } from "@/lib/queryClient";
import { useSelectedClientId } from "@/hooks/use-selected-client-id";

const METRIC_DESCRIPTIONS = {
  Visibility: "Visibility measures how frequently your brand appears in AI-generated responses. A higher score indicates stronger brand presence and recall across AI models, with mentions appearing in both content body and prominent heading positions.",
  Sentiment: "Sentiment evaluates the tone and context of brand mentions in AI responses. This score reflects whether your brand is portrayed positively, neutrally, or negatively, helping you understand how AI models perceive and communicate about your brand.",
  Position: "Position tracks your brand's ranking in AI-generated lists and recommendations. A higher score means your brand consistently appears in top positions when AI models provide comparative recommendations or rankings.",
};

interface RunDetailsSectionProps {
  runId: string | null;
  onBack: () => void;
}

export function RunDetailsSection({ runId, onBack }: RunDetailsSectionProps) {
  const selectedClientId = useSelectedClientId();
  const [expandedPrompts, setExpandedPrompts] = useState<string[]>([]);
  const [expandedModels, setExpandedModels] = useState<
    Record<number, string[]>
  >({});
  const [isAllExpanded, setIsAllExpanded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [expandedCollapsibles, setExpandedCollapsibles] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const { getColor: getVisibilityColor } = useScoreColor("Visibility");
  const { getColor: getSentimentColor } = useScoreColor("Sentiment");
  const { getColor: getPositionColor } = useScoreColor("Position");

  const formatDelta = (delta: number) => {
    if (Math.abs(delta) < 0.1) return "±0.0";
    return delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  };

  const getDeltaColor = (delta: number) => {
    if (Math.abs(delta) < 0.1) return "text-muted-foreground";
    if (delta > 0) return "text-green-600 dark:text-green-500";
    return "text-red-600 dark:text-red-500";
  };

  const getScoreLevel = (score: number): string => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Average";
    if (score >= 20) return "Below Average";
    return "Poor";
  };

  const handleExportFullReport = async () => {
    if (!runId || !selectedClientId || !results.length) return;

    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/v1/prompt-runs/${runId}/benchmarks-bulk?clientId=${selectedClientId}`,
        { headers: { "X-Client-Id": selectedClientId } },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch benchmark data");
      }

      const benchmarkData = await response.json();
      const promptGroups = groupByPrompt();

      let exportText = `POLARIS AI - FULL EXPORT REPORT\n`;
      exportText += `Run ID: ${runId?.substring(0, 8)}\n`;
      exportText += `Export Date: ${new Date().toLocaleString()}\n`;
      exportText += `Total Prompts: ${promptGroups.length}\n`;
      exportText += `\n${"═".repeat(60)}\n\n`;

      promptGroups.forEach((group: any, index: number) => {
        const promptId = group.prompt.id;
        const overallScores = calculatePromptScores(group.results);
        const benchmark = benchmarkData.benchmarks?.[promptId];

        exportText += `${"═".repeat(60)}\n`;
        exportText += `PROMPT #${index + 1}: ${group.prompt.text}\n`;
        exportText += `${"═".repeat(60)}\n\n`;

        exportText += `── OVERALL PERFORMANCE (Prompt Level) ──────────────\n\n`;

        const metrics = [
          {
            name: "VISIBILITY",
            score: overallScores.visibility,
            key: "visibility",
          },
          {
            name: "SENTIMENT",
            score: overallScores.sentiment,
            key: "sentiment",
          },
          { name: "POSITION", score: overallScores.position, key: "position" },
        ];

        metrics.forEach(({ name, score, key }) => {
          const level = getScoreLevel(score);
          exportText += `${name}: ${score.toFixed(1)} (${level})\n`;
          exportText += `Interpretation: ${benchmarkData.metricDescriptions?.[key] || "N/A"}\n`;

          if (benchmark?.entities?.length > 0) {
            const summary = benchmark.summary?.[key];
            if (summary) {
              exportText += `\nBenchmark vs Competitors:\n`;
              exportText += `| Company | Score | Delta |\n`;
              exportText += `|---------|-------|-------|\n`;

              benchmark.entities
                .sort(
                  (a: any, b: any) =>
                    (Number(b[`${key}Score`]) || 0) -
                    (Number(a[`${key}Score`]) || 0),
                )
                .forEach((entity: any) => {
                  const entityScore = Number(entity[`${key}Score`]) || 0;
                  const delta = entity.isClient
                    ? "-"
                    : formatDelta(entityScore - score);
                  const marker = entity.isClient ? " (You)" : "";
                  exportText += `| ${entity.name || "Unknown"}${marker} | ${entityScore.toFixed(1)} | ${delta} |\n`;
                });

              const avgScore = Number(summary.avg) || 0;
              exportText += `| Average | ${avgScore.toFixed(1)} | ${formatDelta(score - avgScore)} |\n`;
            }
          }
          exportText += `\n`;
        });

        exportText += `── RESULTS BY AI MODEL ─────────────────────────────\n\n`;

        const rankedResults = getRankedModelResults(group.results);
        rankedResults.forEach((result: any, modelIndex: number) => {
          const answer = result.answer || {};
          const model = result.model || {};

          exportText += `### #${result.rank || modelIndex + 1} ${model.displayName || "Unknown Model"}\n`;
          exportText += `Scores: V: ${(Number(answer.visibilityScore) || 0).toFixed(1)} | `;
          exportText += `S: ${(Number(answer.sentimentScore) || 0).toFixed(1)} | `;
          exportText += `P: ${(Number(answer.positionScore) || 0).toFixed(1)}\n\n`;

          exportText += `FULL RESPONSE:\n${answer.rawResponse || "No response"}\n\n`;

          if (result.mentions?.length > 0) {
            exportText += `MENTIONS (${result.mentions.length}):\n`;
            result.mentions.forEach((mention: any) => {
              const sentiment = mention.sentiment
                ? ` [${mention.sentiment}]`
                : "";
              exportText += `- "${mention.span}"${sentiment}${mention.isAlias ? " (alias)" : ""}\n`;
            });
            exportText += `\n`;
          }

          if (result.rankings?.length > 0) {
            exportText += `RANKINGS:\n`;
            result.rankings
              .sort(
                (a: any, b: any) => (a.position || 999) - (b.position || 999),
              )
              .forEach((ranking: any) => {
                exportText += `${ranking.position}. ${ranking.item}${ranking.isClientBrand ? " (Client)" : ""}\n`;
              });
            exportText += `\n`;
          }

          if (result.citations?.length > 0) {
            exportText += `CITATIONS (${result.citations.length}):\n`;
            result.citations.forEach((citation: any) => {
              exportText += `- ${citation.url}\n`;
            });
            exportText += `\n`;
          }

          exportText += `---\n\n`;
        });

        exportText += `\n`;
      });

      await navigator.clipboard.writeText(exportText);
      toast({
        title: "Export copied to clipboard",
        description: `Raw data for ${promptGroups.length} prompts with benchmark copied.`,
      });
    } catch (error) {
      console.error("Export failed:", error);
      toast({
        title: "Export failed",
        description: "Could not generate the export. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const { data: client } = useQuery<any>({
    queryKey: ["/api/v1/clients", selectedClientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/clients/${selectedClientId}`);
      if (!response.ok) throw new Error("Failed to fetch client");
      return response.json();
    },
    enabled: !!selectedClientId,
  });

  type RunResultsResponse = { run?: { status?: string } & Record<string, unknown>; results?: unknown[] } & Record<string, unknown>;
  const { data: runData, isLoading } = useQuery<RunResultsResponse>({
    queryKey: ["/api/v1/prompt-runs", runId, "results", selectedClientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/prompt-runs/${runId}/results`, {
        headers: selectedClientId ? { "X-Client-Id": selectedClientId } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch run details");
      return response.json();
    },
    enabled: !!runId && !!selectedClientId,
    // Poll while a run is still in progress so item-level scores stop being
    // stale once the worker finishes scoring/benchmarking. Terminal states
    // (done/failed/stopped/cancelled) freeze polling.
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      if (!status) return false;
      const terminal = ['done', 'failed', 'stopped', 'cancelled', 'error'];
      return terminal.includes(status) ? false : 5000;
    },
  });

  const run = runData?.run;
  const results = runData?.results || [];

  // Group results by prompt
  const groupByPrompt = () => {
    const grouped = new Map();

    results.forEach((result: any) => {
      const promptId = result.prompt?.id;
      if (!promptId) return;

      if (!grouped.has(promptId)) {
        grouped.set(promptId, {
          prompt: result.prompt,
          results: [],
        });
      }
      grouped.get(promptId).results.push(result);
    });

    return Array.from(grouped.values());
  };

  // Calculate overall scores for a specific prompt
  const calculatePromptScores = (promptResults: any[]) => {
    if (!promptResults.length)
      return { visibility: 0, sentiment: 0, position: 0 };

    const totals = promptResults.reduce(
      (acc: any, result: any) => {
        if (result.answer) {
          acc.visibility += Number(result.answer.visibilityScore) || 0;
          acc.sentiment += Number(result.answer.sentimentScore) || 0;
          acc.position += Number(result.answer.positionScore) || 0;
          acc.count += 1;
        }
        return acc;
      },
      { visibility: 0, sentiment: 0, position: 0, count: 0 },
    );

    // Round to 1 decimal place for consistency
    return {
      visibility:
        totals.count > 0
          ? Math.round((totals.visibility / totals.count) * 10) / 10
          : 0,
      sentiment:
        totals.count > 0
          ? Math.round((totals.sentiment / totals.count) * 10) / 10
          : 0,
      position:
        totals.count > 0
          ? Math.round((totals.position / totals.count) * 10) / 10
          : 0,
    };
  };

  // Parse and clean citation category
  const cleanCitationCategory = (category: string | undefined) => {
    if (!category) return "Uncategorized";

    return category
      .replace(/Example - /gi, "")
      .split(/[,/]/)
      .map((cat) => cat.trim())
      .filter((cat) => cat.length > 0)
      .join(", ");
  };

  // State to track expanded details accordions per prompt (unified for all metrics)
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  // Simple component to display average and delta for a single metric
  const BenchmarkRow = ({
    promptId,
    metric,
    clientScore,
  }: {
    promptId: string;
    metric: "visibility" | "sentiment" | "position";
    clientScore: number;
  }) => {
    // Fetch benchmark data for average display
    const { data: benchmarks } = useQuery({
      queryKey: [
        "/api/v1/prompt-runs",
        runId,
        "prompts",
        promptId,
        "benchmarks",
        selectedClientId,
      ],
      queryFn: async () => {
        const response = await fetch(
          `/api/v1/prompt-runs/${runId}/prompts/${promptId}/benchmarks?clientId=${selectedClientId}`,
          {
            headers: selectedClientId
              ? { "X-Client-Id": selectedClientId }
              : {},
          },
        );
        if (!response.ok) return null;
        return response.json();
      },
      enabled: !!runId && !!promptId && !!selectedClientId,
      staleTime: 5 * 60 * 1000,
    });

    if (!benchmarks || !benchmarks.summary) return null;

    const metricData = benchmarks.summary[metric];
    if (!metricData) return null;

    const avg = metricData.avg || 0;
    const delta = clientScore - avg;

    return (
      <div className="text-xs text-muted-foreground mt-2 space-x-1">
        <span>Average : {avg.toFixed(1)}</span>
        <span>|</span>
        <span className={getDeltaColor(delta)} data-testid={`text-delta-${metric}`}>
          {formatDelta(delta)}
        </span>
      </div>
    );
  };

  // Unified component to show all metric details in a single expandable section
  const UnifiedMetricDetails = ({
    promptId,
    overallScores,
  }: {
    promptId: string;
    overallScores: { visibility: number; sentiment: number; position: number };
  }) => {
    const isExpanded = expandedDetails[promptId] || false;
    
    const { getColor: getVisColor } = useScoreColor('Visibility');
    const { getColor: getSentColor } = useScoreColor('Sentiment');
    const { getColor: getPosColor } = useScoreColor('Position');
    
    // Fetch combined metric details (interpretations + benchmarks) in one call
    const { data: metricDetails, isLoading } = useQuery({
      queryKey: ['/api/v1/prompt-runs', runId, 'prompts', promptId, 'metric-details', selectedClientId],
      queryFn: async () => {
        const response = await fetch(
          `/api/v1/prompt-runs/${runId}/prompts/${promptId}/metric-details?clientId=${selectedClientId}`,
          {
            headers: selectedClientId ? { 'X-Client-Id': selectedClientId } : {},
          }
        );
        if (!response.ok) return null;
        return response.json();
      },
      enabled: isExpanded && !!runId && !!promptId && !!selectedClientId,
      staleTime: 5 * 60 * 1000,
    });

    const toggleDetails = () => {
      setExpandedDetails(prev => ({
        ...prev,
        [promptId]: !prev[promptId]
      }));
    };

    const getInterpretationTitle = (interpretation: any) => {
      if (!interpretation?.interpretation) return null;
      const text = interpretation.interpretation || '';
      const match = text.match(/suggests\s+([A-Za-z]+\s+[A-Za-z]+)/i);
      return match ? match[1] : null;
    };

    const renderBenchmarkTable = (metric: 'visibility' | 'sentiment' | 'position', getColor: (score: number) => string) => {
      const entities = metricDetails?.benchmarks?.entities || [];
      const metricCapitalized = metric.charAt(0).toUpperCase() + metric.slice(1);
      
      return (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            {metricCapitalized} Benchmark
          </p>
          <div className="space-y-1">
            {entities
              .slice()
              .sort((a: any, b: any) => {
                const scoreA = a[`${metric}Score`] ?? 0;
                const scoreB = b[`${metric}Score`] ?? 0;
                return scoreB - scoreA;
              })
              .map((entity: any, index: number) => {
                const score = entity[`${metric}Score`] ?? 0;
                const isClient = entity.isClient;
                return (
                  <div 
                    key={index}
                    className="flex items-center justify-between text-xs"
                    data-testid={`benchmark-entity-${metric}-${index}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-4">{index + 1}.</span>
                      <span className={isClient ? 'font-medium' : ''}>
                        {entity.name}
                      </span>
                      {isClient && (
                        <span className="text-xs font-medium bg-[#EDE8FF] text-[#3D1A66] px-2 py-0.5 rounded-full">YOU</span>
                      )}
                    </div>
                    <span 
                      className="font-semibold"
                      style={{ color: getColor(score) }}
                    >
                      {score.toFixed(1)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      );
    };

    return (
      <div className="mt-4">
        {/* Show/Hide Details Toggle */}
        <button
          onClick={toggleDetails}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          data-testid="button-toggle-metric-details"
        >
          {isExpanded ? (
            <>
              <ChevronsDownUp className="h-3 w-3" />
              Hide details
            </>
          ) : (
            <>
              <ChevronsUpDown className="h-3 w-3" />
              Show details
            </>
          )}
        </button>

        {/* Expanded Details Section - 3 Column Grid */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : metricDetails ? (
              <div className="space-y-6">
                {/* Interpretation Row - 3 columns */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Visibility Interpretation */}
                  <div>
                    {metricDetails.interpretations?.visibility?.interpretation && (
                      <>
                        <p 
                          className="text-sm font-semibold mb-1"
                          style={{ color: metricDetails.interpretations.visibility.colorHex || '#F59E0B' }}
                        >
                          {getInterpretationTitle(metricDetails.interpretations.visibility) || 'Visibility insight'}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {metricDetails.interpretations.visibility.interpretation}
                        </p>
                      </>
                    )}
                  </div>
                  
                  {/* Sentiment Interpretation */}
                  <div>
                    {metricDetails.interpretations?.sentiment?.interpretation && (
                      <>
                        <p 
                          className="text-sm font-semibold mb-1"
                          style={{ color: metricDetails.interpretations.sentiment.colorHex || '#F59E0B' }}
                        >
                          {getInterpretationTitle(metricDetails.interpretations.sentiment) || 'Sentiment insight'}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {metricDetails.interpretations.sentiment.interpretation}
                        </p>
                      </>
                    )}
                  </div>
                  
                  {/* Position Interpretation */}
                  <div>
                    {metricDetails.interpretations?.position?.interpretation && (
                      <>
                        <p 
                          className="text-sm font-semibold mb-1"
                          style={{ color: metricDetails.interpretations.position.colorHex || '#F59E0B' }}
                        >
                          {getInterpretationTitle(metricDetails.interpretations.position) || 'Position insight'}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {metricDetails.interpretations.position.interpretation}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* Benchmark Tables Row - 3 columns */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderBenchmarkTable('visibility', getVisColor)}
                  {renderBenchmarkTable('sentiment', getSentColor)}
                  {renderBenchmarkTable('position', getPosColor)}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No metric details available</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Rank and sort model results by overall score (high to low)
  const getRankedModelResults = (promptResults: any[]) => {
    const rankedResults = promptResults.map((result: any) => {
      const answer = result.answer || {};
      const totalScore =
        (answer.visibilityScore || 0) * 0.5 +
        (answer.sentimentScore || 0) * 0.3 +
        (answer.positionScore || 0) * 0.2;

      return {
        ...result,
        totalScore,
        rank: 0,
      };
    });

    rankedResults.sort((a: any, b: any) => b.totalScore - a.totalScore);

    rankedResults.forEach((result: any, index: number) => {
      result.rank = index + 1;
    });

    return rankedResults;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "done":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            <Check className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case "benchmarking":
        return (
          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
            <Clock className="h-3 w-3 mr-1 animate-pulse" />
            Benchmarking
          </Badge>
        );
      case "queued_for_benchmarking":
        return (
          <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100">
            <Clock className="h-3 w-3 mr-1" />
            Queued for Benchmarking
          </Badge>
        );
      case "scoring":
        return (
          <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
            <Clock className="h-3 w-3 mr-1 animate-pulse" />
            Scoring
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
            <Clock className="h-3 w-3 mr-1 animate-pulse" />
            Running
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Queued
          </Badge>
        );
      case "error":
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Get the overall status for a prompt group based on its items
  // Status flow: queued → running → scoring → queued_for_benchmarking → benchmarking → done
  // The group shows the EARLIEST stage that any item is still in
  const getPromptGroupStatus = (groupResults: any[]): string => {
    const statuses = groupResults.map((r: any) => r.item?.status || 'queued');
    
    // Handle terminal states first
    if (statuses.some((s: string) => s === 'error')) return 'error';
    if (statuses.some((s: string) => s === 'cancelled')) return 'cancelled';
    if (statuses.every((s: string) => s === 'done' || s === 'completed')) return 'done';
    
    // For in-progress states, show the earliest stage any item is in
    // This ensures we don't skip ahead (e.g., show "scoring" when some are still "queued")
    if (statuses.some((s: string) => s === 'queued')) return 'queued';
    if (statuses.some((s: string) => s === 'running')) return 'running';
    if (statuses.some((s: string) => s === 'scoring')) return 'scoring';
    if (statuses.some((s: string) => s === 'queued_for_benchmarking')) return 'queued_for_benchmarking';
    if (statuses.some((s: string) => s === 'benchmarking')) return 'benchmarking';
    
    return 'queued';
  };

  // Calculate progress stats
  const getProgressStats = () => {
    const allItems = results.map((r: any) => r.item?.status || 'queued');
    // Count both 'done' and 'completed' as finished
    const completed = allItems.filter((s: string) => s === 'done' || s === 'completed').length;
    const total = allItems.length;
    return { completed, total };
  };

  // Handle refresh - invalidates all related queries for this run
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Invalidate all queries related to this prompt run
      await queryClient.invalidateQueries({
        queryKey: ["/api/v1/prompt-runs", runId, "results", selectedClientId],
      });
      // Also invalidate benchmark queries
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && 
            key[0] === "/api/v1/prompt-runs" && 
            key[1] === runId;
        },
      });
      toast({
        title: "Refreshed",
        description: "Run data has been updated",
      });
    } catch (error) {
      toast({
        title: "Refresh failed",
        description: "Could not refresh run data",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!runId) return null;

  const promptGroups = groupByPrompt();

  return (
    <div className="fade-in">
      {/* Back Navigation */}
      <div className="page-content border-b border-border bg-card">
        <Button
          variant="ghost"
          onClick={onBack}
          className="mb-4"
          data-testid="button-back-to-tracker"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Prompts Tracker
        </Button>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : run ? (
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-foreground">
                Run {run.id.substring(0, 8)}
              </h2>
              {getStatusBadge(run.status)}
            </div>
            <p className="text-sm text-muted-foreground">
              Created{" "}
              {formatDistanceToNow(new Date(run.createdAt), {
                addSuffix: true,
              })}{" "}
              • {run.totalPrompts || 0} prompts
            </p>
          </div>
        ) : null}
      </div>

      {/* Prompts Accordions */}
      <div className="page-content">
        {/* Action Buttons */}
        {!isLoading && promptGroups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            {/* Progress counter */}
            <div className="text-sm text-muted-foreground">
              {(() => {
                const { completed, total } = getProgressStats();
                return total > 0 ? `${completed} of ${total} completed` : null;
              })()}
            </div>
            <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              data-testid="button-refresh-run"
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Run
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportFullReport}
              disabled={isExporting}
              data-testid="button-export-full-report"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Raw Data
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setIsRecalculating(true);
                try {
                  const res = await fetch(`/api/v1/prompt-runs/${runId}/recalculate-position`, { method: 'POST' });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.message);
                  toast({ title: "Position scores recalculated", description: `${data.updated} of ${data.total} answers updated using V2 algorithm` });
                  queryClient.invalidateQueries({ queryKey: ["/api/v1/prompt-runs", runId, "results", selectedClientId] });
                } catch (err: any) {
                  toast({ title: "Recalculation failed", description: err.message, variant: "destructive" });
                } finally {
                  setIsRecalculating(false);
                }
              }}
              disabled={isRecalculating}
              data-testid="button-recalculate-position"
            >
              {isRecalculating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recalculating...
                </>
              ) : (
                <>
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Recalculate Position V2
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (isAllExpanded) {
                  setExpandedPrompts([]);
                  setExpandedModels({});
                  setExpandedDetails({});
                  setExpandedCollapsibles({});
                  setIsAllExpanded(false);
                } else {
                  setExpandedPrompts(
                    promptGroups.map((_: any, i: number) => `prompt-${i}`),
                  );
                  const allModels: Record<number, string[]> = {};
                  const allDetails: Record<string, boolean> = {};
                  const allCollapsibles: Record<string, boolean> = {};
                  promptGroups.forEach((group: any, groupIndex: number) => {
                    const rankedResults = getRankedModelResults(group.results);
                    allModels[groupIndex] = rankedResults.map(
                      (_: any, modelIndex: number) =>
                        `model-${groupIndex}-${modelIndex}`,
                    );
                    // Also expand metric details for each prompt
                    if (group.prompt?.id) {
                      allDetails[group.prompt.id] = true;
                    }
                    // Expand all rankings and citations collapsibles
                    rankedResults.forEach((_: any, modelIndex: number) => {
                      allCollapsibles[`rankings-${groupIndex}-${modelIndex}`] = true;
                      allCollapsibles[`citations-${groupIndex}-${modelIndex}`] = true;
                    });
                  });
                  setExpandedModels(allModels);
                  setExpandedDetails(allDetails);
                  setExpandedCollapsibles(allCollapsibles);
                  setIsAllExpanded(true);
                }
              }}
              data-testid="button-expand-collapse-all"
            >
              {isAllExpanded ? (
                <>
                  <ChevronsDownUp className="h-4 w-4 mr-2" />
                  Collapse All
                </>
              ) : (
                <>
                  <ChevronsUpDown className="h-4 w-4 mr-2" />
                  Expand All
                </>
              )}
            </Button>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : promptGroups.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No prompts available
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Accordion
            type="multiple"
            value={expandedPrompts}
            onValueChange={(value) => {
              setExpandedPrompts(value);
              if (value.length < promptGroups.length && isAllExpanded) {
                setIsAllExpanded(false);
              }
            }}
            className="space-y-4"
          >
            {promptGroups.map((group: any, groupIndex: number) => {
              const overallScores = calculatePromptScores(group.results);
              const rankedResults = getRankedModelResults(group.results);
              const promptStatus = getPromptGroupStatus(group.results);

              return (
                <AccordionItem
                  key={groupIndex}
                  value={`prompt-${groupIndex}`}
                  className="border rounded-lg bg-card"
                  data-testid={`accordion-prompt-${groupIndex}`}
                >
                  <AccordionTrigger className="px-6 py-4 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex-1 text-left">
                        <p className="text-base font-semibold mb-1">
                          Prompt #{groupIndex + 1}
                          {group.prompt?.categoryName && (
                            <span className="text-xs font-normal text-muted-foreground ml-2">
                              · {group.prompt.categoryName}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {group.prompt?.text}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-4">
                        {getStatusBadge(promptStatus)}
                        {promptStatus === 'done' && (
                          <div className="flex items-center gap-3 text-sm font-medium whitespace-nowrap">
                            <span>
                              <span className="text-muted-foreground">V:</span>{" "}
                              <span style={{ color: getVisibilityColor(Number(overallScores.visibility)) }}>
                                {Number(overallScores.visibility).toFixed(1)}
                              </span>
                            </span>
                            <span>
                              <span className="text-muted-foreground">S:</span>{" "}
                              <span style={{ color: getSentimentColor(Number(overallScores.sentiment)) }}>
                                {Number(overallScores.sentiment).toFixed(1)}
                              </span>
                            </span>
                            <span>
                              <span className="text-muted-foreground">P:</span>{" "}
                              <span style={{ color: getPositionColor(Number(overallScores.position)) }}>
                                {Number(overallScores.position).toFixed(1)}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6">
                    <div className="space-y-6 pt-2">
                      {/* Overall Scores */}
                      <div>
                        <h4 className="text-sm font-semibold mb-4">
                          Overall Performance
                        </h4>
                        <div className="bg-muted/30 border border-border rounded-lg p-4">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div className="space-y-1">
                              <div data-testid={`display-score-visibility-${groupIndex}`}>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Visibility</span>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="h-3.5 w-3.5 cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs bg-white dark:bg-gray-900 border border-border shadow-lg">
                                        <p className="text-sm text-foreground">{METRIC_DESCRIPTIONS.Visibility}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                                <p
                                  className="text-3xl font-bold"
                                  style={{
                                    color: getVisibilityColor(
                                      Number(overallScores.visibility),
                                    ),
                                  }}
                                  data-testid={`text-visibility-${groupIndex}`}
                                >
                                  <span>{Number(overallScores.visibility).toFixed(1)}</span><span className="text-base font-normal text-muted-foreground"> / 100</span>
                                </p>
                              </div>
                              <BenchmarkRow
                                promptId={group.prompt?.id}
                                metric="visibility"
                                clientScore={Number(overallScores.visibility)}
                              />
                            </div>

                            <div className="space-y-1">
                              <div data-testid={`display-score-sentiment-${groupIndex}`}>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  <span>Sentiment</span>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="h-3.5 w-3.5 cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs bg-white dark:bg-gray-900 border border-border shadow-lg">
                                        <p className="text-sm text-foreground">{METRIC_DESCRIPTIONS.Sentiment}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                                <p
                                  className="text-3xl font-bold"
                                  style={{
                                    color: getSentimentColor(
                                      Number(overallScores.sentiment),
                                    ),
                                  }}
                                  data-testid={`text-sentiment-${groupIndex}`}
                                >
                                  <span>{Number(overallScores.sentiment).toFixed(1)}</span><span className="text-base font-normal text-muted-foreground"> / 100</span>
                                </p>
                              </div>
                              <BenchmarkRow
                                promptId={group.prompt?.id}
                                metric="sentiment"
                                clientScore={Number(overallScores.sentiment)}
                              />
                            </div>

                            <div className="space-y-1">
                              <div data-testid={`display-score-position-${groupIndex}`}>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Award className="h-3.5 w-3.5" />
                                  <span>Position</span>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="h-3.5 w-3.5 cursor-help" />
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs bg-white dark:bg-gray-900 border border-border shadow-lg">
                                        <p className="text-sm text-foreground">{METRIC_DESCRIPTIONS.Position}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                                <p
                                  className="text-3xl font-bold"
                                  style={{
                                    color: getPositionColor(
                                      Number(overallScores.position),
                                    ),
                                  }}
                                  data-testid={`text-position-${groupIndex}`}
                                >
                                  <span>{Number(overallScores.position).toFixed(1)}</span><span className="text-base font-normal text-muted-foreground"> / 100</span>
                                </p>
                              </div>
                              <BenchmarkRow
                                promptId={group.prompt?.id}
                                metric="position"
                                clientScore={Number(overallScores.position)}
                              />
                            </div>
                          </div>
                          
                          {/* Unified Show/Hide Details Toggle for all metrics */}
                          <UnifiedMetricDetails
                            promptId={group.prompt?.id}
                            overallScores={{
                              visibility: Number(overallScores.visibility),
                              sentiment: Number(overallScores.sentiment),
                              position: Number(overallScores.position),
                            }}
                          />
                        </div>
                      </div>

                      {/* Model Results */}
                      <div>
                        <h4 className="text-sm font-semibold mb-3">
                          Results by AI Model
                        </h4>
                        <Accordion
                          type="multiple"
                          value={expandedModels[groupIndex] || []}
                          onValueChange={(value) => {
                            setExpandedModels((prev) => ({
                              ...prev,
                              [groupIndex]: value,
                            }));
                            if (
                              value.length !== rankedResults.length &&
                              isAllExpanded
                            ) {
                              setIsAllExpanded(false);
                            }
                          }}
                          className="space-y-2"
                        >
                          {rankedResults.map(
                            (result: any, modelIndex: number) => {
                              const mentionTotal = result.mentions?.length || 0;
                              const firstMentionIndex =
                                result.answer?.firstMentionPos ?? null;

                              return (
                                <AccordionItem
                                  key={modelIndex}
                                  value={`model-${groupIndex}-${modelIndex}`}
                                  className="border rounded-md"
                                  data-testid={`accordion-model-${groupIndex}-${modelIndex}`}
                                >
                                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                                    <div className="flex items-center justify-between w-full pr-4">
                                      <div className="flex items-center gap-2">
                                        <Badge className="shrink-0 text-xs">
                                          #{result.rank}
                                        </Badge>
                                        <span className="font-medium text-sm">
                                          {result.model?.displayName ||
                                            "Unknown Model"}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs">
                                        <span
                                          className="font-medium"
                                          style={{
                                            color: getVisibilityColor(
                                              Number(
                                                result.answer
                                                  ?.visibilityScore || 0,
                                              ),
                                            ),
                                          }}
                                        >
                                          V:{" "}
                                          {Number(
                                            result.answer?.visibilityScore || 0,
                                          ).toFixed(1)}
                                        </span>
                                        <span
                                          className="font-medium"
                                          style={{
                                            color: getSentimentColor(
                                              Number(
                                                result.answer?.sentimentScore ||
                                                  0,
                                              ),
                                            ),
                                          }}
                                        >
                                          S:{" "}
                                          {Number(
                                            result.answer?.sentimentScore || 0,
                                          ).toFixed(1)}
                                        </span>
                                        <span
                                          className="font-medium"
                                          style={{
                                            color: getPositionColor(
                                              Number(
                                                result.answer?.positionScore ||
                                                  0,
                                              ),
                                            ),
                                          }}
                                        >
                                          P:{" "}
                                          {Number(
                                            result.answer?.positionScore || 0,
                                          ).toFixed(1)}
                                        </span>
                                      </div>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="px-4 pb-4">
                                    <div className="space-y-3 pt-2">
                                      {/* Full Response */}
                                      {result.answer?.rawResponse && (
                                        <div>
                                          <p className="text-xs text-muted-foreground mb-2 font-medium">
                                            FULL ASSISTANT RESPONSE
                                          </p>
                                          <div className="bg-muted/50 px-3 py-2 rounded-md max-h-64 overflow-y-auto">
                                            <p
                                              className="text-xs whitespace-pre-wrap"
                                              data-testid={`text-response-${groupIndex}-${modelIndex}`}
                                            >
                                              {result.answer.rawResponse}
                                            </p>
                                          </div>
                                        </div>
                                      )}

                                      {/* Scores */}
                                      <div className="grid grid-cols-3 gap-3">
                                        <div>
                                          <p className="text-xs text-muted-foreground mb-1">
                                            Visibility
                                          </p>
                                          <p
                                            className="text-base font-bold"
                                            style={{
                                              color: getVisibilityColor(
                                                Number(
                                                  result.answer
                                                    ?.visibilityScore || 0,
                                                ),
                                              ),
                                            }}
                                          >
                                            {Number(
                                              result.answer?.visibilityScore ||
                                                0,
                                            ).toFixed(1)}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-xs text-muted-foreground mb-1">
                                            Sentiment
                                          </p>
                                          <p
                                            className="text-base font-bold"
                                            style={{
                                              color: getSentimentColor(
                                                Number(
                                                  result.answer
                                                    ?.sentimentScore || 0,
                                                ),
                                              ),
                                            }}
                                          >
                                            {Number(
                                              result.answer?.sentimentScore ||
                                                0,
                                            ).toFixed(1)}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-xs text-muted-foreground mb-1">
                                            Position
                                          </p>
                                          <p
                                            className="text-base font-bold"
                                            style={{
                                              color: getPositionColor(
                                                Number(
                                                  result.answer
                                                    ?.positionScore || 0,
                                                ),
                                              ),
                                            }}
                                          >
                                            {Number(
                                              result.answer?.positionScore || 0,
                                            ).toFixed(1)}
                                          </p>
                                        </div>
                                      </div>

                                      {/* Mentions */}
                                      <div>
                                        <p className="text-xs text-muted-foreground mb-2 font-medium">
                                          MENTIONS (Total: {mentionTotal}, First
                                          Index: {firstMentionIndex ?? "N/A"})
                                        </p>
                                        {result.mentions &&
                                        result.mentions.length > 0 ? (
                                          <div className="flex flex-wrap gap-2">
                                            {result.mentions.map(
                                              (mention: any, i: number) => (
                                                <Badge
                                                  key={i}
                                                  variant={
                                                    mention.sentiment ===
                                                    "positive"
                                                      ? "default"
                                                      : mention.sentiment ===
                                                          "negative"
                                                        ? "destructive"
                                                        : "secondary"
                                                  }
                                                  className="text-xs"
                                                  data-testid={`badge-mention-${groupIndex}-${modelIndex}-${i}`}
                                                >
                                                  {mention.span}{" "}
                                                  {mention.isAlias
                                                    ? "(alias)"
                                                    : ""}
                                                </Badge>
                                              ),
                                            )}
                                          </div>
                                        ) : (
                                          <p className="text-xs text-muted-foreground">
                                            No mentions found
                                          </p>
                                        )}
                                      </div>

                                      {/* Rankings - Collapsible */}
                                      {result.rankings && result.rankings.length > 0 && (() => {
                                        const validRankings = result.rankings.filter(
                                          (r: any) => r && r.item && typeof r.item === "string"
                                        );
                                        
                                        const normalizeAliases = (aliases: any[]): string[] => {
                                          if (!aliases || !Array.isArray(aliases)) return [];
                                          return aliases.map((a: any) => {
                                            if (typeof a === "string") return a.toLowerCase();
                                            if (a && typeof a === "object" && a.value) return a.value.toLowerCase();
                                            return "";
                                          }).filter(Boolean);
                                        };
                                        
                                        const clientNameLower = (client?.name || "").toLowerCase();
                                        const aliasesLower = normalizeAliases([
                                          ...(client?.aliases || []),
                                          ...(client?.brandAliases || [])
                                        ]);
                                        
                                        const isClientMatch = (item: string) => {
                                          const itemLower = (item || "").toLowerCase();
                                          return itemLower.includes(clientNameLower) || 
                                            aliasesLower.some((alias) => itemLower.includes(alias));
                                        };
                                        
                                        const groupedRankings: Record<string, any[]> = {};
                                        validRankings.forEach((ranking: any) => {
                                          const groupKey = ranking.rankingGroup || "General";
                                          if (!groupedRankings[groupKey]) {
                                            groupedRankings[groupKey] = [];
                                          }
                                          groupedRankings[groupKey].push(ranking);
                                        });
                                        
                                        Object.values(groupedRankings).forEach((items) => {
                                          items.sort((a: any, b: any) => (a.position ?? 999) - (b.position ?? 999));
                                        });
                                        
                                        const groupCount = Object.keys(groupedRankings).length;
                                        const groupsWithClient = Object.values(groupedRankings).filter(
                                          (items) => items.some((r: any) => isClientMatch(r.item))
                                        ).length;
                                        
                                        const rankingsKey = `rankings-${groupIndex}-${modelIndex}`;
                                        const isRankingsOpen = expandedCollapsibles[rankingsKey] || false;
                                        
                                        return (
                                          <Collapsible 
                                            className="border-t pt-3" 
                                            open={isRankingsOpen}
                                            onOpenChange={(open) => setExpandedCollapsibles(prev => ({ ...prev, [rankingsKey]: open }))}
                                          >
                                            <div className="border border-border rounded-md overflow-hidden">
                                              <CollapsibleTrigger asChild>
                                                <button 
                                                  type="button"
                                                  className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                                                >
                                                  <div className="flex items-center gap-2">
                                                    <ListOrdered className="h-4 w-4 text-muted-foreground" />
                                                    <span className="text-sm font-medium">RANKINGS</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-xs py-0 px-1.5">
                                                      {groupCount} {groupCount === 1 ? "Group" : "Groups"}
                                                    </Badge>
                                                    {groupsWithClient > 0 && (
                                                      <Badge variant="default" className="text-xs py-0 px-1.5">
                                                        {groupsWithClient} with {client?.name || "Client"}
                                                      </Badge>
                                                    )}
                                                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isRankingsOpen ? "rotate-90" : ""}`} />
                                                  </div>
                                                </button>
                                              </CollapsibleTrigger>
                                              <CollapsibleContent>
                                                <div className="p-3 space-y-3 border-t border-border">
                                                  {Object.entries(groupedRankings).map(([groupName, items], gIdx) => {
                                                    const groupRelevance = items.find((r: any) => r.groupRelevance)?.groupRelevance as string | undefined;
                                                    const relevanceReason = items.find((r: any) => r.relevanceReason)?.relevanceReason as string | undefined;
                                                    return (
                                                    <div key={gIdx} className="bg-muted/20 p-3 rounded-md border border-border/50">
                                                      <div className="flex items-center justify-between mb-2">
                                                        <p className="text-xs font-medium text-foreground">{groupName}</p>
                                                        {groupRelevance && (
                                                          <div className="flex items-center gap-1">
                                                            <span className={`text-[10px] italic ${
                                                              groupRelevance === 'relevant' ? 'text-emerald-600 dark:text-emerald-400' :
                                                              groupRelevance === 'partial' ? 'text-amber-600 dark:text-amber-400' :
                                                              'text-muted-foreground'
                                                            }`} data-testid={`relevance-label-${gIdx}`}>
                                                              {groupRelevance}
                                                            </span>
                                                            {relevanceReason && (
                                                              <TooltipProvider>
                                                                <Tooltip>
                                                                  <TooltipTrigger asChild>
                                                                    <Info className={`h-3 w-3 cursor-help ${
                                                                      groupRelevance === 'relevant' ? 'text-emerald-500 dark:text-emerald-400' :
                                                                      groupRelevance === 'partial' ? 'text-amber-500 dark:text-amber-400' :
                                                                      'text-muted-foreground'
                                                                    }`} data-testid={`relevance-tooltip-${gIdx}`} />
                                                                  </TooltipTrigger>
                                                                  <TooltipContent className="max-w-xs bg-white dark:bg-gray-900 border border-border shadow-lg">
                                                                    <p className="text-xs">{relevanceReason}</p>
                                                                  </TooltipContent>
                                                                </Tooltip>
                                                              </TooltipProvider>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                      <div className="space-y-1">
                                                        {items.map((ranking: any, rIdx: number) => {
                                                          const isClient = isClientMatch(ranking.item);
                                                          return (
                                                            <div 
                                                              key={rIdx} 
                                                              className="flex items-center gap-2 text-xs"
                                                              data-testid={`ranking-item-${groupIndex}-${modelIndex}-${gIdx}-${rIdx}`}
                                                            >
                                                              <span className="text-muted-foreground w-5 text-right">
                                                                {ranking.position ?? rIdx + 1}.
                                                              </span>
                                                              <span className={isClient ? "font-medium" : ""}>
                                                                {ranking.item}
                                                              </span>
                                                              {isClient && (
                                                                <Badge variant="default" className="text-xs py-0 px-1">
                                                                  YOU
                                                                </Badge>
                                                              )}
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    </div>
                                                    );
                                                  })}
                                                </div>
                                              </CollapsibleContent>
                                            </div>
                                          </Collapsible>
                                        );
                                      })()}

                                      {/* Citations - Collapsible */}
                                      {result.citations && result.citations.length > 0 && (() => {
                                        const citationsKey = `citations-${groupIndex}-${modelIndex}`;
                                        const isCitationsOpen = expandedCollapsibles[citationsKey] || false;
                                        
                                        const normalizeClientUrls = (urls: any[]): string[] => {
                                          if (!urls || !Array.isArray(urls)) return [];
                                          return urls.map((u: any) => {
                                            if (typeof u === "string") return u.toLowerCase();
                                            if (u && typeof u === "object" && u.url) return u.url.toLowerCase();
                                            return "";
                                          }).filter(Boolean);
                                        };
                                        
                                        const clientUrls = normalizeClientUrls(client?.urls || []);
                                        const clientWebsite = (client?.website || "").toLowerCase();
                                        
                                        const extractHostname = (url: string): string | null => {
                                          try {
                                            const urlWithProtocol = url.startsWith("http") ? url : `https://${url}`;
                                            return new URL(urlWithProtocol).hostname.replace(/^www\./, "");
                                          } catch {
                                            return null;
                                          }
                                        };
                                        
                                        const hostnameMatches = (host1: string, host2: string): boolean => {
                                          if (host1 === host2) return true;
                                          if (host1.endsWith(`.${host2}`)) return true;
                                          if (host2.endsWith(`.${host1}`)) return true;
                                          return false;
                                        };
                                        
                                        const isClientCitation = (citationUrl: string) => {
                                          if (!citationUrl) return false;
                                          const citationHostname = extractHostname(citationUrl);
                                          if (!citationHostname) return false;
                                          
                                          if (clientWebsite) {
                                            const websiteHostname = extractHostname(clientWebsite);
                                            if (websiteHostname && hostnameMatches(citationHostname, websiteHostname)) {
                                              return true;
                                            }
                                          }
                                          
                                          return clientUrls.some(clientUrl => {
                                            const clientHostname = extractHostname(clientUrl);
                                            return clientHostname && hostnameMatches(citationHostname, clientHostname);
                                          });
                                        };
                                        
                                        const totalCitations = result.citations.length;
                                        const clientCitationCount = result.citations.filter((c: any) => isClientCitation(c.url)).length;
                                        
                                        return (
                                          <Collapsible 
                                            className="border-t pt-3"
                                            open={isCitationsOpen}
                                            onOpenChange={(open) => setExpandedCollapsibles(prev => ({ ...prev, [citationsKey]: open }))}
                                          >
                                            <div className="border border-border rounded-md overflow-hidden">
                                              <CollapsibleTrigger asChild>
                                                <button 
                                                  type="button"
                                                  className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                                                >
                                                  <div className="flex items-center gap-2">
                                                    <Link2 className="h-4 w-4 text-muted-foreground" />
                                                    <span className="text-sm font-medium">CITATIONS</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-xs py-0 px-1.5">
                                                      {totalCitations} {totalCitations === 1 ? "Link" : "Links"}
                                                    </Badge>
                                                    {clientCitationCount > 0 && (
                                                      <Badge variant="default" className="text-xs py-0 px-1.5">
                                                        {clientCitationCount} with {client?.name || "Client"}
                                                      </Badge>
                                                    )}
                                                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isCitationsOpen ? "rotate-90" : ""}`} />
                                                  </div>
                                                </button>
                                              </CollapsibleTrigger>
                                              <CollapsibleContent>
                                                <div className="p-3 space-y-2 border-t border-border">
                                                  {result.citations.map((citation: any, i: number) => {
                                                    const isClientUrl = isClientCitation(citation.url);
                                                    return (
                                                      <div
                                                        key={i}
                                                        className="bg-muted/20 p-2 rounded-md border border-border/50 flex items-center justify-between gap-2"
                                                        data-testid={`citation-${groupIndex}-${modelIndex}-${i}`}
                                                      >
                                                        <div className="flex-1 min-w-0">
                                                          {citation.url && (
                                                            <a
                                                              href={citation.url}
                                                              target="_blank"
                                                              rel="noopener noreferrer"
                                                              className="text-xs text-blue-600 hover:underline flex items-center gap-1 break-all"
                                                              data-testid={`link-citation-${groupIndex}-${modelIndex}-${i}`}
                                                            >
                                                              <ExternalLink className="h-3 w-3 shrink-0" />
                                                              {citation.url}
                                                            </a>
                                                          )}
                                                        </div>
                                                        {isClientUrl && (
                                                          <Badge variant="default" className="text-xs py-0 px-1 shrink-0">
                                                            YOU
                                                          </Badge>
                                                        )}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </CollapsibleContent>
                                            </div>
                                          </Collapsible>
                                        );
                                      })()}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              );
                            },
                          )}
                        </Accordion>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

    </div>
  );
}
