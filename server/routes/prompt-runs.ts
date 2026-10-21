import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import { getScoreExplanation } from "../services/score-explainability";
import { jobQueue } from "./_shared";
import { requireClientId } from "./_helpers";
import { requireRole, assertClientAccess } from "../auth";
import { canAccessInternalModels } from "../utils/internal-model-access";
import { promptRunsLimiter } from "../middleware/rate-limit-expensive";
import { ensureVendorPauseLoaded, isVendorPaused } from "../config/vendor-pause";
import { admitNativeSearch } from "../services/native-web-search/admission";
import { readSearchConfig, webSearchEnabledInput } from "../../shared/native-web-search";
import { NativeSearchStore } from "../services/native-web-search/store";

// Task #139 — A prompt run is "non-terminal" (still in flight / pausable /
// stoppable) when in any of these states. 'paused' is non-terminal too:
// stop must still be able to finalize a paused run to 'cancelled'.
const RUN_NON_TERMINAL_STATUSES = new Set<string>([
  "queued",
  "running",
  "scoring",
  "queued_for_benchmarking",
  "benchmarking",
  "paused",
]);
// Item states that should be flipped to 'cancelled' when a run is stopped
// without a live worker to do it cooperatively.
const ITEM_NON_TERMINAL_STATUSES = new Set<string>([
  "queued",
  "running",
  "scoring",
  "queued_for_benchmarking",
  "benchmarking",
]);

// Task #107: compact auto-generated run names. Format: `Run <id8> · MMM d`
// (e.g. `Run 584e61eb · May 16`). Short enough (~21 chars) to scan in the
// tracker list while still embedding the first 8 chars of the run id so
// users can cross-reference logs. Reused by the dashboard fallback in
// `server/routes/dashboard.ts` so legacy nameless runs render identically.
// Falls back to id-only if the Intl formatter ever throws.
export function buildAutoRunName(runId: string, now: Date = new Date()): string {
  const short = runId.replace(/-/g, "").substring(0, 8);
  try {
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(now);
    return `Run ${short} · ${date}`;
  } catch {
    return `Run ${short}`;
  }
}

// Task #107: strip any trailing `(iteration N)` suffix from a run name so we
// can compare against a canonical "base name" when computing the next
// iteration. Exported for the frontend-shared sibling helper to mirror.
export function stripIterationSuffix(name: string): string {
  return (name || "").replace(/\s*\(iteration\s+\d+\)\s*$/i, "").trim();
}

// Task #107: canonical, server-side iteration index. Scans every existing
// run for the project, strips iteration suffixes, and returns
// `<base> (iteration N+1)` where N is the largest existing K for the same
// stripped base name (default starts at 2). Running this server-side
// guarantees two near-simultaneous reruns produce sequential numbers
// instead of both landing on `(iteration K+1)`.
async function computeIterationName(
  clientId: string,
  rawBaseName: string,
): Promise<string> {
  const base = stripIterationSuffix(rawBaseName) || "Run";
  const runs = await storage.getPromptRuns(clientId);
  let maxN = 1;
  for (const r of runs) {
    const name = (r.name || "").trim();
    if (!name) continue;
    if (name === base) {
      // The base name itself counts as "iteration 1" for sequencing.
      maxN = Math.max(maxN, 1);
      continue;
    }
    const m = name.match(/^(.*?)\s*\(iteration\s+(\d+)\)\s*$/i);
    if (!m) continue;
    if (m[1].trim() !== base) continue;
    const n = Number.parseInt(m[2], 10);
    if (Number.isFinite(n)) maxN = Math.max(maxN, n);
  }
  return `${base} (iteration ${maxN + 1})`;
}

export function registerPromptRunRoutes(app: Express) {
  // A member role in a different selected project must not authorize writes to
  // a run where the caller is only a viewer. Bind role checks to the resource.
  const requireRunMember = requireRole({
    minRole: "member", scope: "client",
    resolveClientId: async req => {
      const run = await storage.getPromptRun(req.params.id);
      if (!run) throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      return run.clientId;
    },
  });
  app.get("/api/v1/prompt-runs", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      // Bounded + paginated: model counts and score averages are computed in
      // set-based SQL (see storage.getPromptRunSummaries), not per-row loops.
      // Detailed answers load via /prompt-runs/:id/results when a run opens.
      // Optional server-side filters so paging covers the whole (filtered)
      // history: `status` (exact) and `q` (case-insensitive name substring).
      const limit = Math.min(
        Math.max(parseInt(req.query.limit as string, 10) || 100, 1),
        200,
      );
      const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
      const status = typeof req.query.status === "string" && req.query.status !== "all"
        ? req.query.status
        : undefined;
      const search = typeof req.query.q === "string" ? req.query.q : undefined;
      const { runs, total } = await storage.getPromptRunSummaries(clientId, {
        limit,
        offset,
        status,
        search,
      });

      res.json({ runs, total, limit, offset });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompt-runs/metadata", async (req, res, next) => {
    try {
      const clientId = requireClientId(req, res);
      const metadata = await storage.getPromptRunsMetadata(clientId);
      res.json(metadata);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/prompt-runs", promptRunsLimiter, requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const schema = z.object({
        clientId: z.string(),
        promptIds: z.array(z.string()),
        modelIds: z.array(z.string()),
        // Task #56: kept for backward-compat with old clients but ALWAYS
        // overwritten with the authenticated user's id below — never trust
        // a client-supplied actor identity for activity attribution.
        createdBy: z.string().default("user"),
        name: z.string().max(200).optional(),
        // Task #107: opt-in iteration naming. When set, the server computes
        // a canonical `<base> (iteration N)` from existing runs for this
        // client/base so concurrent reruns can't collide on the same N.
        // `iterationOf` overrides any caller-supplied `name`.
        iterationOf: z.string().max(200).optional(),
        webSearchEnabled: webSearchEnabledInput,
      });

      const parsed = schema.parse(req.body);
      const { clientId, name, iterationOf } = parsed;
      // Task #25 — de-duplicate client-submitted IDs so a tampered payload
      // can't multiply run items (and cost) for the same prompt/model pair.
      const promptIds = Array.from(new Set(parsed.promptIds));
      const modelIds = Array.from(new Set(parsed.modelIds));
      // Task #56: stamp the actor server-side so activity attribution is
      // trustworthy. Falls back to the legacy "user" sentinel only when
      // there is no session (which the auth guard normally prevents).
      const actorId = (req.user as { id?: string } | undefined)?.id;
      const createdBy = actorId || "user";

      if (promptIds.length === 0) {
        throw new ApiError({ status: 400, code: "bad_request", message: "At least one prompt must be selected" });
      }

      if (modelIds.length === 0) {
        throw new ApiError({ status: 400, code: "bad_request", message: "At least one model must be selected" });
      }

      // Task #25 — hiding disabled models in the popup is not a security
      // boundary. Re-validate every submitted model ID server-side: it must
      // exist, be enabled, and belong to a vendor that is not admin-paused.
      const allModels = await storage.getAllAiModels();
      const modelById = new Map(allModels.map((m) => [m.id, m]));
      const unknownModels = modelIds.filter((id) => !modelById.has(id));
      if (unknownModels.length > 0) {
        throw new ApiError({ status: 400, code: "unknown_model", message: `Unknown AI model id(s): ${unknownModels.join(", ")}` });
      }
      const disabledModels = modelIds.filter((id) => !modelById.get(id)!.enabled);
      if (disabledModels.length > 0) {
        throw new ApiError({ status: 400, code: "model_disabled", message: `AI model(s) are disabled: ${disabledModels.map((id) => modelById.get(id)!.model).join(", ")}` });
      }
      // Task #29 — internal-only candidates (validation windows) are only
      // runnable by admin sessions; hiding them in the popup is not a
      // security boundary, so re-check server-side.
      if (!canAccessInternalModels(req)) {
        const internalModels = modelIds.filter((id) => modelById.get(id)!.internalOnly);
        if (internalModels.length > 0) {
          throw new ApiError({ status: 403, code: "model_internal_only", message: `AI model(s) are restricted to internal validation: ${internalModels.map((id) => modelById.get(id)!.model).join(", ")}` });
        }
      }
      await ensureVendorPauseLoaded();
      const pausedModels = modelIds.filter((id) => isVendorPaused(modelById.get(id)!.vendor));
      if (pausedModels.length > 0) {
        const vendors = Array.from(new Set(pausedModels.map((id) => modelById.get(id)!.vendor)));
        throw new ApiError({ status: 400, code: "vendor_paused", message: `Vendor(s) paused by admin: ${vendors.join(", ")}` });
      }

      // Task #25 — every submitted prompt must exist and belong to the
      // authenticated tenant; otherwise a tampered payload could execute (and
      // bill) prompts from another client under this client's run history.
      const clientPrompts = await storage.getPromptsByIds(clientId, promptIds);
      const clientPromptIds = new Set(clientPrompts.map((p) => p.id));
      const foreignPrompts = promptIds.filter((id) => !clientPromptIds.has(id));
      if (foreignPrompts.length > 0) {
        throw new ApiError({ status: 400, code: "unknown_prompt", message: `Prompt(s) not found for this client: ${foreignPrompts.join(", ")}` });
      }

      let searchConfig;
      try {
        searchConfig = admitNativeSearch(parsed.webSearchEnabled,
          modelIds.map(id => modelById.get(id)!), {
            tenantId: clientId, userId: createdBy, isAdmin: canAccessInternalModels(req),
            validation: canAccessInternalModels(req), itemCount: promptIds.length * modelIds.length,
          });
      } catch (error) {
        throw new ApiError({ status: 400, code: "web_search_ineligible",
          message: error instanceof Error ? error.message : "Web search is not available for this selection.",
          details: { models: (error as { blocked?: unknown }).blocked } });
      }

      const runId = crypto.randomUUID();
      if (searchConfig.validationApprovals?.length) {
        try {
          await new NativeSearchStore().reserveValidation(searchConfig, runId, promptIds.length * modelIds.length);
        } catch {
          throw new ApiError({ status: 400, code: "web_search_ineligible",
            message: "The approved internal validation allowance is exhausted or no longer applicable." });
        }
      }
      // Task #107: iterationOf wins over name (rerun flow); otherwise honour
      // the user-typed name; otherwise fall back to the compact auto-name.
      const runName = iterationOf
        ? await computeIterationName(clientId, iterationOf)
        : (name?.trim() || buildAutoRunName(runId));

      const run = await storage.createPromptRun({
        id: runId,
        clientId,
        name: runName,
        createdBy,
        totalPrompts: promptIds.length * modelIds.length,
        status: "queued",
        searchConfig,
      });

      const items = [];
      for (const promptId of promptIds) {
        for (const modelId of modelIds) {
          const item = await storage.createPromptRunItem({
            promptRunId: run.id,
            promptId,
            modelId,
            status: "queued",
            startedAt: null,
            finishedAt: null,
            error: null,
          });
          items.push(item);
        }
      }

      await jobQueue.enqueue({
        type: "process_prompt_run",
        payload: { promptRunId: run.id },
        startedByUserId: actorId ?? null,
      });

      res.status(201).json({ run, items });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({
          status: 422,
          code: "validation_failed",
          message: "Invalid prompt run data",
          details: { fieldErrors: error.flatten().fieldErrors },
        }));
      }
      next(error);
    }
  });

  app.get("/api/v1/prompt-runs/:id/search-evidence/:itemId", async (req, res, next) => {
    try {
      const run = await storage.getPromptRun(req.params.id);
      if (!run) throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      const belongs = (await storage.getPromptRunItems(run.id)).some(i => i.id === req.params.itemId);
      if (!belongs) throw new ApiError({ status: 404, code: "not_found", message: "Run item not found" });
      if (!readSearchConfig(run.searchConfig).webSearch.enabled) return res.json({ phase: "off", evidence: null });
      const execution = (await new NativeSearchStore().details(run.id, req.params.itemId))[0];
      res.json({ ...(execution ?? { itemId: req.params.itemId, phase: "not_started", evidence: null, answerText: null }),
        runStatus: run.status });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/prompt-runs/:id", async (req, res, next) => {
    try {
      const run = await storage.getPromptRun(req.params.id);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      res.json(run);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/v1/prompt-runs/:id", requireRunMember, async (req, res, next) => {
    try {
      const schema = z.object({
        name: z
          .string()
          .min(1, "Name cannot be empty")
          .max(200, "Name must be 200 characters or less"),
      });

      const { name } = schema.parse(req.body);

      const run = await storage.getPromptRun(req.params.id);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }

      const updated = await storage.updatePromptRun(req.params.id, {
        name: name.trim(),
      });

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid name", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  // Task #56: lightweight endpoint that returns just the (promptIds, modelIds)
  // selection for an in-flight run, so the StartRunDialog can warn only when
  // the *same* prompt+model set would be re-executed (not on every concurrent
  // run for the project).
  app.get("/api/v1/prompt-runs/:id/selections", async (req, res, next) => {
    try {
      const run = await storage.getPromptRun(req.params.id);
      if (!run) throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      const items = await storage.getPromptRunItems(req.params.id);
      const promptIds = Array.from(new Set(items.map((i) => i.promptId)));
      const modelIds = Array.from(new Set(items.map((i) => i.modelId)));
      res.json({ runId: run.id, promptIds, modelIds,
        webSearchEnabled: readSearchConfig(run.searchConfig).webSearch.enabled });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompt-runs/:id/results", async (req, res, next) => {
    try {
      const run = await storage.getPromptRun(req.params.id);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;

      const [items, competitorScores, categories] = await Promise.all([
        storage.getPromptRunItems(req.params.id),
        storage.getCompetitorScoresByRun(req.params.id),
        storage.getPromptCategories(),
      ]);

      const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

      const results = await Promise.all(
        items.map(async (item) => {
          const [prompt, model, answer] = await Promise.all([
            storage.getPrompt(item.promptId),
            storage.getAiModel(item.modelId),
            storage.getAnswerByPromptRunItem(item.id),
          ]);

          let citations: any[] = [];
          let mentions: any[] = [];
          let rankings: any[] = [];

          if (answer) {
            [citations, mentions, rankings] = await Promise.all([
              storage.getCitationsByAnswer(answer.id),
              storage.getMentionsByAnswer(answer.id),
              storage.getRankingsByAnswer(answer.id),
            ]);
          }

          const promptWithCategory = prompt
            ? {
                ...prompt,
                categoryName: prompt.categoryId
                  ? categoryMap.get(prompt.categoryId) || null
                  : null,
              }
            : null;

          return {
            item,
            prompt: promptWithCategory,
            model,
            answer,
            citations,
            mentions,
            rankings,
          };
        }),
      );

      res.json({ run, results, competitorScores });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/prompt-runs/:id/recalculate-position", requireRunMember, async (req, res, next) => {
    try {
      const { calculatePositionScoreV2 } = await import("../services/composer");
      const run = await storage.getPromptRun(req.params.id);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }

      const items = await storage.getPromptRunItems(req.params.id);
      let updated = 0;
      let processed = 0;

      for (const item of items) {
        const answer = await storage.getAnswerByPromptRunItem(item.id);
        if (!answer) continue;

        const rankings = await storage.getRankingsByAnswer(answer.id);
        if (rankings.length === 0) continue;

        processed++;
        const mapRanking = (r: any) => ({
          position: r.position,
          rankingGroup: r.rankingGroup ?? undefined,
          groupRelevance: r.groupRelevance as
            | "relevant"
            | "partial"
            | "irrelevant"
            | null
            | undefined,
          item: r.item,
        });

        const brandRankings = rankings
          .filter((r) => r.isClientBrand)
          .map(mapRanking);
        const allMapped = rankings.map(mapRanking);

        const v2Result = calculatePositionScoreV2(brandRankings, allMapped);
        const oldScore = Number(answer.positionScore) || 0;

        if (v2Result.score !== oldScore) {
          await storage.updateAnswer(answer.id, {
            positionScore: v2Result.score.toString(),
          });
          updated++;
        }
      }

      res.json({
        message: `Recalculated position scores for ${updated} answers using V2`,
        updated,
        total: processed,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompt-runs/:id/errors", async (req, res, next) => {
    try {
      const promptRunId = req.params.id;

      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;

      const errorSummary = await storage.aggregateRunErrors(promptRunId);

      res.json({
        promptRunId,
        status: run.status,
        totalItems: errorSummary.totalItems,
        errorCount: errorSummary.errorCount,
        errorSummary: errorSummary.errorSummary,
        errors: errorSummary.errors,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/prompt-runs/:id/logs", async (req, res, next) => {
    try {
      const promptRunId = req.params.id;

      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;

      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const cursor = req.query.cursor as string | undefined;

      const result = await storage.getPromptRunLogs(promptRunId, {
        limit,
        cursor,
      });

      res.json({
        promptRunId,
        logs: result.logs,
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/v1/prompt-runs/:id", requireRunMember, async (req, res, next) => {
    try {
      const promptRunId = req.params.id;
      // Authz: bind the action to the run's own client (defends against IDOR
      // where a known run id is targeted by a user without access to it).
      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      // Task #139 — Stop the backing job FIRST and wait for the in-flight
      // worker to wind down, so we never leave an orphaned worker writing to
      // rows we're about to delete. No-ops when there's no live/paused job.
      await jobQueue.cancelRunJobAndWait(promptRunId);
      await storage.deletePromptRun(promptRunId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/prompt-runs/:id/stop", requireRunMember, async (req, res, next) => {
    try {
      const promptRunId = req.params.id;

      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      const jobs = await storage.getJobs();
      const job = jobs.find(
        (j) =>
          j.type === "process_prompt_run" &&
          (j.payload as { promptRunId: string }).promptRunId === promptRunId &&
          (j.status === "queued" || j.status === "running" || j.status === "paused"),
      );

      // Task #139 — Hardened stop. A run can be non-terminal without a live
      // worker (queued-but-not-started, paused, or a job that already exited
      // uncleanly). Cancel the job if present, and ALWAYS finalize the run +
      // its pending items to a terminal 'cancelled' state unless a running
      // worker will do it cooperatively on its own.
      if (job) {
        await jobQueue.cancelJob(job.id);
      }

      const runIsActive = !!run && RUN_NON_TERMINAL_STATUSES.has(run.status);
      const hasRunningWorker = !!job && job.status === "running";

      if (!job && !runIsActive) {
        throw new ApiError({ status: 404, code: "not_found", message: "No active job found for this prompt run" });
      }

      if (runIsActive && !hasRunningWorker) {
        // No executor will transition this run, so do it here.
        await storage.updatePromptRun(promptRunId, { status: "cancelled" });
        const items = await storage.getPromptRunItems(promptRunId);
        for (const item of items) {
          if (ITEM_NON_TERMINAL_STATUSES.has(item.status)) {
            await storage.updatePromptRunItem(item.id, {
              status: "cancelled",
              finishedAt: new Date(),
            });
          }
        }
      }

      res.json({ message: "Prompt run stopped successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Task #139 — True Pause. Suspend a queued/running run, preserving its
  // checkpoint + completed items so it can be resumed later without
  // re-paying for already-completed prompt-model combinations.
  app.post("/api/v1/prompt-runs/:id/pause", requireRunMember, async (req, res, next) => {
    try {
      const promptRunId = req.params.id;
      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      const jobs = await storage.getJobs();
      const job = jobs.find(
        (j) =>
          j.type === "process_prompt_run" &&
          (j.payload as { promptRunId: string }).promptRunId === promptRunId &&
          (j.status === "queued" || j.status === "running"),
      );

      if (!job) {
        throw new ApiError({ status: 404, code: "not_found", message: "No active job found to pause for this prompt run" });
      }

      await jobQueue.pauseJob(job.id);
      await storage.updatePromptRun(promptRunId, { status: "paused" });

      res.json({ message: "Prompt run paused successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Task #139 — Resume a paused run. Re-queues the job; the executor reads
  // the preserved checkpoint and skips already-completed items.
  app.post("/api/v1/prompt-runs/:id/resume", requireRunMember, async (req, res, next) => {
    try {
      const promptRunId = req.params.id;
      const run = await storage.getPromptRun(promptRunId);
      if (!run) {
        throw new ApiError({ status: 404, code: "not_found", message: "Prompt run not found" });
      }
      if (!(await assertClientAccess(req, res, run.clientId))) return;
      const jobs = await storage.getJobs();
      const job = jobs.find(
        (j) =>
          j.type === "process_prompt_run" &&
          (j.payload as { promptRunId: string }).promptRunId === promptRunId &&
          j.status === "paused",
      );

      if (!job) {
        throw new ApiError({ status: 404, code: "not_found", message: "No paused job found to resume for this prompt run" });
      }

      await jobQueue.resumeJob(job.id);
      await storage.updatePromptRun(promptRunId, { status: "queued" });

      res.json({ message: "Prompt run resumed successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/v1/prompt-runs/:id/score-explanation/:category",
    async (req, res, next) => {
      try {
        const { id: promptRunId, category } = req.params;
        const { promptId } = req.query;

        if (!["Visibility", "Sentiment", "Position"].includes(category)) {
          throw new ApiError({ status: 400, code: "bad_request", message: "Invalid category. Must be 'Visibility', 'Sentiment', or 'Position'", details: {
          } });
        }

        const explanation = await getScoreExplanation(
          storage,
          promptRunId,
          category as "Visibility" | "Sentiment" | "Position",
          promptId as string | undefined,
        );

        res.json(explanation);
      } catch (error) {
        console.error("Error fetching score explanation:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch score explanation";

        if (
          message.includes("No prompt run items found") ||
          message.includes("No score factors found") ||
          message.includes("No interpretation template found") ||
          message.includes("No color band found")
        ) {
          return next(new ApiError({ status: 404, code: "not_found", message: message }));
        }

        next(error);
      }
    },
  );

  app.get(
    "/api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks",
    async (req, res, next) => {
      try {
        const { runId, promptId } = req.params;
        const clientId = requireClientId(req, res);
        const benchmarks = await storage.getPromptBenchmarks(
          runId,
          promptId,
          clientId,
        );

        if (
          !benchmarks ||
          !benchmarks.entities ||
          benchmarks.entities.length === 0
        ) {
          throw new ApiError({ status: 404, code: "not_found", message: "No benchmark data found for this prompt" });
        }

        res.json({
          runId,
          promptId,
          clientId,
          summary: benchmarks.summary,
          entities: benchmarks.entities,
        });
      } catch (error) {
        console.error("Error fetching prompt benchmarks:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch prompt benchmarks";
        next(error);
    }
    },
  );

  app.get(
    "/api/v1/prompt-runs/:runId/prompts/:promptId/metric-details",
    async (req, res, next) => {
      try {
        const { runId, promptId } = req.params;
        const clientId = requireClientId(req, res);
        const [
          visibilityExplanation,
          sentimentExplanation,
          positionExplanation,
          benchmarks,
        ] = await Promise.all([
          getScoreExplanation(storage, runId, "Visibility", promptId).catch(
            () => null,
          ),
          getScoreExplanation(storage, runId, "Sentiment", promptId).catch(
            () => null,
          ),
          getScoreExplanation(storage, runId, "Position", promptId).catch(
            () => null,
          ),
          storage
            .getPromptBenchmarks(runId, promptId, clientId)
            .catch(() => null),
        ]);

        res.json({
          runId,
          promptId,
          clientId,
          interpretations: {
            visibility: visibilityExplanation,
            sentiment: sentimentExplanation,
            position: positionExplanation,
          },
          benchmarks: benchmarks
            ? {
                summary: benchmarks.summary,
                entities: benchmarks.entities,
              }
            : null,
        });
      } catch (error) {
        console.error("Error fetching metric details:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch metric details";
        next(error);
    }
    },
  );

  app.get("/api/v1/prompt-runs/:runId/benchmarks-bulk", async (req, res, next) => {
    try {
      const { runId } = req.params;
      const clientId = requireClientId(req, res);
      const benchmarks = await storage.getBulkPromptBenchmarks(runId, clientId);

      const metricDescriptions = {
        visibility:
          "Visibility measures how frequently your brand appears in AI-generated responses. A higher score indicates stronger brand presence and recall across AI models.",
        sentiment:
          "Sentiment evaluates the tone and context of brand mentions in AI responses. This score reflects whether your brand is portrayed positively, neutrally, or negatively.",
        position:
          "Position tracks your brand's ranking in AI-generated lists and recommendations. A higher score means your brand consistently appears in top positions.",
      };

      res.json({
        runId,
        clientId,
        benchmarks,
        metricDescriptions,
      });
    } catch (error) {
      console.error("Error fetching bulk benchmarks:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch bulk benchmarks";
      next(error);
    }
  });
}
