# 08 — Database and Data Model

All schema definitions live in `shared/schema.ts`. Postgres provided by Neon; access via Drizzle ORM (`drizzle-orm/neon-serverless`) configured in `server/db.ts`. Do **not** edit `drizzle.config.ts`.

> **Delta vs the original pack**:
> - Task #2 added two tables (`users`, `user_org_memberships`) and one enum (`user_role_enum`).
> - Task #7 added two tables (`invitations`, `audit_log`) and one column (`clients.ownerUserId` → `users.id`).

Schema is pushed (not migrated) via `npm run db:push`.

## Enums (`pgEnum`)

| Enum | Values | Purpose |
|------|--------|---------|
| `source_enum` | `crawl`, `manual`, `csv`, `ai` | Where a topic/prompt came from. |
| `status_enum` | `queued`, `running`, `scoring`, `queued_for_benchmarking`, `benchmarking`, `done`, `completed_with_errors`, `error`, `cancelled` | 4-stage prompt-run lifecycle + outcomes. |
| `priority_enum` | `low`, `normal`, `high` | Job priority. |
| `citation_type_enum` | `hard`, `soft` | Cited URL vs soft reference. |
| `sentiment_enum` | `positive`, `neutral`, `negative` | Mention sentiment. |
| `upload_kind_enum` | `csv_topics`, `csv_prompts` | Upload type. |
| `onboarding_status_enum` | `draft`, `inprogress`, `completed` | Client onboarding state. |
| `site_type_enum` | `internal`, `third_party` | X-Ray site classification. |
| `crawl_access_status_enum` | `ok`, `blocked`, `rate_limited`, `captcha` | Crawl gateway result. |
| `effort_enum` | `S`, `M`, `L` | Recommendation effort. (Defined; usage TBD.) |
| `score_category_enum` | `Position`, `Sentiment`, `Visibility` | Used for `score_factors`, `score_interpretations`, `score_color_bands`. |
| `recommendation_source_enum` | `crawl`, `prompt_response`, `citation`, `ai_analysis`, `manual` | Recommendation provenance. |
| `report_status_enum` | `generating`, `ready`, `failed` | Report snapshot state. |
| `report_section_name_enum` | (12 section keys + extras; see `shared/schema.ts:20`) | Section identifiers for narratives. |
| `report_file_type_enum` | `pdf`, `json`, `csv_zip`, `insights_pdf`, `appendix_pdf` | Output file type. |
| `report_job_status_enum` | `queued`, `aggregating`, `analyzing`, `rendering`, `completed`, `failed` | Report job lifecycle. |
| `health_probe_status_enum` | `pending`, `completed`, `failed` | X-Ray health probe lifecycle. |
| `ai_model_category_enum` | `core`, `additional` | AI model grouping. |
| `log_level_enum` | `info`, `warn`, `error` | `prompt_run_logs.level`. |
| `user_role_enum` | `admin`, `member`, `viewer` | `user_org_memberships.role`. (Added by Task #2; defaults to `member`. The legacy `owner` value was merged into `admin` in May 2026.) |

## Tables

> Conventions: every table uses `varchar` UUID PK with `default(sql\`gen_random_uuid()\`)`. JSONB columns are noted explicitly. Timestamps default to `now()`.

### Auth + RBAC (Tasks #2 + #7)

#### `users`
- `id` PK (UUID), `email` (text, **unique**, not null), `passwordHash` (text, not null — Node `scrypt` `${derivedHex}.${saltHex}`), `displayName` (text, nullable), `createdAt`.
- Insert schema: `insertUserSchema = createInsertSchema(users).omit({ id, createdAt })`.
- Validation: `registerUserSchema` (email + min-8 password + optional displayName + optional orgId), `loginSchema` (email + non-empty password). Used by `server/auth.ts` `/api/v1/auth/{login,register}` handlers.

#### `user_org_memberships`
- `id` PK, `userId → users.id` (not null), `orgId → organizations.id` (not null), `role` (`user_role_enum`, default `member`), `createdAt`.
- Constraint: `UNIQUE (userId, orgId)`.
- Drives per-tenant authorization (`server/auth.ts: getUserOrgIds`, `userHasOrgAccess`, `requireClientAccess`) and the Task #7 role checks (`getUserRoleInOrg`, `requireRole`).

#### `invitations` (Task #7)
- `id` PK, `orgId → organizations.id`, `email` (text), `role` (`user_role_enum`), `tokenHash` (text — sha256 of the single-use token; the raw token is only returned once on create), `createdByUserId → users.id`, `createdAt`, `expiresAt` (default `now() + 7 days`), `acceptedAt` (nullable), `revokedAt` (nullable).
- Atomic accept: `POST /api/v1/auth/invitations/:token/accept` performs a conditional `UPDATE … SET acceptedAt = now() WHERE tokenHash = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > now() RETURNING id`. Concurrent accepts lose the race and get `409`.

#### `audit_log` (Task #7)
- `id` PK, `orgId → organizations.id`, `actorUserId → users.id` (nullable for system actions), `action` (text — e.g. `member.role.update`, `invitation.create`, `client.owner.reassign`), `target` (text — opaque identifier of the affected entity), `metadata` (JSONB), `createdAt`.
- Append-only. Writes via `server/services/audit.ts: recordAudit(...)`. Read access is admin-only at `GET /api/v1/admin/orgs/:orgId/audit`.

### Core entities

#### `organizations`
- `id` PK, `name`, `createdAt`.

#### `clients`
- `id` PK, `orgId → organizations.id`, `projectName` (unique per org), `name`, `website`, `urls` (JSONB), `focusAreas` (JSONB), `industry`, `geography`, `customIndustry`, `customGeography`, `aliases` (JSONB), `brandAliases` (JSONB), `selectedAiModelIds` (JSONB), `onboardingStatus` (enum), `isActive`, `ownerUserId → users.id` (nullable, added by Task #7), `createdAt`.
- Unique constraint: `(orgId, projectName)`.
- Soft-delete: admins flip `isActive=false` via `PATCH /api/v1/admin/clients/:id`; hard delete (`DELETE /api/v1/clients/:id`) also requires `admin`.

#### `competitors`
- `id`, `clientId → clients.id`, `name`, `website`, `aliases` (JSONB).

#### `aiModels`
- `id`, `vendor`, `model`, `displayName`, `category` (enum), `maxTpm`, `maxRpm`, `costPer1kInput` (numeric 10,4), `costPer1kOutput` (numeric 10,4), `enabled`.

### Topics, prompts, runs

#### `topics`
- `id`, `clientId`, `label`, `category`, `keywords` (JSONB), `source` (enum), `accepted`, `createdAt`.

#### `promptCategories`
- `id`, `name`, `slug` (unique), `description`, `createdAt`.

#### `prompts`
- `id`, `clientId`, `text`, `source` (enum), `categoryId → promptCategories.id`, `accepted`, `createdAt`.

#### `promptRuns`
- `id`, `clientId`, `name`, `createdBy`, `totalPrompts`, `status` (enum), `errorSummary`, `createdAt`.

#### `promptRunItems`
- `id`, `promptRunId → promptRuns.id`, `promptId → prompts.id`, `modelId → aiModels.id`, `status` (enum), `startedAt`, `finishedAt`, `error`.

### Answers and extractions

#### `answers`
- `id`, `promptRunItemId → promptRunItems.id`, `rawResponse` (text), `visibilityScore` (numeric 5,2), `firstMentionPos` (int), `sentimentScore` (numeric 5,2), `positionScore` (numeric 5,2), `citationCount` (int default 0).

#### `citations`
- `id`, `answerId → answers.id`, `url`, `domain`, `displayText`, `position` (int), `type` (enum hard/soft), `anchorText`, `isSelfCitation`.

#### `mentions`
- `id`, `answerId`, `span` (text — surface form), `isAlias` (bool), `sentiment` (enum).

#### `rankings`
- `id`, `answerId`, `item` (text), `position` (int), `isClientBrand` (bool), `rankingGroup` (text — group name like "Premium Airlines"), `groupRelevance` (text — `relevant`/`partial`/`irrelevant`), `relevanceReason` (text).

#### `competitorScores`
- `id`, `promptRunId`, `promptId`, `competitorId` (nullable for emergent competitors), `competitorName`, `isClient` (bool), `visibilityScore`, `sentimentScore`, `positionScore`, `overallScore`, `createdAt`.

### Operational

#### `uploads`
- `id`, `clientId`, `kind` (enum), `filename`, `storagePath`, `processed`, `createdAt`.

#### `jobs`
- `id`, `type` (text), `payload` (JSONB), `status` (enum), `priority` (enum), `progress` (int 0-100), `createdAt`, `startedAt`, `finishedAt`, `error`, **Phase 4** `lastHeartbeat`, `resumeCount`, **Phase 1** `workerId`, `heartbeatGraceMs`.

### Recommendations / content

#### `recommendations`
- `id`, `clientId`, `promptRunId` (nullable), `title`, `description`, `severity`, `category`, `examples` (JSONB), `actionItems` (JSONB), `source` (enum), `createdAt`, `updatedAt`.

#### `generatedContents`
- `id`, `clientId`, `promptRunId` (nullable), `sourceUrl`, `sourceDomain`, `title`, `content`, `targetKeywords` (JSONB), `createdAt`.

### Site X-Ray

#### `xraySites`
- `id`, `clientId`, `domain`, `siteType` (enum), `robotsTxtPresent`, `aiTxtPresent`, `crawlAccessStatus` (enum), `robotsRules` (JSONB), `aiTxtContent` (text), `crawlEvidence` (JSONB), `healthProbeStatus` (enum), `lastProbedAt`, `createdAt`, `updatedAt`.

#### `xrayPages`
- `id`, `siteId`, `url`, `title`, `pageType`, `statusCode`, `wordCount`, `rawHtml`, `rawText`, `lastModified`, `createdAt`, `updatedAt`.

#### `xrayPageStructure`
- `id`, `pageId`, `headings` (JSONB), `paragraphs` (JSONB), `lists` (JSONB), `tables` (JSONB), `entities` (JSONB), `focusAreas` (JSONB), `topics` (JSONB), `sentimentScore` (numeric 5,2), `linkCounts` (JSONB), `createdAt`.

#### `xrayPageAnalysis`
- `id`, `pageId`, `assessment` (text), `gaps` (JSONB), `recommendations` (JSONB), `actions` (JSONB), `seoIssues` (JSONB), `freshnessData` (JSONB), `consistencyData` (JSONB), `complianceData` (JSONB), `scores` (JSONB), `createdAt`, `updatedAt`.

### Score explainability

#### `scoreFactors`
- `id`, `promptRunItemId → promptRunItems.id`, `category` (enum: Position/Sentiment/Visibility), `score` (numeric 5,2),
  - **Position factors**: `relevanceValue` (numeric 10,2), `positionValue` (numeric 10,2).
  - **Sentiment factors**: `positiveMentions` (int), `neutralMentions` (int), `negativeMentions` (int).
  - **Visibility factors**: `mentionsCount` (int), `headingHitsCount` (int).
- `createdAt`.

#### `scoreInterpretations`
- `id`, `category` (enum), `scoreMin`, `scoreMax`, `messageTemplate` (text).

#### `scoreColorBands`
- `id`, `category` (enum), `bandName`, `colorHex`, `scoreMin`, `scoreMax`.

### Reporting

#### `reportSnapshots`
- `id`, `clientId`, `projectId`, `runIds` (JSONB array of run IDs), `snapshotData` (JSONB — the materialized snapshot used for narrative generation), `generatedAt`, `generatedBy`, `status` (enum), `narrativeGenerated` (bool).

#### `reportSections`
- `id`, `snapshotId`, `sectionName` (enum, ~12 keys), `sectionContent` (text — markdown), `sectionOrder` (int), `createdAt`.

#### `reportFiles`
- `id`, `snapshotId`, `fileType` (enum: pdf/json/csv_zip/insights_pdf/appendix_pdf), `fileUrl`, `fileSize` (int), `createdAt`.

#### `reportJobs`
- `id`, `snapshotId`, `status` (enum: queued/aggregating/analyzing/rendering/completed/failed), `progressPercent`, `progressMessage`, `currentStep`, `modelUsed`, `tokensUsed`, `costUsd` (numeric 10,4), `errorMessage`, `createdAt`, `completedAt`.

### Restart safety / telemetry

#### `runCheckpoints`
- `id`, `promptRunId` (unique → `promptRuns.id`), `completedItemIds` (JSONB array), `currentStage` (varchar, e.g. `'execution'`, `'scoring'`), `promptCount`, `modelCount`, `competitorCount`, `timeoutMs`, `lastUpdated`, `createdAt`.

#### `promptRunLogs`
- `id`, `promptRunId`, `level` (enum), and additional fields (timestamp, message, context). Used by `run-logger.ts`.

## Drizzle relations (selected)

Defined in `shared/schema.ts` after the table block:
- `usersRelations`: many `userOrgMemberships`, many `invitations` (as creator), many `auditLog` entries (as actor). (Added by Tasks #2 + #7.)
- `userOrgMembershipsRelations`: one `users`, one `organizations`. (Added by Task #2.)
- `invitationsRelations`: one `organizations`, one `users` (creator). (Added by Task #7.)
- `auditLogRelations`: one `organizations`, one `users` (actor, nullable). (Added by Task #7.)
- `clientsRelations`: also one `users` (`ownerUserId`, nullable). (Added by Task #7.)
- `organizationsRelations`: many `clients`.
- `clientsRelations`: one `organization`; many `competitors`, `topics`, `prompts`, `promptRuns`, `recommendations`, `generatedContents`, `xraySites`.
- `competitorsRelations`: one `client`; many `competitorScores`.
- `topicsRelations`: one `client`.
- `promptCategoriesRelations`: many `prompts`.
- `promptsRelations`: one `client`, one `category`; many `promptRunItems`, `competitorScores`.
- `promptRunsRelations`: one `client`; many `promptRunItems`, `competitorScores`, `recommendations`, `generatedContents`, `runCheckpoints`, `promptRunLogs`.
- `promptRunItemsRelations`: one `promptRun`, one `prompt`, one `model`; one `answer`; many `scoreFactors`.
- `aiModelsRelations`: many `promptRunItems`.
- `answersRelations`: one `promptRunItem`; many `citations`, `mentions`, `rankings`.

## Insert schemas (drizzle-zod)

For every table, `shared/schema.ts` exports a `createInsertSchema(table).omit({ ... auto-generated ... })` and a `z.infer<typeof insertSchema>` type, and a `typeof table.$inferSelect` select type. These are imported across services and routes for input validation.

## Important data shapes (JSONB)

- `clients.urls`: array of strings (`["https://...", ...]`).
- `clients.focusAreas`: array of strings.
- `clients.aliases` / `brandAliases`: arrays of strings.
- `topics.keywords`: array of strings.
- `competitors.aliases`: array of strings.
- `recommendations.actionItems`: array of `{ title, description, ... }` (shape inferred from `recommendations-summary.ts`).
- `xrayPageStructure.headings`: array of `{ level, text }` (inferred).
- `xrayPageAnalysis.scores`: per-category numeric scores keyed by category (inferred).
- `reportSnapshots.snapshotData`: large `SnapshotData` object built by `report-snapshot.ts`.
- `reportSnapshots.runIds`: array of `promptRunId` strings.
- `runCheckpoints.completedItemIds`: array of `promptRunItemId` strings.

> Exact shapes for `recommendations.examples`, `xrayPageAnalysis.gaps`, `xrayPageAnalysis.actions`, and `reportSnapshots.snapshotData` are constructed in code rather than declared in Zod — see the originating service for the canonical shape (`content-recommendation-analyzer.ts`, `xray-content-analyzer.ts`, `report-snapshot.ts`).

## Indexes & constraints

- Unique `(orgId, projectName)` on `clients`.
- Unique `slug` on `promptCategories`.
- Unique `promptRunId` on `runCheckpoints`.
- Unique `email` on `users`.
- Unique `(userId, orgId)` on `userOrgMemberships`.
- Unique `tokenHash` on `invitations` (Task #7).
- Foreign keys as documented above (Drizzle `.references(...)`).

> No additional secondary indexes are declared in `shared/schema.ts`. **Gap**: high-cardinality query paths (e.g., `answers.promptRunItemId`, `mentions.answerId`, `citations.answerId`) likely benefit from indexes — Postgres will use FK indexes only if explicitly created.

## `user_sessions` (Task #37)
| Column | Type | Notes |
|---|---|---|
| `session_id` | `text` PK | Mirrors the express-session id (`polaris.sid` cookie value). |
| `user_id` | `varchar` FK → `users.id` ON DELETE CASCADE | Owner. |
| `user_agent` | `text` nullable | Truncated to 1024 chars. |
| `ip_address` | `text` nullable | From `req.ip`/`req.socket.remoteAddress`. |
| `created_at` | `timestamp` default `now()` | |
| `last_seen_at` | `timestamp` default `now()` | Updated at most once per minute per session. |

Migration: `migrations/0003_add_user_sessions.sql` (idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD CONSTRAINT IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). The session-epoch kill switch on `users` remains the source of truth for revocation; this table is the UI mirror.
