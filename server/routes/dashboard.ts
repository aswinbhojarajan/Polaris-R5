import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { promptRuns, promptRunItems, answers } from "@shared/schema";
import { requireClientId } from "./_helpers";
import { buildAutoRunName } from "./prompt-runs";

export function registerDashboardRoutes(app: Express) {
  app.get("/api/v1/dashboard/stats", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const [prompts, runs, topics, activeModels, aggregatedScores] =
        await Promise.all([
          storage.getPrompts(clientId),
          storage.getPromptRuns(clientId),
          storage.getTopics(clientId),
          storage.getClientModels(clientId),
          storage.getClientAggregatedScores(clientId),
        ]);

      const completedRuns = runs.filter((run) => run.status === "done");

      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.json({
        totalPrompts: prompts.length,
        avgVisibilityScore: aggregatedScores.avgVisibilityScore,
        avgSentimentScore: aggregatedScores.avgSentimentScore,
        avgPositionScore: aggregatedScores.avgPositionScore,
        totalCitations: aggregatedScores.totalCitations,
        activeModels: activeModels.length,
        totalRuns: runs.length,
        completedRuns: completedRuns.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/dashboard/historical-scores", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const runIdsParam = req.query.runIds as string | undefined;
      const runIds = runIdsParam
        ? runIdsParam.split(",").filter((id) => id.trim())
        : undefined;

      let limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
      if (isNaN(limit) || limit < 1) limit = 5;
      if (limit > 1000) limit = 1000;

      const historicalData = await storage.getHistoricalScores(clientId, {
        limit,
        runIds,
      });

      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.json(historicalData);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/dashboard/top-topics", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const topics = await storage.getTopics(clientId);

      // Single set-based aggregate over all answers belonging to this
      // client's completed runs — replaces the previous per-run/per-item
      // N+1 loop that timed out on large migrated histories.
      const [agg] = await db
        .select({
          avgVisibility: sql<number>`AVG(COALESCE(${answers.visibilityScore}, 0))`,
          avgSentiment: sql<number>`AVG(COALESCE(${answers.sentimentScore}, 0))`,
          avgPosition: sql<number>`AVG(COALESCE(${answers.positionScore}, 0))`,
          count: sql<number>`COUNT(*)`,
        })
        .from(answers)
        .innerJoin(
          promptRunItems,
          eq(answers.promptRunItemId, promptRunItems.id),
        )
        .innerJoin(promptRuns, eq(promptRunItems.promptRunId, promptRuns.id))
        .where(
          and(eq(promptRuns.clientId, clientId), eq(promptRuns.status, "done")),
        );

      let overallScore = 0;
      if (agg && Number(agg.count) > 0) {
        overallScore =
          Number(agg.avgVisibility) * 0.5 +
          Number(agg.avgSentiment) * 0.3 +
          Number(agg.avgPosition) * 0.2;
      }

      const topicsWithScores = topics
        .filter((topic) => topic.accepted)
        .map((topic) => {
          const keywords = Array.isArray(topic.keywords) ? topic.keywords : [];
          return {
            id: topic.id,
            label: topic.label,
            category: topic.category,
            score: Math.round(overallScore),
            keywords: keywords,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      res.json(topicsWithScores);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/dashboard/recent-runs", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const runs = await storage.getPromptRuns(clientId);

      const recentRuns = [...runs]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 5)
        .map((run) => ({
          id: run.id,
          // Task #107: preserve user-typed names; only synthesize for
          // legacy/null-named runs, and use the same `Run <id8> · <MMM d>`
          // format as the create endpoint so the synthesized labels render
          // identically.
          name: run.name?.trim() || buildAutoRunName(run.id, new Date(run.createdAt)),
          prompts: run.totalPrompts || 0,
          models: 0,
          status: run.status,
          createdAt: run.createdAt,
        }));

      res.json(recentRuns);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/dashboard/competitor-rankings", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      if (!clientId) return;
      console.log("[DEBUG] Competitor rankings - clientId:", clientId);

      const runIdsParam = req.query.runIds as string | undefined;
      const runIds = runIdsParam
        ? runIdsParam.split(",").filter((id) => id.trim())
        : undefined;

      console.log("[DEBUG] Competitor rankings - runIds:", runIds);

      const scores = await storage.getAggregatedCompetitorScores(
        clientId,
        runIds,
      );
      console.log(
        "[DEBUG] Competitor rankings - aggregated scores found:",
        scores.length,
      );

      const rankedScores = scores.map((score, index) => ({
        ...score,
        rank: index + 1,
      }));

      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      res.json(rankedScores);
    } catch (error) {
      next(error);
    }
  });
}
