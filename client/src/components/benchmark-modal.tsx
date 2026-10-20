import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, MessageSquare, Award } from "lucide-react";
import { useScoreColor } from "@/hooks/use-score-color";
import { useSelectedClientId } from "@/hooks/use-selected-client-id";

interface BenchmarkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  promptId: string | null;
  metric: 'Visibility' | 'Sentiment' | 'Position' | null;
  clientScore: number;
}

export function BenchmarkModal({
  open,
  onOpenChange,
  runId,
  promptId,
  metric,
  clientScore
}: BenchmarkModalProps) {
  const selectedClientId = useSelectedClientId();
  const { getColor } = useScoreColor(metric || 'Visibility');

  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/v1/prompt-runs', runId, 'prompts', promptId, 'benchmarks', selectedClientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/v1/prompt-runs/${runId}/prompts/${promptId}/benchmarks?clientId=${selectedClientId}`,
        { headers: selectedClientId ? { 'X-Client-Id': selectedClientId } : {} }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch benchmark data');
      }
      return response.json();
    },
    enabled: open && !!runId && !!promptId && !!selectedClientId
  });

  const getMetricIcon = () => {
    switch (metric) {
      case 'Visibility':
        return <TrendingUp className="h-5 w-5" />;
      case 'Sentiment':
        return <MessageSquare className="h-5 w-5" />;
      case 'Position':
        return <Award className="h-5 w-5" />;
      default:
        return null;
    }
  };

  const formatDelta = (delta: number) => {
    if (Math.abs(delta) < 0.1) return '±0.0';
    return delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  };

  const getDeltaColor = (delta: number) => {
    if (Math.abs(delta) < 0.1) return 'text-muted-foreground';
    if (delta > 0) return 'text-green-600 dark:text-green-500';
    return 'text-red-600 dark:text-red-500';
  };

  const metricKey = metric?.toLowerCase() as 'visibility' | 'sentiment' | 'position';
  const metricData = data?.summary?.[metricKey];
  const entities = data?.entities || [];
  const delta = metricData ? clientScore - metricData.avg : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getMetricIcon()}
            <span>{metric} Benchmark</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Failed to load benchmark data'}
              </p>
            </div>
          )}

          {data && metricData && (
            <>
              {/* Benchmark Summary */}
              <div className="bg-muted/30 border border-border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Your Score</p>
                    <p className="text-2xl font-bold" style={{ color: getColor(clientScore) }}>
                      {clientScore.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">vs. Average</p>
                    <p className={`text-2xl font-bold ${getDeltaColor(delta)}`}>
                      {formatDelta(delta)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Min/Max/Avg Stats */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">Benchmark Statistics</h4>
                <div className="bg-muted/30 border border-border rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Minimum</p>
                      <p className="text-lg font-semibold">{metricData.min.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Average</p>
                      <p className="text-lg font-semibold">{metricData.avg.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Maximum</p>
                      <p className="text-lg font-semibold">{metricData.max.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Entity Comparison */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">
                  All Entities ({entities.length})
                </h4>
                <div className="bg-muted/30 border border-border rounded-lg p-4 max-h-64 overflow-y-auto">
                  <div className="space-y-2">
                    {entities
                      .sort((a: any, b: any) => {
                        const scoreA = a[`${metricKey}Score`] ?? 0;
                        const scoreB = b[`${metricKey}Score`] ?? 0;
                        return scoreB - scoreA;
                      })
                      .map((entity: any, index: number) => {
                        const score = entity[`${metricKey}Score`] ?? 0;
                        const isClient = entity.isClient;
                        return (
                          <div 
                            key={index}
                            className={`flex items-center justify-between py-2 px-3 rounded-md ${
                              isClient ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50'
                            }`}
                            data-testid={`entity-${index}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {entity.name}
                                {isClient && (
                                  <span className="ml-2 text-xs font-medium bg-[#EDE8FF] text-[#3D1A66] px-2 py-0.5 rounded-full">YOU</span>
                                )}
                              </span>
                            </div>
                            <span 
                              className="text-sm font-semibold"
                              style={{ color: getColor(score) }}
                            >
                              {score.toFixed(1)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
