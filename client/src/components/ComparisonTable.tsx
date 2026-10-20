import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Download, TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

interface RunData {
  runId: string;
  runName: string;
  createdAt: string | Date;
  avgVisibilityScore: number;
  avgSentimentScore: number;
  avgPositionScore: number;
  totalCitations: number;
}

interface ComparisonTableProps {
  runs: RunData[];
}

export function ComparisonTable({ runs }: ComparisonTableProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (runs.length < 2) return null;

  // Sort runs chronologically (oldest first) - historicalScores comes in DESC order (newest first)
  const sortedRuns = [...runs].sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Calculate overall score for each run (weighted average)
  const calculateOverallScore = (run: RunData) => {
    return ((run.avgVisibilityScore + run.avgSentimentScore + run.avgPositionScore) / 3);
  };

  // Calculate diff from previous value
  const calculateDiff = (current: number, previous: number) => {
    const diff = current - previous;
    const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;
    return { diff, percentChange };
  };

  // Format diff display - compare to immediate previous run in the selection
  const formatDiff = (current: number, runIndex: number, getValue: (run: RunData) => number) => {
    // First run has no previous run to compare to
    if (runIndex === 0) return null;
    
    const previousRun = sortedRuns[runIndex - 1];
    const previousValue = getValue(previousRun);
    const { diff, percentChange } = calculateDiff(current, previousValue);
    
    if (Math.abs(diff) < 0.1) {
      return <span className="text-muted-foreground text-xs">→</span>;
    }

    const isPositive = diff > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const color = isPositive ? "text-green-600" : "text-red-600";

    return (
      <div className={`flex items-center gap-1 ${color} text-xs`}>
        <Icon className="h-3 w-3" />
        <span>{isPositive ? '+' : ''}{diff.toFixed(1)}</span>
        <span className="text-muted-foreground">({isPositive ? '+' : ''}{percentChange.toFixed(1)}%)</span>
      </div>
    );
  };

  // Find best performing run
  const runsWithScores = sortedRuns.map(run => ({
    run,
    overallScore: calculateOverallScore(run)
  }));
  const bestRun = runsWithScores.reduce((best, current) => 
    current.overallScore > best.overallScore ? current : best
  );

  // Find biggest improvement from previous run
  const improvements = sortedRuns.slice(1).map((run, index) => {
    const previousRun = sortedRuns[index]; // index is relative to slice(1)
    const visDiff = calculateDiff(run.avgVisibilityScore, previousRun.avgVisibilityScore);
    const sentDiff = calculateDiff(run.avgSentimentScore, previousRun.avgSentimentScore);
    const posDiff = calculateDiff(run.avgPositionScore, previousRun.avgPositionScore);
    
    const maxDiff = Math.max(
      Math.abs(visDiff.diff),
      Math.abs(sentDiff.diff),
      Math.abs(posDiff.diff)
    );

    let metric = '';
    let value = 0;
    if (Math.abs(visDiff.diff) === maxDiff) {
      metric = 'visibility';
      value = visDiff.diff;
    } else if (Math.abs(sentDiff.diff) === maxDiff) {
      metric = 'sentiment';
      value = sentDiff.diff;
    } else {
      metric = 'position';
      value = posDiff.diff;
    }

    return { runIndex: index + 1, metric, value, runName: run.runName };
  });

  const biggestChange = improvements.reduce((max, curr) => 
    Math.abs(curr.value) > Math.abs(max.value) ? curr : max
  );

  return (
    <Card>
      <CardHeader 
        className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="comparison-header"
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Run-by-Run Comparison
              <Badge variant="secondary">{runs.length} runs</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Sequential comparison showing change from previous run
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          {/* Comparison Table */}
          <div className="overflow-x-auto mb-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px] sticky left-0 bg-background z-10">Metric</TableHead>
                  {sortedRuns.map((run, index) => (
                    <TableHead key={run.runId} className="text-center">
                      <div className="flex flex-col gap-1 items-center">
                        <span className="font-semibold">{run.runName}</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {format(new Date(run.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Overall Score */}
                <TableRow>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">Overall Score</TableCell>
                  {sortedRuns.map((run, index) => {
                    const score = calculateOverallScore(run);
                    return (
                      <TableCell key={run.runId} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-lg font-semibold">{score.toFixed(1)}</span>
                          {formatDiff(score, index, calculateOverallScore)}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>

                {/* Visibility Score */}
                <TableRow>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">Visibility Score</TableCell>
                  {sortedRuns.map((run, index) => (
                    <TableCell key={run.runId} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">{run.avgVisibilityScore.toFixed(1)}</span>
                        {formatDiff(run.avgVisibilityScore, index, (r) => r.avgVisibilityScore)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>

                {/* Sentiment Score */}
                <TableRow>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">Sentiment Score</TableCell>
                  {sortedRuns.map((run, index) => (
                    <TableCell key={run.runId} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">{run.avgSentimentScore.toFixed(1)}</span>
                        {formatDiff(run.avgSentimentScore, index, (r) => r.avgSentimentScore)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>

                {/* Position Score */}
                <TableRow>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">Position Score</TableCell>
                  {sortedRuns.map((run, index) => (
                    <TableCell key={run.runId} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">{run.avgPositionScore.toFixed(1)}</span>
                        {formatDiff(run.avgPositionScore, index, (r) => r.avgPositionScore)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>

                {/* Total Citations */}
                <TableRow>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">Total Citations</TableCell>
                  {sortedRuns.map((run, index) => (
                    <TableCell key={run.runId} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold">{run.totalCitations}</span>
                        {formatDiff(run.totalCitations, index, (r) => r.totalCitations)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Key Insights */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-semibold mb-3">Key Insights</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-green-600">•</span>
                <span>
                  Best performing run: <span className="font-medium">{bestRun.run.runName}</span> 
                  {' '}({bestRun.overallScore.toFixed(1)} overall score)
                </span>
              </div>
              {biggestChange.value !== 0 && (
                <div className="flex items-start gap-2">
                  <span className={biggestChange.value > 0 ? "text-green-600" : "text-red-600"}>•</span>
                  <span>
                    {biggestChange.value > 0 ? 'Biggest improvement' : 'Biggest decline'}: 
                    {' '}{biggestChange.value > 0 ? '+' : ''}{biggestChange.value.toFixed(1)} {biggestChange.metric} score
                    {' '}in {biggestChange.runName}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <span className="text-blue-600">•</span>
                <span>
                  Comparing {sortedRuns.length} runs spanning {' '}
                  {format(new Date(sortedRuns[0].createdAt), 'MMM d')} - {format(new Date(sortedRuns[sortedRuns.length - 1].createdAt), 'MMM d, yyyy')}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
