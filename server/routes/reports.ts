import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { storage } from "../storage";
import { db } from "../db";
import { requireClientId } from "./_helpers";
import { requireRole } from "../auth";
import type { User } from "@shared/schema";
import { jobQueue } from "../routes";
import { reportsGenerateLimiter } from "../middleware/rate-limit-expensive";

export function registerReportRoutes(app: Express) {
  app.get("/api/v1/reports", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportJobs, reportFiles } = await import("@shared/schema");
      const { eq, desc, sql } = await import("drizzle-orm");

      // Task #90 — return the latest job's status + errorMessage alongside
      // each snapshot so the UI can render partial-success state for
      // already-completed reports without firing N extra `/job` requests.
      // Use a correlated subquery to pick the LATEST job per snapshot — a
      // plain LEFT JOIN would duplicate snapshot rows (or surface stale
      // job state) if a snapshot ever had more than one job (e.g. after a
      // background recovery re-enqueue). Defensive: there is no DB-level
      // uniqueness on (snapshot_id) for report_jobs today.
      const latestJobIdSql = sql<string>`(
        SELECT j.id FROM ${reportJobs} j
        WHERE j.snapshot_id = ${reportSnapshots.id}
        ORDER BY j.created_at DESC
        LIMIT 1
      )`;

      // Task #104 — per-asset availability flags derived from
      // report_files. With independent insights / appendix PDF failure
      // paths, the UI can no longer infer "appendix unavailable" from
      // the presence of jobErrorMessage. Source of truth is whether the
      // file row was inserted by the report processor.
      const insightsPdfAvailableSql = sql<boolean>`EXISTS (
        SELECT 1 FROM ${reportFiles} rf
        WHERE rf.snapshot_id = ${reportSnapshots.id}
          AND rf.file_type IN ('insights_pdf', 'pdf')
      )`;
      const appendixPdfAvailableSql = sql<boolean>`EXISTS (
        SELECT 1 FROM ${reportFiles} rf
        WHERE rf.snapshot_id = ${reportSnapshots.id}
          AND rf.file_type = 'appendix_pdf'
      )`;

      const reports = await db
        .select({
          id: reportSnapshots.id,
          projectId: reportSnapshots.projectId,
          runIds: reportSnapshots.runIds,
          generatedAt: reportSnapshots.generatedAt,
          generatedBy: reportSnapshots.generatedBy,
          status: reportSnapshots.status,
          narrativeGenerated: reportSnapshots.narrativeGenerated,
          jobStatus: reportJobs.status,
          jobErrorMessage: reportJobs.errorMessage,
          jobCurrentStep: reportJobs.currentStep,
          insightsPdfAvailable: insightsPdfAvailableSql,
          appendixPdfAvailable: appendixPdfAvailableSql,
        })
        .from(reportSnapshots)
        .leftJoin(reportJobs, eq(reportJobs.id, latestJobIdSql))
        .where(eq(reportSnapshots.clientId, clientId))
        .orderBy(desc(reportSnapshots.generatedAt))
        .limit(20);

      res.json({ reports });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/reports/generate", reportsGenerateLimiter, requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const { clientId, runId } = req.body;
      if (!clientId || typeof clientId !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "clientId is required" });
      }
      if (!runId || typeof runId !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "runId is required" });
      }

      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new ApiError({ status: 500, code: "internal_error", message: "OpenAI API key not configured" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }

      const projectId = client.projectName || client.name;
      // Task #56: attribute the report job to the calling user (was
      // hardcoded "system"). The processor stamps both
      // `report_snapshots.generatedBy` and `report_jobs.startedByUserId`
      // so the active-operations banner can show "Generating report —
      // started by Jane Doe".
      const actor = req.user as User | undefined;
      const startedByUserId = actor?.id ?? null;
      const generatedBy = actor?.email || actor?.displayName || actor?.id || "system";

      // Task #105 (R1) — Enqueue onto the JobQueue instead of firing a
      // detached promise inside the request process. Server restart /
      // deploy / autoscale events used to leave the report row stuck
      // forever; now the queue's own stale-job sweep takes care of it.
      const queueJob = await jobQueue.enqueue({
        type: "report_generation",
        payload: {
          clientId,
          projectId,
          runIds: [runId],
          generatedBy,
        },
        status: "queued",
        startedByUserId,
      });

      console.log(
        `[Reports] Queued report generation job ${queueJob.id} for client ${clientId} run ${runId}`,
      );

      res.status(202).json({
        message: "Report generation started",
        jobId: queueJob.id,
        note: "Generation is running in the background. Use GET /api/v1/reports to check status.",
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id/sections", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportSections } = await import(
        "@shared/schema"
      );
      const { eq, and, asc } = await import("drizzle-orm");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const sections = await db
        .select()
        .from(reportSections)
        .where(eq(reportSections.snapshotId, id))
        .orderBy(asc(reportSections.sectionOrder));

      res.json({ sections });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id/files", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportFiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const files = await db
        .select()
        .from(reportFiles)
        .where(eq(reportFiles.snapshotId, id));

      res.json({ files });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id/download/pdf", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportFiles, clients } = await import("@shared/schema");
      const { eq, and, or } = await import("drizzle-orm");
      const { buildReportFileName, contentDispositionHeader } = await import(
        "../utils/report-filename"
      );

      const [report] = await db
        .select({
          id: reportSnapshots.id,
          generatedAt: reportSnapshots.generatedAt,
          clientName: clients.name,
          projectName: clients.projectName,
        })
        .from(reportSnapshots)
        .leftJoin(clients, eq(clients.id, reportSnapshots.clientId))
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const [pdfFile] = await db
        .select()
        .from(reportFiles)
        .where(
          and(
            eq(reportFiles.snapshotId, id),
            or(
              eq(reportFiles.fileType, "insights_pdf"),
              eq(reportFiles.fileType, "pdf"),
            ),
          ),
        )
        .limit(1);

      if (!pdfFile) {
        throw new ApiError({ status: 404, code: "not_found", message: "Insights Report PDF not found for this report" });
      }

      const fs = await import("fs/promises");

      try {
        await fs.access(pdfFile.fileUrl);
      } catch {
        throw new ApiError({ status: 404, code: "not_found", message: "PDF file exists in database but file not found on disk" });
      }

      const fileName = buildReportFileName({
        kind: "insights",
        clientName: report.clientName,
        projectName: report.projectName,
        generatedAt: report.generatedAt,
        snapshotId: id,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDispositionHeader(fileName));
      res.setHeader("Content-Length", pdfFile.fileSize);

      const fileStream = (await import("fs")).createReadStream(pdfFile.fileUrl);
      fileStream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id/download/appendix", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportFiles, clients } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { buildReportFileName, contentDispositionHeader } = await import(
        "../utils/report-filename"
      );

      const [report] = await db
        .select({
          id: reportSnapshots.id,
          generatedAt: reportSnapshots.generatedAt,
          clientName: clients.name,
          projectName: clients.projectName,
        })
        .from(reportSnapshots)
        .leftJoin(clients, eq(clients.id, reportSnapshots.clientId))
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const [pdfFile] = await db
        .select()
        .from(reportFiles)
        .where(
          and(
            eq(reportFiles.snapshotId, id),
            eq(reportFiles.fileType, "appendix_pdf"),
          ),
        )
        .limit(1);

      if (!pdfFile) {
        throw new ApiError({ status: 404, code: "not_found", message: "Technical Appendix PDF not found for this report" });
      }

      const fs = await import("fs/promises");

      try {
        await fs.access(pdfFile.fileUrl);
      } catch {
        throw new ApiError({ status: 404, code: "not_found", message: "PDF file exists in database but file not found on disk" });
      }

      const fileName = buildReportFileName({
        kind: "appendix",
        clientName: report.clientName,
        projectName: report.projectName,
        generatedAt: report.generatedAt,
        snapshotId: id,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDispositionHeader(fileName));
      res.setHeader("Content-Length", pdfFile.fileSize);

      const fileStream = (await import("fs")).createReadStream(pdfFile.fileUrl);
      fileStream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/:id/export", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const {
        reportSnapshots,
        clients,
        competitors,
        reportSections,
      } = await import("@shared/schema");
      const { eq, and, asc } = await import("drizzle-orm");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, clientId));

      if (!client) {
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }

      const competitorsData = await db
        .select()
        .from(competitors)
        .where(eq(competitors.clientId, clientId));

      const narrativeSectionsData = await db
        .select()
        .from(reportSections)
        .where(eq(reportSections.snapshotId, id))
        .orderBy(asc(reportSections.sectionOrder));

      const { streamZipExport } = await import("../services/zip-exporter");

      const snapshotData = report.snapshotData as any;
      const clientInfo = {
        id: client.id,
        name: client.name,
        industry: client.industry,
        geography: client.geography,
        website: client.website,
        urls: client.urls,
        focusAreas: client.focusAreas,
        aliases: client.aliases,
        brandAliases: client.brandAliases,
        selectedAiModelIds: client.selectedAiModelIds,
        onboardingStatus: client.onboardingStatus,
      };
      const competitorInfo = competitorsData.map((comp) => ({
        id: comp.id,
        name: comp.name,
        clientId: comp.clientId,
        website: comp.website,
        aliases: comp.aliases,
      }));

      const narrativeSections = narrativeSectionsData.map((section) => ({
        sectionName: section.sectionName,
        sectionContent: section.sectionContent,
        sectionOrder: section.sectionOrder,
        createdAt: section.createdAt?.toISOString() || "",
      }));

      await streamZipExport(
        snapshotData,
        clientInfo,
        competitorInfo,
        narrativeSections,
        res,
      );
    } catch (error) {
      // Streaming export: if any bytes have already been flushed we can't
      // emit a clean JSON envelope without garbling the response body.
      // Log and let the connection close; otherwise route through the
      // global error middleware so the client gets the unified envelope.
      if (!res.headersSent) {
        next(error);
      } else {
        req.log("error", "export stream failed mid-flight", {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  app.get("/api/v1/reports/:id/job", async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportJobs } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const [job] = await db
        .select()
        .from(reportJobs)
        .where(eq(reportJobs.snapshotId, id));

      if (!job) {
        throw new ApiError({ status: 404, code: "not_found", message: "Job not found for this report" });
      }

      res.json({ job });
    } catch (error) {
      next(error);
    }
  });

  // Task #90 — Retry the Technical Appendix for a report whose Insights
  // Report shipped but whose appendix failed. Reuses the stored snapshot
  // data; only the appendix half is re-run.
  app.post(
    "/api/v1/reports/:id/retry-appendix",
    requireRole({ minRole: "member", scope: "client" }),
    async (req, res, next) => {
      try {
        const { id } = req.params;
        const clientId = requireClientId(req, res);
        const { reportSnapshots, reportFiles } = await import("@shared/schema");
        const { eq, and } = await import("drizzle-orm");

        const [report] = await db
          .select()
          .from(reportSnapshots)
          .where(
            and(
              eq(reportSnapshots.id, id),
              eq(reportSnapshots.clientId, clientId),
            ),
          );
        if (!report) {
          throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
        }
        if (report.status !== "ready" && report.status !== "complete") {
          throw new ApiError({ status: 400, code: "bad_request", message: "Report is not in a ready state — cannot retry appendix" });
        }

        // Task #104 — gate to appendix-specific failures. Two preconditions:
        //   (1) Insights PDF MUST already exist — otherwise the report has
        //       a more fundamental failure than the appendix and silently
        //       running the appendix regenerator would clear
        //       `job.errorMessage` and mark the job `completed`, hiding
        //       the Insights failure from users and admins.
        //   (2) Appendix PDF MUST be missing — otherwise there's nothing
        //       to retry.
        const existingFiles = await db
          .select({ fileType: reportFiles.fileType })
          .from(reportFiles)
          .where(eq(reportFiles.snapshotId, id));
        const hasInsights = existingFiles.some(
          (f) => f.fileType === "insights_pdf" || f.fileType === "pdf",
        );
        const hasAppendix = existingFiles.some(
          (f) => f.fileType === "appendix_pdf",
        );
        if (hasAppendix) {
          throw new ApiError({ status: 409, code: "conflict", message: "Technical Appendix already exists for this report — nothing to retry", details: {
          } });
        }
        if (!hasInsights) {
          throw new ApiError({ status: 409, code: "conflict", message: "Insights PDF is also missing for this report — regenerate the full report instead of retrying the appendix alone", details: {
          } });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
          throw new ApiError({ status: 500, code: "internal_error", message: "OpenAI API key not configured" });
        }

        const { regenerateAppendixForSnapshot } = await import(
          "../services/report-job-processor"
        );
        const result = await regenerateAppendixForSnapshot(id, openaiApiKey);
        if (!result.ok) {
          throw new ApiError({
            status: 502,
            code: "upstream_error",
            message: "Technical Appendix retry failed",
            details: { detail: result.error },
          });
        }
        res.json({ message: "Technical Appendix regenerated successfully" });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete("/api/v1/reports/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const { id } = req.params;
      const clientId = requireClientId(req, res);
      const { reportSnapshots, reportFiles, reportJobs, reportSections } =
        await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const fs = await import("fs/promises");

      const [report] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.clientId, clientId),
          ),
        );

      if (!report) {
        throw new ApiError({ status: 404, code: "not_found", message: "Report not found or access denied" });
      }

      const files = await db
        .select()
        .from(reportFiles)
        .where(eq(reportFiles.snapshotId, id));

      for (const file of files) {
        try {
          await fs.unlink(file.fileUrl);
          console.log(`Deleted file: ${file.fileUrl}`);
        } catch (error) {
          console.warn(`Failed to delete file ${file.fileUrl}:`, error);
        }
      }

      await db
        .delete(reportSections)
        .where(eq(reportSections.snapshotId, id));
      await db.delete(reportFiles).where(eq(reportFiles.snapshotId, id));
      await db.delete(reportJobs).where(eq(reportJobs.snapshotId, id));
      await db
        .delete(reportSnapshots)
        .where(eq(reportSnapshots.id, id));

      res.json({ message: "Report deleted successfully" });
    } catch (error) {
      next(error);
    }
  });
}
