import {
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
  type XRaySite, type InsertXRaySite,
  type XRayPage, type InsertXRayPage,
  type XRayPageStructure, type InsertXRayPageStructure,
  type XRayPageAnalysis, type InsertXRayPageAnalysis,
  type ScoreFactors, type InsertScoreFactors,
  type UserSession,
  type ActivityKind,
} from "@shared/schema";
import { randomUUID } from "crypto";

// Task #56 — Source rows for the Active Operations service. The shape is
// intentionally narrow (only what `activity-service.ts` projects into
// ActivityItem) so MemStorage stays cheap to maintain. The actual SQL
// lives in DbStorage.listActiveActivitySources.
export interface ActivityActiveSources {
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    progress: number | null;
    startedAt: Date | null;
    createdAt: Date;
    startedByUserId: string | null;
    payload: Record<string, unknown> | null;
  }>;
  promptRuns: Array<{
    id: string;
    clientId: string;
    status: string;
    createdAt: Date;
    createdBy: string | null;
  }>;
  reports: Array<{
    id: string;
    snapshotId: string;
    clientId: string;
    status: string;
    progressPercent: number | null;
    createdAt: Date;
    startedByUserId: string | null;
  }>;
}

export interface IStorage {
  // Organizations
  getOrganization(id: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;

  // Clients
  getClient(id: string): Promise<Client | undefined>;
  /**
   * List active clients in an org. When `viewer` is provided, the result is
   * filtered to only the projects that user can access (admins see all;
   * others see projects they own or are explicitly granted on
   * `project_memberships`). Pass `undefined` to bypass the filter (used by
   * background jobs / scripts that need an org-wide view).
   */
  getClients(
    orgId: string,
    viewer?: { userId: string; role: 'admin' | 'member' | 'viewer' },
  ): Promise<Array<Client & { lastOpenedAt?: Date | null }>>;
  /**
   * Task #144 — upsert the per-user "last opened" timestamp for a project.
   * Used by the catalog's last-opened default sort.
   */
  recordProjectOpen(userId: string, clientId: string): Promise<void>;
  // Task #56 — Active operations data sources (cross-user in-flight work
  // for one or many projects). Implementations must filter by status and
  // by the supplied clientIds. The activity service projects these rows
  // into the public ActivityItem DTO and hydrates user attribution.
  listActiveActivitySources(
    clientIds: string[],
    activeJobTypes: string[],
    activeJobStatuses: string[],
    activePromptRunStatuses: string[],
    activeReportStatuses: string[],
  ): Promise<ActivityActiveSources>;
  /**
   * Hydrate a small set of users (display name + email) for activity
   * attribution. Order is not significant; missing ids are simply absent.
   */
  getUsersByIds(
    userIds: string[],
  ): Promise<Array<{ id: string; displayName: string | null; email: string }>>;

  // Per-project access control (Task #17).
  listProjectMembers(clientId: string): Promise<Array<{
    userId: string;
    email: string;
    displayName: string | null;
    role: 'admin' | 'member' | 'viewer';
    grantedAt: Date | null;
    grantedByUserId: string | null;
    grantedByEmail: string | null;
    isOwner: boolean;
  }>>;
  addProjectMember(
    clientId: string,
    userId: string,
    grantedByUserId: string | null,
  ): Promise<{ created: boolean; membership: ProjectMembership }>;
  removeProjectMember(clientId: string, userId: string): Promise<boolean>;
  findClientByProjectName(orgId: string, projectName: string, excludeId?: string): Promise<Client | null>;
  createClient(client: CreateClient): Promise<Client>;
  updateClient(id: string, updates: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: string): Promise<void>;

  // Competitors
  getCompetitors(clientId: string): Promise<Competitor[]>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  deleteCompetitor(id: string): Promise<void>;

  // AI Models
  getAiModels(): Promise<AiModel[]>;
  getAllAiModels(): Promise<AiModel[]>;
  getAiModel(id: string): Promise<AiModel | undefined>;
  getClientModels(clientId: string): Promise<AiModel[]>;
  updateClientModels(clientId: string, modelIds: string[]): Promise<void>;
  updateAiModelCategory(id: string, category: 'core' | 'additional'): Promise<AiModel | undefined>;
  updateAiModelInternalOnly(id: string, internalOnly: boolean): Promise<AiModel | undefined>;
  // Task #79 — Disable-lifecycle hardening. When disabling, callers pass
  // `actorUserId` and an optional human-readable `reason` so the History
  // popover can show "Disabled by Alice on 2026-05-12: rate-limited"; the
  // attribution columns are cleared on re-enable.
  updateAiModelEnabled(
    id: string,
    enabled: boolean,
    actorUserId?: string | null,
    reason?: string | null,
  ): Promise<AiModel | undefined>;
  getAiModelUsage(id: string): Promise<{ projectCount: number; inFlightItemCount: number; projectNames: string[] }>;
  // Task #79 — On disable, mark every in-flight `prompt_run_items` row
  // targeting this model as `error`; if every item under a wrapping
  // `prompt_runs` row now references a disabled model, error the run too
  // (and any tracking `jobs` row that points at it). Returns the count
  // of each entity that flipped so the route can include it in the audit
  // metadata. No-op when nothing was in flight.
  cancelInFlightForDisabledModel(
    modelId: string,
    reason: string,
  ): Promise<{ items: number; runs: number; jobs: number }>;
  // Task #79 — Sweep `clients.selectedAiModelIds` to remove `modelId`
  // and append a one-time notification to `clients.disabledModelNotifications`
  // so the project config page can show "Model X was removed by an admin"
  // on next visit. Returns the affected client ids.
  sweepDisabledModelFromClients(
    modelId: string,
    modelName: string,
    vendor: string,
    reason?: string | null,
  ): Promise<string[]>;
  // Task #79 — Look up the current override row's modelId (or null if
  // none) for an LLM function key. Used by the override route so the
  // audit metadata can record which model was unbound, enabling the
  // per-model history popover to surface override changes.
  getLlmFunctionOverrideModelId(functionKey: string): Promise<string | null>;
  // Task #79 — Dismiss one notification entry from a project. No-op when
  // the notification id is not present.
  dismissDisabledModelNotification(
    clientId: string,
    notificationId: string,
  ): Promise<void>;
  // Task #79 — Recent audit entries for a single AI model row, newest
  // first. Powers the History popover in the admin Models table.
  getAiModelAuditHistory(
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
  }>>;

  // Task #77 — LLM function-to-model overrides. `setLlmFunctionOverride`
  // upserts when modelId is non-null and deletes when null. Implementations
  // are responsible for invalidating the resolver cache (server-side
  // helper `invalidateLlmFunctionCache()` in `config/llm-functions.ts`).
  setLlmFunctionOverride(
    functionKey: string,
    modelId: string | null,
    updatedByUserId: string | null,
  ): Promise<void>;

  // Task #78 — Vendor-level kill switch.
  getAiVendorStatuses(): Promise<Array<{
    vendor: string;
    paused: boolean;
    pausedAt: Date | null;
    pausedByUserId: string | null;
    pauseReason: string | null;
  }>>;
  setAiVendorPause(
    vendor: string,
    paused: boolean,
    actorUserId: string | null,
    reason: string | null,
  ): Promise<void>;
  // Most recent successful prompt_run_item finish time across all models in
  // this vendor. Used for the "last successful call" column on the Providers
  // panel. Returns null when nothing successful is on file.
  getVendorLastSuccessAt(vendor: string): Promise<Date | null>;
  // Count of prompt_run_items currently in a non-terminal status across all
  // models in this vendor. Powers the "N items will fail mid-flight"
  // warning in the pause confirmation modal.
  getVendorInFlightItemCount(vendor: string): Promise<number>;
  // Task #115 — Rolling 24h error rate for a vendor, sourced from
  // `prompt_run_items`. Returns total/error counts plus the ratio
  // (`errorRate ∈ [0,1]`). When `totalCount === 0` callers should
  // treat the ratio as "no signal" rather than 0% (UI dims the cell).
  getVendorLast24hErrorRate(vendor: string): Promise<{
    totalCount: number;
    errorCount: number;
    errorRate: number;
  }>;
  // Task #115 — Most recent failed jobs (status='error' OR 'cancelled')
  // with optional limit. Used by the admin queue page to render a
  // retry/cancel table.
  getRecentFailedJobs(limit?: number): Promise<Job[]>;
  // Task #115 — Failed-job counts grouped by `job.type` over the last
  // `hours` window. Powers the "Failures by kind" rollup on the
  // operational dashboard.
  getFailedJobCountsByType(hours: number): Promise<Array<{ type: string; count: number }>>;
  // Task #115 — Count of prompt_runs currently in flight across the
  // whole system (any `ACTIVE_PROMPT_RUN_STATUSES` value). Powers the
  // "Prompt runs in flight" tile on the operational dashboard.
  countActivePromptRuns(): Promise<number>;
  // Task #115 — Atomic cancel for an admin-initiated stop on a queued
  // job. Returns the updated row, or `null` if the row was no longer
  // in `queued` status (e.g. a worker picked it up first). The admin
  // route maps `null` → HTTP 409.
  cancelQueuedJob(id: string, reason?: string): Promise<Job | null>;
  // Task #115 — Recent queued jobs (for the admin Cancel surface).
  getQueuedJobs(limit?: number): Promise<Job[]>;
  // Task #121 — Currently-running jobs (for the admin Halt surface).
  getRunningJobs(limit?: number): Promise<Job[]>;

  // Topics
  getTopics(clientId: string): Promise<Topic[]>;
  createTopic(topic: InsertTopic): Promise<Topic>;
  updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic>;
  deleteTopic(id: string): Promise<void>;
  deleteAIGeneratedTopics(clientId: string): Promise<number>;

  // Prompts
  getPrompts(clientId: string): Promise<Prompt[]>;
  getPromptsByIds(clientId: string, ids: string[]): Promise<Prompt[]>;
  getPrompt(id: string): Promise<Prompt | undefined>;
  createPrompt(prompt: InsertPrompt): Promise<Prompt>;
  updatePrompt(id: string, updates: Partial<InsertPrompt>): Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;
  deleteAIGeneratedPrompts(clientId: string): Promise<number>;
  
  // Prompt Categories
  getPromptCategories(): Promise<PromptCategory[]>;
  
  // Transactional metadata replacement
  replaceClientGeneratedMetadata(
    clientId: string, 
    newTopics: InsertTopic[], 
    newPrompts: InsertPrompt[]
  ): Promise<{ topicsCreated: number; promptsCreated: number }>;

  // Prompt Runs
  getPromptRuns(clientId: string): Promise<PromptRun[]>;
  getPromptRunSummaries(clientId: string, opts: { limit: number; offset: number; status?: string; search?: string }): Promise<{
    runs: Array<PromptRun & {
      modelCount: number;
      avgVisibilityScore: number;
      avgSentimentScore: number;
      avgPositionScore: number;
    }>;
    total: number;
  }>;
  getPromptRun(id: string): Promise<PromptRun | undefined>;
  getPromptRunsMetadata(clientId: string): Promise<Array<{
    id: string;
    name: string;
    createdAt: Date;
    status: string;
    totalPrompts: number | null;
    modelCount: number;
  }>>;
  createPromptRun(run: InsertPromptRun): Promise<PromptRun>;
  updatePromptRun(id: string, updates: Partial<PromptRun>): Promise<PromptRun>;
  claimPromptRunDeliverables(id: string): Promise<boolean>;
  deletePromptRun(id: string): Promise<void>;
  
  // Prompt Run Items
  getPromptRunItems(promptRunId: string): Promise<PromptRunItem[]>;
  createPromptRunItem(item: Omit<PromptRunItem, 'id'>): Promise<PromptRunItem>;
  updatePromptRunItem(id: string, updates: Partial<PromptRunItem>): Promise<PromptRunItem>;
  
  // Answers
  createAnswer(answer: Omit<Answer, 'id'>): Promise<Answer>;
  updateAnswer(id: string, updates: Partial<Answer>): Promise<Answer>;
  getAnswerByPromptRunItem(promptRunItemId: string): Promise<Answer | undefined>;
  
  // Citations
  createCitation(citation: Omit<Citation, 'id'>): Promise<Citation>;
  getCitationsByAnswer(answerId: string): Promise<Citation[]>;
  
  // Mentions
  createMention(mention: Omit<Mention, 'id'>): Promise<Mention>;
  getMentionsByAnswer(answerId: string): Promise<Mention[]>;
  
  // Rankings
  createRanking(ranking: Omit<Ranking, 'id'>): Promise<Ranking>;
  getRankingsByAnswer(answerId: string): Promise<Ranking[]>;

  // Competitor Scores
  createCompetitorScore(score: Omit<CompetitorScore, 'id' | 'createdAt'>): Promise<CompetitorScore>;
  getCompetitorScoresByRun(promptRunId: string): Promise<CompetitorScore[]>;
  getLatestCompetitorScores(clientId: string): Promise<CompetitorScore[]>;
  getAggregatedCompetitorScores(clientId: string, runIds?: string[]): Promise<Array<{
    id: string;
    name: string;
    competitorId: string | null;
    isClient: boolean;
    visibilityScore: number;
    sentimentScore: number;
    positionScore: number;
    overallScore: number;
  }>>;
  deleteCompetitorScore(id: string): Promise<void>;
  
  // Prompt-level Benchmarks
  getPromptBenchmarks(promptRunId: string, promptId: string, clientId: string): Promise<{
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
  }>;
  
  // Bulk Prompt Benchmarks - single query for all prompts in a run
  getBulkPromptBenchmarks(promptRunId: string, clientId: string): Promise<{
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
  }>;

  // Jobs
  getJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: string, updates: Partial<Job>): Promise<Job>;
  /**
   * Atomically claim a job for processing. Only succeeds if job is still queued and unowned.
   * Returns the claimed job if successful, or null if the job was already claimed by another worker.
   */
  claimJob(id: string, workerId: string): Promise<Job | null>;

  // Aggregation
  getClientAggregatedScores(clientId: string): Promise<{
    avgVisibilityScore: number;
    avgSentimentScore: number;
    avgPositionScore: number;
    totalCitations: number;
    totalAnswers: number;
  }>;
  
  getHistoricalScores(clientId: string, options?: { limit?: number; runIds?: string[] }): Promise<Array<{
    runId: string;
    runName: string;
    createdAt: Date;
    avgVisibilityScore: number;
    avgSentimentScore: number;
    avgPositionScore: number;
    totalCitations: number;
  }>>;

  // Opportunities - Citation Analysis
  getCitationAnalysis(clientId: string, promptRunId?: string | null): Promise<any[]>;
  getCitationsByDomain(clientId: string, domain: string, promptRunId?: string | null): Promise<any[]>;

  // Opportunities - Recommendations
  getRecommendations(clientId: string, promptRunId?: string | null): Promise<any>;
  getRecommendationsSummary(clientId: string, options: any): Promise<any>;
  createRecommendation(data: any): Promise<any>;
  saveRecommendations(clientId: string, promptRunId: string | null, recommendations: any[]): Promise<void>;

  // Opportunities - Content Generator
  getGeneratedContents(clientId: string, promptRunId?: string | null): Promise<any[]>;
  saveGeneratedContents(clientId: string, promptRunId: string | null, contents: any[]): Promise<void>;

  // Site X-Ray - Sites
  createXRaySite(site: InsertXRaySite): Promise<XRaySite>;
  getXRaySite(id: string): Promise<XRaySite | undefined>;
  getXRaySitesByClient(clientId: string): Promise<XRaySite[]>;
  resetHealthProbeData(siteId: string): Promise<void>;
  getXRaySitesWithMetrics(clientId: string): Promise<Array<{
    id: string;
    domain: string;
    siteType: string;
    avgScores: { content: number; seo: number; structure: number } | null;
    pageCount: number;
    totalIssues: number;
    totalRecommendations: number;
    robotsTxt: boolean;
    aiTxt: boolean;
    crawlStatus: string;
    healthProbeStatus?: 'pending' | 'completed' | 'failed' | null;
    lastProbedAt?: Date | null;
  }>>;
  updateXRaySite(id: string, updates: Partial<InsertXRaySite>): Promise<XRaySite>;

  /**
   * Task #64 — Returns the most recent `xray_analysis` job per site for the
   * given client, keyed by `siteId`. Used by the X-Ray UI to surface the
   * outcome (status / error / who started it) of the last analysis run on
   * each site card, regardless of which user kicked it off.
   */
  getLatestXRayJobsBySite(clientId: string): Promise<Map<string, {
    jobId: string;
    status: string;
    error: string | null;
    progress: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    startedByUserId: string | null;
  }>>;

  // Site X-Ray - Pages
  createXRayPage(page: InsertXRayPage): Promise<XRayPage>;
  getXRayPage(id: string): Promise<XRayPage | undefined>;
  getXRayPagesBySite(siteId: string): Promise<XRayPage[]>;
  getXRayPagesSummary(siteId: string): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    pageType: string | null;
    wordCount: number | null;
    scores: any;
    issueCount: number;
    recommendationCount: number;
  }>>;

  // Site X-Ray - Page Structure
  createPageStructure(structure: InsertXRayPageStructure): Promise<XRayPageStructure>;
  getPageStructure(pageId: string): Promise<XRayPageStructure | undefined>;

  // Site X-Ray - Page Analysis
  createPageAnalysis(analysis: InsertXRayPageAnalysis): Promise<XRayPageAnalysis>;
  getPageAnalysis(pageId: string): Promise<XRayPageAnalysis | undefined>;
  updatePageAnalysis(id: string, updates: Partial<InsertXRayPageAnalysis>): Promise<XRayPageAnalysis>;
  
  // Score Explainability
  createScoreFactors(factors: InsertScoreFactors): Promise<ScoreFactors>;
  getScoreFactorsByPromptRunItem(promptRunItemId: string): Promise<ScoreFactors[]>;
  getScoreColorBands(category: string): Promise<Array<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  }>>;
  getScoreInterpretation(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    interpretation: string;
  } | undefined>;
  getScoreColorBand(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  } | undefined>;

  // Client Copy - Deep clone to create independent project
  copyClient(sourceClientId: string, newProjectName?: string): Promise<{
    client: Client;
    copied: {
      competitors: number;
      topics: number;
      prompts: number;
      xraySites: number;
      xrayPages: number;
    };
  }>;

  // Client Copy with progress tracking via job
  copyClientWithProgress(sourceClientId: string, jobId: string, newProjectName?: string): Promise<{
    client: Client;
    copied: {
      competitors: number;
      topics: number;
      prompts: number;
      xraySites: number;
      xrayPages: number;
    };
  }>;

  // Phase 3: Run Checkpoints for job resumption
  getRunCheckpoint(promptRunId: string): Promise<{
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
  } | undefined>;
  createRunCheckpoint(checkpoint: {
    promptRunId: string;
    completedItemIds?: string[];
    currentStage?: string;
    promptCount: number;
    modelCount: number;
    competitorCount?: number;
    timeoutMs: number;
  }): Promise<{ id: string; promptRunId: string }>;
  updateRunCheckpoint(promptRunId: string, updates: {
    completedItemIds?: string[];
    currentStage?: string;
    competitorCount?: number;
  }): Promise<void>;
  deleteRunCheckpoint(promptRunId: string): Promise<void>;

  // Phase 3: Completion Gating - Validate run before marking complete
  validateRunCompletion(promptRunId: string): Promise<CompletionValidation>;

  // Phase 3B: Error Propagation - Aggregate item errors for run-level visibility
  aggregateRunErrors(promptRunId: string): Promise<RunErrorSummary>;

  // Phase 4: Structured Telemetry & Logging
  createPromptRunLog(log: {
    promptRunId: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    meta?: unknown;
  }): Promise<{ id: string }>;
  getPromptRunLogs(promptRunId: string, options?: {
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
  }>;

  // User sessions ledger (Task #37). The express-session store remains the
  // source of truth for cookie validity; this mirror exists so the
  // "active sessions" UI and admin audits can list a user's sessions.
  recordUserSession(opts: {
    sessionId: string;
    userId: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<void>;
  touchUserSession(sessionId: string): Promise<void>;
  deleteUserSession(sessionId: string): Promise<void>;
  deleteUserSessionsForUser(userId: string, exceptSessionId?: string): Promise<void>;
  listUserSessionsForUser(userId: string): Promise<UserSession[]>;
  getUserSession(sessionId: string): Promise<UserSession | undefined>;
  countActiveUserSessions(): Promise<number>;
  // Sweeps `user_sessions` rows whose underlying express-session row
  // is gone or expired (Task #42). Returns the number of rows removed.
  pruneOrphanUserSessions(): Promise<number>;

  // Task #59 — Mark prompt_runs stuck in non-terminal status older than the
  // given age as `error` with the supplied reason, and cascade the same
  // status / error to their `prompt_run_items`. Returns counts so the
  // boot-time sweep can log how many zombies it cleaned up. MemStorage
  // implementations return zeros.
  reapStalePromptRuns(
    olderThanMs: number,
    reason: string,
  ): Promise<{ runs: number; items: number }>;
}

// Phase 3: Completion validation result interface
export interface CompletionValidation {
  allItemsDone: boolean;
  itemsNotDone: number;
  expectedAnswers: number;
  actualAnswers: number;
  expectedCompetitorScores: number;
  actualCompetitorScores: number;
  isValid: boolean;
  errors: string[];
}

// Phase 3B: Error aggregation for run-level visibility
export interface ItemError {
  itemId: string;
  promptId: string;
  promptText: string;
  modelId: string;
  modelName: string;
  error: string;
}

export interface RunErrorSummary {
  totalItems: number;
  errorCount: number;
  errors: ItemError[];
  errorSummary: string;
}

export class MemStorage implements IStorage {
  private organizations: Map<string, Organization>;
  private clients: Map<string, Client>;
  private competitors: Map<string, Competitor>;
  private aiModels: Map<string, AiModel>;
  private clientModels: Map<string, string[]>; // clientId -> modelIds
  private topics: Map<string, Topic>;
  private prompts: Map<string, Prompt>;
  private promptRuns: Map<string, PromptRun>;
  private jobs: Map<string, Job>;
  // Task #144 — `${userId}:${clientId}` → last-opened timestamp.
  private projectOpens: Map<string, Date>;

  constructor() {
    this.organizations = new Map();
    this.clients = new Map();
    this.competitors = new Map();
    this.aiModels = new Map();
    this.clientModels = new Map();
    this.topics = new Map();
    this.prompts = new Map();
    this.promptRuns = new Map();
    this.jobs = new Map();
    this.projectOpens = new Map();

    // Seed default organization and AI models
    this.seedDefaultData();
  }

  private seedDefaultData() {
    // Default organization
    const defaultOrg: Organization = {
      id: "default-org",
      name: "Default Organization",
      createdAt: new Date(),
    };
    this.organizations.set(defaultOrg.id, defaultOrg);

    // Seed AI models
    const models: AiModel[] = [
      {
        id: randomUUID(),
        vendor: "OpenAI",
        model: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        maxTpm: 200000,
        maxRpm: 10000,
        costPer1kInput: "0.15",
        costPer1kOutput: "0.60",
        enabled: true,
      },
      {
        id: randomUUID(),
        vendor: "OpenAI", 
        model: "gpt-4.1",
        displayName: "GPT-4.1",
        maxTpm: 40000,
        maxRpm: 5000,
        costPer1kInput: "0.60",
        costPer1kOutput: "1.20",
        enabled: true,
      },
      {
        id: randomUUID(),
        vendor: "Anthropic",
        model: "claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5",
        maxTpm: 40000,
        maxRpm: 5000,
        costPer1kInput: "0.75",
        costPer1kOutput: "1.50",
        enabled: true,
      },
      {
        id: randomUUID(),
        vendor: "Google",
        model: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        maxTpm: 32000,
        maxRpm: 2000,
        costPer1kInput: "0.50",
        costPer1kOutput: "1.00",
        enabled: false,
      },
    ];

    models.forEach(model => this.aiModels.set(model.id, model));
  }

  // Organizations
  async getOrganization(id: string): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const organization: Organization = { ...org, id, createdAt: new Date() };
    this.organizations.set(id, organization);
    return organization;
  }

  // Clients
  async getClient(id: string): Promise<Client | undefined> {
    return this.clients.get(id);
  }

  async getClients(
    orgId: string,
    _viewer?: { userId: string; role: 'admin' | 'member' | 'viewer' },
  ): Promise<Client[]> {
    // MemStorage has no project_memberships; the viewer filter is a no-op
    // here. The DbStorage path enforces it.
    return Array.from(this.clients.values())
      .filter(client => client.orgId === orgId)
      .map(client => ({
        ...client,
        lastOpenedAt: _viewer
          ? this.projectOpens.get(`${_viewer.userId}:${client.id}`) ?? null
          : null,
      }));
  }

  async recordProjectOpen(userId: string, clientId: string): Promise<void> {
    this.projectOpens.set(`${userId}:${clientId}`, new Date());
  }

  async listProjectMembers(_clientId: string) {
    return [] as Array<{
      userId: string;
      email: string;
      displayName: string | null;
      role: 'admin' | 'member' | 'viewer';
      grantedAt: Date | null;
      grantedByUserId: string | null;
      grantedByEmail: string | null;
      isOwner: boolean;
    }>;
  }
  async addProjectMember(clientId: string, userId: string, grantedByUserId: string | null) {
    return {
      created: true,
      membership: {
        id: randomUUID(),
        clientId,
        userId,
        grantedByUserId,
        grantedAt: new Date(),
      } as ProjectMembership,
    };
  }
  async removeProjectMember(_clientId: string, _userId: string): Promise<boolean> {
    return false;
  }

  async createClient(client: CreateClient): Promise<Client> {
    const id = randomUUID();
    const { competitors, modelIds, ...clientData } = client;
    
    const newClient: Client = { 
      ...clientData,
      website: clientData.website || null,
      urls: clientData.urls || null,
      focusAreas: clientData.focusAreas || null,
      industry: clientData.industry || null,
      geography: clientData.geography || null,
      aliases: clientData.aliases || null,
      brandAliases: clientData.brandAliases || null,
      selectedAiModelIds: clientData.selectedAiModelIds || null,
      onboardingStatus: clientData.onboardingStatus || 'draft',
      isActive: clientData.isActive ?? true,
      id, 
      createdAt: new Date()
    };
    this.clients.set(id, newClient);

    // Create competitors if provided
    if (competitors) {
      for (const competitor of competitors) {
        await this.createCompetitor({ ...competitor, clientId: id });
      }
    }

    // Set client models if provided
    if (modelIds) {
      await this.updateClientModels(id, modelIds);
    }

    return newClient;
  }

  async updateClient(id: string, updates: Partial<InsertClient>): Promise<Client> {
    const client = this.clients.get(id);
    if (!client) {
      throw new Error(`Client ${id} not found`);
    }
    const updatedClient = { ...client, ...updates };
    this.clients.set(id, updatedClient);
    return updatedClient;
  }

  async deleteClient(id: string): Promise<void> {
    this.clients.delete(id);
    // Clean up related data
    Array.from(this.competitors.values())
      .filter(c => c.clientId === id)
      .forEach(c => this.competitors.delete(c.id));
    Array.from(this.topics.values())
      .filter(t => t.clientId === id)
      .forEach(t => this.topics.delete(t.id));
    Array.from(this.prompts.values())
      .filter(p => p.clientId === id)
      .forEach(p => this.prompts.delete(p.id));
    Array.from(this.promptRuns.values())
      .filter(r => r.clientId === id)
      .forEach(r => this.promptRuns.delete(r.id));
  }

  // Competitors
  async getCompetitors(clientId: string): Promise<Competitor[]> {
    return Array.from(this.competitors.values()).filter(comp => comp.clientId === clientId);
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    const id = randomUUID();
    const newCompetitor: Competitor = { 
      ...competitor, 
      id,
      website: competitor.website || null,
      aliases: competitor.aliases || null
    };
    this.competitors.set(id, newCompetitor);
    return newCompetitor;
  }

  async deleteCompetitor(id: string): Promise<void> {
    this.competitors.delete(id);
  }

  // AI Models
  async getAiModels(): Promise<AiModel[]> {
    return Array.from(this.aiModels.values()).filter((m) => m.enabled);
  }

  async getAllAiModels(): Promise<AiModel[]> {
    return Array.from(this.aiModels.values());
  }

  async getClientModels(clientId: string): Promise<AiModel[]> {
    const modelIds = this.clientModels.get(clientId) || [];
    return modelIds.map(id => this.aiModels.get(id)).filter(Boolean) as AiModel[];
  }

  async updateAiModelCategory(id: string, category: 'core' | 'additional'): Promise<AiModel | undefined> {
    const m = this.aiModels.get(id);
    if (!m) return undefined;
    const updated: AiModel = { ...m, category };
    this.aiModels.set(id, updated);
    return updated;
  }

  async updateAiModelInternalOnly(id: string, internalOnly: boolean): Promise<AiModel | undefined> {
    const m = this.aiModels.get(id);
    if (!m) return undefined;
    const updated: AiModel = { ...m, internalOnly };
    this.aiModels.set(id, updated);
    return updated;
  }

  async updateAiModelEnabled(
    id: string,
    enabled: boolean,
    actorUserId?: string | null,
    reason?: string | null,
  ): Promise<AiModel | undefined> {
    const m = this.aiModels.get(id);
    if (!m) return undefined;
    const updated: AiModel = {
      ...m,
      enabled,
      disabledAt: enabled ? null : new Date(),
      disabledByUserId: enabled ? null : (actorUserId ?? null),
      disabledReason: enabled ? null : (reason ?? null),
    };
    this.aiModels.set(id, updated);
    return updated;
  }

  // Task #79 — In-memory mode does not persist enough to cancel runs;
  // these are no-ops since the in-memory variant is only used by tests.
  async cancelInFlightForDisabledModel(): Promise<{ items: number; runs: number; jobs: number }> {
    return { items: 0, runs: 0, jobs: 0 };
  }

  async sweepDisabledModelFromClients(): Promise<string[]> {
    return [];
  }

  async dismissDisabledModelNotification(): Promise<void> {
    // no-op
  }

  async getAiModelAuditHistory(): Promise<Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    actorEmail: string | null;
    actorDisplayName: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }>> {
    return [];
  }

  // Task #77 — In-memory mode does not persist function overrides; the
  // resolver short-circuits to env-only under SESSION_STORE=memory anyway.
  async setLlmFunctionOverride(): Promise<void> {
    // no-op
  }

  async getLlmFunctionOverrideModelId(): Promise<string | null> {
    return null;
  }

  // Task #78 — In-memory mode does not persist vendor pause state.
  async getAiVendorStatuses(): Promise<Array<{
    vendor: string;
    paused: boolean;
    pausedAt: Date | null;
    pausedByUserId: string | null;
    pauseReason: string | null;
  }>> {
    return [];
  }

  async setAiVendorPause(): Promise<void> {
    // no-op
  }

  async getVendorLastSuccessAt(): Promise<Date | null> {
    return null;
  }

  async getVendorInFlightItemCount(): Promise<number> {
    return 0;
  }

  async getVendorLast24hErrorRate(): Promise<{
    totalCount: number;
    errorCount: number;
    errorRate: number;
  }> {
    return { totalCount: 0, errorCount: 0, errorRate: 0 };
  }

  async getRecentFailedJobs(): Promise<Job[]> {
    return [];
  }

  async getFailedJobCountsByType(): Promise<Array<{ type: string; count: number }>> {
    return [];
  }

  async countActivePromptRuns(): Promise<number> {
    return 0;
  }

  async cancelQueuedJob(): Promise<Job | null> {
    return null;
  }

  async getQueuedJobs(): Promise<Job[]> {
    return [];
  }

  async getRunningJobs(): Promise<Job[]> {
    return [];
  }

  async getAiModelUsage(_id: string): Promise<{ projectCount: number; inFlightItemCount: number; projectNames: string[] }> {
    return { projectCount: 0, inFlightItemCount: 0, projectNames: [] };
  }

  async updateClientModels(clientId: string, modelIds: string[]): Promise<void> {
    this.clientModels.set(clientId, modelIds);
  }

  // Topics
  async getTopics(clientId: string): Promise<Topic[]> {
    return Array.from(this.topics.values()).filter(topic => topic.clientId === clientId);
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const id = randomUUID();
    const newTopic: Topic = { 
      ...topic, 
      id, 
      createdAt: new Date(),
      accepted: topic.accepted ?? false,
      category: topic.category ?? null,
      keywords: topic.keywords ?? null
    };
    this.topics.set(id, newTopic);
    return newTopic;
  }

  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic> {
    const existing = this.topics.get(id);
    if (!existing) throw new Error("Topic not found");
    const updated: Topic = { ...existing, ...updates, category: updates.category ?? existing.category };
    this.topics.set(id, updated);
    return updated;
  }

  async deleteTopic(id: string): Promise<void> {
    this.topics.delete(id);
  }

  async deleteAIGeneratedTopics(clientId: string): Promise<number> {
    const topicsToDelete = Array.from(this.topics.values()).filter(
      topic => topic.clientId === clientId && (topic.source === 'crawl' || topic.source === 'ai')
    );
    topicsToDelete.forEach(topic => this.topics.delete(topic.id));
    return topicsToDelete.length;
  }

  // Prompts
  async getPrompts(clientId: string): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).filter(prompt => prompt.clientId === clientId);
  }

  async getPromptsByIds(clientId: string, ids: string[]): Promise<Prompt[]> {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return Array.from(this.prompts.values()).filter(
      (prompt) => prompt.clientId === clientId && idSet.has(prompt.id),
    );
  }

  async getPrompt(id: string): Promise<Prompt | undefined> {
    return this.prompts.get(id);
  }

  async createPrompt(prompt: InsertPrompt): Promise<Prompt> {
    const id = randomUUID();
    const newPrompt: Prompt = { 
      ...prompt, 
      id, 
      createdAt: new Date(),
      accepted: prompt.accepted ?? false
    };
    this.prompts.set(id, newPrompt);
    return newPrompt;
  }

  async updatePrompt(id: string, updates: Partial<InsertPrompt>): Promise<Prompt> {
    const existing = this.prompts.get(id);
    if (!existing) throw new Error("Prompt not found");
    const updated: Prompt = { ...existing, ...updates };
    this.prompts.set(id, updated);
    return updated;
  }

  async deletePrompt(id: string): Promise<void> {
    this.prompts.delete(id);
  }

  async deleteAIGeneratedPrompts(clientId: string): Promise<number> {
    const promptsToDelete = Array.from(this.prompts.values()).filter(
      prompt => prompt.clientId === clientId && (prompt.source === 'crawl' || prompt.source === 'ai')
    );
    promptsToDelete.forEach(prompt => this.prompts.delete(prompt.id));
    return promptsToDelete.length;
  }

  async getPromptCategories(): Promise<PromptCategory[]> {
    return [];
  }

  async replaceClientGeneratedMetadata(
    clientId: string,
    newTopics: InsertTopic[],
    newPrompts: InsertPrompt[]
  ): Promise<{ topicsCreated: number; promptsCreated: number }> {
    // Delete existing AI-generated metadata
    const topicsToDelete = Array.from(this.topics.values()).filter(
      topic => topic.clientId === clientId && (topic.source === 'crawl' || topic.source === 'ai')
    );
    topicsToDelete.forEach(topic => this.topics.delete(topic.id));
    
    const promptsToDelete = Array.from(this.prompts.values()).filter(
      prompt => prompt.clientId === clientId && (prompt.source === 'crawl' || prompt.source === 'ai')
    );
    promptsToDelete.forEach(prompt => this.prompts.delete(prompt.id));
    
    // Insert new topics
    let topicsCreated = 0;
    for (const topic of newTopics) {
      await this.createTopic(topic);
      topicsCreated++;
    }
    
    // Insert new prompts
    let promptsCreated = 0;
    for (const prompt of newPrompts) {
      await this.createPrompt(prompt);
      promptsCreated++;
    }
    
    return { topicsCreated, promptsCreated };
  }

  // Prompt Runs
  async getPromptRuns(clientId: string): Promise<PromptRun[]> {
    return Array.from(this.promptRuns.values()).filter(run => run.clientId === clientId);
  }

  async getPromptRun(id: string): Promise<PromptRun | undefined> {
    return this.promptRuns.get(id);
  }

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
    const filtered = (await this.getPromptRuns(clientId))
      .filter((r) => !opts.status || r.status === opts.status)
      .filter((r) => !opts.search?.trim() || r.name.toLowerCase().includes(opts.search.trim().toLowerCase()))
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    const page = filtered.slice(opts.offset, opts.offset + opts.limit);

    const runs = await Promise.all(page.map(async (run) => {
      const items = await this.getPromptRunItems(run.id);
      const models = new Set(items.map((i) => i.modelId));
      let vSum = 0, vN = 0, sSum = 0, sN = 0, pSum = 0, pN = 0;
      for (const item of items) {
        const answer = await this.getAnswerByPromptRunItem(item.id);
        if (!answer) continue;
        if (answer.visibilityScore != null) { vSum += Number(answer.visibilityScore); vN++; }
        if (answer.sentimentScore != null) { sSum += Number(answer.sentimentScore); sN++; }
        if (answer.positionScore != null) { pSum += Number(answer.positionScore); pN++; }
      }
      return {
        ...run,
        modelCount: models.size,
        avgVisibilityScore: vN ? vSum / vN : 0,
        avgSentimentScore: sN ? sSum / sN : 0,
        avgPositionScore: pN ? pSum / pN : 0,
      };
    }));
    return { runs, total: filtered.length };
  }

  async createPromptRun(run: InsertPromptRun): Promise<PromptRun> {
    const id = randomUUID();
    const newRun: PromptRun = { 
      ...run, 
      id, 
      createdAt: new Date(),
      status: run.status || 'queued',
      deliverablesStatus: run.deliverablesStatus || 'pending',
      deliverablesErrorSummary: run.deliverablesErrorSummary || null,
      deliverablesCompletedAt: run.deliverablesCompletedAt || null,
      searchConfig: run.searchConfig ?? null,
    };
    this.promptRuns.set(id, newRun);
    return newRun;
  }

  async updatePromptRun(id: string, updates: Partial<PromptRun>): Promise<PromptRun> {
    const run = this.promptRuns.get(id);
    if (!run) {
      throw new Error(`Prompt run ${id} not found`);
    }
    const updatedRun = { ...run, ...updates };
    this.promptRuns.set(id, updatedRun);
    return updatedRun;
  }

  async claimPromptRunDeliverables(id: string): Promise<boolean> {
    const run = this.promptRuns.get(id);
    if (!run || run.deliverablesStatus === "generating") {
      return false;
    }
    this.promptRuns.set(id, {
      ...run,
      deliverablesStatus: "generating",
      deliverablesErrorSummary: null,
      deliverablesCompletedAt: null,
    });
    return true;
  }

  // Jobs
  async getJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values());
  }

  async getJob(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  async createJob(job: InsertJob): Promise<Job> {
    const id = randomUUID();
    const newJob: Job = { 
      ...job, 
      id, 
      createdAt: new Date(),
      status: job.status || 'queued',
      progress: job.progress || 0,
      startedAt: null,
      finishedAt: null,
      error: null
    };
    this.jobs.set(id, newJob);
    return newJob;
  }

  async updateJob(id: string, updates: Partial<Job>): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    const updatedJob = { ...job, ...updates };
    this.jobs.set(id, updatedJob);
    return updatedJob;
  }

  async claimJob(id: string, workerId: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued' || job.workerId) {
      return null;
    }
    const claimedJob: Job = {
      ...job,
      status: 'running',
      workerId,
      startedAt: new Date(),
      lastHeartbeat: new Date(),
    };
    this.jobs.set(id, claimedJob);
    return claimedJob;
  }

  async deletePromptRun(id: string): Promise<void> {
    this.promptRuns.delete(id);
  }

  async getPromptRunItems(promptRunId: string): Promise<PromptRunItem[]> {
    throw new Error("PromptRunItems not supported in MemStorage");
  }

  async createPromptRunItem(item: Omit<PromptRunItem, 'id'>): Promise<PromptRunItem> {
    throw new Error("PromptRunItems not supported in MemStorage");
  }

  async updatePromptRunItem(id: string, updates: Partial<PromptRunItem>): Promise<PromptRunItem> {
    throw new Error("PromptRunItems not supported in MemStorage");
  }

  async createAnswer(answer: Omit<Answer, 'id'>): Promise<Answer> {
    throw new Error("Answers not supported in MemStorage");
  }

  async updateAnswer(id: string, updates: Partial<Answer>): Promise<Answer> {
    throw new Error("Answers not supported in MemStorage");
  }

  async getAnswerByPromptRunItem(promptRunItemId: string): Promise<Answer | undefined> {
    throw new Error("Answers not supported in MemStorage");
  }

  async createCitation(citation: Omit<Citation, 'id'>): Promise<Citation> {
    throw new Error("Citations not supported in MemStorage");
  }

  async getCitationsByAnswer(answerId: string): Promise<Citation[]> {
    throw new Error("Citations not supported in MemStorage");
  }

  async createMention(mention: Omit<Mention, 'id'>): Promise<Mention> {
    throw new Error("Mentions not supported in MemStorage");
  }

  async getMentionsByAnswer(answerId: string): Promise<Mention[]> {
    throw new Error("Mentions not supported in MemStorage");
  }

  async createRanking(ranking: Omit<Ranking, 'id'>): Promise<Ranking> {
    throw new Error("Rankings not supported in MemStorage");
  }

  async getRankingsByAnswer(answerId: string): Promise<Ranking[]> {
    throw new Error("Rankings not supported in MemStorage");
  }

  async getClientAggregatedScores(clientId: string): Promise<{
    avgVisibilityScore: number;
    avgSentimentScore: number;
    avgPositionScore: number;
    totalCitations: number;
    totalAnswers: number;
  }> {
    return {
      avgVisibilityScore: 0,
      avgSentimentScore: 0,
      avgPositionScore: 0,
      totalCitations: 0,
      totalAnswers: 0
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
    return [];
  }

  async createCompetitorScore(score: Omit<CompetitorScore, 'id' | 'createdAt'>): Promise<CompetitorScore> {
    throw new Error("Competitor scores not supported in MemStorage");
  }

  async getCompetitorScoresByRun(promptRunId: string): Promise<CompetitorScore[]> {
    throw new Error("Competitor scores not supported in MemStorage");
  }

  async getLatestCompetitorScores(clientId: string): Promise<CompetitorScore[]> {
    throw new Error("Competitor scores not supported in MemStorage");
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
    throw new Error("Competitor scores not supported in MemStorage");
  }

  async deleteCompetitorScore(id: string): Promise<void> {
    throw new Error("Competitor scores not supported in MemStorage");
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
    throw new Error("Prompt benchmarks not supported in MemStorage");
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
    throw new Error("Bulk prompt benchmarks not supported in MemStorage");
  }

  async getCitationAnalysis(clientId: string, promptRunId?: string | null): Promise<any[]> {
    throw new Error("Citation analysis not supported in MemStorage");
  }

  async getCitationsByDomain(clientId: string, domain: string, promptRunId?: string | null): Promise<any[]> {
    throw new Error("Citations by domain not supported in MemStorage");
  }

  async getRecommendations(clientId: string, promptRunId?: string | null): Promise<any> {
    throw new Error("Recommendations not supported in MemStorage");
  }

  async getRecommendationsSummary(clientId: string, options: any): Promise<any> {
    throw new Error("Recommendations summary not supported in MemStorage");
  }

  async createRecommendation(data: any): Promise<any> {
    throw new Error("Create recommendation not supported in MemStorage");
  }

  async saveRecommendations(clientId: string, promptRunId: string | null, recommendations: any[]): Promise<void> {
    throw new Error("Recommendations not supported in MemStorage");
  }

  async getGeneratedContents(clientId: string, promptRunId?: string | null): Promise<any[]> {
    throw new Error("Generated content not supported in MemStorage");
  }

  async saveGeneratedContents(clientId: string, promptRunId: string | null, contents: any[]): Promise<void> {
    throw new Error("Generated content not supported in MemStorage");
  }

  async getAiModel(id: string): Promise<AiModel | undefined> {
    return this.aiModels.get(id);
  }

  // Site X-Ray - Sites
  async createXRaySite(site: InsertXRaySite): Promise<XRaySite> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getXRaySite(id: string): Promise<XRaySite | undefined> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getXRaySitesByClient(clientId: string): Promise<XRaySite[]> {
    throw new Error("Site X-Ray not supported in MemStorage");
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
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async updateXRaySite(id: string, updates: Partial<InsertXRaySite>): Promise<XRaySite> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async resetHealthProbeData(siteId: string): Promise<void> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getLatestXRayJobsBySite(): Promise<Map<string, {
    jobId: string;
    status: string;
    error: string | null;
    progress: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    startedByUserId: string | null;
  }>> {
    return new Map();
  }

  // Site X-Ray - Pages
  async createXRayPage(page: InsertXRayPage): Promise<XRayPage> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getXRayPage(id: string): Promise<XRayPage | undefined> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getXRayPagesBySite(siteId: string): Promise<XRayPage[]> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getXRayPagesSummary(siteId: string): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    pageType: string | null;
    wordCount: number | null;
    scores: any;
  }>> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  // Site X-Ray - Page Structure
  async createPageStructure(structure: InsertXRayPageStructure): Promise<XRayPageStructure> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getPageStructure(pageId: string): Promise<XRayPageStructure | undefined> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  // Site X-Ray - Page Analysis
  async createPageAnalysis(analysis: InsertXRayPageAnalysis): Promise<XRayPageAnalysis> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async getPageAnalysis(pageId: string): Promise<XRayPageAnalysis | undefined> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }

  async updatePageAnalysis(id: string, updates: Partial<InsertXRayPageAnalysis>): Promise<XRayPageAnalysis> {
    throw new Error("Site X-Ray not supported in MemStorage");
  }
  
  // Score Explainability
  async createScoreFactors(factors: InsertScoreFactors): Promise<ScoreFactors> {
    throw new Error("Score Explainability requires database storage");
  }
  
  async getScoreFactorsByPromptRunItem(promptRunItemId: string): Promise<ScoreFactors[]> {
    throw new Error("Score Explainability requires database storage");
  }

  async getScoreColorBands(category: string): Promise<Array<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  }>> {
    throw new Error("Score Explainability requires database storage");
  }

  async getScoreInterpretation(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    interpretation: string;
  } | undefined> {
    throw new Error("Score Explainability requires database storage");
  }

  async getScoreColorBand(category: string, score: number): Promise<{
    category: string;
    minScore: number;
    maxScore: number;
    color: string;
  } | undefined> {
    throw new Error("Score Explainability requires database storage");
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
    throw new Error("Client copy requires database storage");
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
    throw new Error("Client copy requires database storage");
  }

  // Phase 3: Run Checkpoints (no-op for MemStorage as it's only for DB-backed runs)
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
    return undefined; // No checkpoint support in memory storage
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
    // No-op for memory storage
    return { id: randomUUID(), promptRunId: checkpoint.promptRunId };
  }

  async updateRunCheckpoint(promptRunId: string, updates: {
    completedItemIds?: string[];
    currentStage?: string;
    competitorCount?: number;
  }): Promise<void> {
    // No-op for memory storage
  }

  async deleteRunCheckpoint(promptRunId: string): Promise<void> {
    // No-op for memory storage
  }

  // Phase 3: Completion Gating - Always valid for memory storage
  async validateRunCompletion(promptRunId: string): Promise<CompletionValidation> {
    return {
      allItemsDone: true,
      itemsNotDone: 0,
      expectedAnswers: 0,
      actualAnswers: 0,
      expectedCompetitorScores: 0,
      actualCompetitorScores: 0,
      isValid: true,
      errors: []
    };
  }

  // Phase 3B: Error Propagation - No errors in memory storage
  async aggregateRunErrors(promptRunId: string): Promise<RunErrorSummary> {
    return {
      totalItems: 0,
      errorCount: 0,
      errors: [],
      errorSummary: ''
    };
  }

  // Phase 4: Structured Telemetry & Logging - No-op for MemStorage
  async createPromptRunLog(log: {
    promptRunId: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    meta?: unknown;
  }): Promise<{ id: string }> {
    return { id: randomUUID() };
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
    return { logs: [], nextCursor: null };
  }

  // Task #56 — Active operations sources. MemStorage is unit-test only;
  // tests don't drive multi-user activity, so an empty source set is fine.
  async listActiveActivitySources(): Promise<ActivityActiveSources> {
    return { jobs: [], promptRuns: [], reports: [] };
  }
  async getUsersByIds(): Promise<Array<{ id: string; displayName: string | null; email: string }>> {
    return [];
  }

  // User sessions ledger — MemStorage is only used for unit-test
  // fixtures, so a no-op/empty implementation is sufficient.
  async recordUserSession(): Promise<void> { /* noop */ }
  async touchUserSession(): Promise<void> { /* noop */ }
  async deleteUserSession(): Promise<void> { /* noop */ }
  async deleteUserSessionsForUser(): Promise<void> { /* noop */ }
  async listUserSessionsForUser(): Promise<UserSession[]> { return []; }
  async getUserSession(): Promise<UserSession | undefined> { return undefined; }
  async countActiveUserSessions(): Promise<number> { return 0; }
  async pruneOrphanUserSessions(): Promise<number> { return 0; }
  async reapStalePromptRuns(): Promise<{ runs: number; items: number }> {
    return { runs: 0, items: 0 };
  }
}

import { DbStorage } from './db-storage';

export const storage = new DbStorage();
