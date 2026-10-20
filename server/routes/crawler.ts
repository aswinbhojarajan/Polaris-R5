import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import {
  crawlWebsite,
  formatCrawledContentForLLM,
} from "../services/website-crawler";
import { jobQueue } from "./_shared";
import { requireRole } from "../auth";

// Zod validation schemas for crawler endpoints
const crawlerExecuteSchema = z.object({
  url: z.string().url(),
  options: z
    .object({
      maxPages: z.number().min(1).max(50).optional(),
      timeout: z.number().min(1000).max(60000).optional(),
      method: z.enum(["auto", "cheerio", "playwright"]).optional(),
    })
    .optional(),
});

const formatForLLMSchema = z.object({
  crawlResult: z.object({
    pages: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        content: z.string(),
        pageType: z.string(),
      }),
    ),
    totalPages: z.number(),
    crawlMethod: z.string(),
  }),
  options: z
    .object({
      maxCharsPerPage: z.number().min(500).max(10000).optional(),
      includePageTypes: z.array(z.string()).optional(),
    })
    .optional(),
});

const crawlAndFormatSchema = z.object({
  url: z.string().url(),
  crawlOptions: z
    .object({
      maxPages: z.number().min(1).max(50).optional(),
      timeout: z.number().min(1000).max(60000).optional(),
      method: z.enum(["auto", "cheerio", "playwright"]).optional(),
    })
    .optional(),
  formatOptions: z
    .object({
      maxCharsPerPage: z.number().min(500).max(10000).optional(),
      includePageTypes: z.array(z.string()).optional(),
    })
    .optional(),
});

// Security: URL validation to block localhost and private IPs
function isSecureUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    if (!["http:", "https:"].includes(url.protocol)) {
      return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
    }

    if (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0"
    ) {
      return { valid: false, error: "Cannot crawl localhost URLs" };
    }

    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = url.hostname.match(ipv4Regex);
    if (match) {
      const [, a, b] = match.map(Number);
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return { valid: false, error: "Cannot crawl private IP addresses" };
      }
    }

    if (url.hostname.includes("replit.dev") || url.hostname.includes("repl.co")) {
      return { valid: false, error: "Cannot crawl internal Replit URLs" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

// Simple in-memory rate limiter
const crawlRateLimit = new Map<string, number>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const lastCrawl = crawlRateLimit.get(ip) || 0;
  if (now - lastCrawl < 5000) return false;
  crawlRateLimit.set(ip, now);
  return true;
}

export function registerCrawlerRoutes(app: Express) {
  // Endpoint 1: Execute crawl (synchronous)
  app.post("/api/v1/crawler/execute", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const validation = crawlerExecuteSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Invalid request body", details: { error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: validation.error.errors,
          }, } });
      }

      const { url } = validation.data;

      const urlCheck = isSecureUrl(url);
      if (!urlCheck.valid) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Request failed", details: { error: {
            code: "INVALID_URL",
            message: urlCheck.error,
            details: { url },
          }, } });
      }

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        throw new ApiError({ status: 429, code: "rate_limited", message: "Too many requests. Please wait 5 seconds between crawls.", details: { error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please wait 5 seconds between crawls.",
            details: { retryAfter: 5 },
          }, } });
      }

      const startTime = Date.now();
      const result = await crawlWebsite(url);
      const duration = Date.now() - startTime;

      res.json({
        url,
        crawledAt: new Date().toISOString(),
        duration,
        result,
      });
    } catch (error) {
      console.error("Error executing crawl:", error);
      next(error);
    }
  });

  // Endpoint 2: Execute crawl (asynchronous)
  app.post("/api/v1/crawler/execute/async", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const validation = crawlerExecuteSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Invalid request body", details: { error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: validation.error.errors,
          }, } });
      }

      const { url, options } = validation.data;

      const urlCheck = isSecureUrl(url);
      if (!urlCheck.valid) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Request failed", details: { error: {
            code: "INVALID_URL",
            message: urlCheck.error,
            details: { url },
          }, } });
      }

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        throw new ApiError({ status: 429, code: "rate_limited", message: "Too many requests. Please wait 5 seconds between crawls.", details: { error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please wait 5 seconds between crawls.",
            details: { retryAfter: 5 },
          }, } });
      }

      // Task #56: collapse the prior double-write (`createJob` + `enqueue`
      // both inserted a `jobs` row, leaving an orphan that never picked
      // up a worker). Attribute to the caller for activity attribution.
      const actorId = (req.user as { id?: string } | undefined)?.id ?? null;
      const job = await jobQueue.enqueue({
        type: "crawler_raw",
        payload: { url, options: options || {} },
        startedByUserId: actorId,
      });

      res.status(202).json({
        jobId: job.id,
        status: "queued",
        url,
        pollUrl: `/api/v1/crawler/jobs/${job.id}`,
      });
    } catch (error) {
      console.error("Error queuing crawl job:", error);
      next(error);
    }
  });

  // Endpoint 3: Get crawler job status
  app.get("/api/v1/crawler/jobs/:jobId", async (req, res, next) => {
    try {
      const job = await storage.getJob(req.params.jobId);

      if (!job) {
        throw new ApiError({ status: 404, code: "not_found", message: "Job not found", details: { error: {
            code: "JOB_NOT_FOUND",
            message: "Job not found",
            details: { jobId: req.params.jobId },
          }, } });
      }

      const response: any = {
        jobId: job.id,
        status: job.status,
        url: (job.payload as any).url,
        createdAt: job.createdAt,
      };

      if (job.status === "done") {
        response.crawledAt = job.finishedAt || job.createdAt;
        if ((job.payload as any).result) {
          response.result = (job.payload as any).result;
        }
      }

      if (job.status === "error" && job.error) {
        response.error = job.error;
      }

      if (job.status === "running" && job.progress !== null) {
        response.progress = job.progress;
      }

      res.json(response);
    } catch (error) {
      console.error("Error fetching job:", error);
      next(error);
    }
  });

  // Endpoint 4: Format crawl result for LLM
  app.post("/api/v1/crawler/format-for-llm", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const validation = formatForLLMSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Invalid request body", details: { error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: validation.error.errors,
          }, } });
      }

      const { crawlResult, options } = validation.data;

      let filteredPages = crawlResult.pages;
      if (options?.includePageTypes && options.includePageTypes.length > 0) {
        filteredPages = crawlResult.pages.filter((page) =>
          options.includePageTypes!.includes(page.pageType),
        );
      }

      const formatted = formatCrawledContentForLLM({
        pages: filteredPages as any,
        totalPages: filteredPages.length,
        crawlMethod: crawlResult.crawlMethod as any,
      });

      const pagesByType: Record<string, number> = {};
      filteredPages.forEach((page) => {
        pagesByType[page.pageType] = (pagesByType[page.pageType] || 0) + 1;
      });

      res.json({
        formatted,
        stats: {
          totalPages: crawlResult.totalPages,
          includedPages: filteredPages.length,
          excludedPages: crawlResult.totalPages - filteredPages.length,
          totalChars: formatted.length,
          pagesByType,
        },
      });
    } catch (error) {
      console.error("Error formatting content:", error);
      next(error);
    }
  });

  // Endpoint 5: Crawl and format (combined)
  app.post("/api/v1/crawler/crawl-and-format", requireRole({ minRole: "member", scope: "none" }), async (req, res, next) => {
    try {
      const validation = crawlAndFormatSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Invalid request body", details: { error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: validation.error.errors,
          }, } });
      }

      const { url, formatOptions } = validation.data;

      const urlCheck = isSecureUrl(url);
      if (!urlCheck.valid) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Request failed", details: { error: {
            code: "INVALID_URL",
            message: urlCheck.error,
            details: { url },
          }, } });
      }

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        throw new ApiError({ status: 429, code: "rate_limited", message: "Too many requests. Please wait 5 seconds between crawls.", details: { error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please wait 5 seconds between crawls.",
            details: { retryAfter: 5 },
          }, } });
      }

      const startTime = Date.now();
      const crawlResult = await crawlWebsite(url);
      const duration = Date.now() - startTime;

      if (crawlResult.crawlMethod === "failed") {
          return next(new ApiError({
            status: 502,
            code: "upstream_error",
            message: "Crawl failed",
            details: { error: (crawlResult as { error?: unknown }).error ?? null },
          }));
        }

      let filteredPages = crawlResult.pages;
      if (
        formatOptions?.includePageTypes &&
        formatOptions.includePageTypes.length > 0
      ) {
        filteredPages = crawlResult.pages.filter((page) =>
          formatOptions.includePageTypes!.includes(page.pageType),
        );
      }

      const formatted = formatCrawledContentForLLM({
        ...crawlResult,
        pages: filteredPages,
        totalPages: filteredPages.length,
      });

      const pagesByType: Record<string, number> = {};
      filteredPages.forEach((page) => {
        pagesByType[page.pageType] = (pagesByType[page.pageType] || 0) + 1;
      });

      res.json({
        url,
        crawledAt: new Date().toISOString(),
        duration,
        crawlResult,
        formatted,
        stats: {
          totalPages: crawlResult.totalPages,
          includedPages: filteredPages.length,
          excludedPages: crawlResult.totalPages - filteredPages.length,
          totalChars: formatted.length,
          pagesByType,
        },
      });
    } catch (error) {
      console.error("Error in crawl-and-format:", error);
      next(error);
    }
  });
}
