import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { storage } from "../storage";
import { probeSiteHealth, updateSiteHealth } from "../services/xray-health-probe";
import { jobQueue } from "./_shared";
import { requireClientId } from "./_helpers";
import { requireRole, assertClientAccess } from "../auth";
import { xrayBatchLimiter } from "../middleware/rate-limit-expensive";

export function registerXRayRoutes(app: Express) {
  // Step 5.1.1: Get all X-Ray sites for a client
  app.get("/api/v1/xray/sites", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      const sitesWithMetrics = await storage.getXRaySitesWithMetrics(clientId);

      // Task #64: attach the most recent xray_analysis job per site so the
      // UI can show "last ran by X, finished Y ago, succeeded/failed" on
      // every site card — not just for runs the current tab kicked off.
      const lastJobs = await storage.getLatestXRayJobsBySite(clientId);
      const userIds = Array.from(
        new Set(
          Array.from(lastJobs.values())
            .map((j) => j.startedByUserId)
            .filter((u): u is string => !!u),
        ),
      );
      const userRows = userIds.length > 0 ? await storage.getUsersByIds(userIds) : [];
      const usersById = new Map(userRows.map((u) => [u.id, u]));

      const ACTIVE = new Set(["queued", "running"]);
      const sitesWithJobs = sitesWithMetrics.map((site) => {
        const job = lastJobs.get(site.id);
        if (!job) return { ...site, lastAnalysisJob: null, activeJobId: null };
        const u = job.startedByUserId ? usersById.get(job.startedByUserId) : null;
        return {
          ...site,
          lastAnalysisJob: {
            jobId: job.jobId,
            status: job.status,
            error: job.error,
            progress: job.progress,
            startedAt: job.startedAt ? job.startedAt.toISOString() : null,
            finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
            createdAt: job.createdAt.toISOString(),
            startedByUserId: job.startedByUserId,
            startedByDisplayName: u?.displayName ?? null,
            startedByEmail: u?.email ?? null,
          },
          activeJobId: ACTIVE.has(job.status) ? job.jobId : null,
        };
      });

      // Auto-refresh stale health data in background (>24 hours old or never checked)
      const sites = await storage.getXRaySitesByClient(clientId);
      const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

      for (const site of sites) {
        if (site.clientId !== clientId) continue;

        const isStale =
          !site.lastProbedAt ||
          Date.now() - new Date(site.lastProbedAt).getTime() >
            STALE_THRESHOLD_MS;

        if (isStale) {
          console.log(
            `Background refresh: Health data stale for ${site.domain} (client: ${clientId}), triggering refresh`,
          );
          probeSiteHealth(site.domain)
            .then((healthData) =>
              updateSiteHealth(storage, site.id, healthData),
            )
            .catch((err) =>
              console.error(
                `Background health refresh failed for ${site.domain}:`,
                err,
              ),
            );
        }
      }

      res.json(sitesWithJobs);
    } catch (error) {
      next(error);
    }
  });

  // Step 5.1.2: Get site details + health data
  app.get("/api/v1/xray/sites/:siteId", async (req, res, next) => {
    try {
      const site = await storage.getXRaySite(req.params.siteId);
      if (!site) {
        throw new ApiError({ status: 404, code: "not_found", message: "Site not found" });
      }
      if (!(await assertClientAccess(req, res, site.clientId))) return;

      const response = {
        ...site,
        robotsRules: site.robotsRules,
        aiTxtContent: site.aiTxtContent,
        crawlEvidence: site.crawlEvidence,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // Step 5.1.2b: Refresh health check for a site
  app.post("/api/v1/xray/sites/:siteId/refresh-health", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      const site = await storage.getXRaySite(req.params.siteId);
      if (!site) {
        throw new ApiError({ status: 404, code: "not_found", message: "Site not found" });
      }

      if (site.clientId !== clientId) {
        throw new ApiError({ status: 403, code: "forbidden", message: "Access denied - site belongs to different client" });
      }

      console.log(
        `Refreshing health check for site: ${site.domain} (client: ${clientId})`,
      );
      const healthData = await probeSiteHealth(site.domain);
      await updateSiteHealth(storage, site.id, healthData);

      const updatedSite = await storage.getXRaySite(site.id);
      res.json({
        success: true,
        message: "Health check refreshed successfully",
        site: updatedSite,
      });
    } catch (error) {
      next(error);
    }
  });

  // Step 5.1.3: Get all pages for a site with summary data
  app.get("/api/v1/xray/sites/:siteId/pages", async (req, res, next) => {
    try {
      const site = await storage.getXRaySite(req.params.siteId);
      if (!site) {
        throw new ApiError({ status: 404, code: "not_found", message: "Site not found" });
      }
      if (!(await assertClientAccess(req, res, site.clientId))) return;
      const pagesWithSummary = await storage.getXRayPagesSummary(
        req.params.siteId,
      );
      res.json(pagesWithSummary);
    } catch (error) {
      next(error);
    }
  });

  // Step 5.1.4: Get full page data
  app.get("/api/v1/xray/pages/:pageId", async (req, res, next) => {
    try {
      const page = await storage.getXRayPage(req.params.pageId);
      if (!page) {
        throw new ApiError({ status: 404, code: "not_found", message: "Page not found" });
      }
      const site = await storage.getXRaySite(page.siteId);
      if (site && !(await assertClientAccess(req, res, site.clientId))) return;

      const structure = await storage.getPageStructure(req.params.pageId);
      const analysis = await storage.getPageAnalysis(req.params.pageId);

      res.json({ page, structure, analysis });
    } catch (error) {
      next(error);
    }
  });

  // Step 5.2.1: Get AI-generated analysis for a page
  app.get("/api/v1/xray/pages/:pageId/analysis", async (req, res, next) => {
    try {
      const page = await storage.getXRayPage(req.params.pageId);
      if (page) {
        const site = await storage.getXRaySite(page.siteId);
        if (site && !(await assertClientAccess(req, res, site.clientId))) return;
      }
      const analysis = await storage.getPageAnalysis(req.params.pageId);
      if (!analysis) {
        throw new ApiError({ status: 404, code: "not_found", message: "Analysis not found for this page" });
      }

      res.json({
        assessment: analysis.assessment,
        gaps: analysis.gaps,
        recommendations: analysis.recommendations,
        actions: analysis.actions,
        seoIssues: analysis.seoIssues,
        scores: analysis.scores,
      });
    } catch (error) {
      next(error);
    }
  });

  // Step 5.2.2: Trigger batch analysis job for a site
  app.post("/api/v1/xray/analyze/batch", xrayBatchLimiter, requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const { siteId } = req.body;
      if (!siteId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "siteId is required" });
      }

      const site = await storage.getXRaySite(siteId);
      if (!site) {
        throw new ApiError({ status: 404, code: "not_found", message: "Site not found" });
      }

      // Task #56: enqueue exactly once (the previous double-write created
      // an orphan `storage.createJob` row that never picked up a worker
      // and inflated the active-operations panel) and attribute the job
      // to the calling user.
      const actorId = (req.user as { id?: string } | undefined)?.id ?? null;
      const job = await jobQueue.enqueue({
        type: "xray_analysis",
        payload: { siteId, clientId: site.clientId },
        startedByUserId: actorId,
      });

      res.json({ jobId: job.id, status: "queued" });
    } catch (error) {
      next(error);
    }
  });

  // Step 5.2.3: Get filtered action items
  app.get("/api/v1/xray/actions", async (req, res, next) => {
    try {
      const siteId = req.query.siteId as string;
      const owner = req.query.owner as string;
      const effort = req.query.effort as string;

      if (!siteId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "siteId query parameter is required" });
      }

      const pages = await storage.getXRayPagesBySite(siteId);

      const allActions: any[] = [];

      for (const page of pages) {
        const analysis = await storage.getPageAnalysis(page.id);
        if (analysis && analysis.actions) {
          const actions = Array.isArray(analysis.actions) ? analysis.actions : [];
          actions.forEach((action: any) => {
            allActions.push({
              pageUrl: page.url,
              pageTitle: page.title,
              text: action.text || action.action,
              owner: action.owner,
              effort: action.effort,
            });
          });
        }
      }

      let filteredActions = allActions;
      if (owner) {
        filteredActions = filteredActions.filter((a) => a.owner === owner);
      }
      if (effort) {
        filteredActions = filteredActions.filter((a) => a.effort === effort);
      }

      res.json({ actions: filteredActions });
    } catch (error) {
      next(error);
    }
  });
}
