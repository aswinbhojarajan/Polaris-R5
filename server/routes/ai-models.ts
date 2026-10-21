import type { Express, Request } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import { requireRole } from "../auth";
import { recordAudit } from "../services/audit";
import type { User, AiModel } from "@shared/schema";
import {
  LLM_FUNCTION_DEFAULTS,
  LLM_FUNCTION_ALLOWED_VENDORS,
  getResolvedLlmFunctionTable,
  invalidateLlmFunctionCache,
  ensureLlmFunctionCacheLoaded,
  isVendorAllowedForFunction,
  type LLMFunctionKey,
} from "../config/llm-functions";
import {
  ensureVendorPauseLoaded,
  invalidateVendorPauseCache,
  isVendorPaused,
} from "../config/vendor-pause";
import { canAccessInternalModels } from "../utils/internal-model-access";
import { getSearchEligibility, loadSearchPolicy } from "../services/native-web-search/policy";

// Map vendor → env var that powers the executor for that provider.
// Surfaced to the admin Providers panel so a "no key configured" state
// tells the operator exactly which env var to set.
const VENDOR_ENV_VAR: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
};

function vendorKeyConfigured(vendor: string): boolean {
  const envVar = VENDOR_ENV_VAR[vendor.toLowerCase()];
  if (!envVar) return false;
  return !!process.env[envVar];
}

const LLM_FUNCTION_KEYS = Object.keys(LLM_FUNCTION_DEFAULTS) as LLMFunctionKey[];

const setLlmFunctionOverrideSchema = z.object({
  modelId: z.string().min(1).nullable(),
});

const updateCategorySchema = z.object({
  category: z.enum(["core", "additional"]),
});

const updateEnabledSchema = z.object({
  enabled: z.boolean(),
  // Task #79 — Optional human-readable reason captured when the admin
  // disables a model. Persisted on the row + audit metadata. Cleared on
  // re-enable. Empty string is treated as "no reason given".
  reason: z.string().trim().max(500).optional(),
});

function annotateKeyAvailability<T extends AiModel>(models: T[], req?: Request) {
  const searchPolicy = loadSearchPolicy();
  const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasGoogleKey = !!process.env.GOOGLE_API_KEY;
  const hasPerplexityKey = !!process.env.PERPLEXITY_API_KEY;
  return models.map((model) => ({
    ...model,
    webSearch: getSearchEligibility(model, searchPolicy, req ? {
      userId: (req.user as { id?: string })?.id ?? "",
      tenantId: String(req.query.clientId ?? req.headers["x-client-id"] ?? ""),
      isAdmin: canAccessInternalModels(req), validation: canAccessInternalModels(req), itemCount: 1,
    } : undefined),
    isKeyAvailable:
      (model.vendor === "OpenAI" && hasOpenAiKey) ||
      (model.vendor === "Anthropic" && hasAnthropicKey) ||
      (model.vendor === "Google" && hasGoogleKey) ||
      (model.vendor === "Perplexity" && hasPerplexityKey),
    // Task #78 — Surface vendor pause state on every model row so the
    // admin table can render a "Vendor paused" chip and the consumer
    // endpoint can filter these out.
    isVendorPaused: isVendorPaused(model.vendor),
  }));
}

export function registerAiModelRoutes(app: Express) {
  app.get("/api/v1/ai-models", async (req, res, next) => {
    try {
      // Task #78 — Hide paused-vendor models from the wizard / configuration
      // / run dialog so they cannot be selected for new runs. The admin
      // catalog endpoint below still returns them so the per-row chip can
      // surface the state.
      await ensureVendorPauseLoaded();
      const models = await storage.getAiModels();
      // Task #29 — internal-only candidates are invisible to normal users
      // even while temporarily enabled for an admin validation window.
      // Admin sessions still see them so the run dialog can be used for
      // recorded validation runs.
      const filtered = models.filter(
        (m) => !isVendorPaused(m.vendor) && (canAccessInternalModels(req) || !m.internalOnly),
      );
      res.json(annotateKeyAvailability(filtered, req));
    } catch (error) {
      next(error);
    }
  });

  // Admin-only: full catalog including disabled rows so admins can re-enable
  // a model previously disabled (deprecated, vendor outage, etc.) without
  // shipping a code change.
  app.get(
    "/api/v1/admin/ai-models",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        await ensureVendorPauseLoaded();
        const models = await storage.getAllAiModels();
        res.json(annotateKeyAvailability(models, req));
      } catch (error) {
        next(error);
      }
    },
  );

  // Task #78 — Providers panel data. One row per vendor present in the
  // catalog (so adding a model with a new vendor automatically grows the
  // panel), enriched with key-configured state, current pause state +
  // attribution, model counts, and a best-effort "last successful call"
  // timestamp pulled from prompt_run_items. Admin-only.
  app.get(
    "/api/v1/admin/providers",
    requireRole({ minRole: "admin", scope: "none" }),
    async (_req, res, next) => {
      try {
        await ensureVendorPauseLoaded();
        const [allModels, statuses] = await Promise.all([
          storage.getAllAiModels(),
          storage.getAiVendorStatuses(),
        ]);
        const statusByVendor = new Map(
          statuses.map((s) => [s.vendor.toLowerCase(), s] as const),
        );
        const vendorSet = new Set<string>();
        for (const m of allModels) vendorSet.add(m.vendor);
        for (const s of statuses) vendorSet.add(s.vendor);

        const rows = await Promise.all(
          Array.from(vendorSet)
            .sort((a, b) => a.localeCompare(b))
            .map(async (vendor) => {
              const lower = vendor.toLowerCase();
              const status = statusByVendor.get(lower);
              const vendorModels = allModels.filter((m) => m.vendor === vendor);
              const [lastSuccessAt, inFlightItemCount, errorRate] = await Promise.all([
                storage.getVendorLastSuccessAt(vendor),
                storage.getVendorInFlightItemCount(vendor),
                storage.getVendorLast24hErrorRate(vendor),
              ]);
              return {
                vendor,
                envVar: VENDOR_ENV_VAR[lower] ?? null,
                keyConfigured: vendorKeyConfigured(vendor),
                paused: status?.paused ?? false,
                pausedAt: status?.pausedAt ?? null,
                pausedByUserId: status?.pausedByUserId ?? null,
                pauseReason: status?.pauseReason ?? null,
                modelCount: vendorModels.length,
                enabledModelCount: vendorModels.filter((m) => m.enabled).length,
                lastSuccessAt,
                inFlightItemCount,
                // Task #115 — rolling-24h error rate for the at-a-glance
                // operational dashboard. `total = 0` is reported as
                // `null` so the UI can render "no traffic" instead of
                // a misleading 0%.
                last24hErrorRate: errorRate.totalCount === 0 ? null : errorRate.errorRate,
                last24hTotalCount: errorRate.totalCount,
                last24hErrorCount: errorRate.errorCount,
              };
            }),
        );
        res.json(rows);
      } catch (error) {
        next(error);
    }
    },
  );

  // Task #78 — Toggle a vendor's paused state. Audit-logged. The vendor
  // is identified by its display name (matches `ai_models.vendor`),
  // case-insensitive. Returns 404 if no model in the catalog uses that
  // vendor (we don't want admins inventing strings here).
  app.patch(
    "/api/v1/admin/providers/:vendor",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const parsed = z
          .object({ paused: z.boolean(), reason: z.string().max(500).optional() })
          .safeParse(req.body);
        if (!parsed.success) {
          return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid request body", details: { fieldErrors: parsed.error.flatten().fieldErrors } }));
        }
        const allModels = await storage.getAllAiModels();
        const canonical = allModels.find(
          (m) => m.vendor.toLowerCase() === req.params.vendor.toLowerCase(),
        )?.vendor;
        if (!canonical) {
          throw new ApiError({ status: 404, code: "not_found", message: "Unknown vendor" });
        }
        const before = (await storage.getAiVendorStatuses()).find(
          (s) => s.vendor.toLowerCase() === canonical.toLowerCase(),
        );
        await storage.setAiVendorPause(
          canonical,
          parsed.data.paused,
          (req.user as User | undefined)?.id ?? null,
          parsed.data.reason ?? null,
        );
        await invalidateVendorPauseCache();

        // Task #115 — operational alert on vendor pause flip (debounced).
        void (await import("../services/alert-sink")).alertVendorPause({
          vendor: canonical,
          paused: parsed.data.paused,
          actor:
            (req.user as User | undefined)?.displayName ??
            (req.user as User | undefined)?.email ??
            null,
          reason: parsed.data.reason ?? null,
        });

        await recordAudit({
          req,
          actorUserId: (req.user as User | undefined)?.id,
          action: parsed.data.paused
            ? "ai_vendor.pause.set"
            : "ai_vendor.pause.clear",
          targetType: "ai_vendor",
          targetId: canonical,
          metadata: {
            vendor: canonical,
            from: { paused: before?.paused ?? false },
            to: { paused: parsed.data.paused, reason: parsed.data.reason ?? null },
          },
        });

        res.json({ vendor: canonical, paused: parsed.data.paused });
      } catch (error) {
        next(error);
    }
    },
  );

  // Admin-only: flip a model's Core/Additional category. The `ai_models`
  // table is global (not org-scoped), so we use scope: 'none' which checks
  // for admin role in any org the caller belongs to. Audit-logged so the
  // admin Audit page surfaces the change.
  app.patch(
    "/api/v1/admin/ai-models/:id/category",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const parsed = updateCategorySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError({ status: 422, code: "validation_failed", message: "Invalid request body", details: { fieldErrors: parsed.error.flatten(), } });
        }
        const { id } = req.params;
        const before = await storage.getAiModel(id);
        if (!before) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }
        const updated = await storage.updateAiModelCategory(id, parsed.data.category);
        if (!updated) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }

        if (before.category !== parsed.data.category) {
          await recordAudit({
            req,
            actorUserId: (req.user as User | undefined)?.id,
            action: "ai_model.category.update",
            targetType: "ai_model",
            targetId: id,
            metadata: {
              model: before.model,
              displayName: before.displayName,
              from: before.category,
              to: parsed.data.category,
            },
          });
        }

        res.json(updated);
      } catch (error) {
        next(error);
    }
    },
  );

  // Admin-only: read-only "blast radius" preview for the disable confirm
  // dialog (Task #73). Returns how many active projects currently list
  // this model in their saved configuration and how many prompt_run_items
  // are still in flight against it. The UI uses this to warn before
  // actually flipping the Enabled switch off.
  app.get(
    "/api/v1/admin/ai-models/:id/usage",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const model = await storage.getAiModel(req.params.id);
        if (!model) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }
        const usage = await storage.getAiModelUsage(req.params.id);
        res.json(usage);
      } catch (error) {
        next(error);
    }
    },
  );

  // Admin-only: enable/disable a model in-place. Disabled models are filtered
  // out of `GET /api/v1/ai-models` (the consumer-facing endpoint used by the
  // wizard, configuration page and run dialog) so they don't appear in any
  // selection UI or "select all" defaults. Audit-logged.
  // Task #77 — Per-function LLM model picker. Returns each of the 14
  // function keys with its description, currently-resolved model, and the
  // resolution source (override / env / default). The UI renders this as
  // the "Functions" tab on /app/admin/models.
  app.get(
    "/api/v1/admin/llm-functions",
    requireRole({ minRole: "admin", scope: "none" }),
    async (_req, res, next) => {
      try {
        // Block on the first read so the table is hot before we serialize.
        await ensureLlmFunctionCacheLoaded();
        res.json(getResolvedLlmFunctionTable());
      } catch (error) {
        next(error);
    }
    },
  );

  // Task #77 — Set or clear the override for one function key. `modelId`
  // null clears the override (falls back to env / default). When non-null,
  // we validate that the model exists and is enabled; the resolver itself
  // also degrades a since-disabled override to the default at read time so
  // a freshly-disabled model won't break inflight reads.
  app.patch(
    "/api/v1/admin/llm-functions/:fn",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const fn = req.params.fn as LLMFunctionKey;
        if (!LLM_FUNCTION_KEYS.includes(fn)) {
          throw new ApiError({ status: 404, code: "not_found", message: "Unknown function key" });
        }
        const parsed = setLlmFunctionOverrideSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError({ status: 422, code: "validation_failed", message: "Invalid request body", details: { fieldErrors: parsed.error.flatten(), } });
        }
        const { modelId } = parsed.data;

        let modelLabel: string | null = null;
        if (modelId !== null) {
          const model = await storage.getAiModel(modelId);
          if (!model) {
            throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
          }
          if (!model.enabled) {
            throw new ApiError({ status: 400, code: "bad_request", message: "Cannot override with a disabled model." });
          }
          if (!isVendorAllowedForFunction(fn, model.vendor)) {
            throw new ApiError({
              status: 400,
              code: "bad_request",
              message:
                `${model.vendor} models are not compatible with the "${fn}" function. ` +
                `Allowed vendors: ${LLM_FUNCTION_ALLOWED_VENDORS[fn].join(", ")}.`,
            });
          }
          modelLabel = `${model.displayName} (${model.model})`;
        }

        // Capture the previous resolution for the audit metadata. We
        // also resolve the previous override row's modelId (if any) so
        // the per-model History popover can surface override changes
        // that affected this specific model.
        await ensureLlmFunctionCacheLoaded();
        const beforeRow = getResolvedLlmFunctionTable().find(
          (r) => r.functionKey === fn,
        );
        const previousOverrideModelId =
          await storage.getLlmFunctionOverrideModelId(fn);
        const previousOverrideModel = previousOverrideModelId
          ? await storage.getAiModel(previousOverrideModelId)
          : null;
        const previousOverrideLabel = previousOverrideModel
          ? `${previousOverrideModel.displayName} (${previousOverrideModel.model})`
          : null;

        await storage.setLlmFunctionOverride(
          fn,
          modelId,
          (req.user as User | undefined)?.id ?? null,
        );
        invalidateLlmFunctionCache();
        await ensureLlmFunctionCacheLoaded();
        const afterRow = getResolvedLlmFunctionTable().find(
          (r) => r.functionKey === fn,
        );

        await recordAudit({
          req,
          actorUserId: (req.user as User | undefined)?.id,
          action:
            modelId === null
              ? "llm_function.override.clear"
              : "llm_function.override.set",
          targetType: "llm_function",
          targetId: fn,
          metadata: {
            functionKey: fn,
            // Task #79 — Per-model history join keys. The History
            // popover unions ai_model rows with llm_function rows whose
            // metadata.modelId or metadata.previousModelId matches.
            modelId: modelId,
            previousModelId: previousOverrideModelId,
            from: {
              model: beforeRow?.resolvedModel,
              source: beforeRow?.source,
              overrideModelLabel: previousOverrideLabel,
            },
            to: {
              model: afterRow?.resolvedModel,
              source: afterRow?.source,
              overrideModelLabel: modelLabel,
            },
          },
        });

        res.json(afterRow);
      } catch (error) {
        next(error);
    }
    },
  );

  // Task #29 — Flip a model's internal-only visibility gate. While true,
  // the model is hidden from the consumer catalog and rejected in
  // prompt-run submissions for non-admin sessions, so a candidate can be
  // temporarily enabled for validation without user exposure.
  app.patch(
    "/api/v1/admin/ai-models/:id/internal-only",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const parsed = z.object({ internalOnly: z.boolean() }).safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError({ status: 422, code: "validation_failed", message: "Invalid request body", details: { fieldErrors: parsed.error.flatten() } });
        }
        const { id } = req.params;
        const before = await storage.getAiModel(id);
        if (!before) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }
        const updated = await storage.updateAiModelInternalOnly(id, parsed.data.internalOnly);
        if (before.internalOnly !== parsed.data.internalOnly) {
          await recordAudit({
            req,
            actorUserId: (req.user as User | undefined)?.id,
            action: "ai_model.internal_only.update",
            targetType: "ai_model",
            targetId: id,
            metadata: {
              model: before.model,
              displayName: before.displayName,
              vendor: before.vendor,
              from: before.internalOnly,
              to: parsed.data.internalOnly,
            },
          });
        }
        res.json(updated);
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/api/v1/admin/ai-models/:id/enabled",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const parsed = updateEnabledSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError({ status: 422, code: "validation_failed", message: "Invalid request body", details: { fieldErrors: parsed.error.flatten(), } });
        }
        const { id } = req.params;
        const before = await storage.getAiModel(id);
        if (!before) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }
        const actorUserId = (req.user as User | undefined)?.id ?? null;
        const reason = parsed.data.reason?.trim() || null;
        const updated = await storage.updateAiModelEnabled(
          id,
          parsed.data.enabled,
          actorUserId,
          reason,
        );
        if (!updated) {
          throw new ApiError({ status: 404, code: "not_found", message: "Model not found" });
        }

        // Task #79 — When transitioning from enabled→disabled, cancel any
        // in-flight work targeting the model and sweep it out of every
        // project's `selectedAiModelIds` (with a one-time banner so the
        // project owner sees what happened on next visit). The reason
        // string flows into both the audit log and the user-facing
        // errorSummary on the cancelled runs.
        let cancellation = { items: 0, runs: 0, jobs: 0 };
        let affectedClientIds: string[] = [];
        if (before.enabled && !parsed.data.enabled) {
          const reasonForCascade = reason
            ? `Model ${before.displayName} was disabled by an admin: ${reason}`
            : `Model ${before.displayName} was disabled by an admin`;
          cancellation = await storage.cancelInFlightForDisabledModel(
            id,
            reasonForCascade,
          );
          affectedClientIds = await storage.sweepDisabledModelFromClients(
            id,
            before.displayName,
            before.vendor,
            reason,
          );
        }

        if (before.enabled !== parsed.data.enabled) {
          await recordAudit({
            req,
            actorUserId: actorUserId ?? undefined,
            action: parsed.data.enabled
              ? "ai_model.enabled.update"
              : "ai_model.disabled.update",
            targetType: "ai_model",
            targetId: id,
            metadata: {
              model: before.model,
              displayName: before.displayName,
              vendor: before.vendor,
              from: before.enabled,
              to: parsed.data.enabled,
              reason,
              cancelledItems: cancellation.items,
              cancelledRuns: cancellation.runs,
              cancelledJobs: cancellation.jobs,
              affectedClientCount: affectedClientIds.length,
            },
          });
        }

        res.json({ ...updated, cancellation, affectedClientCount: affectedClientIds.length });
      } catch (error) {
        next(error);
    }
    },
  );

  // Task #79 — Per-model audit history. Returns the most recent 5
  // entries from the audit log filtered to `targetType=ai_model` so the
  // History popover can render the disable/enable timeline.
  app.get(
    "/api/v1/admin/ai-models/:id/audit",
    requireRole({ minRole: "admin", scope: "none" }),
    async (req, res, next) => {
      try {
        const { id } = req.params;
        const entries = await storage.getAiModelAuditHistory(id, 5);
        res.json(entries);
      } catch (error) {
        next(error);
    }
    },
  );
}
