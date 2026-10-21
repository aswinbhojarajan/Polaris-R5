import type { IStorage } from "../storage";
import type { InsertJob, Job } from "@shared/schema";
import {
  generateMetadataFromWebsite,
  generateAITopicsFromMetadata,
  generateRealisticPrompts,
} from "../openai-service";
import { executePromptRun } from "./prompt-run-executor";
import { executeWithProductionBudget } from "./pilot-budget/production-runtime";
import { PilotBudgetError } from "./pilot-budget/guard";
import { productionManifest, productionPilotContext } from "./pilot-budget/production-config";
import { crawlWebsite } from "./website-crawler";
import { ingestCrawlResults } from "./xray-ingestion";
import { probeSiteHealth, updateSiteHealth } from "./xray-health-probe";
import { ContentRecommendationAnalyzer } from "./content-recommendation-analyzer";
import { calculateJobTimeout, formatTimeout } from "./job-timeout";
import { RunLogger } from "./run-logger";
import { alertJobFailure } from "./alert-sink";

export class JobQueue {
  private storage: IStorage;
  private processingJobs = new Map<string, number>(); // Map of jobId -> startTime (timestamp)
  private jobTimeouts = new Map<string, number>(); // Map of jobId -> calculated timeout in ms (Phase 3)
  private jobToClient = new Map<string, string>(); // Map of jobId -> clientId (for cleanup on timeout)
  private cancelledJobs = new Set<string>();
  // Task #79 — Distinct from `cancelledJobs` (user-initiated cancel
  // → run status 'cancelled'). When the model-disable cascade flips a
  // wrapping run / job to 'error' in DB, we want the executor to bail
  // out WITHOUT downgrading the terminal state to 'cancelled'.
  private haltedJobs = new Set<string>();
  // Task #139 — True pause. When a user pauses a run, we flag the in-flight
  // job here so the executor's cooperative-cancellation poll throws
  // "Job paused" and unwinds WITHOUT marking items cancelled or clearing
  // the checkpoint, so a later resume picks up from where it stopped.
  private pausedJobs = new Set<string>();
  private processingClients = new Map<string, string>(); // Map of clientId -> jobId
  private jobHeartbeatIntervals = new Map<string, NodeJS.Timeout>(); // Phase 4: heartbeat timers
  private jobWorkerIds = new Map<string, string>(); // Phase 1: Map of jobId -> workerId (prevents duplicate executors)
  private readonly MAX_CONCURRENT_JOBS = 4; // Limit concurrent jobs
  private readonly DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default (Phase 3: increased from 10)
  private readonly HEARTBEAT_INTERVAL_MS = 30 * 1000; // Phase 4: 30 second heartbeat
  private readonly STALE_THRESHOLD_MS = 15 * 60 * 1000; // Phase 1: 15 minutes without heartbeat = stale (increased from 5 min)
  private readonly MAX_RESUME_ATTEMPTS = 3; // Phase 4: Max resume attempts
  // Task #142 — When fencing a run delete against a worker on ANOTHER server
  // instance, treat the DB-recorded owner as still alive only if its heartbeat
  // is fresher than this. Set to 2× the heartbeat interval so a worker that is
  // merely between beats is not mistaken for dead.
  private readonly REMOTE_WORKER_FRESH_MS = 2 * this.HEARTBEAT_INTERVAL_MS;

  // Graceful shutdown state
  private pollingInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.recoverStaleJobs().then(() => {
      this.startProcessing();
    });
  }

  /**
   * Stop the queue from picking up any new jobs. Existing in-flight jobs continue.
   * Idempotent. Used by the SIGTERM handler before draining.
   */
  stopAcceptingJobs(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('[JobQueue] Shutdown: stopped polling for new jobs');
  }

  /**
   * Wait for in-flight jobs to finish, up to `graceMs` milliseconds.
   * Returns true if all jobs drained in time, false if grace period elapsed
   * with jobs still running (caller should consider them stale on next boot).
   */
  async drain(graceMs: number): Promise<boolean> {
    const start = Date.now();
    const pollMs = 250;
    while (this.processingJobs.size > 0) {
      if (Date.now() - start >= graceMs) {
        console.warn(
          `[JobQueue] Shutdown: drain grace period (${graceMs}ms) elapsed with ${this.processingJobs.size} job(s) still in flight`,
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    console.log('[JobQueue] Shutdown: all in-flight jobs drained cleanly');
    return true;
  }

  /**
   * True once the queue has been told to stop accepting work.
   */
  isStopping(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Snapshot of queue health used by the /health and /api/admin/queue endpoints.
   * `active`  - jobs currently being processed by THIS instance
   * `queued`  - jobs in the database waiting to be picked up
   * `stale`   - DB-level running jobs whose last heartbeat is older than STALE_THRESHOLD_MS
   * `config`  - heartbeat / stale / resume tunables (mirrors the in-class constants)
   */
  async getHealthStats(): Promise<{
    active: number;
    queued: number;
    stale: number;
    shuttingDown: boolean;
    config: ReturnType<JobQueue['getConfig']>;
  }> {
    let queued = 0;
    let stale = 0;
    try {
      const jobs = await this.storage.getJobs();
      const now = Date.now();
      for (const job of jobs) {
        if (job.status === 'queued') queued++;
        if (job.status === 'running' && job.lastHeartbeat) {
          const since = now - new Date(job.lastHeartbeat).getTime();
          if (since > this.STALE_THRESHOLD_MS) stale++;
        }
      }
    } catch (err) {
      console.error('[JobQueue] getHealthStats: failed to read jobs:', err);
    }
    return {
      active: this.processingJobs.size,
      queued,
      stale,
      shuttingDown: this.isShuttingDown,
      config: this.getConfig(),
    };
  }

  /**
   * Returns the queue's tunable configuration for admin/debug surfaces.
   */
  getConfig(): {
    heartbeatIntervalMs: number;
    staleThresholdMs: number;
    maxResumeAttempts: number;
    maxConcurrentJobs: number;
    defaultTimeoutMs: number;
  } {
    return {
      heartbeatIntervalMs: this.HEARTBEAT_INTERVAL_MS,
      staleThresholdMs: this.STALE_THRESHOLD_MS,
      maxResumeAttempts: this.MAX_RESUME_ATTEMPTS,
      maxConcurrentJobs: this.MAX_CONCURRENT_JOBS,
      defaultTimeoutMs: this.DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Phase 4: On server startup, attempt to auto-resume stale jobs with checkpoints.
   * For prompt runs with checkpoints and resume attempts remaining, re-queue them.
   * For other jobs or those without resume attempts, mark as failed.
   */
  private async recoverStaleJobs(): Promise<void> {
    try {
      const jobs = await this.storage.getJobs();
      const staleJobs = jobs.filter((job) => job.status === "running");

      if (staleJobs.length > 0) {
        console.log(`[JobQueue] Phase 4: Recovering ${staleJobs.length} stale job(s) from previous server instance`);
        
        for (const job of staleJobs) {
          await this.handleStaleJob(job, 'server_restart');
        }
      }

      // Task #58: Sweep `xray_analysis` rows that have been queued for
      // more than the stale threshold. Before this task there was no
      // worker for that type, so any leftover rows would otherwise sit
      // forever and inflate the active-operations banner.
      const STALE_QUEUED_MS = this.STALE_THRESHOLD_MS;
      const now = Date.now();
      const staleQueued = jobs.filter(
        (job) =>
          job.status === "queued" &&
          job.type === "xray_analysis" &&
          job.createdAt &&
          now - new Date(job.createdAt).getTime() > STALE_QUEUED_MS,
      );
      for (const job of staleQueued) {
        const ageMin = Math.round(
          (now - new Date(job.createdAt!).getTime()) / 60000,
        );
        console.log(
          `[JobQueue] Task #58: Failing stale queued xray_analysis job ${job.id} (queued ${ageMin}min ago, no worker before this version)`,
        );
        await this.storage.updateJob(job.id, {
          status: "error",
          error: `xray_analysis job timed out in queue after ${ageMin} minutes without being picked up.`,
          finishedAt: new Date(),
        });
      }

      // Task #105 (R1) — Stale `report_generation` queued sweep. The
      // generic `running` sweep above will route running rows through
      // handleStaleJob (which now cascades to report_jobs/snapshots
      // and may auto-resume from a checkpointed snapshotId), so here
      // we only need to fail rows that sat in the queue forever.
      const staleQueuedReportJobs = jobs.filter(
        (job) =>
          job.type === "report_generation" &&
          job.status === "queued" &&
          job.createdAt &&
          now - new Date(job.createdAt).getTime() > STALE_QUEUED_MS,
      );
      for (const job of staleQueuedReportJobs) {
        const ageMin = Math.round(
          (now - new Date(job.createdAt!).getTime()) / 60000,
        );
        const reason = `Stale job reaped — never picked up (${ageMin}min old)`;
        console.log(
          `[JobQueue] Task #105: Failing stale queued report_generation job ${job.id} (${ageMin}min old)`,
        );
        await this.storage.updateJob(job.id, {
          status: "error",
          error: reason,
          finishedAt: new Date(),
        });
        await this.failLinkedReportRows(job, reason);
      }
    } catch (error) {
      console.error("[JobQueue] Error recovering stale jobs:", error);
    }
  }

  /**
   * Task #105 (R1) — Cascade a report_generation job failure down to
   * the linked `report_jobs` and `report_snapshots` rows so the
   * user-facing UI exits its spinner. Best-effort and idempotent: a
   * second invocation just no-ops via the WHERE clause if the rows
   * are already failed. The processor stamps `payload.snapshotId`
   * after Step 1; if it never got that far, there's nothing to clean
   * up here and we silently return.
   */
  private async failLinkedReportRows(job: Job, reason: string): Promise<void> {
    if (job.type !== "report_generation") return;
    const payload = (job.payload as { snapshotId?: string } | null) || {};
    if (!payload.snapshotId) return;
    try {
      const { db } = await import("../db");
      const { reportJobs, reportSnapshots } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(reportJobs)
        .set({
          status: "failed",
          errorMessage: reason,
          progressMessage: `Failed: ${reason}`,
          completedAt: new Date(),
        })
        .where(eq(reportJobs.snapshotId, payload.snapshotId));
      await db
        .update(reportSnapshots)
        .set({ status: "failed" })
        .where(eq(reportSnapshots.id, payload.snapshotId));
    } catch (err) {
      console.error(
        `[JobQueue] Failed to mark report snapshot ${payload.snapshotId} failed:`,
        err,
      );
    }
  }

  /**
   * Phase 4: Handle a stale job - attempt auto-resume for prompt runs with checkpoints,
   * or mark as failed if resume not possible.
   * Phase 1: Added workerId check to prevent resuming jobs still owned by active workers.
   * Task #105 (R1+R2): Added auto-resume for report_generation jobs that
   * have a checkpointed snapshotId (skips already-completed steps via
   * cached narratives/appendix on the snapshot row), and cascade to
   * report_jobs/report_snapshots when failing.
   */
  private async handleStaleJob(job: Job, reason: 'server_restart' | 'heartbeat_stale' | 'timeout'): Promise<void> {
    const resumeCount = job.resumeCount || 0;
    
    // Phase 1: Check if this job is still being actively worked on
    // Option A: Check if we own it locally (this instance)
    const localWorkerId = this.jobWorkerIds.get(job.id);
    if (localWorkerId && job.workerId === localWorkerId) {
      console.log(`[JobQueue] Phase 1: Job ${job.id} is owned by this instance (${localWorkerId}), skipping stale handling`);
      return;
    }
    
    // Phase 1 Option B: Check if heartbeat is recent - worker may be alive on another instance
    // Only skip if job has a workerId AND heartbeat is within threshold (worker is alive)
    if (job.workerId && job.lastHeartbeat) {
      const now = Date.now();
      const lastHeartbeatTime = new Date(job.lastHeartbeat).getTime();
      const timeSinceHeartbeat = now - lastHeartbeatTime;
      
      // If heartbeat is recent, the worker is still alive - don't resume
      if (timeSinceHeartbeat < this.STALE_THRESHOLD_MS) {
        console.log(`[JobQueue] Phase 1: Job ${job.id} has active worker (${job.workerId}), last heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago, skipping stale handling`);
        return;
      }
    }
    
    // Task #105 (R1+R2) — auto-resume report_generation jobs that have
    // a checkpointed snapshotId. The processor's existingSnapshotId
    // path will hydrate cached narratives/appendix and skip any step
    // that already completed, so resumes don't re-pay the OpenAI cost.
    if (job.type === 'report_generation' && resumeCount < this.MAX_RESUME_ATTEMPTS) {
      const reportPayload = (job.payload as { snapshotId?: string } | null) || {};
      if (reportPayload.snapshotId) {
        console.log(
          `[JobQueue] Task #105: Auto-resuming report_generation job ${job.id} from snapshot ${reportPayload.snapshotId} - attempt ${resumeCount + 1}/${this.MAX_RESUME_ATTEMPTS} - reason: ${reason}`,
        );
        await this.storage.updateJob(job.id, {
          status: "queued",
          error: null,
          startedAt: null,
          lastHeartbeat: null,
          workerId: null,
          resumeCount: resumeCount + 1,
        });
        return;
      }
      // No snapshotId checkpointed yet — fall through to fail path
      // and cascade to the (still-empty) linked rows below.
    }

    // Only auto-resume prompt runs with checkpoints and under max attempts
    if (job.type === 'process_prompt_run' && resumeCount < this.MAX_RESUME_ATTEMPTS) {
      try {
        const payload = job.payload as { promptRunId: string };
        const checkpoint = await this.storage.getRunCheckpoint(payload.promptRunId);
        
        if (checkpoint) {
          // Re-queue the job for resume with incremented resume count
          console.log(`[JobQueue] Phase 4: Auto-resuming job ${job.id} (${job.type}) - attempt ${resumeCount + 1}/${this.MAX_RESUME_ATTEMPTS} - reason: ${reason}`);
          console.log(`[JobQueue] Phase 4: Checkpoint found - ${checkpoint.completedItemIds.length} items already completed, stage: ${checkpoint.currentStage}`);
          
          await this.storage.updateJob(job.id, {
            status: "queued",
            error: null,
            startedAt: null,
            lastHeartbeat: null,
            workerId: null, // Phase 1: Clear workerId on re-queue
            resumeCount: resumeCount + 1,
          });
          return;
        }
      } catch (e) {
        console.error(`[JobQueue] Phase 4: Error checking checkpoint for job ${job.id}:`, e);
      }
    }
    
    // No checkpoint or max attempts reached - mark as failed
    const errorMessage = resumeCount >= this.MAX_RESUME_ATTEMPTS
      ? `Job failed after ${resumeCount} resume attempts. Reason: ${reason}`
      : `Job interrupted (${reason}). No checkpoint available for resume.`;
    
    console.log(`[JobQueue] Phase 4: Marking job ${job.id} (${job.type}) as failed - ${errorMessage}`);
    
    // Log failure for prompt runs
    if (job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.error('Job failed - stale/timeout', { reason, resumeCount, errorMessage });
    }
    
    await this.storage.updateJob(job.id, {
      status: "error",
      error: errorMessage,
      finishedAt: new Date(),
      workerId: null, // Phase 1: Clear workerId on failure
    });

    // Task #115 — operational alert only when a job actually exhausts
    // its resume attempts. First-failure / no-checkpoint terminal cases
    // skip the alert to avoid flooding ops on transient blips that were
    // never going to be auto-retried in the first place.
    if (resumeCount >= this.MAX_RESUME_ATTEMPTS) {
      void alertJobFailure({
        jobId: job.id,
        jobType: job.type,
        attempts: resumeCount,
        error: errorMessage,
      });
    }

    // Task #105 (R1) — cascade report_generation failures to the
    // linked report_jobs/report_snapshots rows so the UI spinner
    // stops immediately, not just on the >15min queued sweep.
    if (job.type === 'report_generation') {
      await this.failLinkedReportRows(job, errorMessage);
    }
  }

  /**
   * Phase 4: Start heartbeat for a job - sends periodic updates to prove job is alive
   */
  private startHeartbeat(jobId: string): void {
    // Clear any existing interval for this job
    this.stopHeartbeat(jobId);
    
    // Send initial heartbeat
    this.sendHeartbeat(jobId);
    
    // Set up periodic heartbeat
    const interval = setInterval(() => {
      this.sendHeartbeat(jobId);
    }, this.HEARTBEAT_INTERVAL_MS);
    
    this.jobHeartbeatIntervals.set(jobId, interval);
    console.log(`[JobQueue] Phase 4: Started heartbeat for job ${jobId} (every ${this.HEARTBEAT_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Phase 4: Stop heartbeat for a job
   */
  private stopHeartbeat(jobId: string): void {
    const interval = this.jobHeartbeatIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.jobHeartbeatIntervals.delete(jobId);
      console.log(`[JobQueue] Phase 4: Stopped heartbeat for job ${jobId}`);
    }
  }

  /**
   * Phase 4: Send a heartbeat update to the database
   */
  private async sendHeartbeat(jobId: string): Promise<void> {
    try {
      await this.storage.updateJob(jobId, {
        lastHeartbeat: new Date(),
      });
    } catch (e) {
      console.error(`[JobQueue] Phase 4: Failed to send heartbeat for job ${jobId}:`, e);
    }
  }

  /**
   * Phase 1: Helper that wraps a long operation with heartbeat sending.
   * Ensures heartbeats continue during long-running operations.
   */
  private async withHeartbeat<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
    this.startHeartbeat(jobId);
    try {
      return await operation();
    } finally {
      this.stopHeartbeat(jobId);
    }
  }

  async enqueue(job: InsertJob): Promise<Job> {
    if (productionPilotContext.getStore() && job.type !== "process_prompt_run")
      throw new PilotBudgetError("UNAPPROVED_PILOT_JOB");
    if (this.isShuttingDown) {
      throw new Error('JobQueue is shutting down and is not accepting new jobs');
    }

    const createdJob = await this.storage.createJob(job);

    // Log job enqueued for prompt runs
    if (job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.info('Job enqueued', { jobId: createdJob.id });
    }

    // Trigger immediate processing (non-blocking)
    this.processJobs().catch((err) =>
      console.error("Error in immediate job processing:", err),
    );

    return createdJob;
  }

  async cancelJob(jobId: string): Promise<void> {
    // Mark job as cancelled in our tracking set
    this.cancelledJobs.add(jobId);

    // Log cancellation for prompt runs
    const job = await this.storage.getJob(jobId);
    if (job && job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.warn('Job cancelled by user', { jobId });
    }

    // Update job status in database
    await this.storage.updateJob(jobId, {
      status: "cancelled",
      finishedAt: new Date(),
    });
  }

  isJobCancelled(jobId: string): boolean {
    return this.cancelledJobs.has(jobId);
  }

  /**
   * Task #139 — Pause an in-flight or queued job. Flags it locally so the
   * executor's cooperative poll throws "Job paused" and unwinds without
   * marking items cancelled or clearing the checkpoint, and flips the DB
   * row to 'paused' so the queue picker (which only takes 'queued') leaves
   * it alone and it no longer counts toward concurrency or the activity
   * banner. A queued-but-not-yet-started job is simply parked in 'paused'.
   */
  async pauseJob(jobId: string): Promise<void> {
    this.pausedJobs.add(jobId);
    const job = await this.storage.getJob(jobId);
    if (job && job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.warn('Job paused by user', { jobId });
    }
    await this.storage.updateJob(jobId, { status: 'paused' });
  }

  /**
   * Task #139 — Resume a paused job. Re-queues it (without bumping
   * resumeCount, since a pause is not a failure) and clears the local
   * pause flag. The executor reads the preserved checkpoint and skips
   * already-completed items, so no completed work is re-paid for.
   */
  async resumeJob(jobId: string): Promise<void> {
    this.pausedJobs.delete(jobId);
    const job = await this.storage.getJob(jobId);
    if (job && job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.info('Job resumed by user', { jobId });
    }
    await this.storage.updateJob(jobId, {
      status: 'queued',
      error: null,
      startedAt: null,
      lastHeartbeat: null,
      workerId: null,
    });
  }

  /**
   * Task #139 — Stop the job backing a prompt run BEFORE deletion and wait
   * for the in-flight worker to wind down, so a delete never leaves an
   * orphaned worker still writing to rows we are about to remove. Returns
   * once the worker has released its processing slot (or after a short
   * timeout). Safe to call when no live job exists.
   *
   * Task #142 — The wind-down must account for a worker running on ANOTHER
   * server instance (horizontal scale). We cannot see a remote instance's
   * in-memory `processingJobs` set, so we use the job row in Postgres as the
   * cross-instance coordination point: setting status='cancelled' is picked up
   * by the remote executor's cancel-poll (every 2s), which unwinds and clears
   * its DB ownership markers (`workerId` + `lastHeartbeat`) in its `finally`.
   * We therefore wait until the job is owned by neither the local instance NOR
   * a live remote worker before returning, fencing the delete against remote
   * writes to rows we are about to remove.
   */
  async cancelRunJobAndWait(promptRunId: string, timeoutMs = 8000): Promise<void> {
    const jobs = await this.storage.getJobs();
    const job = jobs.find(
      (j) =>
        j.type === 'process_prompt_run' &&
        (j.payload as { promptRunId: string }).promptRunId === promptRunId &&
        (j.status === 'queued' || j.status === 'running' || j.status === 'paused'),
    );
    if (!job) return;

    // Flag locally so a running executor bails cooperatively, and clear any
    // pause flag so it takes the cancellation path (not the pause path).
    this.pausedJobs.delete(job.id);
    this.cancelledJobs.add(job.id);
    await this.storage.updateJob(job.id, {
      status: 'cancelled',
      finishedAt: new Date(),
    });

    // Wait for the worker to release on ANY instance.
    //   - Local: the slot is held while `processingJobs` has this job.
    //   - Remote: the DB job still names a `workerId` whose `lastHeartbeat` is
    //     recent. Once the remote executor unwinds it clears both markers, so a
    //     null/absent workerId (or a stale heartbeat from a crashed worker)
    //     means no live remote owner remains.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.processingJobs.has(job.id)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const fresh = await this.storage.getJob(job.id);
      if (!fresh) return; // Row already gone — nothing to fence against.

      const heartbeatAgeMs = fresh.lastHeartbeat
        ? Date.now() - new Date(fresh.lastHeartbeat).getTime()
        : Infinity;
      const remoteWorkerAlive =
        !!fresh.workerId && heartbeatAgeMs < this.REMOTE_WORKER_FRESH_MS;
      if (!remoteWorkerAlive) return; // Released by every instance — safe to delete.

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private async startProcessing(): Promise<void> {
    if (this.isShuttingDown) return;
    // Start processing jobs on a regular interval; keep handle for graceful shutdown.
    this.pollingInterval = setInterval(() => {
      this.processJobs().catch((err) => {
        // Silently ignore connection errors during database recovery
        if (
          !err.message?.includes("aborted due to timeout") &&
          !err.message?.includes("Too many database connection attempts")
        ) {
          console.error("Error in interval job processing:", err);
        }
      });
    }, 15000); // Reduced polling frequency: Check every 15 seconds (instead of 5) to reduce database load
  }

  private async processJobs(): Promise<void> {
    if (this.isShuttingDown) return;
    try {
      const jobs = await this.storage.getJobs();
      
      // Check for timed-out jobs that are not being tracked by this instance
      // (could happen if server restarted but job wasn't caught by recoverStaleJobs)
      await this.checkForTimedOutJobs(jobs);
      
      const queuedJobs = jobs.filter(
        (job) => job.status === "queued" && !this.processingJobs.has(job.id),
      );

      // Filter out jobs for clients that already have a running job (max 1 per client)
      const eligibleJobs = queuedJobs.filter((job) => {
        const clientId = this.extractClientId(job);
        if (clientId && this.processingClients.has(clientId)) {
          return false; // Client already has a running job
        }
        return true;
      });

      // Limit concurrent jobs to MAX_CONCURRENT_JOBS
      const availableSlots = Math.max(
        0,
        this.MAX_CONCURRENT_JOBS - this.processingJobs.size,
      );
      const jobsToProcess = eligibleJobs.slice(0, availableSlots);

      if (jobsToProcess.length > 0) {
        console.log(
          `[JobQueue] Processing ${jobsToProcess.length} jobs (${this.processingJobs.size} currently running, ${availableSlots} slots available)`,
        );
        const processingPromises = jobsToProcess.map((job) =>
          this.processSingleJob(job),
        );
        await Promise.allSettled(processingPromises);
      }
    } catch (error) {
      console.error("Error getting jobs:", error);
    }
  }

  /**
   * Phase 4: Check for stale and timed-out jobs using heartbeat-based detection.
   * This catches:
   * 1. Jobs from previous server instances that weren't recovered on startup
   * 2. Jobs actively being processed that have gone stale (no heartbeat)
   * 3. Jobs that have exceeded their timeout
   */
  private async checkForTimedOutJobs(jobs: Job[]): Promise<void> {
    const now = Date.now();
    
    // Phase 4: Check jobs running on OTHER instances (not tracked locally)
    // Use heartbeat for stale detection, or fall back to start time for old jobs without heartbeat
    const orphanedJobs = jobs.filter(
      (job) => job.status === "running" && !this.processingJobs.has(job.id)
    );

    for (const job of orphanedJobs) {
      // Phase 4: First check for stale heartbeat (more responsive than timeout)
      if (job.lastHeartbeat) {
        const lastHeartbeatTime = new Date(job.lastHeartbeat).getTime();
        const timeSinceHeartbeat = now - lastHeartbeatTime;
        
        if (timeSinceHeartbeat > this.STALE_THRESHOLD_MS) {
          console.log(
            `[JobQueue] Phase 4: Job ${job.id} (${job.type}) stale - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000 / 60)} minutes (threshold: ${this.STALE_THRESHOLD_MS / 1000 / 60}min)`
          );
          await this.handleStaleJob(job, 'heartbeat_stale');
          continue;
        }
      }
      
      // Fall back to start time check for jobs without heartbeat (legacy or newly started)
      if (job.startedAt) {
        const startTime = new Date(job.startedAt).getTime();
        const runningTime = now - startTime;

        // Phase 3: Try to get dynamic timeout from checkpoint, fall back to default
        const jobTimeout = await this.getJobTimeout(job);
        if (runningTime > jobTimeout) {
          console.log(
            `[JobQueue] Phase 4: Orphaned job ${job.id} (${job.type}) timed out after ${Math.round(runningTime / 1000 / 60)} minutes (limit: ${formatTimeout(jobTimeout)})`
          );
          await this.handleStaleJob(job, 'timeout');
        }
      }
    }

    // Phase 4: Check jobs running on THIS instance for timeout
    // (heartbeat should be updating regularly, so only check timeout)
    const activeJobs = Array.from(this.processingJobs.entries());
    for (const [jobId, startTime] of activeJobs) {
      const runningTime = now - startTime;
      
      // Phase 3: Use tracked timeout or default
      const jobTimeout = this.jobTimeouts.get(jobId) || this.DEFAULT_TIMEOUT_MS;
      if (runningTime > jobTimeout) {
        const minutes = Math.round(runningTime / 1000 / 60);
        console.log(
          `[JobQueue] Phase 4: Active job ${jobId} timed out after ${minutes} minutes - releasing slot`
        );
        
        // Stop heartbeat for this job
        this.stopHeartbeat(jobId);
        
        // Mark as cancelled so the job handler can detect it and stop gracefully
        this.cancelledJobs.add(jobId);
        
        // Release the processing slot so new jobs can run
        this.processingJobs.delete(jobId);
        
        // Release the client slot if this job was associated with a client
        const clientId = this.jobToClient.get(jobId);
        if (clientId) {
          this.processingClients.delete(clientId);
          this.jobToClient.delete(jobId);
        }
        
        // Get the job to attempt auto-resume
        try {
          const job = jobs.find(j => j.id === jobId);
          if (job) {
            await this.handleStaleJob(job, 'timeout');
          } else {
            await this.storage.updateJob(jobId, {
              status: "error",
              error: `Job timed out after ${minutes} minutes. The operation took too long.`,
              finishedAt: new Date(),
            });
          }
          console.log(`[JobQueue] Phase 4: Released slot for timed out job ${jobId}`);
        } catch (e) {
          console.error(`[JobQueue] Phase 4: Failed to handle timed out job ${jobId}:`, e);
        }
      }
    }
  }

  private extractClientId(job: Job): string | null {
    try {
      const payload = job.payload as any;
      return payload?.clientId || null;
    } catch {
      return null;
    }
  }

  /**
   * Phase 3: Get the timeout for a job, checking checkpoint first, then calculating dynamically
   */
  private async getJobTimeout(job: Job): Promise<number> {
    // For prompt run jobs, try to get timeout from checkpoint
    if (job.type === 'process_prompt_run') {
      try {
        const payload = job.payload as any;
        const promptRunId = payload?.promptRunId;
        if (promptRunId) {
          const checkpoint = await this.storage.getRunCheckpoint(promptRunId);
          if (checkpoint?.timeoutMs) {
            return checkpoint.timeoutMs;
          }
          // Phase 2: Calculate dynamic timeout based on actual run workload
          const promptRun = await this.storage.getPromptRun(promptRunId);
          if (promptRun) {
            // Use run-level metrics for accurate timeout calculation
            const promptRunItems = await this.storage.getPromptRunItems(promptRunId);
            const competitors = await this.storage.getCompetitors(promptRun.clientId);
            
            // Get unique model count from run items (more accurate than client-level)
            const uniqueModelIds = new Set(promptRunItems.map(item => item.modelId));
            const modelCount = uniqueModelIds.size || 1;
            
            // Use totalPrompts from run record, fallback to items/models
            const promptCount = promptRun.totalPrompts || Math.ceil(promptRunItems.length / modelCount) || 1;
            
            return calculateJobTimeout({
              webSearchEnabled: (promptRun.searchConfig as { webSearch?: { enabled?: boolean } } | null)?.webSearch?.enabled === true,
              promptCount,
              modelCount,
              competitorCount: competitors.length
            });
          }
        }
      } catch (e) {
        console.error('[JobQueue] Error getting job timeout:', e);
      }
    }
    return this.DEFAULT_TIMEOUT_MS;
  }

  private async processSingleJob(job: Job): Promise<void> {
    // Check if job was cancelled before starting
    if (this.isJobCancelled(job.id)) {
      console.log(`Job ${job.id} was cancelled before processing`);
      return;
    }

    // Phase 1: Generate unique workerId to prevent duplicate executors
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Phase 1: Atomically claim the job - prevents race conditions across instances
    const claimedJob = await this.storage.claimJob(job.id, workerId);
    if (!claimedJob) {
      // Another worker claimed this job first - abort silently
      console.log(`[JobQueue] Phase 1: Job ${job.id} was already claimed by another worker, skipping`);
      return;
    }
    
    // Mark this job as being processed with current timestamp
    this.processingJobs.set(job.id, Date.now());
    this.jobWorkerIds.set(job.id, workerId);
    
    // Phase 3: Calculate and track dynamic timeout for this job
    const dynamicTimeout = await this.getJobTimeout(job);
    this.jobTimeouts.set(job.id, dynamicTimeout);
    
    // Phase 4: Log resume status if this is a resumed job
    const resumeCount = job.resumeCount || 0;
    if (resumeCount > 0) {
      console.log(`[JobQueue] Phase 4: Resuming job ${job.id} (${job.type}) - attempt ${resumeCount}/${this.MAX_RESUME_ATTEMPTS}`);
    }
    console.log(`[JobQueue] Job ${job.id} (${job.type}) started with timeout: ${formatTimeout(dynamicTimeout)}, workerId: ${workerId}`);
    
    // Log job start for prompt runs
    if (job.type === 'process_prompt_run') {
      const payload = job.payload as { promptRunId: string };
      const logger = RunLogger.forRun(payload.promptRunId);
      await logger.info('Job started', { 
        jobId: job.id, 
        workerId, 
        timeoutMs: dynamicTimeout,
        resumeCount: resumeCount > 0 ? resumeCount : undefined
      });
    }

    // Track client processing (max 1 job per client)
    const clientId = this.extractClientId(job);
    if (clientId) {
      this.processingClients.set(clientId, job.id);
      this.jobToClient.set(job.id, clientId); // Track reverse mapping for timeout cleanup
    }

    // Phase 4: Start heartbeat to prove job is alive (claimJob already set initial heartbeat)
    this.startHeartbeat(claimedJob.id);

    try {
      // Job is already claimed with status='running', workerId set, etc. by claimJob
      // Use claimedJob instead of stale job snapshot for accurate state

      // Process the job based on type
      const pilot = productionManifest();
      if (pilot && claimedJob.type !== "process_prompt_run" && this.extractClientId(claimedJob) === pilot.clientId)
        throw new PilotBudgetError("UNAPPROVED_PILOT_JOB");
      // An enqueue can synchronously start unrelated customer jobs. Do not
      // let the caller's HTTP sentinel leak into another job's SDK requests.
      await productionPilotContext.exit(() => this.processJob(claimedJob));

      // Check if job was cancelled during processing
      if (this.isJobCancelled(job.id)) {
        console.log(`Job ${job.id} was cancelled during processing`);
        return;
      }

      // Task #79 — Gate the "done" write on the current DB state. The
      // model-disable cascade can flip this job to `error` directly in
      // DB while we were mid-flight; the executor's halted path returns
      // without throwing, so without this guard the queue would
      // overwrite the cascade's `error` back to `done`.
      const currentJob = await this.storage.getJob(job.id);
      if (
        currentJob &&
        (currentJob.status === "error" || currentJob.status === "cancelled")
      ) {
        console.log(
          `[JobQueue] Job ${job.id} is already terminal (${currentJob.status}); skipping completion write`,
        );
        return;
      }
      // Task #139 — A paused job must NOT be marked 'done' and its
      // checkpoint must be preserved for resume. The executor unwound via
      // the "Job paused" path (returning, not throwing), so bail before the
      // completion write + checkpoint deletion below.
      if (currentJob && currentJob.status === "paused") {
        console.log(
          `[JobQueue] Job ${job.id} was paused; skipping completion write and preserving checkpoint`,
        );
        return;
      }
      if (this.haltedJobs.has(job.id)) {
        console.log(
          `[JobQueue] Job ${job.id} was halted by admin disable; skipping completion write`,
        );
        return;
      }

      // Phase 4: Clear checkpoint on successful completion (for prompt runs)
      if (job.type === 'process_prompt_run') {
        try {
          const payload = job.payload as { promptRunId: string };
          await this.storage.deleteRunCheckpoint(payload.promptRunId);
          console.log(`[JobQueue] Phase 4: Cleared checkpoint for completed prompt run ${payload.promptRunId}`);
        } catch (e) {
          console.error(`[JobQueue] Phase 4: Failed to clear checkpoint:`, e);
        }
      }

      await this.storage.updateJob(job.id, {
        status: "done",
        finishedAt: new Date(),
        workerId: null, // Phase 1: Clear workerId on completion
      });
    } catch (error) {
      // Don't update error status if job was cancelled
      if (!this.isJobCancelled(job.id)) {
        await this.storage.updateJob(job.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
          finishedAt: new Date(),
          workerId: null, // Phase 1: Clear workerId on error
        });
      }
    } finally {
      // Phase 4: Stop heartbeat
      this.stopHeartbeat(job.id);

      // Task #142 — Clear the DB ownership markers so a concurrent delete on
      // ANY instance (cancelRunJobAndWait) can observe that this worker has
      // released the job. The done/error paths already null `workerId`; this
      // also covers the cancel / halt / pause early-returns above, which return
      // without clearing it. Status is intentionally left untouched so we never
      // clobber a terminal (cancelled/error/paused/done) state. Best-effort:
      // if the row is already gone (the racing delete won), there is nothing to
      // fence and the error is benign.
      try {
        await this.storage.updateJob(job.id, {
          workerId: null,
          lastHeartbeat: null,
        });
      } catch {
        // Row likely already deleted by the concurrent delete — safe to ignore.
      }

      // Remove from processing and cancelled sets
      this.processingJobs.delete(job.id);
      this.jobTimeouts.delete(job.id); // Phase 3: Clean up dynamic timeout tracking
      this.jobWorkerIds.delete(job.id); // Phase 1: Clean up workerId tracking
      this.cancelledJobs.delete(job.id);
      this.jobToClient.delete(job.id);

      // Remove client from processing map
      if (clientId) {
        this.processingClients.delete(clientId);
      }
    }
  }

  private async processJob(job: Job): Promise<void> {
    switch (job.type) {
      case "process_prompt_run":
        const promptRunPayload = job.payload as { promptRunId: string };
        await this.processPromptRun(promptRunPayload.promptRunId, job.id);
        break;
      case "generate_metadata":
        const metadataPayload = job.payload as {
          clientId: string;
          enableSiteXRay?: boolean;
        };
        await this.generateMetadata(
          metadataPayload.clientId,
          job.id,
          metadataPayload.enableSiteXRay,
        );
        break;
      case "crawler_raw":
        const crawlerPayload = job.payload as {
          url: string;
          options?: any;
          jobId: string;
        };
        await this.processCrawlerJob(
          crawlerPayload.url,
          crawlerPayload.options,
          job.id,
        );
        break;
      case "xray_analysis":
        const xrayPayload = job.payload as {
          siteId: string;
          clientId: string;
        };
        await this.processXRayAnalysis(
          xrayPayload.siteId,
          xrayPayload.clientId,
          job.id,
        );
        break;
      case "report_generation":
        // Task #105 (R1) — Executive report generation. Was a detached
        // promise inside POST /api/v1/reports/generate, which lost work
        // on restart. Now goes through the same queue / heartbeat / stale
        // sweep machinery as every other long job.
        await this.processReportGenerationJob(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private async processPromptRun(
    promptRunId: string,
    jobId?: string,
  ): Promise<void> {
    console.log(`Processing prompt run: ${promptRunId}`);

    const updateProgress = async (progress: number, message: string) => {
      if (jobId) {
        await this.storage.updateJob(jobId, { progress });
      }
      console.log(`[${progress}%] ${message}`);
    };

    const checkCancellation = () => {
      if (jobId && this.haltedJobs.has(jobId)) {
        // Task #79 — Distinct from "Job cancelled". The executor's
        // top-level catch matches this exact message so it preserves
        // the existing 'error' status on the run instead of overwriting
        // it to 'cancelled'.
        throw new Error("Run halted by admin disable");
      }
      if (jobId && this.pausedJobs.has(jobId)) {
        // Task #139 — Distinct from cancel/halt. The executor's top-level
        // catch matches this exact message and unwinds WITHOUT marking
        // items cancelled or clearing the checkpoint, so a resume picks up
        // from where it stopped.
        throw new Error("Job paused");
      }
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error("Job cancelled");
      }
    };

    // Task #79 — Cooperative cancellation for the model-disable cascade.
    // The cascade marks `prompt_runs.status = 'error'` and the wrapping
    // `jobs.status = 'error'` directly in DB. Poll every 2s and:
    //   - On true cancellation ('cancelled'), add to cancelledJobs so
    //     the executor's cancellation path runs.
    //   - On disable-induced 'error', add to haltedJobs so the executor
    //     unwinds via the generic error path and the existing 'error'
    //     state is preserved (NOT downgraded to 'cancelled').
    const cancelPoll = setInterval(async () => {
      if (!jobId) return;
      try {
        const [run, job] = await Promise.all([
          this.storage.getPromptRun(promptRunId),
          this.storage.getJob(jobId),
        ]);
        const isCancelled =
          run?.status === "cancelled" || job?.status === "cancelled";
        const isHalted =
          run?.status === "error" || job?.status === "error";
        const isPaused =
          run?.status === "paused" || job?.status === "paused";
        if (isCancelled) {
          this.cancelledJobs.add(jobId);
        } else if (isHalted) {
          this.haltedJobs.add(jobId);
        } else if (isPaused) {
          // Task #139 — A pause flips the run/job to 'paused' in DB; mirror
          // it into the local set so checkCancellation throws "Job paused".
          this.pausedJobs.add(jobId);
        }
      } catch {
        // Best-effort; the next tick will retry.
      }
    }, 2000);

    // Phase 1: Create heartbeat callback to send during long operations
    const onHeartbeat = jobId ? async () => {
      await this.sendHeartbeat(jobId);
    } : undefined;

    try {
      await executeWithProductionBudget(promptRunId, () => executePromptRun({
        storage: this.storage,
        promptRunId,
        onProgress: updateProgress,
        checkCancellation,
        onHeartbeat,
      }));
    } catch (failure) {
      if (failure instanceof PilotBudgetError) {
        const run = await this.storage.getPromptRun(promptRunId);
        if (run && (run.status === "queued" || run.status === "running")) {
          await this.storage.updatePromptRun(promptRunId, { status: "error", errorSummary: failure.message });
        }
      }
      throw failure;
    } finally {
      clearInterval(cancelPoll);
      if (jobId) {
        this.haltedJobs.delete(jobId);
        this.pausedJobs.delete(jobId);
      }
    }
  }

  private async generateMetadata(
    clientId: string,
    jobId?: string,
    enableSiteXRay: boolean = false,
  ): Promise<void> {
    console.log(
      `Generating metadata for client: ${clientId}${enableSiteXRay ? " (with Site X-Ray Analysis)" : ""}`,
    );

    const updateProgress = async (progress: number) => {
      if (jobId) {
        await this.storage.updateJob(jobId, { progress });
      }
    };

    try {
      await updateProgress(10); // Started

      // Get client details
      const client = await this.storage.getClient(clientId);
      if (!client) {
        throw new Error(`Client not found: ${clientId}`);
      }

      // Helper function to normalize URLs for deduplication
      const normalizeUrl = (url: string): string => {
        try {
          const urlObj = new URL(url);
          // Ignore protocol (http vs https), lowercase hostname, remove trailing slash, remove fragments
          return `${urlObj.hostname.toLowerCase()}${urlObj.pathname.replace(/\/$/, "")}${urlObj.search}`;
        } catch {
          return url.toLowerCase().trim();
        }
      };

      // Extract all URLs (primary, secondary, third-party) with their categories
      const allUrls: string[] = [];
      const urlCategories: Map<
        string,
        "primary" | "secondary" | "third_party"
      > = new Map();
      const seenNormalizedUrls = new Set<string>();

      // Add primary website if exists
      if (client.website) {
        const normalized = normalizeUrl(client.website);
        if (!seenNormalizedUrls.has(normalized)) {
          allUrls.push(client.website);
          urlCategories.set(client.website, "primary");
          seenNormalizedUrls.add(normalized);
        }
      }

      // Add URLs from the urls field (primary, secondary, third-party)
      if (client.urls && Array.isArray(client.urls)) {
        for (const urlObj of client.urls) {
          if (
            urlObj &&
            typeof urlObj === "object" &&
            urlObj.url &&
            typeof urlObj.url === "string"
          ) {
            const normalized = normalizeUrl(urlObj.url);
            if (!seenNormalizedUrls.has(normalized)) {
              allUrls.push(urlObj.url);
              // Map category to siteType: 'primary' and 'secondary' -> 'internal', 'third_party' -> 'third_party'
              const category =
                urlObj.category === "third_party" ? "third_party" : "internal";
              urlCategories.set(urlObj.url, category as any);
              seenNormalizedUrls.add(normalized);
            }
          }
        }
      }

      if (allUrls.length === 0) {
        throw new Error(
          `Client ${clientId} has no URLs - cannot generate metadata`,
        );
      }

      // Extract and validate focus areas
      const focusAreas: string[] = [];
      let invalidFocusAreasCount = 0;

      if (client.focusAreas) {
        if (!Array.isArray(client.focusAreas)) {
          console.warn(
            `Client ${clientId} has malformed focusAreas (not an array):`,
            typeof client.focusAreas,
          );
        } else {
          for (const area of client.focusAreas) {
            if (typeof area === "string" && area.trim().length > 0) {
              focusAreas.push(area.trim());
            } else {
              invalidFocusAreasCount++;
            }
          }

          if (invalidFocusAreasCount > 0) {
            console.warn(
              `Client ${clientId} has ${invalidFocusAreasCount} invalid focus area(s) - non-string or empty values filtered out`,
            );
          }
        }
      }

      console.log(`Generating metadata for client ${client.name}:`);
      console.log(
        `  - ${allUrls.length} unique URLs to crawl: ${allUrls.join(", ")}`,
      );
      console.log(
        `  - ${focusAreas.length} focus areas: ${focusAreas.join(", ")}`,
      );

      await updateProgress(20); // Client validated

      // Generate metadata using OpenAI with retry logic
      let metadata;
      let lastError;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await updateProgress(30 + attempt * 10); // 30, 40, or 50
          metadata = await generateMetadataFromWebsite(
            allUrls,
            client.name,
            client.industry || undefined,
            client.geography || undefined,
            focusAreas.length > 0 ? focusAreas : undefined,
          );
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error;
          console.warn(
            `OpenAI API attempt ${attempt}/${maxRetries} failed for client ${clientId}:`,
            error,
          );

          if (attempt < maxRetries) {
            // Exponential backoff: wait 2^attempt seconds
            const delayMs = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      if (!metadata) {
        throw new Error(
          `Failed to generate metadata after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : "Unknown error"}`,
        );
      }

      await updateProgress(50); // Crawl-based topics received

      // Validate crawl topics
      if (
        !metadata.topics ||
        !Array.isArray(metadata.topics) ||
        metadata.topics.length === 0
      ) {
        console.warn(
          `OpenAI returned no crawl topics for client ${clientId}. Response:`,
          metadata,
        );
        throw new Error(
          "OpenAI returned invalid or empty topics array from website crawl",
        );
      }

      // Sanitize crawl-based topics
      const crawlTopics: any[] = [];
      let crawlTopicsSkipped = 0;

      for (let i = 0; i < metadata.topics.length; i++) {
        const topicData = metadata.topics[i];

        if (!topicData || typeof topicData !== "object") {
          console.warn(
            `Skipping non-object crawl topic at index ${i}:`,
            topicData,
          );
          crawlTopicsSkipped++;
          continue;
        }

        if (!topicData.topic || !topicData.category) {
          console.warn(
            `Skipping invalid crawl topic at index ${i}:`,
            topicData,
          );
          crawlTopicsSkipped++;
          continue;
        }

        crawlTopics.push({
          clientId: client.id,
          label: topicData.topic,
          category: topicData.category,
          source: "crawl" as const,
          keywords: Array.isArray(topicData.keywords) ? topicData.keywords : [],
          accepted: true,
        });
      }

      console.log(
        `Crawl topics sanitized: ${crawlTopics.length} valid (${crawlTopicsSkipped} skipped)`,
      );
      await updateProgress(55);

      // Step 2: Generate AI topics from client metadata
      console.log(`Generating AI topics from client metadata...`);
      let aiTopics: any[] = [];
      let aiTopicsSkipped = 0;

      try {
        // Extract brand aliases from correct field
        const brandAliases = client.brandAliases
          ? Array.isArray(client.brandAliases)
            ? client.brandAliases
            : []
          : [];

        // Parse geographies from comma-separated string to array
        const geographies: string[] = [];
        if (client.geography && typeof client.geography === "string") {
          geographies.push(
            ...client.geography
              .split(",")
              .map((g) => g.trim())
              .filter((g) => g.length > 0),
          );
        }

        // Pass ALL client data to AI topic generation
        const aiTopicsData = await generateAITopicsFromMetadata(
          client.name,
          client.industry || undefined,
          geographies.length > 0 ? geographies : undefined,
          brandAliases.length > 0 ? brandAliases : undefined,
          allUrls.length > 0 ? allUrls : undefined,
          focusAreas.length > 0 ? focusAreas : undefined,
        );

        // Sanitize AI topics
        for (let i = 0; i < aiTopicsData.length; i++) {
          const topicData = aiTopicsData[i];

          if (!topicData || typeof topicData !== "object") {
            console.warn(
              `Skipping non-object AI topic at index ${i}:`,
              topicData,
            );
            aiTopicsSkipped++;
            continue;
          }

          if (!topicData.topic || !topicData.category) {
            console.warn(`Skipping invalid AI topic at index ${i}:`, topicData);
            aiTopicsSkipped++;
            continue;
          }

          aiTopics.push({
            clientId: client.id,
            label: topicData.topic,
            category: topicData.category,
            source: "ai" as const,
            keywords: Array.isArray(topicData.keywords)
              ? topicData.keywords
              : [],
            accepted: true,
          });
        }

        console.log(
          `AI topics sanitized: ${aiTopics.length} valid (${aiTopicsSkipped} skipped)`,
        );
      } catch (error) {
        console.warn(
          `Failed to generate AI topics, continuing with crawl topics only:`,
          error,
        );
      }

      await updateProgress(60);

      // Step 3: Get existing manual topics
      console.log(`Fetching existing manual topics for client ${clientId}...`);
      const allTopics = await this.storage.getTopics(clientId);
      const manualTopics = allTopics.filter(
        (t) => t.source === "manual" && t.accepted,
      );
      console.log(`Found ${manualTopics.length} existing manual topics`);

      // Step 4: Combine ALL topics for prompt generation
      const combinedTopicsForPrompts = [
        ...crawlTopics.map((t) => ({
          label: t.label,
          category: t.category,
          keywords: t.keywords,
        })),
        ...aiTopics.map((t) => ({
          label: t.label,
          category: t.category,
          keywords: t.keywords,
        })),
        ...manualTopics.map((t) => ({
          label: t.label,
          category: t.category || "",
          keywords: Array.isArray(t.keywords) ? t.keywords : [],
        })),
      ];

      console.log(
        `Total topics for prompt generation: ${combinedTopicsForPrompts.length} (${crawlTopics.length} crawl + ${aiTopics.length} AI + ${manualTopics.length} manual)`,
      );
      await updateProgress(65);

      // Step 5: Generate prompts from ALL topics
      console.log(
        `Generating prompts from ${combinedTopicsForPrompts.length} combined topics...`,
      );
      // Task #89 — onboarding now uses the realism-aware generator and
      // pulls competitors + new context fields from the client row so
      // the same project envelope is used here and in refresh-prompts.
      const competitorsForPrompts = await this.storage.getCompetitors(client.id);
      let generatedItems: Awaited<ReturnType<typeof generateRealisticPrompts>> = [];

      try {
        generatedItems = await generateRealisticPrompts({
          client: {
            name: client.name,
            industry: client.industry,
            customIndustry: client.customIndustry,
            geography: client.geography,
            customGeography: client.customGeography,
            brandAliases: client.brandAliases,
            focusAreas: client.focusAreas,
            targetCustomerPersona: client.targetCustomerPersona,
            targetMarketCountry: client.targetMarketCountry,
            primaryTestLocation: client.primaryTestLocation,
            primaryLanguage: client.primaryLanguage,
          },
          topics: combinedTopicsForPrompts,
          competitors: competitorsForPrompts.map((c) => ({ name: c.name, website: c.website })),
        });
      } catch (error) {
        console.error(`Failed to generate prompts from topics:`, error);
        throw new Error(
          `Prompt generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      // Sanitize prompts (the generator already drops malformed rows;
      // this guards against any straggler with empty text).
      const promptsToInsert: any[] = [];
      let promptsSkipped = 0;

      for (let i = 0; i < generatedItems.length; i++) {
        const item = generatedItems[i];
        if (!item || typeof item.text !== "string" || item.text.trim() === "") {
          console.warn(`Skipping invalid prompt at index ${i}`);
          promptsSkipped++;
          continue;
        }
        promptsToInsert.push({
          clientId: client.id,
          text: item.text,
          source: "ai" as const,
          accepted: true,
          intentTier: item.intentTier,
          diagnosticFocus: item.diagnosticFocus,
        });
      }

      console.log(
        `Prompts sanitized: ${promptsToInsert.length} valid (${promptsSkipped} skipped)`,
      );
      await updateProgress(68);

      // Combine crawl and AI topics for insertion
      const topicsToInsert = [...crawlTopics, ...aiTopics];

      // Validate we have data to insert
      if (topicsToInsert.length === 0 || promptsToInsert.length === 0) {
        throw new Error(
          `No valid metadata to insert: ${topicsToInsert.length} topics, ${promptsToInsert.length} prompts`,
        );
      }

      console.log(
        `Summary - Crawl topics: ${crawlTopics.length}, AI topics: ${aiTopics.length}, Generated prompts: ${promptsToInsert.length}`,
      );

      await updateProgress(70); // Sanitization complete

      // Atomically replace metadata using transaction
      console.log(`Replacing AI-generated metadata for client ${clientId}`);
      const { topicsCreated, promptsCreated } =
        await this.storage.replaceClientGeneratedMetadata(
          clientId,
          topicsToInsert,
          promptsToInsert,
        );

      console.log(`Successfully replaced metadata for client ${clientId}`);
      console.log(
        `- Created ${topicsCreated} topics (${crawlTopicsSkipped + aiTopicsSkipped} total skipped: ${crawlTopicsSkipped} crawl + ${aiTopicsSkipped} AI)`,
      );
      console.log(
        `- Created ${promptsCreated} prompts (${promptsSkipped} skipped from prompt generation)`,
      );

      await updateProgress(90); // Metadata saved

      // Phase 2: Site X-Ray Analysis (conditional based on enableSiteXRay flag)
      if (enableSiteXRay) {
        console.log("Site X-Ray Analysis enabled - starting pipeline...");

        // Phase 2.1: X-Ray Ingestion (independent, non-blocking)
        try {
          console.log(`Starting X-Ray ingestion for client ${clientId}...`);

          // Reuse crawl results from metadata generation step
          const allCrawlResults: Array<{ url: string; data: any }> = [];

          if (metadata?.crawlResults && metadata.crawlResults.length > 0) {
            console.log(
              `Reusing crawl data from metadata generation: ${metadata.crawlResults.length} crawl(s)`,
            );
            // Use sourceUrl from each crawl result (not index-based matching!)
            for (const crawlResult of metadata.crawlResults) {
              allCrawlResults.push({
                url: crawlResult.sourceUrl || "unknown", // Use stored sourceUrl
                data: crawlResult,
              });
            }
          } else {
            console.log(
              "No crawl data from metadata generation, crawling for X-Ray...",
            );
            for (const url of allUrls) {
              const crawlResult = await crawlWebsite(url);
              if (
                crawlResult.crawlMethod !== "failed" &&
                crawlResult.pages.length > 0
              ) {
                allCrawlResults.push({ url, data: crawlResult });
              }
            }
          }

          // Ingest crawl data into X-Ray tables (separately per URL to preserve siteType)
          if (allCrawlResults.length > 0) {
            let totalSitesCreated = 0;
            let totalPagesIngested = 0;

            for (const { url, data } of allCrawlResults) {
              const siteType =
                urlCategories.get(url) === "third_party"
                  ? "third_party"
                  : "internal";
              console.log(
                `Ingesting X-Ray data for ${url} (siteType: ${siteType})...`,
              );

              const ingestionResult = await ingestCrawlResults(
                this.storage,
                clientId,
                data,
                siteType,
              );

              totalSitesCreated += ingestionResult.sitesCreated;
              totalPagesIngested += ingestionResult.pagesIngested;

              if (ingestionResult.errors.length > 0) {
                console.warn(
                  `X-Ray ingestion warnings for ${url}:`,
                  ingestionResult.errors,
                );
              }
            }

            console.log(
              `X-Ray ingestion complete: ${totalSitesCreated} sites, ${totalPagesIngested} pages`,
            );

            // Run health probes for each unique domain
            const allPages = allCrawlResults.flatMap(
              (cr) => cr.data.pages || [],
            );
            const domains = new Set(
              allPages
                .map((p: any) => {
                  try {
                    return new URL(p.url).hostname.replace(/^www\./, "");
                  } catch {
                    return null;
                  }
                })
                .filter((d: string | null): d is string => d !== null),
            );

            for (const domain of Array.from(domains)) {
              try {
                const sites = await this.storage.getXRaySitesByClient(clientId);
                const site = sites.find((s) => s.domain === domain);
                if (site) {
                  const healthData = await probeSiteHealth(domain);
                  await updateSiteHealth(this.storage, site.id, healthData);
                  console.log(`Health probe complete for ${domain}`);
                }
              } catch (error) {
                console.warn(`Health probe failed for ${domain}:`, error);
                // Mark probe as failed in database
                const sites = await this.storage.getXRaySitesByClient(clientId);
                const site = sites.find((s) => s.domain === domain);
                if (site) {
                  await this.storage.updateXRaySite(site.id, {
                    healthProbeStatus: 'failed',
                    lastProbedAt: new Date()
                  });
                }
              }
            }

            // Phase 3: Extract structure from ingested pages
            try {
              console.log("Starting structure extraction for X-Ray pages...");
              const { parsePageStructure, extractPlainText } = await import(
                "./xray-structure-parser"
              );
              const { extractEntities } = await import(
                "./xray-entity-extractor"
              );
              const { mapTopics } = await import("./xray-topic-mapper");

              const sites = await this.storage.getXRaySitesByClient(clientId);
              let structuresCreated = 0;

              for (const site of sites) {
                const pages = await this.storage.getXRayPagesBySite(site.id);

                for (const page of pages) {
                  // Check if structure already exists
                  const existingStructure = await this.storage.getPageStructure(
                    page.id,
                  );
                  if (existingStructure) {
                    continue; // Skip if already processed
                  }

                  // Parse HTML structure
                  const structure = parsePageStructure(
                    page.rawHtml || "",
                    page.url,
                  );
                  const plainText = extractPlainText(structure);

                  // Extract entities
                  const entities = extractEntities(plainText, client.name);

                  // Map topics to focus areas
                  const focusAreas = (client.focusAreas as any) || [];
                  const topics = mapTopics(
                    plainText,
                    Array.isArray(focusAreas) ? focusAreas : [],
                  );

                  // Store structure
                  await this.storage.createPageStructure({
                    pageId: page.id,
                    headings: structure.headings as any,
                    paragraphs: structure.paragraphs as any,
                    lists: structure.lists as any,
                    tables: structure.tables as any,
                    entities: entities as any,
                    focusAreas: (client.focusAreas || []) as any,
                    topics: topics as any,
                    linkCounts: structure.linkCounts as any,
                  });

                  structuresCreated++;
                }
              }

              console.log(
                `Structure extraction complete: ${structuresCreated} page structures created`,
              );

              // Phase 4: AI Content Analysis
              // Always run analysis phase - it will check per-page if analysis already exists
              try {
                console.log("Starting AI content analysis for X-Ray pages...");
                const { analyzeBatchPages, calculatePagePriority } =
                  await import("./xray-content-analyzer");

                const sites = await this.storage.getXRaySitesByClient(clientId);
                let analysesCreated = 0;

                // Collect all pages with structure
                const allPagesWithStructure: Array<{
                  page: any;
                  structure: any;
                  priority: number;
                }> = [];

                for (const site of sites) {
                  const pages = await this.storage.getXRayPagesBySite(site.id);

                  for (const page of pages) {
                    // Check if analysis already exists
                    const existingAnalysis = await this.storage.getPageAnalysis(
                      page.id,
                    );
                    if (existingAnalysis) {
                      continue; // Skip already analyzed pages
                    }

                    // Get page structure
                    const structure = await this.storage.getPageStructure(
                      page.id,
                    );
                    if (!structure) {
                      continue; // Can't analyze without structure
                    }

                    allPagesWithStructure.push({
                      page,
                      structure,
                      priority: calculatePagePriority(page),
                    });
                  }
                }

                // Sort by priority (highest first)
                allPagesWithStructure.sort((a, b) => b.priority - a.priority);

                console.log(
                  `Found ${allPagesWithStructure.length} pages ready for AI analysis`,
                );

                // Process in batches of 5 pages per API call with retry logic
                const BATCH_SIZE = 5;
                const MAX_RETRIES = 3;
                const totalBatches = Math.ceil(
                  allPagesWithStructure.length / BATCH_SIZE,
                );
                let failedBatches = 0;

                for (
                  let i = 0;
                  i < allPagesWithStructure.length;
                  i += BATCH_SIZE
                ) {
                  const batch = allPagesWithStructure.slice(i, i + BATCH_SIZE);
                  const batchNum = Math.floor(i / BATCH_SIZE) + 1;

                  console.log(
                    `Analyzing batch ${batchNum}/${totalBatches} (${batch.length} pages)...`,
                  );

                  let retryCount = 0;
                  let batchSuccess = false;

                  while (retryCount < MAX_RETRIES && !batchSuccess) {
                    try {
                      // Run batch analysis
                      const batchInput = batch.map(({ page, structure }) => ({
                        page,
                        structure,
                      }));
                      const analysisResults = await analyzeBatchPages(
                        batchInput,
                        client,
                      );

                      // Validate we got results for all pages in batch
                      if (analysisResults.size === 0) {
                        throw new Error(
                          "No analysis results returned from batch",
                        );
                      }

                      // Store analysis results and convert to recommendations
                      for (const { page, structure } of batch) {
                        const analysis = analysisResults.get(page.id);
                        if (analysis) {
                          await this.storage.createPageAnalysis({
                            pageId: page.id,
                            assessment: analysis.assessment,
                            gaps: analysis.gaps as any,
                            recommendations: analysis.recommendations as any,
                            seoIssues: analysis.seoIssues as any,
                          });
                          analysesCreated++;

                          // Convert X-Ray recommendations to recommendations table
                          if (
                            analysis.recommendations &&
                            Array.isArray(analysis.recommendations)
                          ) {
                            const gaps = (analysis.gaps as any[]) || [];
                            const paragraphs =
                              (structure.paragraphs as any[]) || [];
                            const headings =
                              (structure.headings as any[]) || [];

                            for (const rec of analysis.recommendations) {
                              const xrayRec = rec as any;

                              // Note: X-Ray analysis doesn't provide specific DOM references for recommendations
                              // We provide representative page content as examples for user context
                              const examples: any[] = [];

                              // Find related gap for issue description
                              const relatedGap = gaps.find(
                                (g: any) => g.category === xrayRec.category,
                              );
                              const issueDescription =
                                relatedGap?.issue ||
                                xrayRec.action ||
                                "Content improvement needed";

                              // Get representative page content
                              const meaningfulParas = paragraphs.filter(
                                (p: any) => p.text && p.text.length > 50,
                              );

                              if (meaningfulParas.length > 0) {
                                // Provide up to 3 paragraphs as representative examples
                                meaningfulParas
                                  .slice(0, 3)
                                  .forEach((para: any, idx: number) => {
                                    examples.push({
                                      citation: page.url || "Website",
                                      content:
                                        para.text.substring(0, 200) +
                                        (para.text.length > 200 ? "..." : ""),
                                      issue: `${issueDescription} (Example ${idx + 1}/${Math.min(meaningfulParas.length, 3)})`,
                                    });
                                  });
                              } else if (headings.length > 0) {
                                // Use headings as fallback
                                const headingText = headings
                                  .slice(0, 3)
                                  .map((h: any) => h.text)
                                  .join(" • ");
                                examples.push({
                                  citation: page.url || "Website",
                                  content: `Page headings: ${headingText}`,
                                  issue: issueDescription,
                                });
                              } else {
                                // No content available - create recommendation with marker
                                examples.push({
                                  citation: page.url || "Website",
                                  content:
                                    "[No specific content snippet available - page may be empty or JS-heavy]",
                                  issue: issueDescription,
                                });
                              }

                              // Map X-Ray impact to severity
                              const severity =
                                xrayRec.impact === "high"
                                  ? "high"
                                  : xrayRec.impact === "low"
                                    ? "low"
                                    : "medium";

                              // Always create recommendation, even if content is limited
                              await this.storage.createRecommendation({
                                clientId,
                                promptRunId: null,
                                title: xrayRec.action || "Content improvement",
                                description:
                                  xrayRec.rationale ||
                                  "Improve content quality",
                                severity: severity,
                                category: xrayRec.category || "Content Quality",
                                source: "crawl",
                                examples: examples as any,
                                actionItems: xrayRec.action
                                  ? [xrayRec.action]
                                  : [],
                              });
                            }
                          }
                        }
                      }

                      batchSuccess = true;
                      console.log(`✓ Batch ${batchNum} completed successfully`);
                    } catch (batchError: any) {
                      retryCount++;
                      const isRateLimitError =
                        batchError.status === 429 ||
                        batchError.code === "insufficient_quota";
                      const isRetryableError =
                        isRateLimitError || batchError.status >= 500;

                      if (retryCount < MAX_RETRIES && isRetryableError) {
                        // Exponential backoff: 2s, 4s, 8s
                        const delayMs = Math.pow(2, retryCount) * 1000;
                        console.warn(
                          `Batch ${batchNum} failed (attempt ${retryCount}/${MAX_RETRIES}): ${batchError.message}. Retrying in ${delayMs / 1000}s...`,
                        );
                        await new Promise((resolve) =>
                          setTimeout(resolve, delayMs),
                        );
                      } else {
                        console.error(
                          `✗ Batch ${batchNum} failed after ${retryCount} attempts:`,
                          batchError.message,
                        );
                        failedBatches++;
                        break;
                      }
                    }
                  }
                }

                if (failedBatches > 0) {
                  console.warn(
                    `AI analysis completed with ${failedBatches}/${totalBatches} batches failed`,
                  );
                }

                console.log(
                  `AI content analysis complete: ${analysesCreated} pages analyzed`,
                );
              } catch (analysisError) {
                const errorMessage =
                  analysisError instanceof Error
                    ? analysisError.message
                    : String(analysisError);
                const errorStack =
                  analysisError instanceof Error
                    ? analysisError.stack
                    : undefined;

                console.error("============================================");
                console.error("AI CONTENT ANALYSIS FAILED (NON-CRITICAL):");
                console.error("Client ID:", clientId);
                console.error("Error Message:", errorMessage);
                console.error("Stack Trace:", errorStack);
                console.error("============================================");

                if (jobId) {
                  await this.storage.updateJob(jobId, {
                    error: `[AI ANALYSIS WARNING] ${errorMessage}\n\nStack: ${errorStack || "N/A"}`,
                  });
                }
              }

              // Phase 2.4: Comprehensive Content Recommendations
              try {
                console.log(
                  "Starting comprehensive content recommendation analysis...",
                );
                const analyzer = new ContentRecommendationAnalyzer();
                let recommendationsCreated = 0;

                // Get all sites and their pages for analysis
                const allSites =
                  await this.storage.getXRaySitesByClient(clientId);

                for (const site of allSites) {
                  const pages = await this.storage.getXRayPagesBySite(site.id);

                  for (const page of pages) {
                    // Get page structure and analysis data
                    const structure = await this.storage.getPageStructure(
                      page.id,
                    );

                    if (!structure) continue;

                    // Build page data for analysis
                    const pageData = {
                      url: page.url || "",
                      title: page.title || undefined,
                      wordCount: page.wordCount || undefined,
                      structure: {
                        headings: (structure.headings as any[]) || [],
                        paragraphs: (structure.paragraphs as any[]) || [],
                        entities: (structure.entities as any[]) || [],
                        topics: (structure.topics as any[]) || [],
                        sentimentScore: structure.sentimentScore
                          ? parseFloat(structure.sentimentScore.toString())
                          : undefined,
                      },
                      site: {
                        robotsTxt: site.robotsTxtPresent || false,
                        aiTxt: site.aiTxtPresent || false,
                        crawlAccessStatus: site.crawlAccessStatus || undefined,
                      },
                      seoIssues: [],
                    };

                    // Run all analyses
                    const llmReadinessRecs =
                      analyzer.analyzeLLMReadiness(pageData);
                    const accessibilityRecs =
                      analyzer.analyzeContentAccessibility(pageData);
                    const crawlabilityRecs =
                      analyzer.analyzeCrawlability(pageData);
                    const sentimentRecs = analyzer.analyzeSentiment(pageData);

                    // Combine all recommendations
                    const allRecs = [
                      ...llmReadinessRecs,
                      ...accessibilityRecs,
                      ...crawlabilityRecs,
                      ...sentimentRecs,
                    ];

                    // Create recommendations with examples
                    for (const rec of allRecs) {
                      // Create example from page content
                      const paragraphs = (structure.paragraphs as any[]) || [];
                      const examples: any[] = [];

                      if (paragraphs.length > 0) {
                        const firstPara = paragraphs[0];
                        if (firstPara.text) {
                          examples.push({
                            citation: page.url || "Page",
                            content:
                              firstPara.text.substring(0, 200) +
                              (firstPara.text.length > 200 ? "..." : ""),
                            issue: rec.title,
                          });
                        }
                      }

                      if (examples.length === 0) {
                        examples.push({
                          citation: page.url || "Page",
                          content:
                            "[Analysis based on page structure and metadata]",
                          issue: rec.title,
                        });
                      }

                      await this.storage.createRecommendation({
                        clientId,
                        promptRunId: null,
                        title: rec.title,
                        description: rec.description,
                        severity: rec.severity,
                        category: rec.category,
                        source: "crawl",
                        examples: examples as any,
                        actionItems: rec.actionItems as any,
                      });
                      recommendationsCreated++;
                    }
                  }
                }

                console.log(
                  `Comprehensive content recommendations complete: ${recommendationsCreated} recommendations created`,
                );
              } catch (recError) {
                const errorMessage =
                  recError instanceof Error
                    ? recError.message
                    : String(recError);
                const errorStack =
                  recError instanceof Error ? recError.stack : undefined;

                console.error("============================================");
                console.error("RECOMMENDATION ANALYSIS FAILED (NON-CRITICAL):");
                console.error("Client ID:", clientId);
                console.error("Error Message:", errorMessage);
                console.error("Stack Trace:", errorStack);
                console.error("============================================");

                if (jobId) {
                  await this.storage.updateJob(jobId, {
                    error: `[RECOMMENDATION WARNING] ${errorMessage}\n\nStack: ${errorStack || "N/A"}`,
                  });
                }
              }
            } catch (structureError) {
              const errorMessage =
                structureError instanceof Error
                  ? structureError.message
                  : String(structureError);
              const errorStack =
                structureError instanceof Error
                  ? structureError.stack
                  : undefined;

              console.error("============================================");
              console.error("STRUCTURE EXTRACTION FAILED (NON-CRITICAL):");
              console.error("Client ID:", clientId);
              console.error("Error Message:", errorMessage);
              console.error("Stack Trace:", errorStack);
              console.error("============================================");

              if (jobId) {
                await this.storage.updateJob(jobId, {
                  error: `[STRUCTURE WARNING] ${errorMessage}\n\nStack: ${errorStack || "N/A"}`,
                });
              }
            }
          } else {
            console.log(
              "No crawl data available for X-Ray ingestion (all URLs failed)",
            );
          }
        } catch (xrayError) {
          // X-Ray ingestion failure should not fail the entire job
          const errorMessage =
            xrayError instanceof Error ? xrayError.message : String(xrayError);
          const errorStack =
            xrayError instanceof Error ? xrayError.stack : undefined;

          console.error("============================================");
          console.error("X-RAY INGESTION FAILED (NON-CRITICAL):");
          console.error("Client ID:", clientId);
          console.error("Error Message:", errorMessage);
          console.error("Stack Trace:", errorStack);
          console.error("============================================");

          // Store warning in job error field with special prefix
          if (jobId) {
            await this.storage.updateJob(jobId, {
              error: `[X-RAY WARNING] ${errorMessage}\n\nStack: ${errorStack || "N/A"}`,
            });
          }
        }
      } else {
        console.log("Site X-Ray Analysis disabled - skipping pipeline");
      }

      await updateProgress(100); // Complete
    } catch (error) {
      console.error(
        `Failed to generate metadata for client ${clientId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Task #58: Standalone batch worker for the `xray_analysis` job type
   * (enqueued from POST /api/v1/xray/analyze/batch). Runs structure
   * extraction for any pages that don't yet have it, then runs the
   * batched AI content analysis in chunks of 5. The full ingestion +
   * recommendation pipeline is intentionally NOT re-run here — that
   * pipeline lives in `generateMetadata({ enableSiteXRay: true })`
   * and operates on a freshly crawled snapshot. This worker just
   * (re)analyzes the pages already ingested for the given site.
   */
  private async processXRayAnalysis(
    siteId: string,
    clientId: string,
    jobId?: string,
  ): Promise<void> {
    console.log(
      `[XRay] Processing xray_analysis job for site ${siteId} (client ${clientId})`,
    );

    const updateProgress = async (progress: number) => {
      if (jobId) {
        await this.storage.updateJob(jobId, { progress });
      }
    };

    const checkCancellation = () => {
      if (jobId && this.isJobCancelled(jobId)) {
        throw new Error("Job cancelled");
      }
    };

    await updateProgress(5);

    const site = await this.storage.getXRaySite(siteId);
    if (!site) {
      throw new Error(`X-Ray site not found: ${siteId}`);
    }
    if (site.clientId !== clientId) {
      throw new Error(
        `X-Ray site ${siteId} does not belong to client ${clientId}`,
      );
    }

    const client = await this.storage.getClient(clientId);
    if (!client) {
      throw new Error(`Client not found: ${clientId}`);
    }

    const pages = await this.storage.getXRayPagesBySite(siteId);
    if (pages.length === 0) {
      console.log(`[XRay] Site ${siteId} has no pages to analyze`);
      await updateProgress(100);
      return;
    }

    // Phase 1: Ensure structures exist for every page
    const { parsePageStructure, extractPlainText } = await import(
      "./xray-structure-parser"
    );
    const { extractEntities } = await import("./xray-entity-extractor");
    const { mapTopics } = await import("./xray-topic-mapper");

    const focusAreasRaw = (client.focusAreas as any) || [];
    const focusAreas = Array.isArray(focusAreasRaw) ? focusAreasRaw : [];
    let structuresCreated = 0;

    for (const page of pages) {
      checkCancellation();
      const existing = await this.storage.getPageStructure(page.id);
      if (existing) continue;

      const structure = parsePageStructure(page.rawHtml || "", page.url);
      const plainText = extractPlainText(structure);
      const entities = extractEntities(plainText, client.name);
      const topics = mapTopics(plainText, focusAreas);

      await this.storage.createPageStructure({
        pageId: page.id,
        headings: structure.headings as any,
        paragraphs: structure.paragraphs as any,
        lists: structure.lists as any,
        tables: structure.tables as any,
        entities: entities as any,
        focusAreas: focusAreas as any,
        topics: topics as any,
        linkCounts: structure.linkCounts as any,
      });
      structuresCreated++;
    }
    console.log(
      `[XRay] Structure extraction: ${structuresCreated} new structures (${pages.length} pages total)`,
    );
    await updateProgress(30);

    // Phase 2: Batch AI content analysis for pages without analysis yet
    const { analyzeBatchPages, calculatePagePriority } = await import(
      "./xray-content-analyzer"
    );

    const pagesNeedingAnalysis: Array<{
      page: any;
      structure: any;
      priority: number;
    }> = [];

    for (const page of pages) {
      const existingAnalysis = await this.storage.getPageAnalysis(page.id);
      if (existingAnalysis) continue;
      const structure = await this.storage.getPageStructure(page.id);
      if (!structure) continue;
      pagesNeedingAnalysis.push({
        page,
        structure,
        priority: calculatePagePriority(page),
      });
    }

    pagesNeedingAnalysis.sort((a, b) => b.priority - a.priority);

    if (pagesNeedingAnalysis.length === 0) {
      console.log(`[XRay] All pages already analyzed for site ${siteId}`);
      await updateProgress(100);
      return;
    }

    console.log(
      `[XRay] Analyzing ${pagesNeedingAnalysis.length} pages for site ${siteId}`,
    );

    const BATCH_SIZE = 5;
    const MAX_RETRIES = 3;
    const totalBatches = Math.ceil(pagesNeedingAnalysis.length / BATCH_SIZE);
    let analysesCreated = 0;
    let failedBatches = 0;

    for (let i = 0; i < pagesNeedingAnalysis.length; i += BATCH_SIZE) {
      checkCancellation();
      const batch = pagesNeedingAnalysis.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(
        `[XRay] Batch ${batchNum}/${totalBatches} (${batch.length} pages)`,
      );

      let retryCount = 0;
      let batchSuccess = false;
      while (retryCount < MAX_RETRIES && !batchSuccess) {
        try {
          const batchInput = batch.map(({ page, structure }) => ({
            page,
            structure,
          }));
          const analysisResults = await analyzeBatchPages(batchInput, client);
          if (analysisResults.size === 0) {
            throw new Error("No analysis results returned from batch");
          }

          for (const { page } of batch) {
            const analysis = analysisResults.get(page.id);
            if (!analysis) continue;
            await this.storage.createPageAnalysis({
              pageId: page.id,
              assessment: analysis.assessment,
              gaps: analysis.gaps as any,
              recommendations: analysis.recommendations as any,
              seoIssues: analysis.seoIssues as any,
            });
            analysesCreated++;
          }
          batchSuccess = true;
        } catch (batchError: any) {
          retryCount++;
          const isRateLimit =
            batchError?.status === 429 ||
            batchError?.code === "insufficient_quota";
          const isRetryable = isRateLimit || batchError?.status >= 500;
          if (retryCount < MAX_RETRIES && isRetryable) {
            const delayMs = Math.pow(2, retryCount) * 1000;
            console.warn(
              `[XRay] Batch ${batchNum} failed (attempt ${retryCount}/${MAX_RETRIES}): ${batchError?.message}. Retrying in ${delayMs / 1000}s`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            console.error(
              `[XRay] Batch ${batchNum} failed permanently:`,
              batchError?.message,
            );
            failedBatches++;
            break;
          }
        }
      }

      const progressPct = 30 + Math.floor((batchNum / totalBatches) * 65);
      await updateProgress(Math.min(progressPct, 95));
    }

    console.log(
      `[XRay] Site ${siteId} analysis complete: ${analysesCreated} analyses created, ${failedBatches}/${totalBatches} batches failed`,
    );

    if (failedBatches === totalBatches && totalBatches > 0) {
      throw new Error(
        `X-Ray analysis failed: all ${totalBatches} batches failed`,
      );
    }

    await updateProgress(100);
  }

  private async processCrawlerJob(
    url: string,
    options: any = {},
    jobId?: string,
  ): Promise<void> {
    console.log(`Processing crawler job for URL: ${url}`);

    const updateProgress = async (progress: number) => {
      if (jobId) {
        await this.storage.updateJob(jobId, { progress });
      }
    };

    try {
      await updateProgress(10); // Started

      // Execute crawl
      const result = await crawlWebsite(url);

      await updateProgress(100); // Complete

      // Note: Since jobs table doesn't have a 'result' field, we would need to
      // either modify the schema or handle results differently. For now,
      // the sync endpoint is the recommended way to get crawl results.
      console.log(
        `Crawler job completed for ${url}: ${result.totalPages} pages crawled`,
      );
    } catch (error) {
      console.error(`Failed to crawl ${url}:`, error);
      throw error;
    }
  }

  /**
   * Task #105 (R1) — Worker for `report_generation` jobs. Delegates to
   * the existing pipeline in report-job-processor.ts and surfaces
   * pipeline progress as the JobQueue's `progress` field so the queue
   * health UI shows movement.
   */
  private async processReportGenerationJob(job: Job): Promise<void> {
    const payload = job.payload as {
      clientId: string;
      projectId: string;
      runIds: string[];
      generatedBy: string;
      snapshotId?: string;
    };

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured for report generation');
    }

    const { processReportGeneration } = await import(
      './report-job-processor'
    );

    // Track the snapshotId so we can stamp it into the JobQueue job's
    // payload as soon as it's known. recoverStaleJobs() reads
    // payload.snapshotId to fail the linked report_jobs / report_snapshots
    // rows on a restart sweep — without this, those rows would otherwise
    // stay in `generating` forever and the UI would spin indefinitely.
    let snapshotIdStamped = false;

    await processReportGeneration(
      payload.clientId,
      payload.projectId,
      payload.runIds,
      payload.generatedBy,
      openaiApiKey,
      async (progress) => {
        try {
          // First progress event after snapshot creation — write the
          // snapshotId back into the job payload exactly once.
          if (!snapshotIdStamped && progress.snapshotId) {
            snapshotIdStamped = true;
            const stampedPayload: typeof payload = {
              ...payload,
              snapshotId: progress.snapshotId,
            };
            try {
              await this.storage.updateJob(job.id, {
                payload: stampedPayload,
                progress: progress.progressPercent,
              });
            } catch (err) {
              console.warn(
                `[JobQueue] Failed to stamp snapshotId on report_generation job ${job.id}:`,
                err,
              );
            }
            return;
          }
          await this.storage.updateJob(job.id, {
            progress: progress.progressPercent,
          });
        } catch {
          // best-effort progress mirroring
        }
      },
      job.startedByUserId ?? null,
      payload.snapshotId,
    );
  }
}
