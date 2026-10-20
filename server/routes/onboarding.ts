import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { enrichmentService } from "./_shared";
import { requireRole } from "../auth";
import { probeUrls } from "../services/url-reachability";

export function registerOnboardingRoutes(app: Express) {
  app.post("/api/v1/onboarding/enrich-urls", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Client name is required" });
      }
      console.log(`[Onboarding] Enriching URLs for client: ${name}`);
      const result = await enrichmentService.enrichUrls(name);
      console.log(`[Onboarding] Successfully enriched URLs for client: ${name}`);
      res.json(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[Onboarding] Failed to enrich URLs:", errorMessage);
      console.error("[Onboarding] Full error:", error);

      if (errorMessage.includes("OPENAI_API_KEY")) {
        return next(error);
    }

      next(error);
    }
  });

  app.post("/api/v1/onboarding/enrich-profile", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const { name, urls, focusAreas } = req.body;
      if (!name || typeof name !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Client name is required" });
      }
      console.log(`[Onboarding] Enriching profile for client: ${name}`);
      const result = await enrichmentService.enrichProfile({
        name,
        urls,
        focusAreas,
      });
      console.log(`[Onboarding] Successfully enriched profile for client: ${name}`);
      res.json(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[Onboarding] Failed to enrich profile:", errorMessage);
      console.error("[Onboarding] Full error:", error);

      if (errorMessage.includes("OPENAI_API_KEY")) {
        return next(error);
    }

      next(error);
    }
  });

  // Task #99 — Standalone reachability probe used by the wizard's
  // "Re-check" button so the user can verify URLs they've edited or added
  // themselves without re-running the (slow, paid) AI enrichment call.
  app.post("/api/v1/onboarding/probe-urls", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const { urls } = req.body || {};
      if (!Array.isArray(urls)) {
        throw new ApiError({ status: 400, code: "bad_request", message: "urls must be an array of strings" });
      }
      const filtered = urls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 25);
      const reachability = await probeUrls(filtered);
      res.json({ reachability });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      next(error);
    }
  });

  app.post("/api/v1/onboarding/enrich-competitors", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const { name, urls, industry, geography, brandAliases, focusAreas } =
        req.body;
      if (!name || typeof name !== "string") {
        throw new ApiError({ status: 400, code: "bad_request", message: "Client name is required" });
      }
      console.log(`[Onboarding] Enriching competitors for client: ${name}`);
      const result = await enrichmentService.enrichCompetitors({
        name,
        urls,
        industry,
        geography,
        brandAliases,
        focusAreas,
      });
      console.log(
        `[Onboarding] Successfully enriched competitors for client: ${name}`,
      );
      res.json(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[Onboarding] Failed to enrich competitors:", errorMessage);
      console.error("[Onboarding] Full error:", error);

      if (errorMessage.includes("OPENAI_API_KEY")) {
        return next(error);
    }

      next(error);
    }
  });
}
