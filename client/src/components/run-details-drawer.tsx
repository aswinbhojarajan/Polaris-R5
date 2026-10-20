import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Check, Clock, FileText, Link2, MessageSquare, TrendingUp } from "lucide-react";
import type { PromptRun } from "@shared/schema";
import { useSelectedClientId } from "@/hooks/use-selected-client-id";

interface RunDetailsDrawerProps {
  runId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RunDetailsDrawer({ runId, isOpen, onClose }: RunDetailsDrawerProps) {
  const selectedClientId = useSelectedClientId();

  type RunResultsResponse = { run?: { status?: string } & Record<string, unknown>; results?: unknown[] } & Record<string, unknown>;
  const { data: runData, isLoading } = useQuery<RunResultsResponse>({
    queryKey: ['/api/v1/prompt-runs', runId, 'results', selectedClientId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/prompt-runs/${runId}/results`, {
        headers: selectedClientId ? { 'X-Client-Id': selectedClientId } : {}
      });
      if (!response.ok) throw new Error('Failed to fetch run details');
      return response.json();
    },
    enabled: !!runId && isOpen && !!selectedClientId,
    // Keep polling while the run is in flight so the drawer doesn't show
    // stale 0/0/0 scores after items are scored/benchmarked.
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      if (!status) return false;
      const terminal = ['done', 'failed', 'stopped', 'cancelled', 'error'];
      return terminal.includes(status) ? false : 5000;
    },
  });

  const run = runData?.run;
  const results = runData?.results || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'done':
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            <Check className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
            <Clock className="h-3 w-3 mr-1" />
            Running
          </Badge>
        );
      case 'queued':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Queued
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="drawer-responsive overflow-y-auto" data-testid="drawer-run-details">
        {isLoading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : run ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span>Run {run.id.substring(0, 8)}</span>
                {getStatusBadge(run.status)}
              </SheetTitle>
              <SheetDescription>
                Created {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Total Prompts
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{run.totalPrompts || 0}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold capitalize">{run.status}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs for detailed information */}
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                  <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                  <TabsTrigger value="prompts" data-testid="tab-prompts">Prompts</TabsTrigger>
                  <TabsTrigger value="results" data-testid="tab-results">Results</TabsTrigger>
                  <TabsTrigger value="citations" data-testid="tab-citations">Citations</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Run Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Run ID</span>
                        <span className="text-sm font-medium">{run.id}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <span className="text-sm font-medium">{getStatusBadge(run.status)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Total Prompts</span>
                        <span className="text-sm font-medium">{run.totalPrompts || 0}</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-muted-foreground">Created At</span>
                        <span className="text-sm font-medium">
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="prompts" className="mt-4 space-y-4">
                  {results.length === 0 ? (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-center py-8">
                          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm text-muted-foreground">No prompts executed yet</p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    results.map((result: any, index: number) => (
                      <Card key={index}>
                        <CardHeader>
                          <CardTitle className="text-sm flex items-center justify-between">
                            <span>{result.model?.displayName || 'Unknown Model'}</span>
                            {result.item?.status && getStatusBadge(result.item.status)}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                            <p className="text-sm">{result.prompt?.text || 'N/A'}</p>
                          </div>
                          {result.answer && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Full Response</p>
                              <p className="text-sm bg-muted p-3 rounded-md whitespace-pre-wrap">
                                {result.answer.rawResponse}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="results" className="mt-4 space-y-4">
                  {results.length === 0 ? (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-center py-8">
                          <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm text-muted-foreground">No results available yet</p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    results.map((result: any, index: number) => (
                      <Card key={index}>
                        <CardHeader>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm">{result.model?.displayName || 'Unknown Model'}</CardTitle>
                              {result.item?.status && getStatusBadge(result.item.status)}
                            </div>
                            <div className="bg-muted px-3 py-2 rounded-md">
                              <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                              <p className="text-sm font-medium line-clamp-2">{result.prompt?.text || 'N/A'}</p>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Visibility</p>
                              <p className="text-xl font-bold text-primary">
                                {result.answer?.visibilityScore !== null && result.answer?.visibilityScore !== undefined ? Number(result.answer.visibilityScore).toFixed(1) : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Sentiment</p>
                              <p className="text-xl font-bold text-green-600">
                                {result.answer?.sentimentScore !== null && result.answer?.sentimentScore !== undefined ? Number(result.answer.sentimentScore).toFixed(1) : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Position</p>
                              <p className="text-xl font-bold text-blue-600">
                                {result.answer?.positionScore !== null && result.answer?.positionScore !== undefined ? Number(result.answer.positionScore).toFixed(1) : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Citations</p>
                              <p className="text-xl font-bold text-purple-600">
                                {result.answer?.citationCount !== null && result.answer?.citationCount !== undefined ? result.answer.citationCount : 'N/A'}
                              </p>
                            </div>
                          </div>
                          
                          <div className="border-t pt-4">
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">First Mention Position</p>
                              <p className="text-sm font-medium">{result.answer?.firstMentionPos ?? 'Not found'}</p>
                            </div>
                          </div>
                          
                          {result.mentions && result.mentions.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">Mentions ({result.mentions.length})</p>
                              <div className="flex flex-wrap gap-2">
                                {result.mentions.map((mention: any, i: number) => (
                                  <Badge 
                                    key={i}
                                    variant={mention.sentiment === 'positive' ? 'default' : mention.sentiment === 'negative' ? 'destructive' : 'secondary'}
                                  >
                                    {mention.span} {mention.isAlias ? '(alias)' : ''}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {result.rankings && result.rankings.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">Rankings</p>
                              <div className="space-y-1">
                                {result.rankings
                                  .filter((r: any) => r.position > 0 && r.position <= 20)
                                  .sort((a: any, b: any) => a.position - b.position)
                                  .map((ranking: any, i: number) => (
                                  <div key={i} className="text-sm flex items-center gap-2">
                                    <Badge variant="outline">{ranking.position}</Badge>
                                    <span>{ranking.item}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="citations" className="mt-4 space-y-4">
                  {results.length === 0 ? (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-center py-8">
                          <Link2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm text-muted-foreground">No citations available yet</p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    results.map((result: any, index: number) => (
                      result.citations && result.citations.length > 0 ? (
                        <Card key={index}>
                          <CardHeader>
                            <CardTitle className="text-sm">{result.model?.displayName || 'Unknown Model'}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {result.citations.map((citation: any, i: number) => (
                              <div key={i} className="border-b pb-3 last:border-0">
                                <div className="flex items-start justify-between mb-2">
                                  <Badge variant={citation.type === 'hard' ? 'default' : 'secondary'}>
                                    {citation.type}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">Position {citation.position}</span>
                                </div>
                                {citation.url && (
                                  <a href={citation.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline block">
                                    {citation.url}
                                  </a>
                                )}
                                {citation.domain && <p className="text-sm text-muted-foreground">Domain: {citation.domain}</p>}
                                {citation.displayText && <p className="text-sm">{citation.displayText}</p>}
                                {citation.anchorText && <p className="text-xs text-muted-foreground italic">"{citation.anchorText}"</p>}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ) : null
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-muted-foreground">Run not found</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
