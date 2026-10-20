# Prompt Run Scaling & Resilience Plan

**Date:** December 2025  
**Status:** Planning Complete  
**Goal:** Scale from 5-6 prompts/2 models/5 competitors → 15-20 prompts/4 models/10 competitors

---

## Executive Summary

The current architecture processes prompt-model combinations sequentially with a 10-minute timeout. This creates bottlenecks and causes job failures when:
1. Runs are too large to complete in 10 minutes
2. Application goes idle and Replit sleeps the server
3. User leaves and returns hours later

This plan introduces parallel processing, extended timeouts, and job resilience mechanisms.

---

## Current Architecture Issues

### Issue 1: Sequential Processing
```
prompt-run-executor.ts (line 72):
for (let i = 0; i < items.length; i++) {
  // Executes ONE prompt-model combination at a time
  const result = await executePrompt(prompt.text, aiModel.vendor, aiModel.model);
}
```

**Impact:** 20 prompts × 4 models = 80 API calls executed sequentially (~5-10 seconds each = 6-13 minutes just for API calls)

### Issue 2: 10-Minute Timeout
```
job-queue.ts (line 21):
private readonly JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
```

**Impact:** Large runs WILL timeout and be marked as failed.

### Issue 3: Idle Application Failure
When application is idle:
1. Replit may sleep the server
2. On wake, orphaned jobs (status: "running") are marked as timed out
3. Job is lost even though it could have continued

### Issue 4: Sequential Competitor Scoring
```
competitor-scoring.ts (line 114-178):
for (const [promptId, answers] of promptGroups) {  // Sequential
  for (const comp of discoveredCompetitors) {       // Sequential
    for (const { answer } of answers) {             // Sequential
      await detectMentionsAsync(...);
      await calculateVisibilityScoreAsync(...);
    }
  }
}
```

**Impact:** 20 prompts × 10 competitors × multiple LLM calls = significant additional time

---

## Phased Implementation Plan

### Phase 0: Instrumentation & Baseline (1-2 days) ✅ COMPLETE
**Goal:** Understand current performance before optimizing

#### Tasks
- [x] Add timing instrumentation to prompt execution loop
- [x] Log per-stage durations: API call, scoring, citation extraction, etc.
- [x] Track API rate limit responses per provider
- [x] Measure actual run times for current workloads
- [x] Document baseline metrics

#### Deliverables
- Baseline performance report: 115.58s for 1 prompt × 1 model × 5 competitors
- Identified bottlenecks: competitor_scoring (55.2%), sentiment_scoring (13.9%), ai_api_call (9.0%)

---

### Phase 1: Parallel Prompt Execution (3-4 days) ✅ COMPLETE
**Goal:** Execute multiple prompt-model combinations in parallel with rate limiting

#### Architecture Changes

```typescript
// IMPLEMENTED: Configurable concurrency per provider (batch-executor.ts)
const PROVIDER_CONCURRENCY = {
  openai: 5,      // Can handle higher concurrency
  anthropic: 3,   // Moderate
  perplexity: 3,  // Moderate  
  google: 2       // Rate limited (Gemini has stricter limits)
};

// IMPLEMENTED: BatchExecutor with proper sequencing
// - Providers execute sequentially for cancellation propagation
// - Items within each provider execute in parallel (up to concurrency limit)
// - Scoring awaited before advancing to ensure lifecycle ordering
```

#### Tasks
- [x] Create `BatchExecutor` class with configurable concurrency
- [x] Add per-provider rate limiting (concurrency limits)
- [x] Implement `Promise.allSettled` for parallel execution within providers
- [x] Add retry logic with exponential backoff (3 retries, 1s base delay)
- [x] Group items by provider for rate limit management
- [x] Update progress tracking for parallel execution
- [x] Extract scoring logic into `processItemScoring()` helper
- [x] Pre-fetch prompts/models for O(1) lookup
- [x] Proper cancellation propagation through batch executor

#### Configuration
```typescript
// Environment variables
PROMPT_BATCH_SIZE=5                    // Items processed in parallel
OPENAI_MAX_CONCURRENT=5
ANTHROPIC_MAX_CONCURRENT=3
PERPLEXITY_MAX_CONCURRENT=3
GEMINI_MAX_CONCURRENT=1
```

#### Expected Improvement
- Current: 80 items × 8 seconds = ~11 minutes (sequential)
- After: 80 items ÷ 4 parallel = 20 batches × 8 seconds = ~3 minutes

---

### Phase 2: Parallel Competitor Scoring (2-3 days) ✅ COMPLETE
**Goal:** Parallelize competitor analysis while reusing intermediate results

#### Architecture Changes

```typescript
// IMPLEMENTED: Parallel competitor processing in batches of 3
const COMPETITOR_BATCH_SIZE = 3;

// IMPLEMENTED: scoreCompetitorForPrompt() helper function
async function scoreCompetitorForPrompt(
  comp: DiscoveredCompetitor,
  answersForPrompt: Array<{ item: any; answer: any }>,
  promptText: string,
  existingCompetitors: Array<{ id: string; name: string }>,
  w: { visibility: number; sentiment: number; position: number }
): Promise<CompetitorScoreResult>

// IMPLEMENTED: Batch processing with Promise.allSettled
for (let batchStart = 0; batchStart < competitors.length; batchStart += COMPETITOR_BATCH_SIZE) {
  const batch = competitors.slice(batchStart, batchStart + COMPETITOR_BATCH_SIZE);
  await Promise.allSettled(batch.map(comp => scoreCompetitorForPrompt(...)));
}
```

#### Tasks
- [x] Extract competitor scoring logic into scoreCompetitorForPrompt() helper
- [x] Parallelize competitor scoring with bounded concurrency (3 concurrent)
- [x] Add progress tracking per batch with timing logs
- [ ] Pre-compute and cache answer-level analyses (future optimization)

#### Expected Improvement
- Current: 5 competitors × sequential = ~175s per prompt
- After: 5 competitors ÷ 3 parallel = 2 batches × ~35s = ~70s per prompt (~60% reduction)

---

### Phase 3: Extended Timeouts & Checkpoints (2-3 days) ✅ COMPLETE
**Goal:** Jobs survive long runs and server restarts

#### Architecture Changes

```typescript
// IMPLEMENTED: Dynamic timeout based on workload (job-timeout.ts)
export function calculateJobTimeout(workload: {
  promptCount: number;
  modelCount: number;
  competitorCount?: number;
}): number {
  const BASE_TIMEOUT = 15 * 60 * 1000;           // 15 minutes base
  const PER_ITEM_TIMEOUT = 30 * 1000;            // 30 seconds per item
  const MAX_TIMEOUT = 60 * 60 * 1000;            // 1 hour max
  const items = workload.promptCount * workload.modelCount;
  const competitorFactor = workload.competitorCount 
    ? workload.competitorCount * 10 * 1000  // 10s per competitor
    : 0;
  return Math.min(BASE_TIMEOUT + (items * PER_ITEM_TIMEOUT) + competitorFactor, MAX_TIMEOUT);
}

// IMPLEMENTED: Checkpoint system (shared/schema.ts)
export const runCheckpoints = pgTable("run_checkpoints", {
  id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  promptRunId: varchar("prompt_run_id").notNull().unique().references(() => promptRuns.id, { onDelete: "cascade" }),
  completedItemIds: jsonb("completed_item_ids").default([]),
  currentStage: text("current_stage").default("execution"),  // execution | benchmarking
  promptCount: integer("prompt_count").notNull(),
  modelCount: integer("model_count").notNull(),
  competitorCount: integer("competitor_count").default(0),
  timeoutMs: integer("timeout_ms").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow()
});

// IMPLEMENTED: Resume from checkpoint (prompt-run-executor.ts)
const existingCheckpoint = await storage.getRunCheckpoint(promptRunId);
if (existingCheckpoint) {
  previouslyCompletedIds = new Set(existingCheckpoint.completedItemIds);
  console.log(`Resuming: ${previouslyCompletedIds.size} items already completed`);
}
const items = allItems.filter(item => !previouslyCompletedIds.has(item.id));
```

#### Tasks
- [x] Implement dynamic timeout calculation (job-timeout.ts)
- [x] Add checkpoint table to database schema (shared/schema.ts)
- [x] Implement DbStorage CRUD for checkpoints (db-storage.ts)
- [x] Add MemStorage no-op stubs for checkpoint methods (storage.ts)
- [x] Create checkpoint at run start with workload metadata
- [x] Track completed item IDs during execution
- [x] Update checkpoint stage (execution → benchmarking)
- [x] Resume logic to skip previously completed items
- [x] Delete checkpoint on successful run completion
- [x] Track dynamic timeout per job in job-queue (jobTimeouts map)
- [x] Log timeout when job starts
- [ ] Add "Resume Run" button to UI for failed runs (Phase 4)

#### Database Schema
```sql
CREATE TABLE run_checkpoints (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_run_id VARCHAR NOT NULL UNIQUE REFERENCES prompt_runs(id) ON DELETE CASCADE,
  completed_item_ids JSONB DEFAULT '[]'::jsonb,
  current_stage TEXT DEFAULT 'execution',
  prompt_count INTEGER NOT NULL,
  model_count INTEGER NOT NULL,
  competitor_count INTEGER DEFAULT 0,
  timeout_ms INTEGER NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### Phase 4: Job Resilience & Keep-Alive (3-4 days) ✅ COMPLETE
**Goal:** Jobs complete even when user leaves for hours

**Root Cause Identified:** Jobs would stall when the application was left idle for 1-2 hours on Reserved VM. The VM was still running, but jobs showed "running" status without progress. When users actively refreshed the app, jobs completed fine. This was caused by:
1. No heartbeat mechanism to prove jobs were still alive
2. Timeout detection using only start-time, not ongoing activity
3. Hung executors (stalled API calls, DB timeouts) went undetected
4. No auto-resume capability for stalled jobs

#### Architecture Changes

```typescript
// IMPLEMENTED: Heartbeat mechanism (job-queue.ts)
private jobHeartbeatIntervals = new Map<string, NodeJS.Timeout>();
private readonly HEARTBEAT_INTERVAL_MS = 30 * 1000;  // 30 seconds
private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
private readonly MAX_RESUME_ATTEMPTS = 3;

private startHeartbeat(jobId: string): void {
  this.sendHeartbeat(jobId);
  const interval = setInterval(() => {
    this.sendHeartbeat(jobId);
  }, this.HEARTBEAT_INTERVAL_MS);
  this.jobHeartbeatIntervals.set(jobId, interval);
}

private async sendHeartbeat(jobId: string): Promise<void> {
  await this.storage.updateJob(jobId, { lastHeartbeat: new Date() });
}

// IMPLEMENTED: Stale detection based on heartbeat (job-queue.ts)
private async checkForTimedOutJobs(jobs: Job[]): Promise<void> {
  for (const job of orphanedJobs) {
    if (job.lastHeartbeat) {
      const timeSinceHeartbeat = now - new Date(job.lastHeartbeat).getTime();
      if (timeSinceHeartbeat > this.STALE_THRESHOLD_MS) {
        await this.handleStaleJob(job, 'heartbeat_stale');
        continue;
      }
    }
    // Fall back to start time for legacy jobs
  }
}

// IMPLEMENTED: Auto-resume with checkpoint (job-queue.ts)
private async handleStaleJob(job: Job, reason: string): Promise<void> {
  const resumeCount = job.resumeCount || 0;
  
  if (job.type === 'process_prompt_run' && resumeCount < this.MAX_RESUME_ATTEMPTS) {
    const checkpoint = await this.storage.getRunCheckpoint(payload.promptRunId);
    if (checkpoint) {
      await this.storage.updateJob(job.id, {
        status: "queued",
        resumeCount: resumeCount + 1,
      });
      return; // Will be picked up by processJobs()
    }
  }
  // Mark as failed if no checkpoint or max attempts reached
}
```

#### Tasks
- [x] Add `last_heartbeat` column to jobs table
- [x] Add `resume_count` column to jobs table
- [x] Implement heartbeat updates during job execution (every 30s)
- [x] Change stale detection from "time since start" to "time since heartbeat"
- [x] Implement auto-resume on server startup via recoverStaleJobs()
- [x] Implement auto-resume on stale detection (not just restart)
- [x] Add resume count guard (max 3 attempts)
- [x] Add logging for heartbeat and resume operations
- [x] Clear checkpoint on successful job completion

#### Database Schema
```sql
ALTER TABLE jobs ADD COLUMN last_heartbeat TIMESTAMP;
ALTER TABLE jobs ADD COLUMN resume_count INTEGER DEFAULT 0;
```

#### Key Configuration
| Setting | Value | Purpose |
|---------|-------|---------|
| HEARTBEAT_INTERVAL_MS | 30 seconds | How often job proves it's alive |
| STALE_THRESHOLD_MS | 5 minutes | How long without heartbeat = stale |
| MAX_RESUME_ATTEMPTS | 3 | Prevent infinite retry loops |

---

## Configuration Summary

### New Environment Variables
```bash
# Phase 1: Parallel Execution
PROMPT_BATCH_SIZE=5
OPENAI_MAX_CONCURRENT=5
ANTHROPIC_MAX_CONCURRENT=3
PERPLEXITY_MAX_CONCURRENT=3
GEMINI_MAX_CONCURRENT=1

# Phase 3: Timeouts
JOB_BASE_TIMEOUT_MINUTES=15
JOB_MAX_TIMEOUT_MINUTES=60
JOB_PER_ITEM_TIMEOUT_SECONDS=30

# Phase 4: Resilience
JOB_HEARTBEAT_INTERVAL_SECONDS=30
JOB_STALE_THRESHOLD_MINUTES=5
ENABLE_JOB_AUTO_RESUME=true
```

---

## Expected Results

| Metric | Current | After Phase 1-2 | After Phase 3-4 |
|--------|---------|-----------------|-----------------|
| Max Prompts | 5-6 | 15-20 | 20+ |
| Max Models | 2 | 4 | 4 |
| Max Competitors | 5 | 10 | 10 |
| Run Time (20×4) | Timeout | ~8 minutes | ~8 minutes |
| Idle Tolerance | Fails | Fails | Resumes |
| Server Restart | Lost | Lost | Resumes |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| API Rate Limits | High | Per-provider concurrency limits |
| Database Overload | Medium | Connection gating, batch inserts |
| Parallel Failures | Medium | Promise.allSettled + individual error handling |
| Checkpoint Corruption | Low | Atomic updates, validation on resume |
| Infinite Resume Loop | Low | Resume counter with max attempts |

---

## Implementation Order Recommendation

1. **Phase 1** first - Biggest performance gain, lowest risk
2. **Phase 3** second - Fixes timeout issues
3. **Phase 2** third - Optimizes competitor scoring
4. **Phase 4** last - Full resilience, most complex

---

## Open Questions

1. Should we add a "priority" queue for smaller runs?
2. Do we need a separate background worker process?
3. Should checkpoints be visible in the UI?
4. What's the max timeout we should allow? (1 hour? 2 hours?)

---

## Next Steps

1. Review and approve this plan
2. Decide on implementation priority
3. Begin Phase 0 instrumentation
