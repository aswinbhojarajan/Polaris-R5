import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, pgEnum, jsonb, numeric, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { SearchConfig, SearchEvidence } from "./native-web-search";

// Enums
export const sourceEnum = pgEnum('source_enum', ['crawl', 'manual', 'csv', 'ai']);
export const statusEnum = pgEnum('status_enum', ['queued', 'running', 'scoring', 'queued_for_benchmarking', 'benchmarking', 'done', 'completed_with_errors', 'error', 'cancelled', 'paused']);
export const priorityEnum = pgEnum('priority_enum', ['low', 'normal', 'high']);
export const citationTypeEnum = pgEnum('citation_type_enum', ['hard', 'soft']);
export const sentimentEnum = pgEnum('sentiment_enum', ['positive', 'neutral', 'negative']);
export const uploadKindEnum = pgEnum('upload_kind_enum', ['csv_topics', 'csv_prompts']);
export const onboardingStatusEnum = pgEnum('onboarding_status_enum', ['draft', 'inprogress', 'completed']);
export const siteTypeEnum = pgEnum('site_type_enum', ['internal', 'third_party']);
export const crawlAccessStatusEnum = pgEnum('crawl_access_status_enum', ['ok', 'blocked', 'rate_limited', 'captcha']);
export const effortEnum = pgEnum('effort_enum', ['S', 'M', 'L']);
export const scoreCategoryEnum = pgEnum('score_category_enum', ['Position', 'Sentiment', 'Visibility']);
export const recommendationSourceEnum = pgEnum('recommendation_source_enum', ['crawl', 'prompt_response', 'citation', 'ai_analysis', 'manual']);
export const reportStatusEnum = pgEnum('report_status_enum', ['generating', 'ready', 'failed']);
export const reportSectionNameEnum = pgEnum('report_section_name_enum', [
  'executive_summary',
  'diagnostic_overview',
  'competitive_landscape',
  'visibility_performance',
  'critical_gaps',
  'pattern_analysis',
  'consulting_inference',
  'strategic_implications',
  'leadership_conversations',
  'business_impact',
  'action_plan_306090',
  'implementation_roadmap',
  'diagnostic_appendix'
]);
export const reportFileTypeEnum = pgEnum('report_file_type_enum', ['pdf', 'json', 'csv_zip', 'insights_pdf', 'appendix_pdf']);
export const reportJobStatusEnum = pgEnum('report_job_status_enum', ['queued', 'aggregating', 'analyzing', 'rendering', 'completed', 'failed']);
export const healthProbeStatusEnum = pgEnum('health_probe_status_enum', ['pending', 'completed', 'failed']);
export const aiModelCategoryEnum = pgEnum('ai_model_category_enum', ['core', 'additional']);
export const userRoleEnum = pgEnum('user_role_enum', ['admin', 'member', 'viewer']);
export const userStatusEnum = pgEnum('user_status_enum', ['invited', 'active', 'disabled']);
export const credentialGrantKindEnum = pgEnum('credential_grant_kind_enum', [
  'invitation',
  'password_reset',
  'magic_link',
  'temp_password',
]);
// Task #89 — Intent tier for the new realism-aware Prompt Library generator.
// Orthogonal to the 7-category topical taxonomy: tier classifies *who* the
// prompt is asked by / how branded it is; category classifies *what* it's
// about. Existing rows keep `intent_tier = NULL` and render with an em-dash
// in the UI.
export const promptIntentTierEnum = pgEnum('prompt_intent_tier', [
  'branded',
  'semi_branded',
  'unbranded',
]);

// Auth tables
// Session storage for connect-pg-simple. Columns/indexes match the schema
// connect-pg-simple expects (see node_modules/connect-pg-simple/table.sql).
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON ${table} ("expire")`,
}));

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  // Account lifecycle (Task #18). `invited` users have no usable password
  // until they redeem an invitation grant; `disabled` users are refused at
  // login with the same generic error as a bad password (anti-enumeration).
  status: userStatusEnum("status").default('active').notNull(),
  // When the password was last changed; used by reset/temp-password flows
  // and by future expiry policies. Null for legacy users.
  passwordChangedAt: timestamp("password_changed_at"),
  // Forces the change-password interstitial on next successful login.
  // Set when admins issue a reset / temp password.
  mustChangeOnNextLogin: boolean("must_change_on_next_login").default(false).notNull(),
  // When non-null and in the future, login is refused with a generic error.
  lockedUntil: timestamp("locked_until"),
  failedLoginCount: integer("failed_login_count").default(0).notNull(),
  // Monotonic counter bumped on password reset / admin sign-out-everywhere.
  // The session middleware compares the cookie's snapshot against this
  // value and rejects stale sessions, providing an instant kill switch.
  sessionEpoch: integer("session_epoch").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Unified credential-bearing grants (Task #18). Replaces ad-hoc invitation /
// password-reset flows with a single primitive: every grant has a
// sha256-hashed token, a kind-specific TTL, single-use semantics
// (`consumed_at`), and admin revocation. The token is shown ONCE in the
// admin UI's reveal modal — only the hash is stored.
export const credentialGrants = pgTable("credential_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: credentialGrantKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // Always populated. For password resets / temp passwords this is the
  // current owner's email; for invitations it is the invited address.
  email: text("email").notNull(),
  // Linked user (when known). Invitations to brand-new addresses leave
  // this null until redemption creates the user.
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  // Optional tenancy scope — invitations carry orgId (and optionally
  // clientId) so redemption can grant memberships atomically.
  orgId: varchar("org_id").references(() => organizations.id),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }),
  // For invitations only: the role to grant on org membership creation.
  role: userRoleEnum("role"),
  issuedByUserId: varchar("issued_by_user_id").references(() => users.id),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedIp: text("consumed_ip"),
  consumedUa: text("consumed_ua"),
  revokedAt: timestamp("revoked_at"),
  // Free-form metadata — e.g. temp_password issuer, reset reason, the
  // hashed temp password for `kind=temp_password`, etc.
  metadata: jsonb("metadata"),
});

// Per-user mirror of express-session rows (Task #37). The Postgres
// `session` table written by connect-pg-simple is opaque (its `sess` JSON
// is private to the store), so we keep this denormalized index for the
// "active sessions" UI and admin audits. The session-epoch kill switch is
// still the source of truth for revocation — pruning a row here only hides
// it from the UI.
//   - sessionId mirrors connect.sid (the express-session id, same value
//     stored as the cookie payload).
//   - cascading delete on user removal so account deletion cleans up.
export const userSessions = pgTable("user_sessions", {
  sessionId: text("session_id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

// Per-user password history. Used to prevent reuse of the last N
// passwords; `password_hash` is the full Argon2id hash.
export const passwordHistory = pgTable("password_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userOrgMemberships = pgTable("user_org_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  orgId: varchar("org_id").references(() => organizations.id).notNull(),
  role: userRoleEnum("role").default('member').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueMembership: sql`UNIQUE (${table.userId}, ${table.orgId})`,
}));

// Core tables
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id).notNull(),
  projectName: text("project_name").notNull(),
  name: text("name").notNull(),
  website: text("website"),
  urls: jsonb("urls"),
  focusAreas: jsonb("focus_areas"),
  industry: text("industry"),
  geography: text("geography"),
  customIndustry: text("custom_industry"),
  customGeography: text("custom_geography"),
  aliases: jsonb("aliases"),
  brandAliases: jsonb("brand_aliases"),
  selectedAiModelIds: jsonb("selected_ai_model_ids"),
  // Task #89 — Optional context fields used by the realism-aware Prompt
  // Library generator. All nullable; the generator degrades gracefully
  // when blank.
  targetCustomerPersona: text("target_customer_persona"),
  targetMarketCountry: text("target_market_country"),
  primaryTestLocation: text("primary_test_location"),
  primaryLanguage: text("primary_language"),
  // Task #79 — Pending one-time notifications shown on the project config
  // page when an admin disables a model that this project had selected.
  // Shape: Array<{ id: string; modelId: string; modelName: string; vendor: string; disabledAt: string }>.
  // Cleared from the array as the user dismisses each banner.
  disabledModelNotifications: jsonb("disabled_model_notifications"),
  onboardingStatus: onboardingStatusEnum("onboarding_status").default('draft'),
  isActive: boolean("is_active").default(true).notNull(),
  // The member who created the project. Set on insert; never overwritten by
  // user-facing CRUD. Admins can reassign via the admin module.
  ownerUserId: varchar("owner_user_id").references(() => users.id),
  // Audit metadata: who last touched the row and when. Nullable for legacy
  // rows / system writes.
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueProjectName: sql`UNIQUE (${table.orgId}, ${table.projectName})`,
}));

// Per-project access grants. Binary access (no per-project role); the user's
// org role still governs what they can *do* once they're inside.
export const projectMemberships = pgTable("project_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  grantedByUserId: varchar("granted_by_user_id").references(() => users.id),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
}, (table) => ({
  uniqueMembership: uniqueIndex("project_memberships_client_user_uniq").on(
    table.clientId,
    table.userId,
  ),
}));

// Task #144 — per-user "last opened" timestamps so the Project Catalog can
// default-sort by the projects the caller used most recently. Upserted on
// every project open; one row per (client, user).
export const projectOpens = pgTable("project_opens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  lastOpenedAt: timestamp("last_opened_at").defaultNow().notNull(),
}, (table) => ({
  uniqueOpen: uniqueIndex("project_opens_client_user_uniq").on(
    table.clientId,
    table.userId,
  ),
}));

// Append-only audit log of admin-module mutations.
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  name: text("name").notNull(),
  website: text("website"),
  aliases: jsonb("aliases"),
});

export const aiModels = pgTable("ai_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendor: text("vendor").notNull(),
  model: text("model").notNull(),
  displayName: text("display_name").notNull(),
  category: aiModelCategoryEnum("category").default('additional').notNull(),
  maxTpm: integer("max_tpm"),
  maxRpm: integer("max_rpm"),
  costPer1kInput: numeric("cost_per_1k_input", { precision: 10, scale: 4 }),
  costPer1kOutput: numeric("cost_per_1k_output", { precision: 10, scale: 4 }),
  enabled: boolean("enabled").default(true).notNull(),
  // Task #29 — Internal-only visibility gate for candidate validation.
  // When true, the model is hidden from the consumer catalog endpoint and
  // rejected in prompt-run submissions unless the requesting session
  // belongs to an admin. This lets an admin temporarily enable a candidate
  // for a recorded validation window without exposing it to normal users.
  internalOnly: boolean("internal_only").default(false).notNull(),
  // Task #79 — Disable-lifecycle attribution. Populated when an admin flips
  // `enabled` from true to false; cleared on re-enable. Lets the History
  // popover render "Disabled by Alice on 2026-05-12: rate-limited".
  disabledAt: timestamp("disabled_at"),
  disabledByUserId: varchar("disabled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  disabledReason: text("disabled_reason"),
});

// Task #78 — Vendor-level kill switch. One row per vendor (matches the
// `vendor` text on `ai_models`). When `paused = true`, the consumer-facing
// model list and the executor both treat that vendor as unavailable
// without touching per-model `enabled` flags, so un-pausing restores
// prior state. Designed to survive reboot.
export const aiVendorStatus = pgTable("ai_vendor_status", {
  vendor: text("vendor").primaryKey(),
  paused: boolean("paused").default(false).notNull(),
  pausedAt: timestamp("paused_at"),
  pausedByUserId: varchar("paused_by_user_id").references(() => users.id, { onDelete: "set null" }),
  pauseReason: text("pause_reason"),
});

// Task #77 — Per-function model overrides for the 14 internal LLM call sites.
// One row per function key (see `server/config/llm-functions.ts`
// `LLMFunctionConfig`). When a row exists and points at an enabled
// ai_model, the resolver uses that model in preference to the env var /
// default. Designed to allow a future `clientId` column for per-tenant
// overrides without a rewrite.
export const llmFunctionOverrides = pgTable("llm_function_overrides", {
  functionKey: text("function_key").primaryKey(),
  modelId: varchar("model_id")
    .references(() => aiModels.id, { onDelete: "cascade" })
    .notNull(),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const topics = pgTable("topics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  label: text("label").notNull(),
  category: text("category"),
  keywords: jsonb("keywords"),
  source: sourceEnum("source").notNull(),
  accepted: boolean("accepted").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promptCategories = pgTable("prompt_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const prompts = pgTable("prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  text: text("text").notNull(),
  source: sourceEnum("source").notNull(),
  categoryId: varchar("category_id").references(() => promptCategories.id),
  accepted: boolean("accepted").default(false).notNull(),
  // Task #89 — Set by the realism-aware generator. Nullable so legacy rows
  // and manually-added prompts (where the user hasn't classified intent)
  // continue to work; UI renders an em-dash badge for null.
  intentTier: promptIntentTierEnum("intent_tier"),
  diagnosticFocus: text("diagnostic_focus"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const promptRuns = pgTable("prompt_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  name: text("name").notNull(),
  createdBy: varchar("created_by").notNull(),
  totalPrompts: integer("total_prompts").notNull(),
  status: statusEnum("status").default('queued').notNull(),
  errorSummary: text("error_summary"),
  deliverablesStatus: text("deliverables_status").default('pending').notNull(),
  deliverablesErrorSummary: text("deliverables_error_summary"),
  deliverablesCompletedAt: timestamp("deliverables_completed_at"),
  // Task #115 — Liveness heartbeat written by the executor every ~30s
  // during item processing. The periodic sweep (see
  // server/services/prompt-run-reaper.ts::startStalePromptRunSweep)
  // reaps any non-terminal run whose heartbeat is older than the
  // stale threshold, even when the workflow is healthy. Nullable
  // because legacy / very-fresh rows may not have one yet; the
  // reaper treats `heartbeat_at IS NULL` together with old createdAt
  // as stale.
  heartbeatAt: timestamp("heartbeat_at"),
  searchConfig: jsonb("search_config").$type<SearchConfig>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Run-list pagination sorts each client's runs newest-first on every poll;
  // this composite index keeps that from scanning/sorting the whole table.
  byClientCreated: index("idx_prompt_runs_client_id_created_at").on(t.clientId, t.createdAt.desc()),
}));

export const promptRunItems = pgTable("prompt_run_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id).notNull(),
  promptId: varchar("prompt_id").references(() => prompts.id).notNull(),
  modelId: varchar("model_id").references(() => aiModels.id).notNull(),
  status: statusEnum("status").default('queued').notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
}, (t) => ({
  byRun: index("idx_prompt_run_items_prompt_run_id").on(t.promptRunId),
}));

export const answers = pgTable("answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunItemId: varchar("prompt_run_item_id").references(() => promptRunItems.id).notNull(),
  rawResponse: text("raw_response").notNull(),
  visibilityScore: numeric("visibility_score", { precision: 5, scale: 2 }),
  firstMentionPos: integer("first_mention_pos"),
  sentimentScore: numeric("sentiment_score", { precision: 5, scale: 2 }),
  positionScore: numeric("position_score", { precision: 5, scale: 2 }),
  citationCount: integer("citation_count").default(0),
  // Task #105 (R2) — cached LLM summary so a retried report skips
  // re-summarizing answers that already have one.
  summary: text("summary"),
}, (t) => ({
  byItem: index("idx_answers_prompt_run_item_id").on(t.promptRunItemId),
}));

// One fenced execution owner per item. Native attribution is deliberately
// separate from analytical citations and from text passed to scorers.
export const promptRunItemExecutions = pgTable("prompt_run_item_executions", {
  itemId: varchar("item_id").primaryKey(),
  runId: varchar("run_id").notNull(),
  phase: text("phase").notNull().default("not_started"),
  answerText: text("answer_text"),
  evidence: jsonb("evidence").$type<SearchEvidence>(),
  canonicalAnswerId: varchar("canonical_answer_id"),
  claimToken: varchar("claim_token"),
  leaseUntil: timestamp("lease_until"),
  deadlineAt: timestamp("deadline_at"),
  ledger: jsonb("ledger").$type<{ attemptCount: number; continuationCount: number; searchBudgetReserved: number }>()
    .notNull().default({ attemptCount: 0, continuationCount: 0, searchBudgetReserved: 0 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byRun: index("idx_native_executions_run_id").on(t.runId),
  itemFk: foreignKey({ name: "prompt_run_item_executions_item_id_fkey",
    columns: [t.itemId], foreignColumns: [promptRunItems.id] }).onDelete("cascade"),
  runFk: foreignKey({ name: "prompt_run_item_executions_run_id_fkey",
    columns: [t.runId], foreignColumns: [promptRuns.id] }).onDelete("cascade"),
  answerFk: foreignKey({ name: "prompt_run_item_executions_canonical_answer_id_fkey",
    columns: [t.canonicalAnswerId], foreignColumns: [answers.id] }).onDelete("set null"),
  phaseCheck: check("prompt_run_item_executions_phase_check",
    sql`${t.phase} in ('not_started', 'generating', 'generated', 'scoring', 'scored', 'failed')`),
  answerCheck: check("prompt_run_item_executions_answer_text_check",
    sql`${t.answerText} is null or (length(${t.answerText}) >= 1 and length(${t.answerText}) <= 250000)`),
  evidenceCheck: check("prompt_run_item_executions_evidence_check",
    sql`${t.evidence} is null or octet_length(${t.evidence}::text) <= 262144`),
}));

// Conservatively retain pilot reservations even if a run is deleted; deleting
// a run must not replenish an approved paid-validation allowance.
export const nativeSearchValidationReservations = pgTable("native_search_validation_reservations", {
  approvalRef: varchar("approval_ref").notNull(),
  runId: varchar("run_id").notNull(),
  itemCount: integer("item_count").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  reservation: uniqueIndex("idx_native_validation_reservation").on(t.approvalRef, t.runId),
  itemCountCheck: check("native_search_validation_reservations_item_count_check", sql`${t.itemCount} > 0`),
}));

export const citations = pgTable("citations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  answerId: varchar("answer_id").references(() => answers.id).notNull(),
  url: text("url"),
  domain: text("domain"),
  displayText: text("display_text"),
  position: integer("position").notNull(),
  type: citationTypeEnum("type").notNull(),
  anchorText: text("anchor_text"),
  isSelfCitation: boolean("is_self_citation").default(false).notNull(),
}, (t) => ({
  byAnswer: index("idx_citations_answer_id").on(t.answerId),
}));

export const mentions = pgTable("mentions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  answerId: varchar("answer_id").references(() => answers.id).notNull(),
  span: text("span").notNull(),
  isAlias: boolean("is_alias").default(false).notNull(),
  sentiment: sentimentEnum("sentiment").notNull(),
}, (t) => ({
  byAnswer: index("idx_mentions_answer_id").on(t.answerId),
}));

export const rankings = pgTable("rankings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  answerId: varchar("answer_id").references(() => answers.id).notNull(),
  item: text("item").notNull(),
  position: integer("position").notNull(),
  isClientBrand: boolean("is_client_brand").default(false).notNull(),
  rankingGroup: text("ranking_group"),
  groupRelevance: text("group_relevance"),
  relevanceReason: text("relevance_reason"),
}, (t) => ({
  byAnswer: index("idx_rankings_answer_id").on(t.answerId),
}));

export const competitorScores = pgTable("competitor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id).notNull(),
  promptId: varchar("prompt_id").references(() => prompts.id),
  competitorId: varchar("competitor_id").references(() => competitors.id),
  competitorName: text("competitor_name").notNull(),
  isClient: boolean("is_client").default(false).notNull(),
  visibilityScore: numeric("visibility_score", { precision: 5, scale: 2 }),
  sentimentScore: numeric("sentiment_score", { precision: 5, scale: 2 }),
  positionScore: numeric("position_score", { precision: 5, scale: 2 }),
  overallScore: numeric("overall_score", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Durable, non-refundable release-pilot accounting. Deliberately independent
// of run/user deletion; managed Publish creates this table, never startup DDL.
export const nativeSearchPilotBudgets = pgTable("native_search_pilot_budgets", {
  approvalRef: varchar("approval_ref").primaryKey(),
  manifestHash: text("manifest_hash").notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => ({
  boundedState: check("native_search_pilot_budgets_state_check", sql`octet_length(${t.state}::text) <= 524288`),
}));

export const uploads = pgTable("uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  kind: uploadKindEnum("kind").notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  status: statusEnum("status").default('queued').notNull(),
  priority: priorityEnum("priority").default('low').notNull(),
  progress: integer("progress").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  error: text("error"),
  // Phase 4: Heartbeat and resume tracking
  lastHeartbeat: timestamp("last_heartbeat"),
  resumeCount: integer("resume_count").default(0),
  // Phase 1 (Race Condition Fix): Unique worker ID to prevent duplicate executors
  workerId: varchar("worker_id"),
  // Phase 1: Optional grace period before stale detection (in ms)
  heartbeatGraceMs: integer("heartbeat_grace_ms"),
  // Task #56: who triggered this background job (null for system/auto-recovered).
  // Used to attribute in-flight operations to a user in the multi-user
  // active-operations banner. References users.id with ON DELETE SET NULL so
  // deleting a user does not lose the running job.
  startedByUserId: varchar("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export const recommendations = pgTable("recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  examples: jsonb("examples"),
  actionItems: jsonb("action_items"),
  source: recommendationSourceEnum("source").default('ai_analysis').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const generatedContents = pgTable("generated_contents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id),
  sourceUrl: text("source_url"),
  sourceDomain: text("source_domain"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  targetKeywords: jsonb("target_keywords"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Site X-Ray tables
export const xraySites = pgTable("xray_sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  domain: text("domain").notNull(),
  siteType: siteTypeEnum("site_type").notNull(),
  robotsTxtPresent: boolean("robots_txt_present").default(false).notNull(),
  aiTxtPresent: boolean("ai_txt_present").default(false).notNull(),
  crawlAccessStatus: crawlAccessStatusEnum("crawl_access_status").default('ok').notNull(),
  robotsRules: jsonb("robots_rules"),
  aiTxtContent: text("ai_txt_content"),
  crawlEvidence: jsonb("crawl_evidence"),
  healthProbeStatus: healthProbeStatusEnum("health_probe_status").default('pending'),
  lastProbedAt: timestamp("last_probed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const xrayPages = pgTable("xray_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id").references(() => xraySites.id).notNull(),
  url: text("url").notNull(),
  title: text("title"),
  pageType: text("page_type"),
  statusCode: integer("status_code"),
  wordCount: integer("word_count").default(0),
  rawHtml: text("raw_html"),
  rawText: text("raw_text"),
  lastModified: timestamp("last_modified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const xrayPageStructure = pgTable("xray_page_structure", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").references(() => xrayPages.id).notNull(),
  headings: jsonb("headings"),
  paragraphs: jsonb("paragraphs"),
  lists: jsonb("lists"),
  tables: jsonb("tables"),
  entities: jsonb("entities"),
  focusAreas: jsonb("focus_areas"),
  topics: jsonb("topics"),
  sentimentScore: numeric("sentiment_score", { precision: 5, scale: 2 }),
  linkCounts: jsonb("link_counts"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const xrayPageAnalysis = pgTable("xray_page_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").references(() => xrayPages.id).notNull(),
  assessment: text("assessment"),
  gaps: jsonb("gaps"),
  recommendations: jsonb("recommendations"),
  actions: jsonb("actions"),
  seoIssues: jsonb("seo_issues"),
  freshnessData: jsonb("freshness_data"),
  consistencyData: jsonb("consistency_data"),
  complianceData: jsonb("compliance_data"),
  scores: jsonb("scores"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Score Explainability tables
export const scoreFactors = pgTable("score_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunItemId: varchar("prompt_run_item_id").references(() => promptRunItems.id).notNull(),
  category: scoreCategoryEnum("category").notNull(),
  score: numeric("score", { precision: 5, scale: 2 }).notNull(),
  // Position factors
  relevanceValue: numeric("relevance_value", { precision: 10, scale: 2 }),
  positionValue: numeric("position_value", { precision: 10, scale: 2 }),
  // Sentiment factors
  positiveMentions: integer("positive_mentions"),
  neutralMentions: integer("neutral_mentions"),
  negativeMentions: integer("negative_mentions"),
  // Visibility factors
  mentionsCount: integer("mentions_count"),
  headingHitsCount: integer("heading_hits_count"),
  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scoreInterpretations = pgTable("score_interpretations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: scoreCategoryEnum("category").notNull(),
  scoreMin: numeric("score_min", { precision: 5, scale: 2 }).notNull(),
  scoreMax: numeric("score_max", { precision: 5, scale: 2 }).notNull(),
  messageTemplate: text("message_template").notNull(),
});

export const scoreColorBands = pgTable("score_color_bands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: scoreCategoryEnum("category").notNull(),
  bandName: text("band_name").notNull(),
  colorHex: text("color_hex").notNull(),
  scoreMin: numeric("score_min", { precision: 5, scale: 2 }).notNull(),
  scoreMax: numeric("score_max", { precision: 5, scale: 2 }).notNull(),
});

// Executive Reporting Tables
export const reportSnapshots = pgTable("report_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  projectId: text("project_id").notNull(),
  runIds: jsonb("run_ids").notNull(),
  snapshotData: jsonb("snapshot_data").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  generatedBy: varchar("generated_by").notNull(),
  status: reportStatusEnum("status").default('generating').notNull(),
  narrativeGenerated: boolean("narrative_generated").default(false).notNull(),
  // Task #105 (R2) — cached LLM outputs so a re-attempt after a crash
  // can skip Steps 4 (narratives) and 5 (appendix) instead of paying
  // for the OpenAI calls again. Typed as `unknown` at the schema layer
  // (the consumer in report-job-processor narrows them to the concrete
  // GeneratedNarratives / GeneratedAppendix shapes).
  narratives: jsonb("narratives").$type<Record<string, unknown> | null>(),
  appendixContent: jsonb("appendix_content").$type<Record<string, unknown> | null>(),
});

export const reportSections = pgTable("report_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotId: varchar("snapshot_id").references(() => reportSnapshots.id).notNull(),
  sectionName: reportSectionNameEnum("section_name").notNull(),
  sectionContent: text("section_content").notNull(),
  sectionOrder: integer("section_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reportFiles = pgTable("report_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotId: varchar("snapshot_id").references(() => reportSnapshots.id).notNull(),
  fileType: reportFileTypeEnum("file_type").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reportJobs = pgTable("report_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotId: varchar("snapshot_id").references(() => reportSnapshots.id).notNull(),
  status: reportJobStatusEnum("status").default('queued').notNull(),
  progressPercent: integer("progress_percent").default(0).notNull(),
  progressMessage: text("progress_message"),
  currentStep: text("current_step"),
  modelUsed: text("model_used"),
  tokensUsed: integer("tokens_used"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  // Task #56: who triggered this report job (null for legacy/system rows).
  startedByUserId: varchar("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

// Phase 3: Run Checkpoints for job resumption after server restart
export const runCheckpoints = pgTable("run_checkpoints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id).notNull().unique(),
  completedItemIds: jsonb("completed_item_ids").notNull().default([]),
  currentStage: varchar("current_stage", { length: 50 }).notNull().default('execution'),
  promptCount: integer("prompt_count").notNull().default(0),
  modelCount: integer("model_count").notNull().default(0),
  competitorCount: integer("competitor_count").notNull().default(0),
  timeoutMs: integer("timeout_ms").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Phase 4: Structured Telemetry & Logging - Per-run log storage
export const logLevelEnum = pgEnum('log_level_enum', ['info', 'warn', 'error']);

export const promptRunLogs = pgTable("prompt_run_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptRunId: varchar("prompt_run_id").references(() => promptRuns.id).notNull(),
  level: logLevelEnum("level").notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// Relations
// Core CRM Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  clients: many(clients),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.orgId],
    references: [organizations.id],
  }),
  owner: one(users, {
    fields: [clients.ownerUserId],
    references: [users.id],
  }),
  updatedBy: one(users, {
    fields: [clients.updatedByUserId],
    references: [users.id],
  }),
  competitors: many(competitors),
  topics: many(topics),
  prompts: many(prompts),
  promptRuns: many(promptRuns),
  uploads: many(uploads),
  recommendations: many(recommendations),
  generatedContents: many(generatedContents),
  xraySites: many(xraySites),
  memberships: many(projectMemberships),
}));

export const projectMembershipsRelations = relations(projectMemberships, ({ one }) => ({
  client: one(clients, {
    fields: [projectMemberships.clientId],
    references: [clients.id],
  }),
  user: one(users, {
    fields: [projectMemberships.userId],
    references: [users.id],
  }),
  grantedBy: one(users, {
    fields: [projectMemberships.grantedByUserId],
    references: [users.id],
  }),
}));

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  client: one(clients, {
    fields: [competitors.clientId],
    references: [clients.id],
  }),
  competitorScores: many(competitorScores),
}));

// Prompt Execution Relations
export const topicsRelations = relations(topics, ({ one }) => ({
  client: one(clients, {
    fields: [topics.clientId],
    references: [clients.id],
  }),
}));

export const promptCategoriesRelations = relations(promptCategories, ({ many }) => ({
  prompts: many(prompts),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  client: one(clients, {
    fields: [prompts.clientId],
    references: [clients.id],
  }),
  category: one(promptCategories, {
    fields: [prompts.categoryId],
    references: [promptCategories.id],
  }),
  promptRunItems: many(promptRunItems),
  competitorScores: many(competitorScores),
}));

export const promptRunsRelations = relations(promptRuns, ({ one, many }) => ({
  client: one(clients, {
    fields: [promptRuns.clientId],
    references: [clients.id],
  }),
  promptRunItems: many(promptRunItems),
  competitorScores: many(competitorScores),
  recommendations: many(recommendations),
  generatedContents: many(generatedContents),
}));

export const promptRunItemsRelations = relations(promptRunItems, ({ one, many }) => ({
  promptRun: one(promptRuns, {
    fields: [promptRunItems.promptRunId],
    references: [promptRuns.id],
  }),
  prompt: one(prompts, {
    fields: [promptRunItems.promptId],
    references: [prompts.id],
  }),
  aiModel: one(aiModels, {
    fields: [promptRunItems.modelId],
    references: [aiModels.id],
  }),
  answer: one(answers),
  scoreFactors: many(scoreFactors),
}));

export const aiModelsRelations = relations(aiModels, ({ many }) => ({
  promptRunItems: many(promptRunItems),
}));

export const answersRelations = relations(answers, ({ one, many }) => ({
  promptRunItem: one(promptRunItems, {
    fields: [answers.promptRunItemId],
    references: [promptRunItems.id],
  }),
  citations: many(citations),
  mentions: many(mentions),
  rankings: many(rankings),
}));

export const citationsRelations = relations(citations, ({ one }) => ({
  answer: one(answers, {
    fields: [citations.answerId],
    references: [answers.id],
  }),
}));

export const mentionsRelations = relations(mentions, ({ one }) => ({
  answer: one(answers, {
    fields: [mentions.answerId],
    references: [answers.id],
  }),
}));

export const rankingsRelations = relations(rankings, ({ one }) => ({
  answer: one(answers, {
    fields: [rankings.answerId],
    references: [answers.id],
  }),
}));

export const competitorScoresRelations = relations(competitorScores, ({ one }) => ({
  promptRun: one(promptRuns, {
    fields: [competitorScores.promptRunId],
    references: [promptRuns.id],
  }),
  prompt: one(prompts, {
    fields: [competitorScores.promptId],
    references: [prompts.id],
  }),
  competitor: one(competitors, {
    fields: [competitorScores.competitorId],
    references: [competitors.id],
  }),
}));

// Content Generation Relations
export const uploadsRelations = relations(uploads, ({ one }) => ({
  client: one(clients, {
    fields: [uploads.clientId],
    references: [clients.id],
  }),
}));

export const recommendationsRelations = relations(recommendations, ({ one }) => ({
  client: one(clients, {
    fields: [recommendations.clientId],
    references: [clients.id],
  }),
  promptRun: one(promptRuns, {
    fields: [recommendations.promptRunId],
    references: [promptRuns.id],
  }),
}));

export const generatedContentsRelations = relations(generatedContents, ({ one }) => ({
  client: one(clients, {
    fields: [generatedContents.clientId],
    references: [clients.id],
  }),
  promptRun: one(promptRuns, {
    fields: [generatedContents.promptRunId],
    references: [promptRuns.id],
  }),
}));

// Site X-Ray Relations
export const xraySitesRelations = relations(xraySites, ({ one, many }) => ({
  client: one(clients, {
    fields: [xraySites.clientId],
    references: [clients.id],
  }),
  pages: many(xrayPages),
}));

export const xrayPagesRelations = relations(xrayPages, ({ one, many }) => ({
  site: one(xraySites, {
    fields: [xrayPages.siteId],
    references: [xraySites.id],
  }),
  structure: one(xrayPageStructure),
  analysis: one(xrayPageAnalysis),
}));

export const xrayPageStructureRelations = relations(xrayPageStructure, ({ one }) => ({
  page: one(xrayPages, {
    fields: [xrayPageStructure.pageId],
    references: [xrayPages.id],
  }),
}));

export const xrayPageAnalysisRelations = relations(xrayPageAnalysis, ({ one }) => ({
  page: one(xrayPages, {
    fields: [xrayPageAnalysis.pageId],
    references: [xrayPages.id],
  }),
}));

// Score Explainability Relations
export const scoreFactorsRelations = relations(scoreFactors, ({ one }) => ({
  promptRunItem: one(promptRunItems, {
    fields: [scoreFactors.promptRunItemId],
    references: [promptRunItems.id],
  }),
}));

// Insert schemas
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  updatedByUserId: true,
}).extend({
  projectName: z.string()
    .min(1, "Project name is required")
    .max(100, "Project name must be less than 100 characters")
    .trim()
    .transform(val => val.replace(/\s+/g, ' '))
    .refine(
      val => /^[a-zA-Z0-9\s\-_.,'&()]+$/.test(val),
      "Project name can only contain letters, numbers, spaces, and basic punctuation"
    ),
  name: z.string()
    .min(1, "Client name is required")
    .max(100, "Client name must be less than 100 characters")
    .trim(),
});
export const insertCompetitorSchema = createInsertSchema(competitors).omit({ id: true });
export const insertAiModelSchema = createInsertSchema(aiModels).omit({ id: true });
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true, createdAt: true });
export const insertPromptSchema = createInsertSchema(prompts).omit({ id: true, createdAt: true }).extend({
  categoryId: z.string().nullable().optional().transform((val) => {
    // Convert empty/whitespace strings to null, trim valid strings
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    return trimmed === '' ? null : trimmed;
  }),
});
export const insertPromptRunSchema = createInsertSchema(promptRuns).omit({ createdAt: true }).extend({
  id: z.string().optional()
});
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true, startedAt: true, finishedAt: true });
export const insertRecommendationSchema = createInsertSchema(recommendations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGeneratedContentSchema = createInsertSchema(generatedContents).omit({ id: true, createdAt: true });
export const insertXRaySiteSchema = createInsertSchema(xraySites).omit({ id: true, createdAt: true, updatedAt: true });
export const insertXRayPageSchema = createInsertSchema(xrayPages).omit({ id: true, createdAt: true, updatedAt: true });
export const insertXRayPageStructureSchema = createInsertSchema(xrayPageStructure).omit({ id: true, createdAt: true });
export const insertXRayPageAnalysisSchema = createInsertSchema(xrayPageAnalysis).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScoreFactorsSchema = createInsertSchema(scoreFactors).omit({ id: true, createdAt: true });
export const insertScoreInterpretationSchema = createInsertSchema(scoreInterpretations).omit({ id: true });
export const insertScoreColorBandSchema = createInsertSchema(scoreColorBands).omit({ id: true });
export const insertReportSnapshotSchema = createInsertSchema(reportSnapshots).omit({ id: true, generatedAt: true });
export const insertReportSectionSchema = createInsertSchema(reportSections).omit({ id: true, createdAt: true });
export const insertReportFileSchema = createInsertSchema(reportFiles).omit({ id: true, createdAt: true });
export const insertReportJobSchema = createInsertSchema(reportJobs).omit({ id: true, createdAt: true, completedAt: true });

// Types
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;

export type AiModel = typeof aiModels.$inferSelect;
export type InsertAiModel = z.infer<typeof insertAiModelSchema>;

export type Topic = typeof topics.$inferSelect;
export type InsertTopic = z.infer<typeof insertTopicSchema>;

export type Prompt = typeof prompts.$inferSelect;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;
export type PromptIntentTier = typeof promptIntentTierEnum.enumValues[number];

export type PromptCategory = typeof promptCategories.$inferSelect;

export type PromptRun = typeof promptRuns.$inferSelect;
export type InsertPromptRun = z.infer<typeof insertPromptRunSchema>;

export type PromptRunItem = typeof promptRunItems.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type Mention = typeof mentions.$inferSelect;
export type Ranking = typeof rankings.$inferSelect;
export type CompetitorScore = typeof competitorScores.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type GeneratedContent = typeof generatedContents.$inferSelect;
export type InsertGeneratedContent = z.infer<typeof insertGeneratedContentSchema>;
export type XRaySite = typeof xraySites.$inferSelect;
export type InsertXRaySite = z.infer<typeof insertXRaySiteSchema>;
export type XRayPage = typeof xrayPages.$inferSelect;
export type InsertXRayPage = z.infer<typeof insertXRayPageSchema>;
export type XRayPageStructure = typeof xrayPageStructure.$inferSelect;
export type InsertXRayPageStructure = z.infer<typeof insertXRayPageStructureSchema>;
export type XRayPageAnalysis = typeof xrayPageAnalysis.$inferSelect;
export type InsertXRayPageAnalysis = z.infer<typeof insertXRayPageAnalysisSchema>;
export type ScoreFactors = typeof scoreFactors.$inferSelect;
export type InsertScoreFactors = z.infer<typeof insertScoreFactorsSchema>;
export type ScoreInterpretation = typeof scoreInterpretations.$inferSelect;
export type InsertScoreInterpretation = z.infer<typeof insertScoreInterpretationSchema>;
export type ScoreColorBand = typeof scoreColorBands.$inferSelect;
export type InsertScoreColorBand = z.infer<typeof insertScoreColorBandSchema>;
export type ReportSnapshot = typeof reportSnapshots.$inferSelect;
export type InsertReportSnapshot = z.infer<typeof insertReportSnapshotSchema>;
export type ReportSection = typeof reportSections.$inferSelect;
export type InsertReportSection = z.infer<typeof insertReportSectionSchema>;
export type ReportFile = typeof reportFiles.$inferSelect;
export type InsertReportFile = z.infer<typeof insertReportFileSchema>;
export type ReportJob = typeof reportJobs.$inferSelect;
export type InsertReportJob = z.infer<typeof insertReportJobSchema>;

export type RunCheckpoint = typeof runCheckpoints.$inferSelect;
export const insertRunCheckpointSchema = createInsertSchema(runCheckpoints).omit({ id: true, createdAt: true, lastUpdated: true });
export type InsertRunCheckpoint = z.infer<typeof insertRunCheckpointSchema>;

// Phase 4: Prompt Run Logs
export type PromptRunLog = typeof promptRunLogs.$inferSelect;
export const insertPromptRunLogSchema = createInsertSchema(promptRunLogs).omit({ id: true, timestamp: true });
export type InsertPromptRunLog = z.infer<typeof insertPromptRunLogSchema>;

// Task #56 — Active-operations DTO. Both the per-project list endpoint
// (`GET /api/v1/clients/:clientId/activity`) and the catalog summary
// endpoint (`GET /api/v1/clients/activity-summary`) return arrays of these.
// Kept as a zod schema (not a table) because activities are derived live
// from `jobs`, `prompt_runs`, and `report_jobs`.
export const activityKindSchema = z.enum([
  "metadata_generation",
  "site_xray",
  "prompt_run",
  "refresh_prompts",
  "project_copy",
  "report_generation",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityItemSchema = z.object({
  id: z.string(),
  kind: activityKindSchema,
  clientId: z.string(),
  status: z.enum(["queued", "running"]),
  progress: z.number().min(0).max(100).nullable(),
  label: z.string(),
  startedAt: z.string().nullable(),
  startedByUserId: z.string().nullable(),
  startedByDisplayName: z.string().nullable(),
  startedByEmail: z.string().nullable(),
  // For navigating into the relevant page (e.g. /app/dashboard?clientId=X&runId=Y).
  refId: z.string().nullable(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activitySummarySchema = z.object({
  clientId: z.string(),
  count: z.number().int().nonnegative(),
  kinds: z.array(activityKindSchema),
  // Task #56: full per-client item list so catalog tooltips can show
  // "{name} started {kind} {Xago}" without an extra fetch per card.
  items: z.array(activityItemSchema),
});
export type ActivitySummary = z.infer<typeof activitySummarySchema>;

// Extended validation schemas
export const createClientSchema = insertClientSchema.extend({
  competitors: z.array(insertCompetitorSchema.omit({ clientId: true })).optional(),
  modelIds: z.array(z.string()).optional(),
});

export type CreateClient = z.infer<typeof createClientSchema>;

// Auth: users + memberships
export type User = typeof users.$inferSelect;
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const registerUserSchema = z.object({
  email: z.string().email("A valid email is required"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  displayName: z.string().trim().min(1).max(100).optional(),
  orgId: z.string().optional(),
});
export type RegisterUserInput = z.infer<typeof registerUserSchema>;

export const loginSchema = z.object({
  email: z.string().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export type UserOrgMembership = typeof userOrgMemberships.$inferSelect;
export const insertUserOrgMembershipSchema = createInsertSchema(userOrgMemberships).omit({ id: true, createdAt: true });
export type InsertUserOrgMembership = z.infer<typeof insertUserOrgMembershipSchema>;

// Org-scoped invitation issuance payload (the credential grant is created
// and the raw token returned exactly once via the admin reveal modal).
export const createInvitationSchema = z.object({
  email: z.string().email("A valid email is required"),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  // Optional: pre-select projects to grant on accept (Task #26). Stored on
  // the grant's metadata.clientIds; the redeem handler reconciles
  // project_memberships from this list when the invitee accepts. IDs that
  // do not belong to the invitation's org at redeem time are silently
  // dropped.
  clientIds: z.array(z.string().min(1)).optional(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

// Project-scoped invitation. Org-admin role is intentionally NOT allowed
// here — only org admins may mint other org admins, and project-scoped
// invitations are callable by project owners (who are not necessarily org
// admins). Granted org membership uses this constrained role.
export const createProjectInvitationSchema = z.object({
  email: z.string().email("A valid email is required"),
  role: z.enum(['member', 'viewer']).default('member'),
});
export type CreateProjectInvitationInput = z.infer<typeof createProjectInvitationSchema>;

// Project memberships
export type ProjectMembership = typeof projectMemberships.$inferSelect;
export const insertProjectMembershipSchema = createInsertSchema(projectMemberships).omit({
  id: true,
  grantedAt: true,
});
export type InsertProjectMembership = z.infer<typeof insertProjectMembershipSchema>;

export const grantProjectMemberSchema = z.object({
  email: z.string().email("A valid email is required"),
});
export type GrantProjectMemberInput = z.infer<typeof grantProjectMemberSchema>;

export const acceptInvitationSchema = z.object({
  password: z.string().min(12, "Password must be at least 12 characters"),
  displayName: z.string().trim().min(1).max(100).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const updateMembershipSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const updateClientAdminSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  projectName: z.string().trim().min(1).max(100).optional(),
  ownerUserId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateClientAdminInput = z.infer<typeof updateClientAdminSchema>;

export type AuditLogEntry = typeof auditLog.$inferSelect;

// Credential grants (Task #18)
export type CredentialGrant = typeof credentialGrants.$inferSelect;
export const insertCredentialGrantSchema = createInsertSchema(credentialGrants).omit({
  id: true,
  issuedAt: true,
  consumedAt: true,
  consumedIp: true,
  consumedUa: true,
  revokedAt: true,
});
export type InsertCredentialGrant = z.infer<typeof insertCredentialGrantSchema>;
export type CredentialGrantKind = CredentialGrant["kind"];
export type UserStatus = (typeof users.$inferSelect)["status"];

export type PasswordHistoryEntry = typeof passwordHistory.$inferSelect;

// User sessions (Task #37). Per-user mirror of express-session rows.
export type UserSession = typeof userSessions.$inferSelect;
export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  createdAt: true,
  lastSeenAt: true,
});
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;

// Shared password-policy validator. Used by both the server (on every
// password write — register, redeem, change-password) and the client (live
// feedback on the reset / change forms). Keeping it in one place ensures
// the two surfaces cannot drift.
//
// Policy:
//   - >= 12 chars (or >= 16 to qualify as a passphrase exemption)
//   - At least three of: lowercase, uppercase, digit, symbol — UNLESS the
//     password is >= 16 chars (passphrase exemption)
//   - Not equal (case-insensitive) to email or display name
//   - Not in the small built-in common-password blocklist
export const COMMON_PASSWORDS = new Set<string>([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "changeme",
  "changeme123",
  "iloveyou",
  "monkey",
  "dragon",
  "abc123",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
]);

export interface PasswordPolicyContext {
  email?: string | null;
  displayName?: string | null;
}

export function validatePasswordPolicy(
  password: string,
  ctx: PasswordPolicyContext = {},
): { ok: true } | { ok: false; reason: string } {
  if (typeof password !== "string") {
    return { ok: false, reason: "Password is required" };
  }
  if (password.length < 12) {
    return { ok: false, reason: "Password must be at least 12 characters" };
  }
  if (password.length < 16) {
    let classes = 0;
    if (/[a-z]/.test(password)) classes++;
    if (/[A-Z]/.test(password)) classes++;
    if (/[0-9]/.test(password)) classes++;
    if (/[^A-Za-z0-9]/.test(password)) classes++;
    if (classes < 3) {
      return {
        ok: false,
        reason:
          "Use at least 3 of: lowercase, uppercase, number, symbol (or use a passphrase of 16+ characters)",
      };
    }
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, reason: "That password is too common — pick something unique" };
  }
  if (ctx.email && lower === ctx.email.toLowerCase()) {
    return { ok: false, reason: "Password must not equal your email" };
  }
  if (ctx.displayName && lower === ctx.displayName.toLowerCase()) {
    return { ok: false, reason: "Password must not equal your display name" };
  }
  return { ok: true };
}

export const passwordPolicySchema = (ctx: PasswordPolicyContext = {}) =>
  z.string().superRefine((v, c) => {
    const r = validatePasswordPolicy(v, ctx);
    if (!r.ok) c.addIssue({ code: z.ZodIssueCode.custom, message: r.reason });
  });

// Public + admin payload schemas
export const forgotPasswordSchema = z.object({
  email: z.string().email("A valid email is required"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const redeemGrantSchema = z.object({
  password: z.string().min(1),
  displayName: z.string().trim().min(1).max(100).optional(),
});
export type RedeemGrantInput = z.infer<typeof redeemGrantSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const adminUserActionSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type AdminUserActionInput = z.infer<typeof adminUserActionSchema>;

// Auth: relations
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(userOrgMemberships),
}));

export const userOrgMembershipsRelations = relations(userOrgMemberships, ({ one }) => ({
  user: one(users, {
    fields: [userOrgMemberships.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [userOrgMemberships.orgId],
    references: [organizations.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(users, {
    fields: [auditLog.actorUserId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [auditLog.orgId],
    references: [organizations.id],
  }),
}));

// Export IStorage interface from storage
export type { IStorage } from "../server/storage";
