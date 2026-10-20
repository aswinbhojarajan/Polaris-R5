import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { storage } from "../storage";
import { openaiService } from "../openai-service";
import { requireClientId } from "./_helpers";
import { requireRole } from "../auth";
import {
  DeliverablesAlreadyGeneratingError,
  finalizePromptRunDeliverables,
  TARGET_CONTENT_DRAFTS,
} from "../services/prompt-run-deliverables";

export function registerOpportunityRoutes(app: Express) {
  app.get("/api/v1/opportunities/citations", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const promptRunId = req.query.promptRunId as string | undefined;
      const citationAnalysis = await storage.getCitationAnalysis(
        clientId,
        promptRunId || undefined,
      );
      res.json(citationAnalysis);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/citations/domain/:domain", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const { domain } = req.params;
      if (!domain) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Domain parameter is required" });
      }

      const promptRunId = req.query.promptRunId as string | undefined;
      const citations = await storage.getCitationsByDomain(
        clientId,
        domain,
        promptRunId || undefined,
      );
      res.json(citations);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/recommendations", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const promptRunId = req.query.promptRunId as string | undefined;
      const recommendations = await storage.getRecommendations(
        clientId,
        promptRunId || undefined,
      );

      const idFilter = req.query.id as string;
      if (idFilter) {
        const filtered = recommendations.recommendations.filter(
          (r: any) => r.id === idFilter,
        );
        return res.json({ ...recommendations, recommendations: filtered });
      }

      res.json(recommendations);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/recommendations/stats", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const promptRunId = req.query.promptRunId as string | undefined;
      const { getCategoryStats } = await import(
        "../services/recommendations-summary"
      );
      const stats = await getCategoryStats(clientId, promptRunId);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/recommendations/summary", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const { SUMMARY_DEFAULTS } = await import(
        "../services/recommendations-summary"
      );

      const options = {
        page: parseInt(req.query.page as string) || SUMMARY_DEFAULTS.page!,
        pageSize:
          parseInt(req.query.pageSize as string) || SUMMARY_DEFAULTS.pageSize!,
        sortBy: (req.query.sortBy as string) || SUMMARY_DEFAULTS.sortBy!,
        sortDir: (req.query.sortDir as string) || SUMMARY_DEFAULTS.sortDir!,
        search: req.query.search as string,
        category: req.query.category as string,
        highLevelCategory: req.query.highLevelCategory as string,
        severity: req.query.severity as string,
        source: req.query.source as string,
        promptRunId: req.query.promptRunId as string | undefined,
      };

      const summary = await storage.getRecommendationsSummary(
        clientId,
        options,
      );
      res.json(summary);
    } catch (error) {
      console.error("Error fetching recommendations summary:", error);
      next(error);
    }
  });

  app.post("/api/v1/opportunities/recommendations", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const { insertRecommendationSchema } = await import("@shared/schema");

      const data = insertRecommendationSchema.parse({
        ...req.body,
        clientId,
        source: "manual",
        promptRunId: null,
      });

      const newRecommendation = await storage.createRecommendation(data);
      res.json(newRecommendation);
    } catch (error: any) {
      console.error("Error creating recommendation:", error);
      if (error.name === "ZodError") {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid recommendation data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  app.post("/api/v1/opportunities/recommendations/generate", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const { clientId } = req.body;
      if (!clientId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "clientId is required" });
      }

      const recommendations = await openaiService.generateRecommendations(
        clientId,
      );
      await storage.saveRecommendations(clientId, null, recommendations);

      res.json({
        message: "Recommendations generated successfully",
        count: recommendations.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/content", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const promptRunId = req.query.promptRunId as string | undefined;
      const contents = await storage.getGeneratedContents(
        clientId,
        promptRunId || undefined,
      );
      res.json(contents);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/opportunities/deliverables/status", requireRole({ minRole: "viewer", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      const promptRunId = req.query.promptRunId as string | undefined;

      const run = promptRunId
        ? await storage.getPromptRun(promptRunId)
        : (await storage.getPromptRuns(clientId)).find(
            candidate => candidate.status === "done" || candidate.status === "completed_with_errors",
          );
      if (!run || run.clientId !== clientId) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      const recommendations = await storage.getRecommendations(clientId, run.id);
      const contents = await storage.getGeneratedContents(clientId, run.id);

      res.json({
        promptRunId: run.id,
        runStatus: run.status,
        status: run.deliverablesStatus,
        errorSummary: run.deliverablesErrorSummary,
        recommendationCount: recommendations.recommendations.length,
        contentCount: contents.length,
        targetContentCount: TARGET_CONTENT_DRAFTS,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post([
    "/api/v1/opportunities/content/generate",
    "/api/v1/opportunities/deliverables/retry",
  ], requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      const { promptRunId } = req.body;
      if (!promptRunId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "promptRunId is required" });
      }

      const run = await storage.getPromptRun(promptRunId);
      if (!run || run.clientId !== clientId) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (run.status !== "done" && run.status !== "completed_with_errors") {
        throw new ApiError({ status: 409, code: "run_not_complete", message: "The prompt run must finish before deliverables can be retried" });
      }
      if (run.deliverablesStatus === "generating") {
        throw new ApiError({ status: 409, code: "already_generating", message: "Final deliverables are already being generated" });
      }

      const result = await finalizePromptRunDeliverables({
        storage,
        clientId,
        promptRunId,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof DeliverablesAlreadyGeneratingError) {
        return next(new ApiError({
          status: 409,
          code: "already_generating",
          message: error.message,
        }));
      }
      next(error);
    }
  });
}
