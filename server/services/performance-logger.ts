/**
 * Performance Logger - Phase 0 Instrumentation
 * Tracks timing and metrics for prompt run execution to identify bottlenecks
 */

interface TimingEntry {
  stage: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface ProviderStats {
  callCount: number;
  successCount: number;
  totalDuration: number;
  avgDuration: number;
  rateLimitHits: number;
  errors: number;
}

interface RunMetrics {
  runId: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  totalItems: number;
  promptCount: number;
  modelCount: number;
  competitorCount: number;
  successfulItems: number;
  failedItems: number;
  timings: TimingEntry[];
  providerStats: Record<string, ProviderStats>;
  stageBreakdown: Record<string, { count: number; totalMs: number; avgMs: number }>;
}

class PerformanceLogger {
  private activeRuns: Map<string, RunMetrics> = new Map();

  startRun(runId: string, totalItems: number, uniquePromptIds: string[], uniqueModelIds: string[]): void {
    const metrics: RunMetrics = {
      runId,
      startTime: Date.now(),
      totalItems,
      promptCount: uniquePromptIds.length,
      modelCount: uniqueModelIds.length,
      competitorCount: 0,
      successfulItems: 0,
      failedItems: 0,
      timings: [],
      providerStats: {},
      stageBreakdown: {}
    };
    this.activeRuns.set(runId, metrics);
    console.log(`[PERF] Run ${runId} started: ${metrics.promptCount} prompts × ${metrics.modelCount} models = ${totalItems} items`);
  }

  updateCompetitorCount(runId: string, count: number): void {
    const metrics = this.activeRuns.get(runId);
    if (metrics) {
      metrics.competitorCount = count;
    }
  }

  incrementSuccessfulItems(runId: string): void {
    const metrics = this.activeRuns.get(runId);
    if (metrics) {
      metrics.successfulItems++;
    }
  }

  incrementFailedItems(runId: string): void {
    const metrics = this.activeRuns.get(runId);
    if (metrics) {
      metrics.failedItems++;
    }
  }

  logApiCall(runId: string, provider: string, duration: number, statusCode: number = 200, isError: boolean = false): void {
    const isRateLimited = statusCode === 429;
    const metrics = this.activeRuns.get(runId);
    if (!metrics) return;
    
    if (!metrics.providerStats[provider]) {
      metrics.providerStats[provider] = {
        callCount: 0,
        successCount: 0,
        totalDuration: 0,
        avgDuration: 0,
        rateLimitHits: 0,
        errors: 0
      };
    }
    
    const stats = metrics.providerStats[provider];
    stats.callCount++;
    stats.totalDuration += duration;
    stats.avgDuration = stats.totalDuration / stats.callCount;
    if (isRateLimited) stats.rateLimitHits++;
    if (isError) {
      stats.errors++;
    } else {
      stats.successCount++;
    }
  }

  logStage(runId: string, stage: string, duration: number, metadata?: Record<string, any>): void {
    const metrics = this.activeRuns.get(runId);
    if (!metrics) return;
    
    metrics.timings.push({
      stage,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      metadata
    });
    
    if (!metrics.stageBreakdown[stage]) {
      metrics.stageBreakdown[stage] = { count: 0, totalMs: 0, avgMs: 0 };
    }
    metrics.stageBreakdown[stage].count++;
    metrics.stageBreakdown[stage].totalMs += duration;
    metrics.stageBreakdown[stage].avgMs = 
      metrics.stageBreakdown[stage].totalMs / metrics.stageBreakdown[stage].count;
    
    if (duration > 1000) {
      console.log(`[PERF] ${stage}: ${(duration / 1000).toFixed(2)}s`, metadata || '');
    }
  }

  endRun(runId: string): RunMetrics | null {
    const metrics = this.activeRuns.get(runId);
    if (!metrics) return null;
    
    metrics.endTime = Date.now();
    metrics.totalDuration = metrics.endTime - metrics.startTime;
    
    this.printRunSummary(metrics);
    this.activeRuns.delete(runId);
    
    return metrics;
  }

  private printRunSummary(metrics: RunMetrics): void {
    const totalSec = (metrics.totalDuration || 0) / 1000;
    const itemCount = metrics.totalItems || 1;
    
    console.log('\n' + '='.repeat(60));
    console.log('[PERF] PROMPT RUN PERFORMANCE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Run ID: ${metrics.runId}`);
    console.log(`Total Duration: ${totalSec.toFixed(2)} seconds`);
    console.log(`Items Processed: ${itemCount} (${metrics.promptCount} prompts, ${metrics.modelCount} models)`);
    console.log(`Success/Fail: ${metrics.successfulItems}/${metrics.failedItems}`);
    console.log(`Competitors Scored: ${metrics.competitorCount}`);
    console.log(`Avg per Item: ${(totalSec / itemCount).toFixed(2)} seconds`);
    
    console.log('\n--- Stage Breakdown ---');
    const sortedStages = Object.entries(metrics.stageBreakdown)
      .sort((a, b) => b[1].totalMs - a[1].totalMs);
    
    for (const [stage, data] of sortedStages) {
      const pct = ((data.totalMs / (metrics.totalDuration || 1)) * 100).toFixed(1);
      console.log(`  ${stage}: ${(data.totalMs / 1000).toFixed(2)}s total (${data.count} calls, avg ${(data.avgMs / 1000).toFixed(2)}s) - ${pct}%`);
    }
    
    console.log('\n--- Provider Stats ---');
    for (const [provider, stats] of Object.entries(metrics.providerStats)) {
      console.log(`  ${provider}: ${stats.callCount} calls, avg ${(stats.avgDuration / 1000).toFixed(2)}s, ${stats.rateLimitHits} rate limits, ${stats.errors} errors`);
    }
    
    console.log('='.repeat(60) + '\n');
  }

  getActiveRunMetrics(runId: string): RunMetrics | undefined {
    return this.activeRuns.get(runId);
  }
}

export const performanceLogger = new PerformanceLogger();
