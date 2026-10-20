import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { storage } from "../storage";
import { getClientId } from "./_helpers";
import { requireRole, assertClientAccess } from "../auth";
import { jobQueue } from "./_shared";

/**
 * Jobs routes.
 *
 * Note: prior to consolidation, `/api/v1/jobs` and `/api/v1/jobs/:id` were
 * registered twice in `routes.ts` (lines 382/406 and 1280/1289). The first
 * (more capable) handler always won because Express routes only the first
 * matching handler — the second handler was dead code. This module keeps the
 * functional list+filter implementation and standardizes the tenancy param
 * (`clientId` preferred, `client_id` accepted for backwards compatibility).
 */
export function registerJobRoutes(app: Express) {
  app.get("/api/v1/jobs", async (req, res, next) => {
    try {
      const clientId = getClientId(req);
      const jobs = await storage.getJobs();

      const filteredJobs = clientId
        ? jobs.filter((job) => {
            const payload = job.payload as any;
            return payload?.clientId === clientId;
          })
        : jobs;

      const sortedJobs = filteredJobs.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      res.json(sortedJobs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/jobs/:id", async (req, res, next) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        throw new ApiError({ status: 404, code: "not_found", message: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  // Task #63: cancel a running job (currently used by the Site X-Ray UI to
  // abort an in-flight `xray_analysis` batch). The job-queue's
  // `processXRayAnalysis` already polls `isJobCancelled` between page batches,
  // so flipping the flag here causes the worker to stop gracefully and the
  // job row transitions to `cancelled`.
  app.post(
    "/api/v1/jobs/:id/cancel",
    requireRole({ minRole: "member", scope: "client" }),
    async (req, res, next) => {
      try {
        const job = await storage.getJob(req.params.id);
        if (!job) {
          throw new ApiError({ status: 404, code: "not_found", message: "Job not found" });
        }

        // Tenancy check: every cancellable job MUST be bound to a client via
        // its payload so we can enforce per-project access. Refuse if the
        // payload doesn't expose `clientId` — better to fail closed than to
        // let a member of project A cancel an untagged job belonging to
        // project B by guessing its id.
        const payloadClientId = (job.payload as { clientId?: string } | null)
          ?.clientId;
        if (!payloadClientId) {
          throw new ApiError({ status: 403, code: "forbidden", message: "This job type cannot be cancelled via this endpoint (no project binding on the job).", details: {
          } });
        }
        const ok = await assertClientAccess(req, res, payloadClientId);
        if (!ok) return;

        if (job.status !== "queued" && job.status !== "running") {
          throw new ApiError({ status: 409, code: "conflict", message: `Job is already ${job.status} and cannot be cancelled` });
        }

        await jobQueue.cancelJob(job.id);
        res.json({ message: "Job cancelled" });
      } catch (error) {
        next(error);
    }
    },
  );
}
