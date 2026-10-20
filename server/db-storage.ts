import { db } from './db';
import { randomUUID } from 'crypto';
import { eq, and, or, desc, sql, not, inArray, gte, lte, ne, ilike, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  organizations, clients, competitors, aiModels, topics, prompts, promptCategories, promptRuns, promptRunItems,
  answers, citations, mentions, rankings, competitorScores, jobs,
  recommendations, generatedContents,
  xraySites, xrayPages, xrayPageStructure, xrayPageAnalysis,
  scoreFactors, scoreInterpretations, scoreColorBands,
  runCheckpoints, promptRunLogs,
  projectMemberships, projectOpens, users, userOrgMemberships,
  reportJobs, reportSnapshots, auditLog,
  type Organization, type InsertOrganization,
  type Client, type InsertClient, type CreateClient,
  type ProjectMembership,
  type Competitor, type InsertCompetitor,
  type AiModel, type InsertAiModel,
  type Topic, type InsertTopic,
  type Prompt, type InsertPrompt,
  type PromptCategory,
  type PromptRun, type InsertPromptRun,
  type PromptRunItem,
  type Answer,
  type Citation,
  type Mention,
  type Ranking,
  type CompetitorScore,
  type Job, type InsertJob,
  type Recommendation, type InsertRecommendation,
  type GeneratedContent, type InsertGeneratedContent,
  type XRaySite, type InsertXRaySite,
  type XRayPage, type InsertXRayPage,
  type XRayPageStructure, type InsertXRayPageStructure,
  type XRayPageAnalysis, type InsertXRayPageAnalysis,
  type ScoreFactors, type InsertScoreFactors,
  userSessions, type UserSession,
  aiVendorStatus,
} from '@shared/schema';
import type { IStorage, ActivityActiveSources } from './storage';
import { normalizeToRootDomain, extractBrandDomain } from './services/citation-extractor';

export class DbStorage implements IStorage {

  // Organizations
  async getOrganization(id: string): Promise<Organization | undefined> {
    const result = await db.select().from(organizations).where(eq(organizations.id, id));
    return result[0];
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const result = await db.insert(organizations).values(org).returning();
    return result[0];
  }

  // Clients
  async getClient(id: string): Promise<Client | undefined> {
    const result = await db.select().from(clients).where(eq(clients.id, id));
    return result[0];
  }

  async getClients(
    orgId: string,
    viewer?: { userId: string; role: 'admin' | 'member' | 'viewer' },
  ): Promise<Array<Client & { lastOpenedAt: Date | null }>> {
    // Task #144 — surface the caller's per-project "last opened" timestamp
    // alongside each row so the catalog can default-sort by it.
    const selection = {
      ...getTableColumns(clients),
      lastOpenedAt: projectOpens.lastOpenedAt,
    };
    const withOpens = (viewerUserId: string) =>
      db
        .select(selection)
        .from(clients)
        .leftJoin(
          projectOpens,
          and(
            eq(projectOpens.clientId, clients.id),
            eq(projectOpens.userId, viewerUserId),
          ),
        );

    // Unscoped callers (background jobs / scripts) have no viewer, so there
    // is no per-user timestamp to join.
    if (!viewer) {
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.orgId, orgId), eq(clients.isActive, true)));
      return rows.map((r) => ({ ...r, lastOpenedAt: null }));
    }

    // Admins see every active project in the org.
    if (viewer.role === 'admin') {
      return await withOpens(viewer.userId).where(
        and(eq(clients.orgId, orgId), eq(clients.isActive, true)),
      );
    }

    // Non-admins see projects they own + projects they've been explicitly
    // granted on `project_memberships`.
    return await withOpens(viewer.userId).where(
        and(
          eq(clients.orgId, orgId),
          eq(clients.isActive, true),
          or(
            eq(clients.ownerUserId, viewer.userId),
            sql`EXISTS (
              SELECT 1 FROM ${projectMemberships}
              WHERE ${projectMemberships.clientId} = ${clients.id}
                AND ${projectMemberships.userId} = ${viewer.userId}
            )`,
          ),
        ),
      );
  }

  async recordProjectOpen(userId: string, clientId: string): Promise<void> {
    // Task #144 — one row per (client, user); refresh the timestamp on
    // every open.
    await db
      .insert(projectOpens)
      .values({ userId, clientId, lastOpenedAt: new Date() })
      .onConflictDoUpdate({
        target: [projectOpens.clientId, projectOpens.userId],
        set: { lastOpenedAt: new Date() },
      });
  }

  async listProjectMembers(clientId: string) {
    // Project owner + org admins always have implicit access. Surface them
    // alongside explicit project_memberships so the sharing UI can show a
    // complete picture (Task #17 acceptance criteria).
    const project = await db
      .select({ ownerUserId: clients.ownerUserId, orgId: clients.orgId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    const ownerUserId = project[0]?.ownerUserId ?? null;
    const projectOrgId = project[0]?.orgId ?? null;

    const granters = alias(users, "granters");
    const explicit = await db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: userOrgMemberships.role,
        grantedAt: projectMemberships.grantedAt,
        grantedByUserId: projectMemberships.grantedByUserId,
        grantedByEmail: granters.email,
      })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .innerJoin(clients, eq(clients.id, projectMemberships.clientId))
      .leftJoin(
        userOrgMemberships,
        and(
          eq(userOrgMemberships.userId, projectMemberships.userId),
          eq(userOrgMemberships.orgId, clients.orgId),
        ),
      )
      .leftJoin(granters, eq(granters.id, projectMemberships.grantedByUserId))
      .where(eq(projectMemberships.clientId, clientId))
      .orderBy(desc(projectMemberships.grantedAt));

    const out: Array<{
      userId: string;
      email: string;
      displayName: string | null;
      role: 'admin' | 'member' | 'viewer';
      grantedAt: Date | null;
      grantedByUserId: string | null;
      grantedByEmail: string | null;
      isOwner: boolean;
    }> = [];
    const seen = new Set<string>();

    if (ownerUserId) {
      const [ownerRow] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: userOrgMemberships.role,
        })
        .from(users)
        .leftJoin(
          userOrgMemberships,
          and(
            eq(userOrgMemberships.userId, users.id),
            projectOrgId
              ? eq(userOrgMemberships.orgId, projectOrgId)
              : sql`false`,
          ),
        )
        .where(eq(users.id, ownerUserId))
        .limit(1);
      if (ownerRow) {
        out.push({
          userId: ownerRow.id,
          email: ownerRow.email,
          displayName: ownerRow.displayName,
          role: (ownerRow.role ?? 'admin') as 'admin' | 'member' | 'viewer',
          grantedAt: null,
          grantedByUserId: null,
          grantedByEmail: null,
          isOwner: true,
        });
        seen.add(ownerRow.id);
      }
    }

    // Org admins always have implicit access — surface them so the share
    // dialog reflects effective access (Task #17 acceptance).
    if (projectOrgId) {
      const adminRows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(userOrgMemberships)
        .innerJoin(users, eq(users.id, userOrgMemberships.userId))
        .where(
          and(
            eq(userOrgMemberships.orgId, projectOrgId),
            eq(userOrgMemberships.role, "admin"),
          ),
        );
      for (const a of adminRows) {
        if (seen.has(a.id)) continue;
        out.push({
          userId: a.id,
          email: a.email,
          displayName: a.displayName,
          role: 'admin',
          grantedAt: null,
          grantedByUserId: null,
          grantedByEmail: null,
          isOwner: false,
        });
        seen.add(a.id);
      }
    }

    for (const r of explicit) {
      if (seen.has(r.userId)) continue;
      out.push({
        userId: r.userId,
        email: r.email,
        displayName: r.displayName,
        role: (r.role ?? 'viewer') as 'admin' | 'member' | 'viewer',
        grantedAt: r.grantedAt,
        grantedByUserId: r.grantedByUserId,
        grantedByEmail: r.grantedByEmail,
        isOwner: false,
      });
      seen.add(r.userId);
    }
    return out;
  }

  async addProjectMember(
    clientId: string,
    userId: string,
    grantedByUserId: string | null,
  ): Promise<{ created: boolean; membership: ProjectMembership }> {
    const [row] = await db
      .insert(projectMemberships)
      .values({ clientId, userId, grantedByUserId })
      .onConflictDoNothing()
      .returning();
    if (row) return { created: true, membership: row };
    const [existing] = await db
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.clientId, clientId),
          eq(projectMemberships.userId, userId),
        ),
      )
      .limit(1);
    return { created: false, membership: existing };
  }

  async removeProjectMember(clientId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.clientId, clientId),
          eq(projectMemberships.userId, userId),
        ),
      )
      .returning({ id: projectMemberships.id });
    return result.length > 0;
  }

  async findClientByProjectName(orgId: string, projectName: string, excludeId?: string): Promise<Client | null> {
    const conditions = [
      eq(clients.orgId, orgId),
      ilike(clients.projectName, projectName)
    ];
    
    if (excludeId) {
      conditions.push(ne(clients.id, excludeId));
    }
    
    const result = await db.select().from(clients)
      .where(and(...conditions))
      .limit(1);
    
    return result[0] || null;
  }

  async createClient(client: CreateClient): Promise<Client> {
    const result = await db.insert(clients).values(client).returning();
    return result[0];
  }

  async updateClient(id: string, updates: Partial<InsertClient>): Promise<Client> {
    // Always stamp updatedAt; updatedByUserId is supplied by the caller (or
    // left null for system updates like background metadata generation).
    const result = await db.update(clients)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`Client ${id} not found`);
    }
    return result[0];
  }

  async deleteClient(id: string): Promise<void> {
    // Delete Opportunities data first (has FK to clients and prompt_runs)
    await db.delete(generatedContents).where(eq(generatedContents.clientId, id));
    await db.delete(recommendations).where(eq(recommendations.clientId, id));
    
    // Delete X-Ray data (cascade: analysis → structure → pages → sites)
    const clientSites = await db.select().from(xraySites).where(eq(xraySites.clientId, id));
    
    for (const site of clientSites) {
      // Get all pages for this site
      const sitePages = await db.select().from(xrayPages).where(eq(xrayPages.siteId, site.id));
      
      for (const page of sitePages) {
        // Delete page analysis and structure
        await db.delete(xrayPageAnalysis).where(eq(xrayPageAnalysis.pageId, page.id));
        await db.delete(xrayPageStructure).where(eq(xrayPageStructure.pageId, page.id));
      }
      
      // Delete pages
      await db.delete(xrayPages).where(eq(xrayPages.siteId, site.id));
    }
    
    // Delete sites
    await db.delete(xraySites).where(eq(xraySites.clientId, id));
    
    // Get all prompt runs for this client to cascade delete their related data
    const clientPromptRuns = await db.select().from(promptRuns).where(eq(promptRuns.clientId, id));
    
    // Delete all prompt run related data
    for (const run of clientPromptRuns) {
      // Delete competitor scores for this run
      await db.delete(competitorScores).where(eq(competitorScores.promptRunId, run.id));
      
      // Get prompt run items
      const items = await db.select().from(promptRunItems).where(eq(promptRunItems.promptRunId, run.id));
      
      // Delete all answer related data for each item
      for (const item of items) {
        const itemAnswers = await db.select().from(answers).where(eq(answers.promptRunItemId, item.id));
        
        for (const answer of itemAnswers) {
          // Delete citations, mentions, rankings
          await db.delete(citations).where(eq(citations.answerId, answer.id));
          await db.delete(mentions).where(eq(mentions.answerId, answer.id));
          await db.delete(rankings).where(eq(rankings.answerId, answer.id));
        }
        
        // Delete answers
        await db.delete(answers).where(eq(answers.promptRunItemId, item.id));
        
        // Delete score factors for this item
        await db.delete(scoreFactors).where(eq(scoreFactors.promptRunItemId, item.id));
      }
      
      // Delete prompt run items
      await db.delete(promptRunItems).where(eq(promptRunItems.promptRunId, run.id));
    }
    
    // Delete prompt runs
    await db.delete(promptRuns).where(eq(promptRuns.clientId, id));
    
    // Delete competitors, topics, prompts
    await db.delete(competitors).where(eq(competitors.clientId, id));
    await db.delete(topics).where(eq(topics.clientId, id));
    await db.delete(prompts).where(eq(prompts.clientId, id));
    
    // Finally delete the client
    await db.delete(clients).where(eq(clients.id, id));
  }

  // Competitors
  async getCompetitors(clientId: string): Promise<Competitor[]> {
    return await db.select().from(competitors).where(eq(competitors.clientId, clientId));
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const result = await db.insert(competitors).values(competitor).returning();
    return result[0];
  }

  async deleteCompetitor(id: string): Promise<void> {
    await db.delete(competitorScores).where(eq(competitorScores.competitorId, id));
    await db.delete(competitors).where(eq(competitors.id, id));
  }

  // AI Models
  async getAiModels(): Promise<AiModel[]> {
    return await db.select().from(aiModels).where(eq(aiModels.enabled, true));
  }

  async getAllAiModels(): Promise<AiModel[]> {
    return await db.select().from(aiModels);
  }

  async getClientModels(clientId: string): Promise<AiModel[]> {
    // Task #10 — clients.selected_ai_model_ids is the canonical per-project
    // model selection. Null / non-array (legacy projects that never saved a
    // selection) falls back to all enabled models; an explicit selection is
    // filtered to models that still exist and are enabled.
    const [client] = await db
      .select({ selectedAiModelIds: clients.selectedAiModelIds })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) return [];

    const selected = client.selectedAiModelIds;
    if (!Array.isArray(selected)) {
      // Task #15 — legacy projects that never saved a selection used to fall
      // back to *all* enabled models, silently multiplying run cost as the
      // catalog grows. Instead, backfill an explicit default of enabled
      // core-category models (falling back to all enabled models only if no
      // core models exist) and persist it so the project stops relying on an
      // implicit fallback.
      // Task #29 — never backfill an internal-only candidate into a normal
      // project's default selection, even while it is temporarily enabled
      // for an admin validation window.
      let defaults = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.enabled, true), eq(aiModels.internalOnly, false), eq(aiModels.category, 'core')));
      if (defaults.length === 0) {
        defaults = await db
          .select()
          .from(aiModels)
          .where(and(eq(aiModels.enabled, true), eq(aiModels.internalOnly, false)));
      }

      // Only write when the column is still NULL so we never clobber a
      // selection saved concurrently by the user.
      await db
        .update(clients)
        .set({ selectedAiModelIds: defaults.map((m) => m.id), updatedAt: new Date() })
        .where(and(eq(clients.id, clientId), sql`${clients.selectedAiModelIds} IS NULL`));

      return defaults;
    }

    const ids = selected.filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return [];

    const rows = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.enabled, true), inArray(aiModels.id, ids)));

    // Preserve the stored selection order.
    const byId = new Map(rows.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id)).filter((m): m is AiModel => !!m);
  }

  async updateClientModels(clientId: string, modelIds: string[]): Promise<void> {
    // Task #10 — validate against enabled models, then write the selection
    // atomically to clients.selected_ai_model_ids.
    const uniqueIds = Array.from(new Set(modelIds));
    let validIds: string[] = [];
    if (uniqueIds.length > 0) {
      // Task #29 — internal-only candidates cannot be written into a
      // project's selection; they are reserved for admin validation runs.
      const enabledRows = await db
        .select({ id: aiModels.id })
        .from(aiModels)
        .where(and(eq(aiModels.enabled, true), eq(aiModels.internalOnly, false), inArray(aiModels.id, uniqueIds)));
      const enabledSet = new Set(enabledRows.map((r) => r.id));
      const invalid = uniqueIds.filter((id) => !enabledSet.has(id));
      if (invalid.length > 0) {
        throw new Error(`Invalid or disabled AI model ids: ${invalid.join(', ')}`);
      }
      // Keep the caller's order.
      validIds = uniqueIds;
    }

    const result = await db
      .update(clients)
      .set({ selectedAiModelIds: validIds, updatedAt: new Date() })
      .where(eq(clients.id, clientId))
      .returning({ id: clients.id });
    if (!result[0]) {
      throw new Error(`Client ${clientId} not found`);
    }
  }

  async updateAiModelCategory(id: string, category: 'core' | 'additional'): Promise<AiModel | undefined> {
    const result = await db
      .update(aiModels)
      .set({ category })
      .where(eq(aiModels.id, id))
      .returning();
    return result[0];
  }

  async updateAiModelEnabled(
    id: string,
    enabled: boolean,
    actorUserId?: string | null,
    reason?: string | null,
  ): Promise<AiModel | undefined> {
    // Task #79 — Stamp the disable-attribution columns on the same UPDATE
    // so we don't end up with `enabled=false` rows missing `disabled_at`
    // (would break the History popover's "by whom / when" rendering).
    const result = await db
      .update(aiModels)
      .set({
        enabled,
        disabledAt: enabled ? null : new Date(),
        disabledByUserId: enabled ? null : (actorUserId ?? null),
        disabledReason: enabled ? null : (reason ?? null),
      })
      .where(eq(aiModels.id, id))
      .returning();
    return result[0];
  }

  // Task #29 — Flip the internal-only visibility gate. Kept separate from
  // enabled so an admin can stage a candidate (internalOnly=true, enabled
  // flipped per validation window) without touching disable attribution.
  async updateAiModelInternalOnly(id: string, internalOnly: boolean): Promise<AiModel | undefined> {
    const result = await db
      .update(aiModels)
      .set({ internalOnly })
      .where(eq(aiModels.id, id))
      .returning();
    return result[0];
  }

  // Task #79 — Cancel any work targeting a model that is being disabled.
  // Called from the PATCH /enabled route immediately after the model row
  // flips to enabled=false. Three layers, in order:
  //   1. prompt_run_items in a non-terminal status → status=error.
  //   2. prompt_runs where every remaining item references a now-disabled
  //      model → status=error (we don't kill mixed-vendor runs that still
  //      have viable items).
  //   3. jobs of type 'process_prompt_run' whose payload.runId matches a
  //      run we just errored → status=failed.
  // The reason string is propagated to errorSummary on every row so the
  // user-facing run history shows "Model X was disabled by an admin"
  // instead of a vague "stale".
  async cancelInFlightForDisabledModel(
    modelId: string,
    reason: string,
  ): Promise<{ items: number; runs: number; jobs: number }> {
    const { ACTIVE_PROMPT_RUN_STATUSES } = await import('./services/activity-service');

    // Capture the wrapping run ids first so we can decide which to error.
    const affectedItems = await db
      .select({ id: promptRunItems.id, promptRunId: promptRunItems.promptRunId })
      .from(promptRunItems)
      .where(
        and(
          eq(promptRunItems.modelId, modelId),
          inArray(promptRunItems.status, ACTIVE_PROMPT_RUN_STATUSES),
        ),
      );

    if (affectedItems.length === 0) {
      return { items: 0, runs: 0, jobs: 0 };
    }

    const itemIds = affectedItems.map((r) => r.id);
    const candidateRunIds = Array.from(
      new Set(affectedItems.map((r) => r.promptRunId)),
    );

    await db
      .update(promptRunItems)
      .set({
        status: 'error',
        error: reason,
        finishedAt: new Date(),
      })
      .where(inArray(promptRunItems.id, itemIds));

    // Determine which wrapping runs have ANY remaining items pointing at
    // an enabled model — regardless of item status. A run that already
    // produced completed work on a still-enabled model is NOT errored
    // when the disabled-model items are cancelled; only single-model (or
    // all-disabled-model) runs transition to error. This matches the
    // "do not fail multi-model runs that still have at least one
    // enabled model" requirement.
    const stillViable = await db
      .selectDistinct({ promptRunId: promptRunItems.promptRunId })
      .from(promptRunItems)
      .innerJoin(aiModels, eq(aiModels.id, promptRunItems.modelId))
      .where(
        and(
          inArray(promptRunItems.promptRunId, candidateRunIds),
          eq(aiModels.enabled, true),
        ),
      );
    const viableRunIds = new Set(stillViable.map((r) => r.promptRunId));
    const runsToError = candidateRunIds.filter((id) => !viableRunIds.has(id));

    let runsCount = 0;
    if (runsToError.length > 0) {
      const erroredRuns = await db
        .update(promptRuns)
        .set({
          status: 'error',
          errorSummary: reason,
        })
        .where(inArray(promptRuns.id, runsToError))
        .returning({ id: promptRuns.id });
      runsCount = erroredRuns.length;
    }

    // Fail wrapping `jobs` rows for the runs we just killed. The payload
    // shape is `{ runId, ... }` — see job-queue process_prompt_run.
    let jobsCount = 0;
    if (runsToError.length > 0) {
      const erroredJobs = await db
        .update(jobs)
        .set({
          status: 'error',
          error: reason,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.type, 'process_prompt_run'),
            inArray(jobs.status, ['queued', 'running']),
            // The wrapping job for a prompt run is enqueued with
            // `payload: { promptRunId }` (see routes/prompt-runs.ts).
            // Cast the JS string[] to a real Postgres text[]; without
            // the cast drizzle binds the parameter as JSONB and PG
            // throws "op ANY/ALL (array) requires array on right side".
            sql`${jobs.payload}->>'promptRunId' = ANY(${sql.raw(`ARRAY[${runsToError.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`)})`,
          ),
        )
        .returning({ id: jobs.id });
      jobsCount = erroredJobs.length;
    }

    return { items: itemIds.length, runs: runsCount, jobs: jobsCount };
  }

  // Task #79 — Strip the disabled model id from every project's
  // `selectedAiModelIds` array and append a one-time notification entry
  // so the project config page can banner "Model X was removed by an
  // admin" on next visit. Returns the affected client ids so the route
  // can include the count in the audit log metadata.
  async sweepDisabledModelFromClients(
    modelId: string,
    modelName: string,
    vendor: string,
    reason: string | null = null,
  ): Promise<string[]> {
    const affected = await db
      .select({
        id: clients.id,
        selectedAiModelIds: clients.selectedAiModelIds,
        disabledModelNotifications: clients.disabledModelNotifications,
      })
      .from(clients)
      .where(
        and(
          eq(clients.isActive, true),
          sql`${clients.selectedAiModelIds} @> ${JSON.stringify([modelId])}::jsonb`,
        ),
      );

    if (affected.length === 0) return [];

    const disabledAt = new Date().toISOString();
    for (const row of affected) {
      const currentIds = Array.isArray(row.selectedAiModelIds)
        ? (row.selectedAiModelIds as string[])
        : [];
      const nextIds = currentIds.filter((id) => id !== modelId);

      const currentNotifs = Array.isArray(row.disabledModelNotifications)
        ? (row.disabledModelNotifications as Array<{
            id: string;
            modelId: string;
          }>)
        : [];
      // De-dupe: don't double-banner if the admin disables and re-enables
      // and disables again before the user dismisses.
      const alreadyNotified = currentNotifs.some((n) => n.modelId === modelId);
      const nextNotifs = alreadyNotified
        ? currentNotifs
        : [
            ...currentNotifs,
            {
              id: randomUUID(),
              modelId,
              modelName,
              vendor,
              disabledAt,
              reason,
            },
          ];

      await db
        .update(clients)
        .set({
          selectedAiModelIds: nextIds,
          disabledModelNotifications: nextNotifs,
        })
        .where(eq(clients.id, row.id));
    }

    return affected.map((r) => r.id);
  }

  async dismissDisabledModelNotification(
    clientId: string,
    notificationId: string,
  ): Promise<void> {
    const row = await db
      .select({ disabledModelNotifications: clients.disabledModelNotifications })
      .from(clients)
      .where(eq(clients.id, clientId));
    const current = Array.isArray(row[0]?.disabledModelNotifications)
      ? (row[0].disabledModelNotifications as Array<{ id: string }>)
      : [];
    const next = current.filter((n) => n.id !== notificationId);
    if (next.length === current.length) return;
    await db
      .update(clients)
      .set({ disabledModelNotifications: next })
      .where(eq(clients.id, clientId));
  }

  async getAiModelAuditHistory(
    modelId: string,
    limit: number,
  ): Promise<Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    actorEmail: string | null;
    actorDisplayName: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorUserId: auditLog.actorUserId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        actorEmail: users.email,
        actorDisplayName: users.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(
        or(
          and(
            eq(auditLog.targetType, 'ai_model'),
            eq(auditLog.targetId, modelId),
          ),
          // Task #79 — Include override events that bound or unbound
          // THIS model to/from any LLM function. Both the new override
          // and the cleared override carry their modelId in metadata.
          and(
            eq(auditLog.targetType, 'llm_function'),
            or(
              sql`${auditLog.metadata}->>'modelId' = ${modelId}`,
              sql`${auditLog.metadata}->>'previousModelId' = ${modelId}`,
            ),
          ),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmail,
      actorDisplayName: r.actorDisplayName,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }));
  }

  // Task #73 — Returns the live "blast radius" of disabling a model:
  //   • how many active projects have this model in `selectedAiModelIds`
  //     (any future scheduled run for those projects would silently skip
  //     the model)
  //   • how many `prompt_run_items` are currently in a non-terminal status
  //     for this model (those would fail mid-flight)
  // Plus a small sample of project names so the confirm dialog can show
  // something more concrete than a raw count. Read-only; safe to call on
  // every toggle.
  async getAiModelUsage(
    id: string,
  ): Promise<{ projectCount: number; inFlightItemCount: number; projectNames: string[] }> {
    const { ACTIVE_PROMPT_RUN_STATUSES } = await import('./services/activity-service');

    const projectsWithModel = await db
      .select({ id: clients.id, projectName: clients.projectName })
      .from(clients)
      .where(
        and(
          eq(clients.isActive, true),
          sql`${clients.selectedAiModelIds} @> ${JSON.stringify([id])}::jsonb`,
        ),
      );

    const inFlightRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(promptRunItems)
      .where(
        and(
          eq(promptRunItems.modelId, id),
          inArray(promptRunItems.status, ACTIVE_PROMPT_RUN_STATUSES),
        ),
      );

    return {
      projectCount: projectsWithModel.length,
      inFlightItemCount: Number(inFlightRows[0]?.count ?? 0),
      projectNames: projectsWithModel.slice(0, 5).map((p) => p.projectName),
    };
  }

  // Task #77 — Per-function model override CRUD. Upserts when modelId is
  // non-null, deletes when null. Caller must `invalidateLlmFunctionCache()`
  // to make the change visible immediately on this process.
  async getLlmFunctionOverrideModelId(
    functionKey: string,
  ): Promise<string | null> {
    const { llmFunctionOverrides } = await import('@shared/schema');
    const [row] = await db
      .select({ modelId: llmFunctionOverrides.modelId })
      .from(llmFunctionOverrides)
      .where(eq(llmFunctionOverrides.functionKey, functionKey))
      .limit(1);
    return row?.modelId ?? null;
  }

  async setLlmFunctionOverride(
    functionKey: string,
    modelId: string | null,
    updatedByUserId: string | null,
  ): Promise<void> {
    const { llmFunctionOverrides } = await import('@shared/schema');
    if (modelId === null) {
      await db
        .delete(llmFunctionOverrides)
        .where(eq(llmFunctionOverrides.functionKey, functionKey));
      return;
    }
    await db
      .insert(llmFunctionOverrides)
      .values({ functionKey, modelId, updatedByUserId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: llmFunctionOverrides.functionKey,
        set: { modelId, updatedByUserId, updatedAt: new Date() },
      });
  }

  // Task #78 — Vendor-level kill switch CRUD. Reads return one row per
  // vendor row in `ai_vendor_status`; missing vendors are treated as
  // "not paused" by the resolver / cache. `setAiVendorPause` upserts so
  // the latest pause attribution (`pausedAt`/`pausedByUserId`/`pauseReason`)
  // is always recorded, even when toggling off (we keep the row so the
  // UI can show "last paused at" history if we need it later).
  async getAiVendorStatuses(): Promise<Array<{
    vendor: string;
    paused: boolean;
    pausedAt: Date | null;
    pausedByUserId: string | null;
    pauseReason: string | null;
  }>> {
    const rows = await db.select().from(aiVendorStatus);
    return rows.map((r) => ({
      vendor: r.vendor,
      paused: r.paused,
      pausedAt: r.pausedAt,
      pausedByUserId: r.pausedByUserId,
      pauseReason: r.pauseReason,
    }));
  }

  async setAiVendorPause(
    vendor: string,
    paused: boolean,
    actorUserId: string | null,
    reason: string | null,
  ): Promise<void> {
    await db
      .insert(aiVendorStatus)
      .values({
        vendor,
        paused,
        pausedAt: paused ? new Date() : null,
        pausedByUserId: paused ? actorUserId : null,
        pauseReason: paused ? reason : null,
      })
      .onConflictDoUpdate({
        target: aiVendorStatus.vendor,
        set: {
          paused,
          pausedAt: paused ? new Date() : null,
          pausedByUserId: paused ? actorUserId : null,
          pauseReason: paused ? reason : null,
        },
      });
  }

  // Best-effort "last successful call" timestamp — derived from the most
  // recent `prompt_run_items.finishedAt` joined to `ai_models` by vendor
  // where the item finished without an error. Returns null when nothing
  // successful is on file (in which case the UI shows "—").
  async getVendorLastSuccessAt(vendor: string): Promise<Date | null> {
    const rows = await db
      .select({ finishedAt: promptRunItems.finishedAt })
      .from(promptRunItems)
      .innerJoin(aiModels, eq(aiModels.id, promptRunItems.modelId))
      .where(
        and(
          eq(aiModels.vendor, vendor),
          eq(promptRunItems.status, 'done'),
          sql`${promptRunItems.finishedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(promptRunItems.finishedAt))
      .limit(1);
    return rows[0]?.finishedAt ?? null;
  }

  // Task #115 — Rolling 24h error rate for a vendor, computed from
  // `prompt_run_items.finishedAt`. An item counts as an error when
  // its `status='error'` OR `error IS NOT NULL`. Items still in
  // flight (no `finishedAt`) are excluded — they would inflate the
  // rate during a long run.
  async getVendorLast24hErrorRate(vendor: string): Promise<{
    totalCount: number;
    errorCount: number;
    errorRate: number;
  }> {
    const rows = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        errors: sql<number>`COUNT(*) FILTER (WHERE ${promptRunItems.status} = 'error' OR ${promptRunItems.error} IS NOT NULL)::int`,
      })
      .from(promptRunItems)
      .innerJoin(aiModels, eq(aiModels.id, promptRunItems.modelId))
      .where(
        and(
          eq(aiModels.vendor, vendor),
          sql`${promptRunItems.finishedAt} IS NOT NULL`,
          sql`${promptRunItems.finishedAt} >= NOW() - INTERVAL '24 hours'`,
        ),
      );
    const total = Number(rows[0]?.total ?? 0);
    const errors = Number(rows[0]?.errors ?? 0);
    return {
      totalCount: total,
      errorCount: errors,
      errorRate: total === 0 ? 0 : errors / total,
    };
  }

  // Task #115 — Recent failed/cancelled jobs for the admin operational
  // dashboard. Bounded by `limit` (default 50) since the table can grow
  // unboundedly. Includes `cancelled` so the Retry button surface in the
  // queue UI covers both terminal-but-retryable states.
  async getRecentFailedJobs(limit = 50): Promise<Job[]> {
    return await db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ['error', 'cancelled']))
      .orderBy(desc(jobs.finishedAt))
      .limit(limit);
  }

  // Task #115 — Failed-job counts grouped by `job.type` over the last
  // `hours` window. Used by the operational dashboard "Failures by kind"
  // rollup. Only counts `status='error'` (cancellations are operator-
  // initiated and not noise-worthy here).
  async getFailedJobCountsByType(hours = 24): Promise<Array<{ type: string; count: number }>> {
    const rows = await db
      .select({
        type: jobs.type,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'error'),
          sql`${jobs.finishedAt} IS NOT NULL`,
          sql`${jobs.finishedAt} >= NOW() - INTERVAL '1 hour' * ${hours}`,
        ),
      )
      .groupBy(jobs.type)
      .orderBy(desc(sql`COUNT(*)`));
    return rows.map((r) => ({ type: r.type, count: Number(r.count) }));
  }

  // Task #115 — System-wide count of prompt_runs currently in flight
  // (any ACTIVE_PROMPT_RUN_STATUSES value). Drives the "Prompt runs in
  // flight" tile on the operational dashboard.
  async countActivePromptRuns(): Promise<number> {
    const { ACTIVE_PROMPT_RUN_STATUSES } = await import('./services/activity-service');
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(promptRuns)
      .where(inArray(promptRuns.status, ACTIVE_PROMPT_RUN_STATUSES));
    return Number(rows[0]?.count ?? 0);
  }

  // Mirrors `ACTIVE_PROMPT_RUN_STATUSES` from activity-service. Counts
  // prompt_run_items still in flight across all models in this vendor —
  // used to warn admins how many items the pause will strand.
  async getVendorInFlightItemCount(vendor: string): Promise<number> {
    const { ACTIVE_PROMPT_RUN_STATUSES } = await import('./services/activity-service');
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(promptRunItems)
      .innerJoin(aiModels, eq(aiModels.id, promptRunItems.modelId))
      .where(
        and(
          eq(aiModels.vendor, vendor),
          inArray(promptRunItems.status, ACTIVE_PROMPT_RUN_STATUSES),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  // Topics
  async getTopics(clientId: string): Promise<Topic[]> {
    return await db.select().from(topics).where(eq(topics.clientId, clientId));
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const result = await db.insert(topics).values(topic).returning();
    return result[0];
  }

  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic> {
    const result = await db.update(topics)
      .set(updates)
      .where(eq(topics.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`Topic ${id} not found`);
    }
    return result[0];
  }

  async deleteTopic(id: string): Promise<void> {
    await db.delete(topics).where(eq(topics.id, id));
  }

  async deleteAIGeneratedTopics(clientId: string): Promise<number> {
    const result = await db.delete(topics)
      .where(and(
        eq(topics.clientId, clientId),
        or(eq(topics.source, 'crawl'), eq(topics.source, 'ai'))
      ))
      .returning();
    return result.length;
  }

  // Prompts
  async getPrompts(clientId: string): Promise<Prompt[]> {
    return await db.select().from(prompts).where(eq(prompts.clientId, clientId));
  }

  async getPromptsByIds(clientId: string, ids: string[]): Promise<Prompt[]> {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.clientId, clientId), inArray(prompts.id, ids)));
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const result = await db.insert(prompts).values(prompt).returning();
    return result[0];
  }

  async updatePrompt(id: string, updates: Partial<InsertPrompt>): Promise<Prompt> {
    const result = await db.update(prompts)
      .set(updates)
      .where(eq(prompts.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`Prompt ${id} not found`);
    }
    return result[0];
  }

  async deletePrompt(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
  }

  async deleteAIGeneratedPrompts(clientId: string): Promise<number> {
    const result = await db.delete(prompts)
      .where(and(
        eq(prompts.clientId, clientId),
        or(eq(prompts.source, 'crawl'), eq(prompts.source, 'ai'))
      ))
      .returning();
    return result.length;
  }

  // Prompt Categories
  async getPromptCategories(): Promise<PromptCategory[]> {
    return await db.select().from(promptCategories);
  }

  async replaceClientGeneratedMetadata(
    clientId: string,
    newTopics: InsertTopic[],
    newPrompts: InsertPrompt[]
  ): Promise<{ topicsCreated: number; promptsCreated: number }> {
    // Safety check: ensure we have data to insert before deleting
    if (newTopics.length === 0 && newPrompts.length === 0) {
      console.warn(`No new metadata to insert for client ${clientId}, skipping replacement`);
      return { topicsCreated: 0, promptsCreated: 0 };
    }

    try {
      // Delete existing AI-generated metadata (preserves manual entries)
      await db.delete(topics).where(and(
        eq(topics.clientId, clientId),
        or(eq(topics.source, 'crawl'), eq(topics.source, 'ai'))
      ));
      
      // Find prompts that are currently in use (referenced in prompt_run_items)
      const usedPrompts = await db
        .selectDistinct({ promptId: promptRunItems.promptId })
        .from(promptRunItems)
        .innerJoin(prompts, eq(prompts.id, promptRunItems.promptId))
        .where(eq(prompts.clientId, clientId));
      
      const usedPromptIds = usedPrompts.map(p => p.promptId);
      
      // Only delete AI-generated prompts that are NOT in use
      if (usedPromptIds.length > 0) {
        await db.delete(prompts).where(and(
          eq(prompts.clientId, clientId),
          or(eq(prompts.source, 'crawl'), eq(prompts.source, 'ai')),
          not(inArray(prompts.id, usedPromptIds))
        ));
      } else {
        // No used prompts, safe to delete all AI-generated prompts
        await db.delete(prompts).where(and(
          eq(prompts.clientId, clientId),
          or(eq(prompts.source, 'crawl'), eq(prompts.source, 'ai'))
        ));
      }
      
      // Insert new topics
      let topicsCreated = 0;
      if (newTopics.length > 0) {
        const topicResults = await db.insert(topics).values(newTopics).returning();
        topicsCreated = topicResults.length;
      }
      
      // Insert new prompts
      let promptsCreated = 0;
      if (newPrompts.length > 0) {
        const promptResults = await db.insert(prompts).values(newPrompts).returning();
        promptsCreated = promptResults.length;
      }
      
      return { topicsCreated, promptsCreated };
    } catch (error) {
      console.error(`Failed to replace client metadata for ${clientId}:`, error);
      throw new Error(`Metadata replacement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Prompt Runs
  async getPromptRuns(clientId: string): Promise<PromptRun[]> {
    return await db.select().from(promptRuns).where(eq(promptRuns.clientId, clientId));
  }

  // Task: run-list performance. One set-based query computes per-run model
  // counts and score averages via JOIN + GROUP BY instead of N+1 per-item
  // queries. Bounded by limit/offset so huge migrated projects can't make
  // the list endpoint scan everything on each ~3s poll.
  async getPromptRunSummaries(
    clientId: string,
    opts: { limit: number; offset: number; status?: string; search?: string },
  ): Promise<{
    runs: Array<PromptRun & {
      modelCount: number;
      avgVisibilityScore: number;
      avgSentimentScore: number;
      avgPositionScore: number;
    }>;
    total: number;
  }> {
    // Server-side status/search filters so pagination covers the *filtered*
    // history, not just whatever page happens to be loaded client-side.
    const conditions = [eq(promptRuns.clientId, clientId)];
    if (opts.status) {
      conditions.push(eq(promptRuns.status, opts.status as PromptRun['status']));
    }
    if (opts.search?.trim()) {
      conditions.push(ilike(promptRuns.name, `%${opts.search.trim()}%`));
    }
    const where = and(...conditions);

    // Page the runs first (cheap), then aggregate only over the page's runs.
    const [pageRuns, [{ total }]] = await Promise.all([
      db
        .select()
        .from(promptRuns)
        .where(where)
        .orderBy(desc(promptRuns.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(promptRuns)
        .where(where),
    ]);

    if (pageRuns.length === 0) return { runs: [], total };

    const runIds = pageRuns.map((r) => r.id);
    const aggregates = await db
      .select({
        promptRunId: promptRunItems.promptRunId,
        modelCount: sql<number>`COUNT(DISTINCT ${promptRunItems.modelId})::int`,
        avgVisibilityScore: sql<string | null>`AVG(${answers.visibilityScore})`,
        avgSentimentScore: sql<string | null>`AVG(${answers.sentimentScore})`,
        avgPositionScore: sql<string | null>`AVG(${answers.positionScore})`,
      })
      .from(promptRunItems)
      .leftJoin(answers, eq(answers.promptRunItemId, promptRunItems.id))
      .where(inArray(promptRunItems.promptRunId, runIds))
      .groupBy(promptRunItems.promptRunId);

    const aggByRun = new Map(aggregates.map((a) => [a.promptRunId, a]));
    const runs = pageRuns.map((run) => {
      const agg = aggByRun.get(run.id);
      return {
        ...run,
        modelCount: agg?.modelCount ?? 0,
        avgVisibilityScore: agg?.avgVisibilityScore != null ? Number(agg.avgVisibilityScore) : 0,
        avgSentimentScore: agg?.avgSentimentScore != null ? Number(agg.avgSentimentScore) : 0,
        avgPositionScore: agg?.avgPositionScore != null ? Number(agg.avgPositionScore) : 0,
      };
    });
    return { runs, total };
  }

  async getPromptRun(id: string): Promise<PromptRun | undefined> {
    const result = await db.select().from(promptRuns).where(eq(promptRuns.id, id));
    return result[0];
  }

  async getPromptRunsMetadata(clientId: string): Promise<Array<{
    id: string;
    name: string;
    createdAt: Date;
    status: string;
    totalPrompts: number | null;
    modelCount: number;
  }>> {
    const results = await db
      .select({
        id: promptRuns.id,
        name: promptRuns.name,
        createdAt: promptRuns.createdAt,
        status: promptRuns.status,
        totalPrompts: promptRuns.totalPrompts,
        modelCount: sql<number>`COUNT(DISTINCT ${promptRunItems.modelId})`.as('model_count'),
      })
      .from(promptRuns)
      .leftJoin(promptRunItems, eq(promptRunItems.promptRunId, promptRuns.id))
      .where(and(
        eq(promptRuns.clientId, clientId),
        eq(promptRuns.status, 'done')
      ))
      .groupBy(promptRuns.id, promptRuns.name, promptRuns.createdAt, promptRuns.status, promptRuns.totalPrompts)
      .orderBy(desc(promptRuns.createdAt));

    return results.map(r => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      status: r.status,
      totalPrompts: r.totalPrompts,
      modelCount: r.modelCount
    }));
  }

  async createPromptRun(run: InsertPromptRun): Promise<PromptRun> {
    const result = await db.insert(promptRuns).values(run).returning();
    return result[0];
  }

  async updatePromptRun(id: string, updates: Partial<PromptRun>): Promise<PromptRun> {
    const result = await db.update(promptRuns)
      .set(updates)
      .where(eq(promptRuns.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`PromptRun ${id} not found`);
    }
    return result[0];
  }

  async claimPromptRunDeliverables(id: string): Promise<boolean> {
    const claimed = await db.update(promptRuns)
      .set({
        deliverablesStatus: "generating",
        deliverablesErrorSummary: null,
        deliverablesCompletedAt: null,
      })
      .where(and(
        eq(promptRuns.id, id),
        ne(promptRuns.deliverablesStatus, "generating"),
      ))
      .returning({ id: promptRuns.id });
    return claimed.length === 1;
  }

  async deletePromptRun(id: string): Promise<void> {
    // Task #139 — Wrap the whole cascade in a single transaction so a
    // mid-delete failure rolls back instead of leaving the run half-deleted.
    // Also delete the children that the old cascade omitted: score_factors
    // (NOT NULL FK → prompt_run_items, so deleting a scored run used to fail
    // with an FK violation), run_checkpoints, and prompt_run_logs.
    await db.transaction(async (tx) => {
      // Opportunities data (FK → prompt_runs)
      await tx.delete(generatedContents).where(eq(generatedContents.promptRunId, id));
      await tx.delete(recommendations).where(eq(recommendations.promptRunId, id));

      // Competitor scores (FK → prompt_runs)
      await tx.delete(competitorScores).where(eq(competitorScores.promptRunId, id));

      // Get all prompt_run_items for this run
      const items = await tx.select()
        .from(promptRunItems)
        .where(eq(promptRunItems.promptRunId, id));

      // For each item, delete all related data
      for (const item of items) {
        // Get all answers for this item
        const itemAnswers = await tx.select()
          .from(answers)
          .where(eq(answers.promptRunItemId, item.id));

        // Delete data for each answer
        for (const answer of itemAnswers) {
          await tx.delete(citations).where(eq(citations.answerId, answer.id));
          await tx.delete(mentions).where(eq(mentions.answerId, answer.id));
          await tx.delete(rankings).where(eq(rankings.answerId, answer.id));
          await tx.delete(answers).where(eq(answers.id, answer.id));
        }

        // score_factors has a NOT NULL FK to prompt_run_items; must go
        // before the item is deleted.
        await tx.delete(scoreFactors).where(eq(scoreFactors.promptRunItemId, item.id));
      }

      // Delete all prompt_run_items
      await tx.delete(promptRunItems).where(eq(promptRunItems.promptRunId, id));

      // Checkpoint + logs (FK → prompt_runs)
      await tx.delete(runCheckpoints).where(eq(runCheckpoints.promptRunId, id));
      await tx.delete(promptRunLogs).where(eq(promptRunLogs.promptRunId, id));

      // Finally, delete the prompt_run
      await tx.delete(promptRuns).where(eq(promptRuns.id, id));
    });
  }

  // AI Models (singular)
  async getAiModel(id: string): Promise<AiModel | undefined> {
    const result = await db.select().from(aiModels).where(eq(aiModels.id, id));
    return result[0];
  }

  // Prompts (singular)
  async getPrompt(id: string): Promise<Prompt | undefined> {
    const result = await db.select().from(prompts).where(eq(prompts.id, id));
    return result[0];
  }

  // Prompt Run Items
  async getPromptRunItems(promptRunId: string): Promise<PromptRunItem[]> {
    return await db.select().from(promptRunItems).where(eq(promptRunItems.promptRunId, promptRunId));
  }

  async createPromptRunItem(item: Omit<PromptRunItem, 'id'>): Promise<PromptRunItem> {
    const result = await db.insert(promptRunItems).values(item).returning();
    return result[0];
  }

  async updatePromptRunItem(id: string, updates: Partial<PromptRunItem>): Promise<PromptRunItem> {
    const result = await db.update(promptRunItems)
      .set(updates)
      .where(eq(promptRunItems.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`PromptRunItem ${id} not found`);
    }
    return result[0];
  }

  // Answers
  async createAnswer(answer: Omit<Answer, 'id'>): Promise<Answer> {
    const result = await db.insert(answers).values(answer).returning();
    return result[0];
  }

  async updateAnswer(id: string, updates: Partial<Answer>): Promise<Answer> {
    const result = await db.update(answers)
      .set(updates)
      .where(eq(answers.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`Answer ${id} not found`);
    }
    return result[0];
  }

  async getAnswerByPromptRunItem(promptRunItemId: string): Promise<Answer | undefined> {
    const result = await db.select().from(answers).where(eq(answers.promptRunItemId, promptRunItemId));
    return result[0];
  }

  // Citations
  async createCitation(citation: Omit<Citation, 'id'>): Promise<Citation> {
    const result = await db.insert(citations).values(citation).returning();
    return result[0];
  }

  async getCitationsByAnswer(answerId: string): Promise<Citation[]> {
    return await db.select().from(citations).where(eq(citations.answerId, answerId));
  }

  // Mentions
  async createMention(mention: Omit<Mention, 'id'>): Promise<Mention> {
    const result = await db.insert(mentions).values(mention).returning();
    return result[0];
  }

  async getMentionsByAnswer(answerId: string): Promise<Mention[]> {
    return await db.select().from(mentions).where(eq(mentions.answerId, answerId));
  }

  // Rankings
  async createRanking(ranking: Omit<Ranking, 'id'>): Promise<Ranking> {
    const result = await db.insert(rankings).values(ranking).returning();
    return result[0];
  }

  async getRankingsByAnswer(answerId: string): Promise<Ranking[]> {
    return await db.select().from(rankings).where(eq(rankings.answerId, answerId));
  }

  // Competitor Scores
  async createCompetitorScore(score: Omit<CompetitorScore, 'id' | 'createdAt'>): Promise<CompetitorScore> {
    const result = await db.insert(competitorScores).values(score).returning();
    return result[0];
  }

  async getCompetitorScoresByRun(promptRunId: string): Promise<CompetitorScore[]> {
    return await db.select().from(competitorScores)
      .where(eq(competitorScores.promptRunId, promptRunId))
      .orderBy(desc(competitorScores.overallScore));
  }

  async getLatestCompetitorScores(clientId: string): Promise<CompetitorScore[]> {
    // Get the latest completed prompt run for this client
    const latestRun = await db.select()
      .from(promptRuns)
      .where(and(
        eq(promptRuns.clientId, clientId),
        eq(promptRuns.status, 'done')
      ))
      .orderBy(desc(promptRuns.createdAt))
      .limit(1);

    if (!latestRun[0]) {
      return [];
    }

    // Get competitor scores for the latest run
    return await this.getCompetitorScoresByRun(latestRun[0].id);
  }

  async getAggregatedCompetitorScores(clientId: string, runIds?: string[]): Promise<Array<{
    id: string;
    name: string;
    competitorId: string | null;
    isClient: boolean;
    visibilityScore: number;
    sentimentScore: number;
    positionScore: number;
    overallScore: number;
  }>> {
    // Determine which run(s) to query
    let targetRunIds: string[] = [];
    
    if (runIds && runIds.length > 0) {
      // Use provided runIds (filter to only completed runs for safety)
      const whereConditions = [
        eq(promptRuns.clientId, clientId),
        eq(promptRuns.status, 'done')
      ];
      whereConditions.push(inArray(promptRuns.id, runIds));
      
      const validRuns = await db.select()
        .from(promptRuns)
        .where(and(...whereConditions));
      targetRunIds = validRuns.map(run => run.id);
    } else {
      // Default to latest run (backward compatible)
      const latestRun = await db.select()
        .from(promptRuns)
        .where(and(
          eq(promptRuns.clientId, clientId),
          eq(promptRuns.status, 'done')
        ))
        .orderBy(desc(promptRuns.createdAt))
        .limit(1);
      
      if (latestRun[0]) {
        targetRunIds = [latestRun[0].id];
      }
    }

    if (targetRunIds.length === 0) {
      return [];
    }

    // Get all prompt-level scores for the target run(s)
    const allScores = await db.select().from(competitorScores)
      .where(inArray(competitorScores.promptRunId, targetRunIds));

    if (allScores.length === 0) {
      return [];
    }

    // Group by competitor (competitorName + competitorId + isClient)
    const competitorGroups = new Map<string, typeof allScores>();
    
    for (const score of allScores) {
      const key = `${score.competitorName}|${score.competitorId}|${score.isClient}`;
      if (!competitorGroups.has(key)) {
        competitorGroups.set(key, []);
      }
      competitorGroups.get(key)!.push(score);
    }

    // Aggregate scores for each competitor
    const aggregatedScores = Array.from(competitorGroups.entries()).map(([key, scores]) => {
      const firstScore = scores[0];
      
      // Calculate averages across all prompts for this competitor
      let visSum = 0, visCount = 0;
      let sentSum = 0, sentCount = 0;
      let posSum = 0, posCount = 0;
      let overallSum = 0, overallCount = 0;

      for (const score of scores) {
        if (score.visibilityScore != null) {
          visSum += Number(score.visibilityScore);
          visCount++;
        }
        if (score.sentimentScore != null) {
          sentSum += Number(score.sentimentScore);
          sentCount++;
        }
        if (score.positionScore != null) {
          posSum += Number(score.positionScore);
          posCount++;
        }
        if (score.overallScore != null) {
          overallSum += Number(score.overallScore);
          overallCount++;
        }
      }

      const avgVis = visCount > 0 ? Math.round((visSum / visCount) * 10) / 10 : 0;
      const avgSent = sentCount > 0 ? Math.round((sentSum / sentCount) * 10) / 10 : 0;
      const avgPos = posCount > 0 ? Math.round((posSum / posCount) * 10) / 10 : 0;
      const avgOverall = overallCount > 0 ? Math.round((overallSum / overallCount) * 10) / 10 : 0;

      return {
        id: firstScore.id,
        name: firstScore.competitorName,
        competitorId: firstScore.competitorId,
        isClient: firstScore.isClient,
        visibilityScore: avgVis,
        sentimentScore: avgSent,
        positionScore: avgPos,
        overallScore: avgOverall
      };
    });

    // Sort by overall score descending
    return aggregatedScores.sort((a, b) => b.overallScore - a.overallScore);
  }

  async deleteCompetitorScore(id: string): Promise<void> {
    await db.delete(competitorScores).where(eq(competitorScores.id, id));
  }

  async getPromptBenchmarks(promptRunId: string, promptId: string, clientId: string): Promise<{
    summary: {
      visibility: { min: number; max: number; avg: number };
      sentiment: { min: number; max: number; avg: number };
      position: { min: number; max: number; avg: number };
    };
    entities: Array<{
      name: string;
      entityId: string | null;
      isClient: boolean;
      visibilityScore: number | null;
      sentimentScore: number | null;
      positionScore: number | null;
    }>;
  }> {
    // Get all competitor scores for this specific prompt
    const scores = await db.select().from(competitorScores)
      .where(and(
        eq(competitorScores.promptRunId, promptRunId),
        eq(competitorScores.promptId, promptId)
      ));

    // Filter to include only client + configured competitors for this client
    const clientCompetitors = await this.getCompetitors(clientId);
    const competitorIds = new Set(clientCompetitors.map(c => c.id));
    
    const relevantScores = scores.filter(s => 
      s.isClient || (s.competitorId && competitorIds.has(s.competitorId))
    );

    if (relevantScores.length === 0) {
      return {
        summary: {
          visibility: { min: 0, max: 0, avg: 0 },
          sentiment: { min: 0, max: 0, avg: 0 },
          position: { min: 0, max: 0, avg: 0 }
        },
        entities: []
      };
    }

    // Calculate summary stats - properly handle null values
    const visScores = relevantScores.flatMap(s => s.visibilityScore == null ? [] : [Number(s.visibilityScore)]);
    const sentScores = relevantScores.flatMap(s => s.sentimentScore == null ? [] : [Number(s.sentimentScore)]);
    const posScores = relevantScores.flatMap(s => s.positionScore == null ? [] : [Number(s.positionScore)]);

    const calcStats = (arr: number[]) => {
      if (arr.length === 0) return { min: 0, max: 0, avg: 0 };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const avg = arr.reduce((sum, val) => sum + val, 0) / arr.length;
      return { min, max, avg: Math.round(avg * 100) / 100 };
    };

    return {
      summary: {
        visibility: calcStats(visScores),
        sentiment: calcStats(sentScores),
        position: calcStats(posScores)
      },
      entities: relevantScores.map(s => ({
        name: s.competitorName,
        entityId: s.competitorId,
        isClient: s.isClient,
        visibilityScore: s.visibilityScore == null ? null : Number(s.visibilityScore),
        sentimentScore: s.sentimentScore == null ? null : Number(s.sentimentScore),
        positionScore: s.positionScore == null ? null : Number(s.positionScore)
      })).sort((a, b) => {
        const aVis = a.visibilityScore ?? 0;
        const bVis = b.visibilityScore ?? 0;
        return bVis - aVis;
      })
    };
  }

  async getBulkPromptBenchmarks(promptRunId: string, clientId: string): Promise<{
    [promptId: string]: {
      summary: {
        visibility: { min: number; max: number; avg: number };
        sentiment: { min: number; max: number; avg: number };
        position: { min: number; max: number; avg: number };
      };
      entities: Array<{
        name: string;
        entityId: string | null;
        isClient: boolean;
        visibilityScore: number | null;
        sentimentScore: number | null;
        positionScore: number | null;
      }>;
    };
  }> {
    // Get all competitor scores for all prompts in this run in a single query
    const allScores = await db.select().from(competitorScores)
      .where(eq(competitorScores.promptRunId, promptRunId));

    if (allScores.length === 0) {
      return {};
    }

    // Get client's configured competitors
    const clientCompetitors = await this.getCompetitors(clientId);
    const competitorIds = new Set(clientCompetitors.map(c => c.id));

    // Group scores by promptId
    const scoresByPrompt = new Map<string, typeof allScores>();
    for (const score of allScores) {
      if (!score.promptId) continue;
      
      // Filter to include only client + configured competitors
      if (!score.isClient && (!score.competitorId || !competitorIds.has(score.competitorId))) {
        continue;
      }

      if (!scoresByPrompt.has(score.promptId)) {
        scoresByPrompt.set(score.promptId, []);
      }
      scoresByPrompt.get(score.promptId)!.push(score);
    }

    const calcStats = (arr: number[]) => {
      if (arr.length === 0) return { min: 0, max: 0, avg: 0 };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const avg = arr.reduce((sum, val) => sum + val, 0) / arr.length;
      return { min, max, avg: Math.round(avg * 100) / 100 };
    };

    // Build result object keyed by promptId
    const result: {
      [promptId: string]: {
        summary: {
          visibility: { min: number; max: number; avg: number };
          sentiment: { min: number; max: number; avg: number };
          position: { min: number; max: number; avg: number };
        };
        entities: Array<{
          name: string;
          entityId: string | null;
          isClient: boolean;
          visibilityScore: number | null;
          sentimentScore: number | null;
          positionScore: number | null;
        }>;
      };
    } = {};

    for (const [promptId, scores] of scoresByPrompt) {
      const visScores = scores.flatMap(s => s.visibilityScore == null ? [] : [Number(s.visibilityScore)]);
      const sentScores = scores.flatMap(s => s.sentimentScore == null ? [] : [Number(s.sentimentScore)]);
      const posScores = scores.flatMap(s => s.positionScore == null ? [] : [Number(s.positionScore)]);

      result[promptId] = {
        summary: {
          visibility: calcStats(visScores),
          sentiment: calcStats(sentScores),
          position: calcStats(posScores)
        },
        entities: scores.map(s => ({
          name: s.competitorName,
          entityId: s.competitorId,
          isClient: s.isClient,
          visibilityScore: s.visibilityScore == null ? null : Number(s.visibilityScore),
          sentimentScore: s.sentimentScore == null ? null : Number(s.sentimentScore),
          positionScore: s.positionScore == null ? null : Number(s.positionScore)
        })).sort((a, b) => {
          const aVis = a.visibilityScore ?? 0;
          const bVis = b.visibilityScore ?? 0;
          return bVis - aVis;
        })
      };
    }

    return result;
  }

  // Jobs
  async getJobs(): Promise<Job[]> {
    return await db.select().from(jobs);
  }

  async getJob(id: string): Promise<Job | undefined> {
    const result = await db.select().from(jobs).where(eq(jobs.id, id));
    return result[0];
  }

  async createJob(job: InsertJob): Promise<Job> {
    const result = await db.insert(jobs).values(job).returning();
    return result[0];
  }

  async updateJob(id: string, updates: Partial<Job>): Promise<Job> {
    const result = await db.update(jobs)
      .set(updates)
      .where(eq(jobs.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`Job ${id} not found`);
    }
    return result[0];
  }

  // Task #115 — Atomic cancel: only succeeds if the row is still
  // `queued`. Closes the read-then-write race where a worker could
  // claim the job between the admin route's `getJob` and `updateJob`
  // calls and end up force-marked `cancelled` mid-run.
  async cancelQueuedJob(id: string, reason = "Cancelled by admin"): Promise<Job | null> {
    const now = new Date();
    const result = await db.update(jobs)
      .set({
        status: 'cancelled',
        finishedAt: now,
        error: reason,
      })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
      .returning();
    return result[0] ?? null;
  }

  // Task #115 — Recent queued jobs for the admin Cancel surface. The
  // failed-jobs feed only contains terminal rows, so without this the
  // Cancel button in the admin queue UI is effectively unreachable.
  async getQueuedJobs(limit = 50): Promise<Job[]> {
    return await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'queued'))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
  }

  // Task #121 — Currently-running jobs for the admin Halt surface.
  async getRunningJobs(limit = 50): Promise<Job[]> {
    return await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'running'))
      .orderBy(desc(jobs.startedAt))
      .limit(limit);
  }

  async claimJob(id: string, workerId: string): Promise<Job | null> {
    const now = new Date();
    const result = await db.update(jobs)
      .set({
        status: 'running',
        workerId,
        startedAt: now,
        lastHeartbeat: now,
      })
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.status, 'queued'),
          sql`${jobs.workerId} IS NULL`
        )
      )
      .returning();
    
    return result[0] || null;
  }

  // Aggregation
  async getClientAggregatedScores(clientId: string): Promise<{
    avgVisibilityScore: number;
    avgSentimentScore: number;
    avgPositionScore: number;
    totalCitations: number;
    totalAnswers: number;
  }> {
    // Get all answers for completed prompt runs for this client
    const result = await db
      .select({
        visibilityScore: answers.visibilityScore,
        sentimentScore: answers.sentimentScore,
        positionScore: answers.positionScore,
        citationCount: answers.citationCount
      })
      .from(answers)
      .innerJoin(promptRunItems, eq(answers.promptRunItemId, promptRunItems.id))
      .innerJoin(promptRuns, eq(promptRunItems.promptRunId, promptRuns.id))
      .where(
        and(
          eq(promptRuns.clientId, clientId),
          eq(promptRuns.status, 'done')
        )
      );

    if (result.length === 0) {
      return {
        avgVisibilityScore: 0,
        avgSentimentScore: 0,
        avgPositionScore: 0,
        totalCitations: 0,
        totalAnswers: 0
      };
    }

    // Calculate aggregates
    let visibilitySum = 0;
    let visibilityCount = 0;
    let sentimentSum = 0;
    let sentimentCount = 0;
    let positionSum = 0;
    let positionCount = 0;
    let citationSum = 0;

    for (const row of result) {
      if (row.visibilityScore !== null && row.visibilityScore !== undefined) {
        visibilitySum += Number(row.visibilityScore);
        visibilityCount++;
      }
      if (row.sentimentScore !== null && row.sentimentScore !== undefined) {
        sentimentSum += Number(row.sentimentScore);
        sentimentCount++;
      }
      if (row.positionScore !== null && row.positionScore !== undefined) {
        positionSum += Number(row.positionScore);
        positionCount++;
      }
      if (row.citationCount !== null && row.citationCount !== undefined) {
        citationSum += Number(row.citationCount);
      }
    }

    return {
      avgVisibilityScore: visibilityCount > 0 ? Math.round((visibilitySum / visibilityCount) * 10) / 10 : 0,
      avgSentimentScore: sentimentCount > 0 ? Math.round((sentimentSum / sentimentCount) * 10) / 10 : 0,
      avgPositionScore: positionCount > 0 ? Math.round((positionSum / positionCount) * 10) / 10 : 0,
      totalCitations: citationSum,
      totalAnswers: result.length
    };
  }

  async getHistoricalScores(clientId: string, options?: { limit?: number; runIds?: string[] }): Promise<Array<{
    runId: string;
    runName: string;
    createdAt: Date;
    avgVisibilityScore: number;
    avgSentimentScore: number;
    avgPositionScore: number;
    totalCitations: number;
  }>> {
    // Extract options with defaults
    const limit = options?.limit ?? 5;
    const runIds = options?.runIds;
    // Allow higher limits (up to 1000) to support single-run selections with old runs
    const clampedLimit = Math.min(limit, 1000);
    
    // Build base WHERE clause (always filter by client and status)
    let whereClause = sql`pr.client_id = ${clientId} AND pr.status = 'done'`;
    
    // Add runIds filter if provided (using IN instead of ANY for proper array handling)
    if (runIds && runIds.length > 0) {
      const runIdPlaceholders = runIds.map(id => sql`${id}`);
      whereClause = sql`${whereClause} AND pr.id IN (${sql.join(runIdPlaceholders, sql`, `)})`;
    }
    
    const limitClause = runIds && runIds.length > 0 ? sql.empty() : sql`LIMIT ${clampedLimit}`;
    
    const results = await db.execute<{
      run_id: string;
      run_name: string;
      created_at: Date;
      total_prompts: number;
      avg_visibility_score: string;
      avg_sentiment_score: string;
      avg_position_score: string;
      total_citations: string;
    }>(sql`
      WITH run_scores AS (
        SELECT 
          pr.id as run_id,
          pr.name as run_name,
          pr.created_at,
          pr.total_prompts,
          COALESCE(AVG(a.visibility_score), 0) as avg_visibility_score,
          COALESCE(AVG(a.sentiment_score), 0) as avg_sentiment_score,
          COALESCE(AVG(a.position_score), 0) as avg_position_score
        FROM prompt_runs pr
        LEFT JOIN prompt_run_items pri ON pri.prompt_run_id = pr.id
        LEFT JOIN answers a ON a.prompt_run_item_id = pri.id
        WHERE ${whereClause}
        GROUP BY pr.id, pr.name, pr.created_at, pr.total_prompts
      ),
      run_citations AS (
        SELECT 
          pr.id as run_id,
          COUNT(DISTINCT c.id) as citation_count
        FROM prompt_runs pr
        LEFT JOIN prompt_run_items pri ON pri.prompt_run_id = pr.id
        LEFT JOIN answers a ON a.prompt_run_item_id = pri.id
        LEFT JOIN citations c ON c.answer_id = a.id
        WHERE ${whereClause}
        GROUP BY pr.id
      )
      SELECT 
        rs.run_id,
        rs.run_name,
        rs.created_at,
        rs.total_prompts,
        rs.avg_visibility_score,
        rs.avg_sentiment_score,
        rs.avg_position_score,
        COALESCE(rc.citation_count, 0) as total_citations
      FROM run_scores rs
      LEFT JOIN run_citations rc ON rs.run_id = rc.run_id
      ORDER BY rs.created_at DESC
      ${limitClause}
    `);

    return results.rows.map(row => ({
      runId: row.run_id,
      runName: row.run_name,
      createdAt: row.created_at,
      avgVisibilityScore: Math.round((parseFloat(row.avg_visibility_score) || 0) * 10) / 10,
      avgSentimentScore: Math.round((parseFloat(row.avg_sentiment_score) || 0) * 10) / 10,
      avgPositionScore: Math.round((parseFloat(row.avg_position_score) || 0) * 10) / 10,
      totalCitations: parseInt(row.total_citations) || 0
    }));
  }

  // Opportunities - Citation Analysis
  // 
  // METRIC CALCULATIONS:
  // 1. Citations Count: Total number of times this domain appeared across all AI responses
  // 
  // NORMALIZATION:
  // - Domains: www.example.com and example.com grouped together (www stripped)
  // - URLs: https://example.com/ and https://example.com grouped together (trailing slash removed)
  async getCitationAnalysis(clientId: string, promptRunId?: string | null): Promise<any[]> {
    // Get all citations with URLs for this client, optionally filtered by run
    // Note: "historical" doesn't apply to citations since they're always linked to runs via answers
    // If "historical" is passed, treat it as "all runs" (no filter)
    const isSpecificRun = Boolean(promptRunId && promptRunId !== 'historical');
    const runFilter = isSpecificRun
      ? sql` AND pr.id = ${promptRunId}` 
      : sql``;
    const terminalRunFilter = isSpecificRun
      ? sql``
      : sql` AND pr.status IN ('done', 'completed_with_errors')`;
    
    const results = await db.execute<{
      url: string;
      answer_id: string;
      total_responses: string;
    }>(sql`
      WITH total_responses AS (
        SELECT COUNT(DISTINCT a.id) as total_count
        FROM answers a
        INNER JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
        INNER JOIN prompt_runs pr ON pri.prompt_run_id = pr.id
        WHERE pr.client_id = ${clientId}${terminalRunFilter}${runFilter}
      )
      SELECT 
        c.url,
        a.id as answer_id,
        tr.total_count as total_responses
      FROM citations c
      INNER JOIN answers a ON c.answer_id = a.id
      INNER JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
      INNER JOIN prompt_runs pr ON pri.prompt_run_id = pr.id
      CROSS JOIN total_responses tr
      WHERE pr.client_id = ${clientId}${terminalRunFilter} AND c.url IS NOT NULL${runFilter}
    `);

    const totalResponses = results.rows.length > 0 ? parseInt(results.rows[0].total_responses) : 0;

    // Extract and normalize domains from URLs, group by brand
    const brandData = new Map<string, {
      fullDomains: Set<string>;
      urls: Map<string, number>;
      answerIds: Set<string>;
    }>();

    for (const row of results.rows) {
      try {
        const url = new URL(row.url);
        const hostname = url.hostname;
        const fullDomain = normalizeToRootDomain(hostname);
        const brandDomain = extractBrandDomain(fullDomain);
        const normalizedUrl = row.url.toLowerCase().replace(/\/$/, '');

        if (!brandData.has(brandDomain)) {
          brandData.set(brandDomain, {
            fullDomains: new Set(),
            urls: new Map(),
            answerIds: new Set()
          });
        }

        const data = brandData.get(brandDomain)!;
        data.fullDomains.add(fullDomain);
        data.urls.set(normalizedUrl, (data.urls.get(normalizedUrl) || 0) + 1);
        data.answerIds.add(row.answer_id);
      } catch (error) {
        // Skip invalid URLs
        continue;
      }
    }

    // Convert to array and calculate metrics
    const analysis = Array.from(brandData.entries()).map(([brandDomain, data]) => {
      const urlEntries = Array.from(data.urls.entries());
      const totalFrequency = urlEntries.reduce((sum, [, freq]) => sum + freq, 0);
      const fullDomains = Array.from(data.fullDomains);
      
      // Display domain: use brand domain or the single full domain
      const displayDomain = fullDomains.length > 1 ? brandDomain : fullDomains[0];
      
      // Find representative URL - prefer one that closely matches a domain
      let representativeUrl = urlEntries[0]?.[0] || '';
      for (const domain of fullDomains) {
        const domainMatch = urlEntries.find(([url]) => 
          url.match(new RegExp(`https?://([^/]+\\.)?${domain.replace(/\./g, '\\.')}/?$`))
        );
        if (domainMatch) {
          representativeUrl = domainMatch[0];
          break;
        }
      }

      return {
        domain: displayDomain,
        fullDomains: fullDomains,
        representativeUrl,
        urlCount: data.urls.size,
        frequency: totalFrequency,
        usagePercentage: totalResponses > 0 ? parseFloat(((data.answerIds.size / totalResponses) * 100).toFixed(2)) : 0
      };
    });

    // Sort by frequency desc, then usage percentage desc
    analysis.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      if (b.usagePercentage !== a.usagePercentage) return b.usagePercentage - a.usagePercentage;
      return a.domain.localeCompare(b.domain);
    });

    // Return top 20 with ranks
    return analysis.slice(0, 20).map((item, index) => ({
      ...item,
      rank: index + 1
    }));
  }

  // Opportunities - Citation Analysis by Domain (for drill-down)
  // Note: domain parameter should be the normalized root domain (e.g., "example.com", NOT "www.example.com")
  // 
  // METRIC CALCULATIONS (per URL):
  // 1. Frequency: Total number of times this specific URL appeared
  // 
  // NORMALIZATION:
  // - URLs: https://example.com/ and https://example.com grouped together (trailing slash removed)
  async getCitationsByDomain(clientId: string, domain: string, promptRunId?: string | null): Promise<any[]> {
    // Get all citations with URLs for this client, optionally filtered by run
    // Note: "historical" doesn't apply to citations since they're always linked to runs via answers
    const isSpecificRun = Boolean(promptRunId && promptRunId !== 'historical');
    const runFilter = isSpecificRun
      ? sql` AND pr.id = ${promptRunId}` 
      : sql``;
    const terminalRunFilter = isSpecificRun
      ? sql``
      : sql` AND pr.status IN ('done', 'completed_with_errors')`;
    
    const results = await db.execute<{
      url: string;
    }>(sql`
      SELECT c.url
      FROM citations c
      INNER JOIN answers a ON c.answer_id = a.id
      INNER JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
      INNER JOIN prompt_runs pr ON pri.prompt_run_id = pr.id
      WHERE pr.client_id = ${clientId}${terminalRunFilter} AND c.url IS NOT NULL${runFilter}
    `);

    // Filter and group by URL for the specified domain (or brand)
    const urlFrequencies = new Map<string, number>();

    for (const row of results.rows) {
      try {
        const url = new URL(row.url);
        const hostname = url.hostname;
        const fullDomain = normalizeToRootDomain(hostname);
        const brandDomain = extractBrandDomain(fullDomain);

        // Include URLs where either the full domain or brand domain matches
        if (fullDomain === domain || brandDomain === domain) {
          const normalizedUrl = row.url.toLowerCase().replace(/\/$/, '');
          urlFrequencies.set(normalizedUrl, (urlFrequencies.get(normalizedUrl) || 0) + 1);
        }
      } catch (error) {
        // Skip invalid URLs
        continue;
      }
    }

    // Convert to array and sort by frequency
    const urls = Array.from(urlFrequencies.entries())
      .map(([url, frequency]) => ({ url, frequency }))
      .sort((a, b) => b.frequency - a.frequency);

    return urls;
  }

  // Opportunities - Recommendations
  async getRecommendations(clientId: string, promptRunId?: string | null): Promise<any> {
    // Build where conditions
    const conditions = [eq(recommendations.clientId, clientId)];
    
    // Filter by promptRunId: if provided, match it; if null explicitly, show only historical
    if (promptRunId !== undefined) {
      if (promptRunId === null || promptRunId === 'historical') {
        conditions.push(sql`${recommendations.promptRunId} IS NULL`);
      } else {
        conditions.push(eq(recommendations.promptRunId, promptRunId));
      }
    }
    
    const results = await db.select()
      .from(recommendations)
      .where(and(...conditions))
      .orderBy(desc(recommendations.createdAt));

    if (results.length === 0) {
      return { recommendations: [], generatedAt: null };
    }

    return {
      recommendations: results.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        severity: r.severity,
        category: r.category,
        source: r.source,
        example: r.examples ? (Array.isArray(r.examples) && r.examples.length > 0 ? r.examples[0] : undefined) : undefined,
        actionItems: r.actionItems
      })),
      generatedAt: results[0].createdAt.toISOString()
    };
  }

  async getRecommendationsSummary(clientId: string, options: any): Promise<any> {
    const { getRecommendationsSummary } = await import('./services/recommendations-summary');
    return getRecommendationsSummary(clientId, options);
  }

  async createRecommendation(data: InsertRecommendation): Promise<Recommendation> {
    const [result] = await db.insert(recommendations)
      .values(data)
      .returning();
    return result;
  }

  async saveRecommendations(clientId: string, promptRunId: string | null, recommendationsList: any[]): Promise<void> {
    // Valid source enum values from recommendation_source_enum
    const validSources = ['crawl', 'prompt_response', 'citation', 'ai_analysis', 'manual'];
    
    const inserts: InsertRecommendation[] = recommendationsList.map(r => {
      // Handle both 'example' (single object) and 'examples' (array)
      let examples = r.examples;
      if (!examples && r.example) {
        examples = [r.example]; // Convert single example to array
      }
      
      // Validate and sanitize source - LLM sometimes returns invalid values like domains
      let source = r.source || 'ai_analysis';
      if (!validSources.includes(source)) {
        console.warn(`[saveRecommendations] Invalid source "${source}", defaulting to "ai_analysis"`);
        source = 'ai_analysis';
      }
      
      return {
        clientId,
        promptRunId,
        title: r.title,
        description: r.description,
        severity: r.severity,
        category: r.category,
        examples: examples || [],
        actionItems: r.actionItems || [],
        source
      };
    });

    await db.insert(recommendations).values(inserts);
    console.log(`Saved ${recommendationsList.length} recommendations for client ${clientId}`);
  }

  // Opportunities - Content Generator
  async getGeneratedContents(clientId: string, promptRunId?: string | null): Promise<any[]> {
    // Build where conditions
    const conditions = [eq(generatedContents.clientId, clientId)];
    
    // Filter by promptRunId: if provided, match it; if null explicitly, show only historical
    if (promptRunId !== undefined) {
      if (promptRunId === null || promptRunId === 'historical') {
        conditions.push(sql`${generatedContents.promptRunId} IS NULL`);
      } else {
        conditions.push(eq(generatedContents.promptRunId, promptRunId));
      }
    }
    
    const results = await db.select()
      .from(generatedContents)
      .where(and(...conditions))
      .orderBy(desc(generatedContents.createdAt));

    return results.map(c => ({
      id: c.id,
      citationSource: c.sourceDomain || 'N/A',
      topic: c.title,
      content: c.content,
      generatedAt: c.createdAt.toISOString(),
      format: 'Article'
    }));
  }

  async saveGeneratedContents(clientId: string, promptRunId: string | null, contentsList: any[]): Promise<void> {
    const inserts: InsertGeneratedContent[] = contentsList.map(c => ({
      clientId,
      promptRunId,
      sourceUrl: c.sourceUrl || null,
      sourceDomain: c.citationSource || c.sourceDomain || null,
      title: c.topic || c.title,
      content: c.content,
      targetKeywords: c.targetKeywords || null
    }));

    await db.insert(generatedContents).values(inserts);
    console.log(`Saved ${contentsList.length} generated contents for client ${clientId}`);
  }

  // Site X-Ray - Sites
  async createXRaySite(site: InsertXRaySite): Promise<XRaySite> {
    const result = await db.insert(xraySites).values(site).returning();
    return result[0];
  }

  async getXRaySite(id: string): Promise<XRaySite | undefined> {
    const result = await db.select().from(xraySites).where(eq(xraySites.id, id));
    return result[0];
  }

  async getXRaySitesByClient(clientId: string): Promise<XRaySite[]> {
    return await db.select().from(xraySites).where(eq(xraySites.clientId, clientId));
  }

  async getXRaySitesWithMetrics(clientId: string): Promise<Array<{
    id: string;
    domain: string;
    siteType: string;
    avgScores: { content: number; seo: number; structure: number } | null;
    pageCount: number;
    robotsTxt: boolean;
    aiTxt: boolean;
    crawlStatus: string;
  }>> {
    const sites = await db.select().from(xraySites).where(eq(xraySites.clientId, clientId));
    
    // Bulk fetch all pages and analyses for all sites
    const siteIds = sites.map(s => s.id);
    if (siteIds.length === 0) return [];
    
    const allPages = await db.select({
      id: xrayPages.id,
      siteId: xrayPages.siteId
    }).from(xrayPages).where(inArray(xrayPages.siteId, siteIds));
    
    const pageIds = allPages.map(p => p.id);
    const allAnalyses = pageIds.length > 0 
      ? await db.select({
          pageId: xrayPageAnalysis.pageId,
          scores: xrayPageAnalysis.scores,
          seoIssues: xrayPageAnalysis.seoIssues,
          gaps: xrayPageAnalysis.gaps,
          recommendations: xrayPageAnalysis.recommendations
        }).from(xrayPageAnalysis).where(inArray(xrayPageAnalysis.pageId, pageIds))
      : [];
    
    // Build lookup maps
    const pagesBySite = new Map<string, string[]>();
    allPages.forEach(p => {
      if (!pagesBySite.has(p.siteId)) pagesBySite.set(p.siteId, []);
      pagesBySite.get(p.siteId)!.push(p.id);
    });
    
    const analysisByPage = new Map<string, { scores: any; seoIssues: any[]; gaps: any[]; recommendations: any[] }>();
    allAnalyses.forEach(a => analysisByPage.set(a.pageId, {
      scores: a.scores,
      seoIssues: (a.seoIssues as any[]) || [],
      gaps: (a.gaps as any[]) || [],
      recommendations: (a.recommendations as any[]) || []
    }));
    
    // Compute metrics for each site
    return sites.map(site => {
      const pageColl = pagesBySite.get(site.id) || [];
      const pageCount = pageColl.length;
      
      // Calculate average scores and count issues/recommendations
      let avgScores = null;
      let totalIssues = 0;
      let totalRecommendations = 0;
      
      const analysisArray = pageColl
        .map(pid => analysisByPage.get(pid))
        .filter(a => a && typeof a === 'object');
      
      if (analysisArray.length > 0) {
        avgScores = {
          content: analysisArray.reduce((sum, a) => sum + (a?.scores?.content || 0), 0) / analysisArray.length,
          seo: analysisArray.reduce((sum, a) => sum + (a?.scores?.seo || 0), 0) / analysisArray.length,
          structure: analysisArray.reduce((sum, a) => sum + (a?.scores?.structure || 0), 0) / analysisArray.length,
        };
        // Total issues = SEO issues + content gaps
        totalIssues = analysisArray.reduce((sum, a) => 
          sum + (a?.seoIssues?.length || 0) + (a?.gaps?.length || 0), 0);
        totalRecommendations = analysisArray.reduce((sum, a) => sum + (a?.recommendations?.length || 0), 0);
      }
      
      return {
        id: site.id,
        domain: site.domain,
        siteType: site.siteType,
        avgScores,
        pageCount,
        totalIssues,
        totalRecommendations,
        robotsTxt: site.robotsTxtPresent,
        aiTxt: site.aiTxtPresent,
        crawlStatus: site.crawlAccessStatus,
        healthProbeStatus: site.healthProbeStatus,
        lastProbedAt: site.lastProbedAt
      };
    });
  }

  async getLatestXRayJobsBySite(clientId: string): Promise<Map<string, {
    jobId: string;
    status: string;
    error: string | null;
    progress: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    startedByUserId: string | null;
  }>> {
    // Most-recent xray_analysis job per siteId for this client. We use a
    // window function so we get exactly one row per site (the latest run)
    // in a single round-trip instead of N+1 queries.
    const rows = await db.execute<{
      site_id: string;
      job_id: string;
      status: string;
      error: string | null;
      progress: number | null;
      started_at: Date | null;
      finished_at: Date | null;
      created_at: Date;
      started_by_user_id: string | null;
    }>(sql`
      SELECT site_id, job_id, status, error, progress, started_at, finished_at, created_at, started_by_user_id
      FROM (
        SELECT
          ${jobs.payload}->>'siteId' AS site_id,
          ${jobs.id} AS job_id,
          ${jobs.status}::text AS status,
          ${jobs.error} AS error,
          ${jobs.progress} AS progress,
          ${jobs.startedAt} AS started_at,
          ${jobs.finishedAt} AS finished_at,
          ${jobs.createdAt} AS created_at,
          ${jobs.startedByUserId} AS started_by_user_id,
          ROW_NUMBER() OVER (
            PARTITION BY ${jobs.payload}->>'siteId'
            ORDER BY ${jobs.createdAt} DESC
          ) AS rn
        FROM ${jobs}
        WHERE ${jobs.type} = 'xray_analysis'
          AND ${jobs.payload}->>'clientId' = ${clientId}
          AND ${jobs.payload}->>'siteId' IS NOT NULL
      ) t
      WHERE rn = 1
    `);

    const out = new Map<string, {
      jobId: string;
      status: string;
      error: string | null;
      progress: number | null;
      startedAt: Date | null;
      finishedAt: Date | null;
      createdAt: Date;
      startedByUserId: string | null;
    }>();
    for (const r of rows.rows) {
      if (!r.site_id) continue;
      out.set(r.site_id, {
        jobId: r.job_id,
        status: r.status,
        error: r.error ?? null,
        progress: typeof r.progress === 'number' ? r.progress : null,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        finishedAt: r.finished_at ? new Date(r.finished_at) : null,
        createdAt: new Date(r.created_at),
        startedByUserId: r.started_by_user_id ?? null,
      });
    }
    return out;
  }

  async updateXRaySite(id: string, updates: Partial<InsertXRaySite>): Promise<XRaySite> {
    const result = await db.update(xraySites)
      .set(updates)
      .where(eq(xraySites.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`X-Ray Site ${id} not found`);
    }
    return result[0];
  }

  async resetHealthProbeData(siteId: string): Promise<void> {
    await db.update(xraySites)
      .set({
        robotsTxtPresent: false,
        aiTxtPresent: false,
        crawlAccessStatus: 'ok',
        robotsRules: null,
        aiTxtContent: null,
        crawlEvidence: null,
        healthProbeStatus: 'pending',
        lastProbedAt: null,
        updatedAt: new Date()
      })
      .where(eq(xraySites.id, siteId));
  }

  // Site X-Ray - Pages
  async createXRayPage(page: InsertXRayPage): Promise<XRayPage> {
    const result = await db.insert(xrayPages).values(page).returning();
    return result[0];
  }

  async getXRayPage(id: string): Promise<XRayPage | undefined> {
    const result = await db.select().from(xrayPages).where(eq(xrayPages.id, id));
    return result[0];
  }

  async getXRayPagesBySite(siteId: string): Promise<XRayPage[]> {
    return await db.select().from(xrayPages).where(eq(xrayPages.siteId, siteId));
  }

  async getXRayPagesSummary(siteId: string): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    pageType: string | null;
    wordCount: number | null;
    scores: any;
    issueCount: number;
    recommendationCount: number;
  }>> {
    // Single query with left join to get pages and their analyses
    const results = await db
      .select({
        id: xrayPages.id,
        url: xrayPages.url,
        title: xrayPages.title,
        pageType: xrayPages.pageType,
        wordCount: xrayPages.wordCount,
        scores: xrayPageAnalysis.scores,
        seoIssues: xrayPageAnalysis.seoIssues,
        gaps: xrayPageAnalysis.gaps,
        recommendations: xrayPageAnalysis.recommendations
      })
      .from(xrayPages)
      .leftJoin(xrayPageAnalysis, eq(xrayPages.id, xrayPageAnalysis.pageId))
      .where(eq(xrayPages.siteId, siteId));
    
    // Map results to include computed counts
    return results.map(r => ({
      id: r.id,
      url: r.url,
      title: r.title,
      pageType: r.pageType,
      wordCount: r.wordCount,
      scores: r.scores,
      issueCount: ((r.seoIssues as any[])?.length || 0) + ((r.gaps as any[])?.length || 0),
      recommendationCount: (r.recommendations as any[])?.length || 0
    }));
  }

  // Site X-Ray - Page Structure
  async createPageStructure(structure: InsertXRayPageStructure): Promise<XRayPageStructure> {
    const result = await db.insert(xrayPageStructure).values(structure).returning();
    return result[0];
  }

  async getPageStructure(pageId: string): Promise<XRayPageStructure | undefined> {
    const result = await db.select().from(xrayPageStructure).where(eq(xrayPageStructure.pageId, pageId));
    return result[0];
  }

  // Site X-Ray - Page Analysis
  async createPageAnalysis(analysis: InsertXRayPageAnalysis): Promise<XRayPageAnalysis> {
    const result = await db.insert(xrayPageAnalysis).values(analysis).returning();
    return result[0];
  }

  async getPageAnalysis(pageId: string): Promise<XRayPageAnalysis | undefined> {
    const result = await db.select().from(xrayPageAnalysis).where(eq(xrayPageAnalysis.pageId, pageId));
    return result[0];
  }

  async updatePageAnalysis(id: string, updates: Partial<InsertXRayPageAnalysis>): Promise<XRayPageAnalysis> {
    const result = await db.update(xrayPageAnalysis)
      .set(updates)
      .where(eq(xrayPageAnalysis.id, id))
      .returning();
    
    if (!result[0]) {
      throw new Error(`X-Ray Page Analysis ${id} not found`);
    }
    return result[0];
  }
  
  // Score Explainability
  async createScoreFactors(factors: InsertScoreFactors): Promise<ScoreFactors> {
    const result = await db.insert(scoreFactors).values(factors).returning();
    return result[0];
  }
  
  async getScoreFactorsByPromptRunItem(promptRunItemId: string): Promise<ScoreFactors[]> {
    return await db.select().from(scoreFactors).where(eq(scoreFactors.promptRunItemId, promptRunItemId));
  }

  async getScoreColorBands(category: string): Promise<Array<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  }>> {
    const bands = await db.select({
      category: scoreColorBands.category,
      minScore: scoreColorBands.scoreMin,
      maxScore: scoreColorBands.scoreMax,
      color: scoreColorBands.colorHex
    })
    .from(scoreColorBands)
    .where(eq(scoreColorBands.category, category as any))
    .orderBy(scoreColorBands.scoreMin);
    
    return bands.map(b => ({
      category: b.category,
      minScore: parseFloat(b.minScore),
      maxScore: parseFloat(b.maxScore),
      color: b.color
    }));
  }

  async getScoreInterpretation(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    interpretation: string;
  } | undefined> {
    const result = await db.select({
      category: scoreInterpretations.category,
      minScore: scoreInterpretations.scoreMin,
      maxScore: scoreInterpretations.scoreMax,
      interpretation: scoreInterpretations.messageTemplate
    })
    .from(scoreInterpretations)
    .where(
      and(
        eq(scoreInterpretations.category, category as any),
        gte(sql`${score}`, scoreInterpretations.scoreMin),
        lte(sql`${score}`, scoreInterpretations.scoreMax)
      )
    )
    .limit(1);
    
    if (!result[0]) return undefined;
    
    return {
      category: result[0].category,
      minScore: parseFloat(result[0].minScore),
      maxScore: parseFloat(result[0].maxScore),
      interpretation: result[0].interpretation
    };
  }

  async getScoreColorBand(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  } | undefined> {
    const result = await db.select({
      category: scoreColorBands.category,
      minScore: scoreColorBands.scoreMin,
      maxScore: scoreColorBands.scoreMax,
      color: scoreColorBands.colorHex
    })
    .from(scoreColorBands)
    .where(
      and(
        eq(scoreColorBands.category, category as any),
        gte(sql`${score}`, scoreColorBands.scoreMin),
        lte(sql`${score}`, scoreColorBands.scoreMax)
      )
    )
    .limit(1);
    
    if (!result[0]) return undefined;
    
    return {
      category: result[0].category,
      minScore: parseFloat(result[0].minScore),
      maxScore: parseFloat(result[0].maxScore),
      color: result[0].color
    };
  }

  async copyClient(sourceClientId: string, newProjectName?: string): Promise<{
    client: Client;
    copied: {
      competitors: number;
      topics: number;
      prompts: number;
      xraySites: number;
      xrayPages: number;
    };
  }> {
    console.log(`[CopyClient] Starting deep clone of client ${sourceClientId}`);
    
    const sourceClient = await this.getClient(sourceClientId);
    if (!sourceClient) {
      throw new Error('Source client not found');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    let projectName = newProjectName || `${sourceClient.projectName} - Copy ${timestamp}`;
    
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      const existing = await this.findClientByProjectName(sourceClient.orgId, projectName);
      if (!existing) break;
      attempts++;
      projectName = `${sourceClient.projectName} - Copy ${timestamp}-${attempts}`;
    }
    
    if (attempts >= maxAttempts) {
      throw new Error('Could not generate unique project name after multiple attempts');
    }

    const copied = {
      competitors: 0,
      topics: 0,
      prompts: 0,
      xraySites: 0,
      xrayPages: 0
    };

    const [newClientResult] = await db.insert(clients).values({
      orgId: sourceClient.orgId,
      projectName: projectName,
      name: sourceClient.name,
      website: sourceClient.website,
      urls: sourceClient.urls,
      focusAreas: sourceClient.focusAreas,
      industry: sourceClient.industry,
      geography: sourceClient.geography,
      aliases: sourceClient.aliases,
      brandAliases: sourceClient.brandAliases,
      selectedAiModelIds: sourceClient.selectedAiModelIds,
      onboardingStatus: sourceClient.onboardingStatus,
      isActive: true
    }).returning();

    const newClientId = newClientResult.id;
    console.log(`[CopyClient] Created new client ${newClientId} with name "${projectName}"`);

    const sourceCompetitors = await db.select().from(competitors).where(eq(competitors.clientId, sourceClientId));
    for (const comp of sourceCompetitors) {
      await db.insert(competitors).values({
        clientId: newClientId,
        name: comp.name,
        website: comp.website,
        aliases: comp.aliases
      });
      copied.competitors++;
    }
    console.log(`[CopyClient] Copied ${copied.competitors} competitors`);

    const sourceTopics = await db.select().from(topics).where(eq(topics.clientId, sourceClientId));
    for (const topic of sourceTopics) {
      await db.insert(topics).values({
        clientId: newClientId,
        label: topic.label,
        category: topic.category,
        keywords: topic.keywords,
        source: topic.source,
        accepted: topic.accepted
      });
      copied.topics++;
    }
    console.log(`[CopyClient] Copied ${copied.topics} topics`);

    const sourcePrompts = await db.select().from(prompts).where(eq(prompts.clientId, sourceClientId));
    for (const prompt of sourcePrompts) {
      await db.insert(prompts).values({
        clientId: newClientId,
        text: prompt.text,
        source: prompt.source,
        categoryId: prompt.categoryId,
        accepted: prompt.accepted
      });
      copied.prompts++;
    }
    console.log(`[CopyClient] Copied ${copied.prompts} prompts`);

    const sourceSites = await db.select().from(xraySites).where(eq(xraySites.clientId, sourceClientId));
    
    for (const site of sourceSites) {
      const [newSite] = await db.insert(xraySites).values({
        clientId: newClientId,
        domain: site.domain,
        siteType: site.siteType,
        robotsTxtPresent: site.robotsTxtPresent,
        aiTxtPresent: site.aiTxtPresent,
        crawlAccessStatus: site.crawlAccessStatus,
        robotsRules: site.robotsRules,
        aiTxtContent: site.aiTxtContent,
        crawlEvidence: site.crawlEvidence,
        healthProbeStatus: site.healthProbeStatus,
        lastProbedAt: site.lastProbedAt
      }).returning();
      
      copied.xraySites++;
      
      const sourcePages = await db.select().from(xrayPages).where(eq(xrayPages.siteId, site.id));
      
      for (const page of sourcePages) {
        const [newPage] = await db.insert(xrayPages).values({
          siteId: newSite.id,
          url: page.url,
          title: page.title,
          pageType: page.pageType,
          statusCode: page.statusCode,
          wordCount: page.wordCount,
          rawHtml: page.rawHtml,
          rawText: page.rawText,
          lastModified: page.lastModified
        }).returning();
        
        copied.xrayPages++;
        
        const sourceStructure = await db.select().from(xrayPageStructure).where(eq(xrayPageStructure.pageId, page.id));
        for (const structure of sourceStructure) {
          await db.insert(xrayPageStructure).values({
            pageId: newPage.id,
            headings: structure.headings,
            paragraphs: structure.paragraphs,
            lists: structure.lists,
            tables: structure.tables,
            entities: structure.entities,
            focusAreas: structure.focusAreas,
            topics: structure.topics,
            sentimentScore: structure.sentimentScore,
            linkCounts: structure.linkCounts
          });
        }
        
        const sourceAnalysis = await db.select().from(xrayPageAnalysis).where(eq(xrayPageAnalysis.pageId, page.id));
        for (const analysis of sourceAnalysis) {
          await db.insert(xrayPageAnalysis).values({
            pageId: newPage.id,
            assessment: analysis.assessment,
            gaps: analysis.gaps,
            recommendations: analysis.recommendations,
            actions: analysis.actions,
            seoIssues: analysis.seoIssues,
            freshnessData: analysis.freshnessData,
            consistencyData: analysis.consistencyData,
            complianceData: analysis.complianceData,
            scores: analysis.scores
          });
        }
      }
    }
    console.log(`[CopyClient] Copied ${copied.xraySites} sites with ${copied.xrayPages} pages`);

    console.log(`[CopyClient] Complete! New client: ${newClientId}`);
    
    return {
      client: newClientResult,
      copied
    };
  }

  async copyClientWithProgress(sourceClientId: string, jobId: string, newProjectName?: string): Promise<{
    client: Client;
    copied: {
      competitors: number;
      topics: number;
      prompts: number;
      xraySites: number;
      xrayPages: number;
    };
  }> {
    console.log(`[CopyClient] Starting deep clone of client ${sourceClientId} with progress tracking`);
    
    const sourceClient = await this.getClient(sourceClientId);
    if (!sourceClient) {
      throw new Error('Source client not found');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    let projectName = newProjectName || `${sourceClient.projectName} - Copy ${timestamp}`;
    
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      const existing = await this.findClientByProjectName(sourceClient.orgId, projectName);
      if (!existing) break;
      attempts++;
      projectName = `${sourceClient.projectName} - Copy ${timestamp}-${attempts}`;
    }
    
    if (attempts >= maxAttempts) {
      throw new Error('Could not generate unique project name after multiple attempts');
    }

    const copied = {
      competitors: 0,
      topics: 0,
      prompts: 0,
      xraySites: 0,
      xrayPages: 0
    };

    // Step 1: Create new client (10%)
    const [newClientResult] = await db.insert(clients).values({
      orgId: sourceClient.orgId,
      projectName: projectName,
      name: sourceClient.name,
      website: sourceClient.website,
      urls: sourceClient.urls,
      focusAreas: sourceClient.focusAreas,
      industry: sourceClient.industry,
      geography: sourceClient.geography,
      aliases: sourceClient.aliases,
      brandAliases: sourceClient.brandAliases,
      selectedAiModelIds: sourceClient.selectedAiModelIds,
      onboardingStatus: sourceClient.onboardingStatus,
      isActive: true
    }).returning();

    const newClientId = newClientResult.id;
    console.log(`[CopyClient] Created new client ${newClientId} with name "${projectName}"`);
    await this.updateJob(jobId, { progress: 10 });

    // Step 2: Copy competitors (30%)
    const sourceCompetitors = await db.select().from(competitors).where(eq(competitors.clientId, sourceClientId));
    for (const comp of sourceCompetitors) {
      await db.insert(competitors).values({
        clientId: newClientId,
        name: comp.name,
        website: comp.website,
        aliases: comp.aliases
      });
      copied.competitors++;
    }
    console.log(`[CopyClient] Copied ${copied.competitors} competitors`);
    await this.updateJob(jobId, { progress: 30 });

    // Step 3: Copy topics (50%)
    const sourceTopics = await db.select().from(topics).where(eq(topics.clientId, sourceClientId));
    for (const topic of sourceTopics) {
      await db.insert(topics).values({
        clientId: newClientId,
        label: topic.label,
        category: topic.category,
        keywords: topic.keywords,
        source: topic.source,
        accepted: topic.accepted
      });
      copied.topics++;
    }
    console.log(`[CopyClient] Copied ${copied.topics} topics`);
    await this.updateJob(jobId, { progress: 50 });

    // Step 4: Copy prompts (70%)
    const sourcePrompts = await db.select().from(prompts).where(eq(prompts.clientId, sourceClientId));
    for (const prompt of sourcePrompts) {
      await db.insert(prompts).values({
        clientId: newClientId,
        text: prompt.text,
        source: prompt.source,
        categoryId: prompt.categoryId,
        accepted: prompt.accepted
      });
      copied.prompts++;
    }
    console.log(`[CopyClient] Copied ${copied.prompts} prompts`);
    await this.updateJob(jobId, { progress: 70 });

    // Step 5: Copy X-Ray sites and pages (90%)
    const sourceSites = await db.select().from(xraySites).where(eq(xraySites.clientId, sourceClientId));
    
    for (const site of sourceSites) {
      const [newSite] = await db.insert(xraySites).values({
        clientId: newClientId,
        domain: site.domain,
        siteType: site.siteType,
        robotsTxtPresent: site.robotsTxtPresent,
        aiTxtPresent: site.aiTxtPresent,
        crawlAccessStatus: site.crawlAccessStatus,
        robotsRules: site.robotsRules,
        aiTxtContent: site.aiTxtContent,
        crawlEvidence: site.crawlEvidence,
        healthProbeStatus: site.healthProbeStatus,
        lastProbedAt: site.lastProbedAt
      }).returning();
      
      copied.xraySites++;
      
      const sourcePages = await db.select().from(xrayPages).where(eq(xrayPages.siteId, site.id));
      
      for (const page of sourcePages) {
        const [newPage] = await db.insert(xrayPages).values({
          siteId: newSite.id,
          url: page.url,
          title: page.title,
          pageType: page.pageType,
          statusCode: page.statusCode,
          wordCount: page.wordCount,
          rawHtml: page.rawHtml,
          rawText: page.rawText,
          lastModified: page.lastModified
        }).returning();
        
        copied.xrayPages++;
        
        const sourceStructure = await db.select().from(xrayPageStructure).where(eq(xrayPageStructure.pageId, page.id));
        for (const structure of sourceStructure) {
          await db.insert(xrayPageStructure).values({
            pageId: newPage.id,
            headings: structure.headings,
            paragraphs: structure.paragraphs,
            lists: structure.lists,
            tables: structure.tables,
            entities: structure.entities,
            focusAreas: structure.focusAreas,
            topics: structure.topics,
            sentimentScore: structure.sentimentScore,
            linkCounts: structure.linkCounts
          });
        }
        
        const sourceAnalysis = await db.select().from(xrayPageAnalysis).where(eq(xrayPageAnalysis.pageId, page.id));
        for (const analysis of sourceAnalysis) {
          await db.insert(xrayPageAnalysis).values({
            pageId: newPage.id,
            assessment: analysis.assessment,
            gaps: analysis.gaps,
            recommendations: analysis.recommendations,
            actions: analysis.actions,
            seoIssues: analysis.seoIssues,
            freshnessData: analysis.freshnessData,
            consistencyData: analysis.consistencyData,
            complianceData: analysis.complianceData,
            scores: analysis.scores
          });
        }
      }
    }
    console.log(`[CopyClient] Copied ${copied.xraySites} sites with ${copied.xrayPages} pages`);
    await this.updateJob(jobId, { progress: 90 });

    console.log(`[CopyClient] Complete! New client: ${newClientId}`);
    
    return {
      client: newClientResult,
      copied
    };
  }

  // Phase 3: Run Checkpoints for job resumption
  async getRunCheckpoint(promptRunId: string): Promise<{
    id: string;
    promptRunId: string;
    completedItemIds: string[];
    currentStage: string;
    promptCount: number;
    modelCount: number;
    competitorCount: number;
    timeoutMs: number;
    lastUpdated: Date;
    createdAt: Date;
  } | undefined> {
    const result = await db.select().from(runCheckpoints).where(eq(runCheckpoints.promptRunId, promptRunId));
    if (result.length === 0) return undefined;
    const row = result[0];
    return {
      id: row.id,
      promptRunId: row.promptRunId,
      completedItemIds: (row.completedItemIds as string[]) || [],
      currentStage: row.currentStage,
      promptCount: row.promptCount,
      modelCount: row.modelCount,
      competitorCount: row.competitorCount,
      timeoutMs: row.timeoutMs,
      lastUpdated: row.lastUpdated,
      createdAt: row.createdAt
    };
  }

  async createRunCheckpoint(checkpoint: {
    promptRunId: string;
    completedItemIds?: string[];
    currentStage?: string;
    promptCount: number;
    modelCount: number;
    competitorCount?: number;
    timeoutMs: number;
  }): Promise<{ id: string; promptRunId: string }> {
    const result = await db.insert(runCheckpoints).values({
      promptRunId: checkpoint.promptRunId,
      completedItemIds: checkpoint.completedItemIds || [],
      currentStage: checkpoint.currentStage || 'execution',
      promptCount: checkpoint.promptCount,
      modelCount: checkpoint.modelCount,
      competitorCount: checkpoint.competitorCount || 0,
      timeoutMs: checkpoint.timeoutMs
    }).returning({ id: runCheckpoints.id, promptRunId: runCheckpoints.promptRunId });
    return result[0];
  }

  async updateRunCheckpoint(promptRunId: string, updates: {
    completedItemIds?: string[];
    currentStage?: string;
    competitorCount?: number;
  }): Promise<void> {
    const updateData: Record<string, any> = {
      lastUpdated: new Date()
    };
    if (updates.completedItemIds !== undefined) {
      updateData.completedItemIds = updates.completedItemIds;
    }
    if (updates.currentStage !== undefined) {
      updateData.currentStage = updates.currentStage;
    }
    if (updates.competitorCount !== undefined) {
      updateData.competitorCount = updates.competitorCount;
    }
    await db.update(runCheckpoints).set(updateData).where(eq(runCheckpoints.promptRunId, promptRunId));
  }

  async deleteRunCheckpoint(promptRunId: string): Promise<void> {
    await db.delete(runCheckpoints).where(eq(runCheckpoints.promptRunId, promptRunId));
  }

  // Phase 3: Completion Gating - Validate run before marking complete
  async validateRunCompletion(promptRunId: string): Promise<{
    allItemsDone: boolean;
    itemsNotDone: number;
    expectedAnswers: number;
    actualAnswers: number;
    expectedCompetitorScores: number;
    actualCompetitorScores: number;
    isValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    // Get the prompt run to find client and expected counts
    const promptRun = await this.getPromptRun(promptRunId);
    if (!promptRun) {
      return {
        allItemsDone: false,
        itemsNotDone: 0,
        expectedAnswers: 0,
        actualAnswers: 0,
        expectedCompetitorScores: 0,
        actualCompetitorScores: 0,
        isValid: false,
        errors: ['Prompt run not found']
      };
    }
    
    // Step 3.2: Count prompt items with non-terminal status
    // Phase 3B: 'error' is now a terminal state (item failed but processing is complete)
    const allItems = await this.getPromptRunItems(promptRunId);
    const terminalStatuses = ['done', 'error'];
    const itemsNotTerminal = allItems.filter(item => !terminalStatuses.includes(item.status)).length;
    const allItemsTerminal = itemsNotTerminal === 0;
    
    if (!allItemsTerminal) {
      errors.push(`${itemsNotTerminal} items still processing`);
    }
    
    // Phase 3B: Count successful items (status 'done') for answer expectations
    const successfulItems = allItems.filter(item => item.status === 'done');
    const erroredItems = allItems.filter(item => item.status === 'error');
    
    // Step 3.3: Count answers vs expected (only successful items should have answers)
    const expectedAnswers = successfulItems.length;
    let actualAnswers = 0;
    
    // Count answers for all items
    const answerCounts = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(answers)
      .innerJoin(promptRunItems, eq(answers.promptRunItemId, promptRunItems.id))
      .where(eq(promptRunItems.promptRunId, promptRunId));
    
    actualAnswers = Number(answerCounts[0]?.count || 0);
    
    if (actualAnswers !== expectedAnswers) {
      errors.push(`Answer count mismatch: expected ${expectedAnswers}, got ${actualAnswers}`);
    }
    
    // Step 3.4: Verify each configured competitor has a score per prompt
    // Get configured competitors and client info
    const competitors = await this.getCompetitors(promptRun.clientId);
    const client = await this.getClient(promptRun.clientId);
    const uniquePromptIds = [...new Set(allItems.map(item => item.promptId))];
    
    // Get all scores for this run
    const allScores = await db.select().from(competitorScores)
      .where(eq(competitorScores.promptRunId, promptRunId));
    
    const actualCompetitorScores = allScores.length;
    
    // Expected: each prompt × (1 client + N configured competitors)
    const expectedCompetitorScores = uniquePromptIds.length * (1 + competitors.length);
    
    // Build sets of existing scores for verification
    // Use competitorId for configured competitors, isClient flag for client
    const clientScorePrompts = new Set(
      allScores.filter(s => s.isClient).map(s => s.promptId)
    );
    const competitorScoreMap = new Map<string, Set<string>>(); // promptId -> Set of competitorIds
    for (const score of allScores) {
      if (!score.isClient && score.competitorId) {
        if (!competitorScoreMap.has(score.promptId)) {
          competitorScoreMap.set(score.promptId, new Set());
        }
        competitorScoreMap.get(score.promptId)!.add(score.competitorId);
      }
    }
    
    // Verify client has score for each prompt (using isClient flag)
    const missingClientScores: string[] = [];
    for (const promptId of uniquePromptIds) {
      if (!clientScorePrompts.has(promptId)) {
        missingClientScores.push(promptId);
      }
    }
    
    // Verify each configured competitor has score for each prompt (using competitorId)
    const missingCompetitorScores: { promptId: string; competitor: string }[] = [];
    for (const promptId of uniquePromptIds) {
      const promptCompetitorIds = competitorScoreMap.get(promptId) || new Set();
      for (const comp of competitors) {
        if (!promptCompetitorIds.has(comp.id)) {
          missingCompetitorScores.push({ promptId, competitor: comp.name });
        }
      }
    }
    
    // Report missing scores
    if (missingClientScores.length > 0) {
      errors.push(`Missing client scores for ${missingClientScores.length} prompts`);
    }
    if (missingCompetitorScores.length > 0) {
      errors.push(`Missing ${missingCompetitorScores.length} competitor scores (${missingCompetitorScores.slice(0, 3).map(m => m.competitor).join(', ')}${missingCompetitorScores.length > 3 ? '...' : ''})`);
    }
    
    // Step 3.5: Return validation result with details
    // Phase 3B: isValid requires: all items terminal (done OR error), answer count matches successful items, ALL configured entities have scores
    const allScoresPresent = missingClientScores.length === 0 && missingCompetitorScores.length === 0;
    const isValid = allItemsTerminal && actualAnswers === expectedAnswers && allScoresPresent;
    
    console.log(`[CompletionValidation] Run ${promptRunId}: allItemsTerminal=${allItemsTerminal} (${successfulItems.length} done, ${erroredItems.length} error), answers=${actualAnswers}/${expectedAnswers}, scores=${actualCompetitorScores}/${expectedCompetitorScores}, isValid=${isValid}`);
    
    return {
      allItemsDone: allItemsTerminal, // Renamed but keeping interface compatible
      itemsNotDone: itemsNotTerminal,
      expectedAnswers,
      actualAnswers,
      expectedCompetitorScores,
      actualCompetitorScores,
      isValid,
      errors
    };
  }

  // Phase 3B: Error Propagation - Aggregate all item errors for run-level visibility
  async aggregateRunErrors(promptRunId: string): Promise<{
    totalItems: number;
    errorCount: number;
    errors: Array<{
      itemId: string;
      promptId: string;
      promptText: string;
      modelId: string;
      modelName: string;
      error: string;
    }>;
    errorSummary: string;
  }> {
    // Get all items for this run
    const allItems = await db.select().from(promptRunItems)
      .where(eq(promptRunItems.promptRunId, promptRunId));
    
    const totalItems = allItems.length;
    
    // Filter to error items only
    const errorItems = allItems.filter(item => item.status === 'error');
    const errorCount = errorItems.length;
    
    if (errorCount === 0) {
      return {
        totalItems,
        errorCount: 0,
        errors: [],
        errorSummary: ''
      };
    }
    
    // Get prompt and model details for each error
    const errors: Array<{
      itemId: string;
      promptId: string;
      promptText: string;
      modelId: string;
      modelName: string;
      error: string;
    }> = [];
    
    for (const item of errorItems) {
      const prompt = await db.select().from(prompts).where(eq(prompts.id, item.promptId)).limit(1);
      const model = await db.select().from(aiModels).where(eq(aiModels.id, item.modelId)).limit(1);
      
      errors.push({
        itemId: item.id,
        promptId: item.promptId,
        promptText: prompt[0]?.text || 'Unknown prompt',
        modelId: item.modelId,
        modelName: model[0]?.displayName || model[0]?.model || 'Unknown model',
        error: item.error || 'Unknown error'
      });
    }
    
    // Build summary string
    const errorSummary = `${errorCount} of ${totalItems} prompts failed`;
    
    console.log(`[ErrorAggregation] Run ${promptRunId}: ${errorSummary}`);
    
    return {
      totalItems,
      errorCount,
      errors,
      errorSummary
    };
  }

  // Phase 4: Structured Telemetry & Logging
  async createPromptRunLog(log: {
    promptRunId: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    meta?: unknown;
  }): Promise<{ id: string }> {
    const result = await db.insert(promptRunLogs).values({
      promptRunId: log.promptRunId,
      level: log.level,
      message: log.message,
      meta: log.meta ?? null,
    }).returning({ id: promptRunLogs.id });
    return result[0];
  }

  async getPromptRunLogs(promptRunId: string, options?: {
    limit?: number;
    cursor?: string;
    level?: 'info' | 'warn' | 'error';
  }): Promise<{
    logs: Array<{
      id: string;
      promptRunId: string;
      level: 'info' | 'warn' | 'error';
      message: string;
      meta: unknown;
      timestamp: Date;
    }>;
    nextCursor: string | null;
  }> {
    const limit = options?.limit ?? 100;
    const conditions = [eq(promptRunLogs.promptRunId, promptRunId)];
    
    if (options?.level) {
      conditions.push(eq(promptRunLogs.level, options.level));
    }
    
    if (options?.cursor) {
      conditions.push(lte(promptRunLogs.timestamp, new Date(options.cursor)));
    }
    
    const results = await db.select()
      .from(promptRunLogs)
      .where(and(...conditions))
      .orderBy(desc(promptRunLogs.timestamp))
      .limit(limit + 1);
    
    const hasMore = results.length > limit;
    const logs = results.slice(0, limit).map(row => ({
      id: row.id,
      promptRunId: row.promptRunId,
      level: row.level,
      message: row.message,
      meta: row.meta,
      timestamp: row.timestamp,
    }));
    
    const nextCursor = hasMore && logs.length > 0 
      ? logs[logs.length - 1].timestamp.toISOString()
      : null;
    
    return { logs, nextCursor };
  }

  // ----- User sessions ledger (Task #37) -----
  // Routed through IStorage so the active-sessions UI, admin audits,
  // and the queue-config endpoint all share the same surface. The
  // express-session store remains the source of truth for cookie
  // validity; bumping users.session_epoch is the kill switch.

  async recordUserSession(opts: {
    sessionId: string;
    userId: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      const ua = opts.userAgent ? opts.userAgent.slice(0, 1024) : null;
      await db
        .insert(userSessions)
        .values({
          sessionId: opts.sessionId,
          userId: opts.userId,
          userAgent: ua,
          ipAddress: opts.ipAddress ?? null,
        })
        .onConflictDoUpdate({
          target: userSessions.sessionId,
          set: {
            userId: opts.userId,
            userAgent: ua,
            ipAddress: opts.ipAddress ?? null,
            lastSeenAt: new Date(),
          },
        });
    } catch (err) {
      console.error("[sessions] recordUserSession failed", err);
    }
  }

  async touchUserSession(sessionId: string): Promise<void> {
    try {
      await db
        .update(userSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(userSessions.sessionId, sessionId));
    } catch (err) {
      console.error("[sessions] touchUserSession failed", err);
    }
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    try {
      await db.delete(userSessions).where(eq(userSessions.sessionId, sessionId));
    } catch (err) {
      console.error("[sessions] deleteUserSession failed", err);
    }
  }

  async deleteUserSessionsForUser(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    try {
      if (exceptSessionId) {
        await db
          .delete(userSessions)
          .where(
            and(eq(userSessions.userId, userId), ne(userSessions.sessionId, exceptSessionId)),
          );
      } else {
        await db.delete(userSessions).where(eq(userSessions.userId, userId));
      }
    } catch (err) {
      console.error("[sessions] deleteUserSessionsForUser failed", err);
    }
  }

  async listUserSessionsForUser(userId: string): Promise<UserSession[]> {
    // Filter out rows whose underlying express-session row in the
    // connect-pg-simple `session` table no longer exists or has expired
    // (Task #42). The PG store prunes expired `session` rows hourly but
    // never touches our parallel `user_sessions` ledger, so without this
    // join the UI would list "active" sessions whose cookie is already
    // dead. Skipped when the in-memory store is active (tests / when
    // SESSION_STORE=memory) — in that case the `session` table is empty
    // or missing and filtering would hide every legitimate row.
    if (usingMemorySessionStore()) {
      return db
        .select()
        .from(userSessions)
        .where(eq(userSessions.userId, userId))
        .orderBy(desc(userSessions.lastSeenAt));
    }
    return db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          sql`EXISTS (SELECT 1 FROM "session" WHERE "session"."sid" = ${userSessions.sessionId} AND "session"."expire" > NOW())`,
        ),
      )
      .orderBy(desc(userSessions.lastSeenAt));
  }

  async getUserSession(sessionId: string): Promise<UserSession | undefined> {
    const rows = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionId, sessionId))
      .limit(1);
    return rows[0];
  }

  async countActiveUserSessions(): Promise<number> {
    try {
      if (usingMemorySessionStore()) {
        const rows = await db.select({ id: userSessions.sessionId }).from(userSessions);
        return rows.length;
      }
      // Same expired-row filter as listUserSessionsForUser so the
      // admin queue-health card and the active-sessions UI stay in
      // lockstep (Task #42).
      const rows = await db
        .select({ id: userSessions.sessionId })
        .from(userSessions)
        .where(
          sql`EXISTS (SELECT 1 FROM "session" WHERE "session"."sid" = ${userSessions.sessionId} AND "session"."expire" > NOW())`,
        );
      return rows.length;
    } catch {
      return 0;
    }
  }

  async pruneOrphanUserSessions(): Promise<number> {
    // Sweep `user_sessions` rows whose underlying express-session row
    // is gone or expired (Task #42). Called on an interval from
    // setupAuth(). Returns the number of rows removed (best-effort —
    // swallows errors so a transient DB hiccup never crashes the
    // sweeper).
    if (usingMemorySessionStore()) return 0;
    try {
      const result = await db.execute(sql`
        DELETE FROM "user_sessions"
        WHERE NOT EXISTS (
          SELECT 1 FROM "session"
          WHERE "session"."sid" = "user_sessions"."session_id"
            AND "session"."expire" > NOW()
        )
      `);
      // node-postgres returns rowCount; Neon serverless returns the
      // same field. Default to 0 if the driver omits it.
      const rc = (result as unknown as { rowCount?: number | null }).rowCount;
      return typeof rc === "number" ? rc : 0;
    } catch (err) {
      console.error("[sessions] pruneOrphanUserSessions failed", err);
      return 0;
    }
  }

  // Task #56 active-operations methods. Part of the IStorage contract — see storage.ts.
  async listActiveActivitySources(
    clientIds: string[],
    activeJobTypes: string[],
    activeJobStatuses: string[],
    activePromptRunStatuses: string[],
    activeReportStatuses: string[],
  ): Promise<ActivityActiveSources> {
  if (clientIds.length === 0) {
    return { jobs: [], promptRuns: [], reports: [] };
  }
  const jobRows = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      progress: jobs.progress,
      startedAt: jobs.startedAt,
      createdAt: jobs.createdAt,
      startedByUserId: jobs.startedByUserId,
      payload: jobs.payload,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, activeJobStatuses),
        inArray(jobs.type, activeJobTypes),
        or(
          sql`${jobs.payload}->>'clientId' IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`,
          sql`${jobs.payload}->>'sourceClientId' IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      ),
    );

  const promptRunRows = await db
    .select({
      id: promptRuns.id,
      clientId: promptRuns.clientId,
      status: promptRuns.status,
      createdAt: promptRuns.createdAt,
      createdBy: promptRuns.createdBy,
    })
    .from(promptRuns)
    .where(
      and(
        inArray(promptRuns.clientId, clientIds),
        inArray(promptRuns.status, activePromptRunStatuses),
      ),
    );

  const reportRows = await db
    .select({
      id: reportJobs.id,
      snapshotId: reportJobs.snapshotId,
      clientId: reportSnapshots.clientId,
      status: reportJobs.status,
      progressPercent: reportJobs.progressPercent,
      createdAt: reportJobs.createdAt,
      startedByUserId: reportJobs.startedByUserId,
    })
    .from(reportJobs)
    .innerJoin(reportSnapshots, eq(reportJobs.snapshotId, reportSnapshots.id))
    .where(
      and(
        inArray(reportSnapshots.clientId, clientIds),
        inArray(reportJobs.status, activeReportStatuses),
      ),
    );

  return {
    jobs: jobRows.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      progress: typeof j.progress === 'number' ? j.progress : null,
      startedAt: j.startedAt ?? null,
      createdAt: j.createdAt!,
      startedByUserId: j.startedByUserId ?? null,
      payload: (j.payload as Record<string, unknown> | null) ?? null,
    })),
    promptRuns: promptRunRows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      status: r.status,
      createdAt: r.createdAt!,
      createdBy: r.createdBy ?? null,
    })),
    reports: reportRows.map((r) => ({
      id: r.id,
      snapshotId: r.snapshotId,
      clientId: r.clientId,
      status: r.status,
      progressPercent: typeof r.progressPercent === 'number' ? r.progressPercent : null,
      createdAt: r.createdAt!,
      startedByUserId: r.startedByUserId ?? null,
    })),
    };
  }

  // Task #59 — Reap prompt_runs stuck in any non-terminal status whose
  // createdAt is older than `olderThanMs`. Marks both the run and its
  // items as `error` with the supplied reason text written to
  // `prompt_runs.error_summary` / `prompt_run_items.error`. The
  // statusEnum has no `failed` value — `error` is the canonical
  // terminal-failure status used elsewhere in the system.
  async reapStalePromptRuns(
    olderThanMs: number,
    reason: string,
  ): Promise<{ runs: number; items: number }> {
    const { ACTIVE_PROMPT_RUN_STATUSES } = await import("./services/activity-service");
    const cutoff = new Date(Date.now() - olderThanMs);

    // Task #115 — Prefer heartbeat freshness over createdAt so a long
    // healthy run that is still beating doesn't get reaped at the
    // 30-minute mark. A row is stale when:
    //   (a) it has a heartbeat and that heartbeat is older than the
    //       cutoff, OR
    //   (b) it has no heartbeat AND its createdAt is older than the
    //       cutoff (covers legacy rows + crashed workers that never
    //       wrote a beat).
    const staleRows = await db
      .select({ id: promptRuns.id })
      .from(promptRuns)
      .where(
        and(
          inArray(promptRuns.status, ACTIVE_PROMPT_RUN_STATUSES),
          sql`(${promptRuns.heartbeatAt} IS NOT NULL AND ${promptRuns.heartbeatAt} < ${cutoff})
               OR (${promptRuns.heartbeatAt} IS NULL AND ${promptRuns.createdAt} < ${cutoff})`,
        ),
      );

    if (staleRows.length === 0) {
      return { runs: 0, items: 0 };
    }

    const ids = staleRows.map((r) => r.id);

    const itemUpdate = await db
      .update(promptRunItems)
      .set({ status: "error", error: reason, finishedAt: new Date() })
      .where(
        and(
          inArray(promptRunItems.promptRunId, ids),
          inArray(promptRunItems.status, ACTIVE_PROMPT_RUN_STATUSES),
        ),
      );
    const itemRc = (itemUpdate as unknown as { rowCount?: number | null }).rowCount;

    // Re-check status in the WHERE so that any run which raced to a
    // terminal state between SELECT and UPDATE is left alone instead of
    // being overwritten with our reap reason.
    const runUpdate = await db
      .update(promptRuns)
      .set({ status: "error", errorSummary: reason })
      .where(
        and(
          inArray(promptRuns.id, ids),
          inArray(promptRuns.status, ACTIVE_PROMPT_RUN_STATUSES),
        ),
      );
    const runRc = (runUpdate as unknown as { rowCount?: number | null }).rowCount;

    return {
      runs: typeof runRc === "number" ? runRc : ids.length,
      items: typeof itemRc === "number" ? itemRc : 0,
    };
  }

  async getUsersByIds(
    userIds: string[],
  ): Promise<Array<{ id: string; displayName: string | null; email: string }>> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
    return rows;
  }
}

function usingMemorySessionStore(): boolean {
  return (
    process.env.SESSION_STORE === "memory" || process.env.NODE_ENV === "test"
  );
}
