/**
 * Task #115 — Admin operational endpoints over the `jobs` table.
 *
 *   GET  /api/v1/admin/jobs/failed     - Recent failed jobs (status=error)
 *   POST /api/v1/admin/jobs/:id/retry  - Re-enqueue a failed job as a NEW
 *                                        row with `payload.parent_job_id`
 *                                        + `payload.retry_attempt` carried
 *                                        forward (no in-place mutation,
 *                                        so the original row stays as
 *                                        evidence in the audit log).
 *   POST /api/v1/admin/jobs/:id/cancel - Flip a queued job to cancelled.
 *                                        Running jobs are rejected with
 *                                        a 409 — they need the existing
 *                                        per-job cancellation path so the
 *                                        executor exits cleanly.
 *
 * Both mutations are audit-logged so the admin Audit page surfaces them
 * under `job.retry` / `job.cancel`.
 */
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { jobQueue } from "./_shared";
import { requireRole } from "../auth";
import { ApiError } from "../utils/api-error";
import { recordAudit } from "../services/audit";
import type { User } from "@shared/schema";

const retrySchema = z.object({});

export function registerAdminJobRoutes(app: Express): void {
  app.get(
    "/api/v1/admin/jobs/failed",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query.limit ?? 50) || 50),
        );
        const rows = await storage.getRecentFailedJobs(limit);
        res.json(rows);
      } catch (err) {
        next(err);
      }
    },
  );

  // Task #115 — Failures-by-kind rollup for the operational dashboard.
  // Aggregates `status='error'` jobs by `job.type` over the last
  // `?hours=` window (default 24, capped at 168 = 7d).
  app.get(
    "/api/v1/admin/jobs/failed-by-type",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const hours = Math.min(
          168,
          Math.max(1, Number(req.query.hours ?? 24) || 24),
        );
        const rows = await storage.getFailedJobCountsByType(hours);
        res.json({ hours, rows });
      } catch (err) {
        next(err);
      }
    },
  );

  // Task #115 — System-wide prompt-runs in flight count for the
  // operational dashboard's "Prompt runs in flight" tile.
  app.get(
    "/api/v1/admin/prompt-runs/in-flight",
    requireRole({ minRole: "admin", scope: "none" }),
    async (_req, res, next) => {
      try {
        const count = await storage.countActivePromptRuns();
        res.json({ count });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/v1/admin/jobs/:id/retry",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        retrySchema.parse(req.body ?? {});
        const original = await storage.getJob(req.params.id);
        if (!original) {
          throw new ApiError({
            status: 404,
            code: "not_found",
            message: "Job not found",
          });
        }
        if (original.status !== "error" && original.status !== "cancelled") {
          throw new ApiError({
            status: 409,
            code: "invalid_state",
            message: `Only failed or cancelled jobs can be retried (current status: ${original.status})`,
          });
        }

        // Carry the original payload forward, layering retry metadata on
        // top so downstream processors can still read the original
        // `clientId` / `promptRunId` / etc. without changes.
        const originalPayload =
          (original.payload as Record<string, unknown> | null) ?? {};
        const retryAttempt =
          typeof originalPayload.retry_attempt === "number"
            ? originalPayload.retry_attempt + 1
            : 1;
        const newPayload = {
          ...originalPayload,
          parent_job_id: original.id,
          retry_attempt: retryAttempt,
          retried_by_user_id: (req.user as User | undefined)?.id ?? null,
        };

        const retried = await jobQueue.enqueue({
          type: original.type,
          payload: newPayload,
          clientId: original.clientId,
          startedByUserId: (req.user as User | undefined)?.id ?? null,
        });

        await recordAudit({
          req,
          actorUserId: (req.user as User | undefined)?.id,
          action: "job.retry",
          targetType: "job",
          targetId: retried.id,
          metadata: {
            parentJobId: original.id,
            jobType: original.type,
            retryAttempt,
          },
        });

        res.status(201).json({ id: retried.id, parentJobId: original.id, retryAttempt });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/v1/admin/jobs/:id/cancel",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        // Atomic cancel — only flips the row when it's still queued.
        // Returns null if a worker claimed the job between the admin's
        // click and this call, in which case we surface a 409 so the
        // operator can refresh and try the running-job cancel path.
        const updated = await storage.cancelQueuedJob(
          req.params.id,
          "Cancelled by admin",
        );

        if (!updated) {
          // Distinguish "never existed" from "state moved on" with a
          // single follow-up read. Read happens only on the unhappy
          // path so the hot path stays one SQL round-trip.
          const existing = await storage.getJob(req.params.id);
          if (!existing) {
            throw new ApiError({
              status: 404,
              code: "not_found",
              message: "Job not found",
            });
          }
          throw new ApiError({
            status: 409,
            code: "invalid_state",
            message: `Only queued jobs can be cancelled here (current status: ${existing.status}). Running jobs must be cancelled via the run's cancel endpoint.`,
          });
        }

        await recordAudit({
          req,
          actorUserId: (req.user as User | undefined)?.id,
          action: "job.cancel",
          targetType: "job",
          targetId: updated.id,
          metadata: { jobType: updated.type, previousStatus: "queued" },
        });

        res.json({ id: updated.id, status: "cancelled" });
      } catch (err) {
        next(err);
      }
    },
  );

  // Task #121 — Halt a currently running job. Uses the in-process
  // `JobQueue.cancelJob()` channel so the executor's cooperative
  // cancellation check (`isJobCancelled`) flips and the worker exits
  // cleanly at the next checkpoint. The DB row is also flipped to
  // `cancelled` inside `cancelJob` so the UI reflects the change
  // even if this server instance isn't the one running the job.
  app.post(
    "/api/v1/admin/jobs/:id/halt",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const job = await storage.getJob(req.params.id);
        if (!job) {
          throw new ApiError({
            status: 404,
            code: "not_found",
            message: "Job not found",
          });
        }
        if (job.status !== "running") {
          throw new ApiError({
            status: 409,
            code: "invalid_state",
            message: `Only running jobs can be halted (current status: ${job.status}). Queued jobs use /cancel; terminal jobs cannot be halted.`,
          });
        }

        await jobQueue.cancelJob(req.params.id);

        await recordAudit({
          req,
          actorUserId: (req.user as User | undefined)?.id,
          action: "job.halt",
          targetType: "job",
          targetId: job.id,
          metadata: { jobType: job.type, previousStatus: "running" },
        });

        res.json({ id: job.id, status: "cancelled" });
      } catch (err) {
        next(err);
      }
    },
  );

  // Task #115 — Queued jobs feed for the admin Cancel UI. Without
  // this, the per-row Cancel button on the failed-jobs table is
  // unreachable (failed-jobs only contains terminal rows).
  // Task #121 — Running jobs feed for the admin Halt UI.
  app.get(
    "/api/v1/admin/jobs/running",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query.limit ?? 50) || 50),
        );
        const rows = await storage.getRunningJobs(limit);
        res.json(rows);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get(
    "/api/v1/admin/jobs/queued",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const limit = Math.min(
          200,
          Math.max(1, Number(req.query.limit ?? 50) || 50),
        );
        const rows = await storage.getQueuedJobs(limit);
        res.json(rows);
      } catch (err) {
        next(err);
      }
    },
  );
}
