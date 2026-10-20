import type { Express } from "express";
import { ApiError } from "../utils/api-error";
import { z } from "zod";
import { storage } from "../storage";
import {
  insertClientSchema,
  createClientSchema,
  promptCategories,
  prompts,
  type User,
} from "@shared/schema";
import { and, eq, or } from "drizzle-orm";
import { generateRealisticPrompts } from "../openai-service";
import { db } from "../db";
import { classifyPrompt } from "../services/prompt-classifier";
import { jobQueue } from "./_shared";
import { getOrgId } from "./_helpers";
import { refreshPromptsLimiter } from "../middleware/rate-limit-expensive";
import {
  requireRole,
  assertOrgAccess,
  assertClientAccess,
  getUserRoleInOrg,
} from "../auth";

// Task #98 — bounded-concurrency map. Returns results in the same order
// as the input. Used to parallelise the per-prompt classifier calls in
// the refresh-prompts route (was serial, ~30–60s for 18 prompts).
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < lanes; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          results[i] = await fn(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

export function registerClientRoutes(app: Express) {
  // Organizations
  app.get("/api/v1/organizations/:id", async (req, res, next) => {
    try {
      if (!(await assertOrgAccess(req, res, req.params.id))) return;
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        throw new ApiError({ status: 404, code: "not_found", message: "Organization not found" });
      }
      res.json(org);
    } catch (error) {
      next(error);
    }
  });

  // Clients
  app.get("/api/v1/clients", async (req, res, next) => {
    try {
      const orgId = getOrgId(req) || "default-org";
      const user = req.user as User | undefined;
      // Resolve the caller's role in this org so DbStorage can apply the
      // per-project visibility filter (admins see all; members/viewers see
      // only owned + explicitly-granted projects).
      let viewer:
        | { userId: string; role: 'admin' | 'member' | 'viewer' }
        | undefined;
      if (user) {
        const role = await getUserRoleInOrg(user.id, orgId);
        if (!role) {
          // Authenticated caller with no role in this org — never expose
          // the project list (Task #17 access control).
          return res.json([]);
        }
        viewer = { userId: user.id, role };
      }
      const clients = await storage.getClients(orgId, viewer);
      res.json(clients);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/clients/validate-project-name", async (req, res, next) => {
    try {
      const { projectName, excludeId } = req.query;
      const orgId = getOrgId(req);

      if (!projectName || !orgId) {
        throw new ApiError({ status: 400, code: "bad_request", message: "projectName and orgId are required", details: {
        } });
      }

      const existing = await storage.findClientByProjectName(
        orgId,
        projectName as string,
        excludeId as string | undefined,
      );

      res.json({
        available: !existing,
        conflictingProjectId: existing?.id || null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/clients", requireRole({ minRole: "member", scope: "org" }), async (req, res, next) => {
    try {
      // Strip user-supplied owner — the route always stamps the session
      // user as owner so it cannot be spoofed.
      const data = createClientSchema.omit({ ownerUserId: true }).parse(req.body);
      const { competitors, modelIds, ...clientData } = data;

      const existing = await storage.findClientByProjectName(
        clientData.orgId,
        clientData.projectName,
      );

      if (existing) {
        throw new ApiError({ status: 409, code: "conflict", message: "A project with this name already exists. Please choose another name.", details: {
          field: "projectName",
          conflictingProjectId: existing.id,
        } });
      }

      // Stamp the creator as the project owner. The creator is always
      // recorded on `clients.ownerUserId` (Task #17), and they implicitly
      // have access without needing a `project_memberships` row.
      const user = req.user as User | undefined;
      const client = await storage.createClient({
        ...clientData,
        ownerUserId: user?.id ?? null,
        updatedByUserId: user?.id ?? null,
      });

      if (competitors && competitors.length > 0) {
        await Promise.all(
          competitors.map((comp) =>
            storage.createCompetitor({
              clientId: client.id,
              name: comp.name,
              website: comp.website || null,
              aliases: comp.aliases || [],
            }),
          ),
        );
      }

      if (modelIds && modelIds.length > 0) {
        await storage.updateClientModels(client.id, modelIds);
      }

      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid client data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      next(error);
    }
  });

  // Task #144 — record that the caller opened this project. Powers the
  // catalog's "Last opened" default sort. Idempotent upsert; any role with
  // access to the project may record an open (including viewers).
  app.post("/api/v1/clients/:id/open", async (req, res, next) => {
    try {
      if (!(await assertClientAccess(req, res, req.params.id))) return;
      const user = req.user as User | undefined;
      if (!user) {
        throw new ApiError({ status: 401, code: "unauthorized", message: "Authentication required" });
      }
      await storage.recordProjectOpen(user.id, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/clients/:id", async (req, res, next) => {
    try {
      if (!(await assertClientAccess(req, res, req.params.id))) return;
      const client = await storage.getClient(req.params.id);
      if (!client) {
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/v1/clients/:id", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      // Strip admin-only / server-managed metadata from the user-facing
      // update path. Owner reassignment is admin-only via
      // PATCH /api/v1/admin/clients/:id (Task #17).
      const data = insertClientSchema
        .partial()
        .omit({
          ownerUserId: true,
          updatedByUserId: true,
          updatedAt: true,
          orgId: true,
        })
        .parse(req.body);

      const existingClient = await storage.getClient(req.params.id);
      if (!existingClient) {
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }

      if (data.projectName) {
        const existing = await storage.findClientByProjectName(
          existingClient.orgId,
          data.projectName,
          req.params.id,
        );

        if (existing) {
          throw new ApiError({ status: 409, code: "conflict", message: "A project with this name already exists. Please choose another name.", details: {
            field: "projectName",
            conflictingProjectId: existing.id,
          } });
        }
      }

      const user = req.user as User | undefined;
      const client = await storage.updateClient(req.params.id, {
        ...data,
        updatedByUserId: user?.id ?? null,
      });
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(new ApiError({ status: 422, code: "validation_failed", message: "Invalid client data", details: { fieldErrors: error.flatten().fieldErrors } }));
      }
      if (error instanceof Error && error.message.includes("unique constraint")) {
        return next(new ApiError({ status: 409, code: "conflict", message: "A project with this name already exists. Please choose another name.", details: { field: "projectName" } }));
      }
      next(error);
    }
  });

  app.delete("/api/v1/clients/:id", requireRole({ minRole: "admin", scope: "client" }), async (req, res, next) => {
    try {
      await storage.deleteClient(req.params.id);
      res.json({
        success: true,
        message: "Client and all related data deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/clients/:id/copy", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const sourceClientId = req.params.id;
      const { projectName } = req.body || {};
      const validatedName =
        typeof projectName === "string" && projectName.trim()
          ? projectName.trim()
          : undefined;

      const actorId = (req.user as User | undefined)?.id ?? null;
      const job = await storage.createJob({
        type: "copy_client",
        payload: { sourceClientId, projectName: validatedName },
        startedByUserId: actorId,
      });

      (async () => {
        try {
          await storage.updateJob(job.id, {
            status: "running",
            startedAt: new Date(),
          });
          const result = await storage.copyClientWithProgress(
            sourceClientId,
            job.id,
            validatedName,
          );
          // Stamp the copy's creator as the new project's owner, so the
          // user who initiated the copy retains access without needing a
          // project_memberships row.
          const actor = req.user as User | undefined;
          if (actor?.id && result.client?.id) {
            try {
              await storage.updateClient(result.client.id, {
                ownerUserId: actor.id,
                updatedByUserId: actor.id,
              });
            } catch (err) {
              console.error("Failed to stamp copy owner:", err);
            }
          }
          await storage.updateJob(job.id, {
            status: "done",
            progress: 100,
            finishedAt: new Date(),
            payload: {
              ...job.payload,
              result: { clientId: result.client.id, copied: result.copied },
            },
          });
        } catch (error) {
          console.error("Copy client job failed:", error);
          await storage.updateJob(job.id, {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
            finishedAt: new Date(),
          });
        }
      })();

      res.json({
        success: true,
        jobId: job.id,
        message: "Copy started",
      });
    } catch (error) {
      console.error("Failed to start copy client:", error);
      const message =
        error instanceof Error ? error.message : "Failed to copy client";
      next(error);
    }
  });

  // Generate metadata - lives on the client URL but uses the job queue
  app.post("/api/v1/clients/:id/generate-metadata", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }

      const hasWebsite = !!client.website;
      const hasUrls =
        client.urls && Array.isArray(client.urls) && client.urls.length > 0;

      if (!hasWebsite && !hasUrls) {
        throw new ApiError({ status: 400, code: "bad_request", message: "Client must have at least one URL to generate metadata", details: {
        } });
      }

      const { enableSiteXRay = false } = req.body;

      const actorId = (req.user as User | undefined)?.id ?? null;
      const job = await jobQueue.enqueue({
        type: "generate_metadata",
        payload: {
          clientId: client.id,
          enableSiteXRay: !!enableSiteXRay,
        },
        status: "queued",
        startedByUserId: actorId,
      });

      console.log(`Queued metadata generation job for client: ${client.id}`);
      res.json({
        message: "Metadata generation started",
        clientId: client.id,
        jobId: job.id,
      });
    } catch (error) {
      next(error);
    }
  });

  // Per-client model selection (URL is /api/v1/clients/:id/models)
  app.get("/api/v1/clients/:id/models", async (req, res, next) => {
    try {
      if (!(await assertClientAccess(req, res, req.params.id))) return;
      const models = await storage.getClientModels(req.params.id);
      res.json(models);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/v1/clients/:id/models", requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    try {
      const { model_ids } = req.body;
      if (!Array.isArray(model_ids)) {
        throw new ApiError({ status: 400, code: "bad_request", message: "model_ids must be an array" });
      }
      // Task #10 — validates IDs against enabled models and writes
      // clients.selected_ai_model_ids atomically; surface invalid IDs as 422.
      try {
        await storage.updateClientModels(req.params.id, model_ids);
      } catch (err) {
        if (err instanceof Error && /Invalid or disabled AI model ids/.test(err.message)) {
          throw new ApiError({ status: 422, code: "validation_failed", message: err.message });
        }
        throw err;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Refresh prompts from topics (URL is /api/v1/clients/:id/refresh-prompts)
  app.post("/api/v1/clients/:id/refresh-prompts", refreshPromptsLimiter, requireRole({ minRole: "member", scope: "client" }), async (req, res, next) => {
    // Task #56: this work is synchronous (no JobQueue handler), but we
    // still write a `jobs` row with status running → done so other users
    // viewing the project see "Refreshing prompts" in the active-ops
    // banner. The row is never picked up by a worker — we transition
    // it manually below — but the activity service surfaces it the same
    // way as queued jobs because it filters on type+status alone.
    const clientId = req.params.id;
    const actorId = (req.user as User | undefined)?.id ?? null;
    let trackingJobId: string | null = null;
    try {
      const tracking = await storage.createJob({
        type: "refresh_prompts",
        payload: { clientId },
        status: "running",
        startedByUserId: actorId,
      });
      trackingJobId = tracking.id;
      await storage.updateJob(tracking.id, { startedAt: new Date() });

      const client = await storage.getClient(clientId);
      if (!client) {
        await storage.updateJob(tracking.id, { status: "failed", finishedAt: new Date(), error: "Client not found" });
        throw new ApiError({ status: 404, code: "not_found", message: "Client not found" });
      }

      const allTopics = await storage.getTopics(clientId);
      const acceptedTopics = allTopics.filter((t) => t.accepted);

      if (acceptedTopics.length === 0) {
        await storage.updateJob(tracking.id, { status: "failed", finishedAt: new Date(), error: "No topics" });
        throw new ApiError({ status: 400, code: "bad_request", message: "No topics available to generate prompts" });
      }

      // Task #89 — load competitors so the realism-aware generator can
      // optionally reference category leaders in semi-branded prompts
      // without us hard-coding them into the template.
      const clientCompetitors = await storage.getCompetitors(clientId);

      const generated = await generateRealisticPrompts({
        client: {
          name: client.name,
          industry: client.industry,
          customIndustry: client.customIndustry,
          geography: client.geography,
          customGeography: client.customGeography,
          brandAliases: client.brandAliases,
          focusAreas: client.focusAreas,
          targetCustomerPersona: client.targetCustomerPersona,
          targetMarketCountry: client.targetMarketCountry,
          primaryTestLocation: client.primaryTestLocation,
          primaryLanguage: client.primaryLanguage,
        },
        topics: acceptedTopics
          .filter((t) => t.category !== null)
          .map((t) => ({
            label: t.label,
            category: t.category!,
            keywords: Array.isArray(t.keywords) ? (t.keywords as string[]) : [],
          })),
        competitors: clientCompetitors.map((c) => ({ name: c.name, website: c.website })),
      });

      if (!generated || generated.length === 0) {
        if (trackingJobId) await storage.updateJob(trackingJobId, { status: "failed", finishedAt: new Date(), error: "No prompts generated" });
        throw new ApiError({
          status: 502,
          code: "upstream_error",
          message: "Failed to generate prompts from topics",
        });
      }

      const categories = await db.select().from(promptCategories);
      const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));

      // Task #98 — classify in parallel (concurrency=5) BEFORE the
      // transaction. Classification is best-effort: a single failure
      // logs and falls back to categoryId=null rather than aborting
      // the whole refresh.
      const CLASSIFY_CONCURRENCY = 5;
      const classified = await runWithConcurrency(
        generated,
        CLASSIFY_CONCURRENCY,
        async (item) => {
          let categoryId: string | null = null;
          let categorySlug: string | null = null;
          try {
            const classification = await classifyPrompt(item.text);
            categorySlug = classification.category;
            categoryId = categoryMap.get(classification.category) || null;
          } catch (error) {
            console.error(`[RefreshPrompts] Failed to classify prompt:`, error);
          }
          console.log(
            `[RefreshPrompts] tier=${item.intentTier} focus="${item.diagnosticFocus}" cat=${categorySlug ?? "unknown"} :: "${item.text.substring(0, 60)}..."`,
          );
          return { item, categoryId };
        },
      );

      // Task #98 — atomic delete + insert. If anything throws inside
      // the transaction the original AI prompts remain untouched, so a
      // mid-batch failure no longer leaves the user with an empty
      // (or partial) Prompt Library.
      const createdPrompts = await db.transaction(async (tx) => {
        await tx
          .delete(prompts)
          .where(
            and(
              eq(prompts.clientId, clientId),
              or(eq(prompts.source, "crawl"), eq(prompts.source, "ai")),
            ),
          );

        const rows = classified.map(({ item, categoryId }) => ({
          clientId,
          text: item.text,
          source: "ai" as const,
          accepted: true,
          categoryId,
          intentTier: item.intentTier,
          diagnosticFocus: item.diagnosticFocus,
        }));
        if (rows.length === 0) return [];
        return await tx.insert(prompts).values(rows).returning();
      });

      if (trackingJobId) {
        await storage.updateJob(trackingJobId, {
          status: "done",
          progress: 100,
          finishedAt: new Date(),
        });
      }
      res.json({
        message: "Prompts refreshed successfully",
        count: createdPrompts.length,
        prompts: createdPrompts,
      });
    } catch (error) {
      console.error("Failed to refresh prompts:", error);
      if (trackingJobId) {
        try {
          await storage.updateJob(trackingJobId, {
            status: "failed",
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : "Unknown error",
          });
        } catch {
          /* swallow tracking-update errors so the original failure surfaces */
        }
      }
      next(error);
    }
  });

  // Task #79 — Dismiss one entry from `clients.disabledModelNotifications`
  // after the project owner sees the "Model X was removed by an admin"
  // banner. Idempotent — re-deleting an already-dismissed entry is a no-op.
  app.post(
    "/api/v1/clients/:clientId/disabled-model-notifications/:notificationId/dismiss",
    async (req, res, next) => {
      try {
        const { clientId, notificationId } = req.params;
        if (!(await assertClientAccess(req, res, clientId))) return;
        await storage.dismissDisabledModelNotification(clientId, notificationId);
        res.json({ ok: true });
      } catch (error) {
      next(error);
    }
    },
  );
}
