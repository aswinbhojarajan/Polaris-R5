# 04 — Capability Map

A map from product capability → backing files. Use this to find "where does feature X live?" without grepping.

> **Routing note (post-merge)**: `server/routes.ts` is now a 10-line shim. Per-domain handlers live under `server/routes/`: `clients.ts`, `onboarding.ts`, `jobs.ts`, `competitors.ts`, `ai-models.ts`, `topics.ts`, `prompts.ts`, `prompt-runs.ts`, `score-colors.ts`, `dashboard.ts`, `opportunities.ts`, `xray.ts`, `crawler.ts`, `reports.ts`, `openapi.ts`. Shared singletons (job queue, enrichment service) are in `_shared.ts`; tenancy helpers in `_helpers.ts`; orchestration in `index.ts`.

## Authentication, tenancy, RBAC (Tasks #2 + #7)

| Capability | Files |
|------------|-------|
| Session middleware + passport-local + scrypt | `server/auth.ts` (`setupAuth`, `hashPassword`, `verifyPassword`). |
| Auth routes (`/api/v1/auth/{me,login,register,logout}`) | `server/auth.ts`. `register` returns 403 unless `ALLOW_PUBLIC_REGISTRATION=true`. |
| Public invitation accept | `POST /api/v1/auth/invitations/:token/accept` in `server/routes/admin-users.ts` (atomic single-use claim). |
| Per-tenant authorization (membership lookup) | `server/auth.ts: getUserOrgIds`, `userHasOrgAccess`, `userHasClientAccess`, `requireClientAccess`. |
| Tenancy parameter extraction (`x-client-id` > `?clientId=` > `?client_id=`) | `server/routes/_helpers.ts: getClientId`, `requireClientId`, `getOrgId`. |
| Users / memberships / invitations / audit data | `users`, `user_org_memberships`, `invitations`, `audit_log` tables; `user_role_enum` (`shared/schema.ts`). |
| Default seed admin (`admin@polaris.local`) | `server/seed.ts`; overridable via `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`. Seeded as `admin` of `default-org`. |
| **RBAC privilege matrix (Task #7)** | `server/privileges.ts` (~40 entries; surfaced as `x-required-role` in OpenAPI). |
| **Per-route role enforcement** | `server/auth.ts: requireRole({minRole, scope})`. Roles: `viewer < member < admin`. (The legacy `owner` role was merged into `admin` in May 2026.) |
| **Global guard** (auth + tenant scope) | `requireAuth` + `requireTenantAccessIfPresent` mounted on `/api/v1` in `server/routes/index.ts` (skip-list for `/auth/*` and invitation accept). |
| **IDOR guards on ID-based GETs** | `assertClientAccess` / `assertOrgAccess` in `server/auth.ts`; called from clients/xray/prompt-runs handlers. |
| **Per-project owner** | `clients.ownerUserId` (FK `users.id`); reassign via `PATCH /api/v1/admin/clients/:id`. |
| **Audit logger** | `server/services/audit.ts: recordAudit(...)` → `audit_log` table; admin-only read at `GET /api/v1/admin/orgs/:orgId/audit`. |
| **Frontend role hook** | `client/src/hooks/use-role.ts` (`canWrite`, `canAdmin`); drives sidebar gating + per-action disable. |
| **Admin module API** | `server/routes/admin-users.ts` (members CRUD, invitations, audit), `server/routes/admin-projects.ts` (rename/owner/soft-delete). |
| **Admin module UI** | `client/src/pages/admin/users.tsx`, `client/src/pages/admin/projects.tsx`, `client/src/pages/invite-accept.tsx`. |
| **Test bypass** | `TEST_AUTH_BYPASS=true` honored only when `NODE_ENV=test` (used by `server/tests/routes-integration.test.ts`). RBAC suite (`server/tests/rbac.test.ts`) does NOT set it. |

## Onboarding & client management

| Capability | Files |
|------------|-------|
| Org / client CRUD | `server/routes/clients.ts`, `server/db-storage.ts` (`getClient`, `createClient`, `updateClient`, `deleteClient`). |
| Client copy | `POST /api/v1/clients/:id/copy` in `server/routes/clients.ts`. |
| Project-name uniqueness | `findClientByProjectName` in `db-storage.ts`; `GET /api/v1/clients/validate-project-name`. |
| URL enrichment | `OnboardingEnrichmentService.enrichUrls` (`server/services/onboarding-enrichment.ts`); routed in `server/routes/onboarding.ts`. |
| Profile enrichment (industry, geography, brand aliases) | `OnboardingEnrichmentService.enrichProfile`. |
| Competitor enrichment | `OnboardingEnrichmentService.enrichCompetitors`. |

## Crawling & metadata

| Capability | Files |
|------------|-------|
| Multi-page crawl with fallback | `server/services/website-crawler.ts` (Crawlee `CheerioCrawler` → `PlaywrightCrawler`). |
| Stealth crawl | `playwright-extra` + `puppeteer-extra-plugin-stealth`; helpers in `server/utils/chromium-path.ts`. |
| LLM-formatted crawl context | `formatCrawledContentForLLM` in `website-crawler.ts`. |
| Topics + keywords + prompts generation | `server/openai-service.ts: generateMetadataFromWebsite`, `generateAITopicsFromMetadata`, `generatePromptsFromTopics` (model: `gpt-4-turbo-preview`). |
| Manual metadata generation | `POST /api/v1/clients/:id/generate-metadata` → `JobQueue`. |
| Topics CRUD | `server/routes/topics.ts`, `db-storage.ts` (`getTopics`, etc.). |
| Prompts CRUD + categories | `server/routes/prompts.ts`, `db-storage.ts`. |
| Prompt classification | `server/services/prompt-classifier.ts`. |

## Prompt runs

| Capability | Files |
|------------|-------|
| Run launch / list / cancel / delete | `server/routes/prompt-runs.ts` (588 LoC). |
| Run orchestration | `server/services/prompt-run-executor.ts`. |
| Multi-vendor LLM execution | `server/services/ai-executor.ts` (OpenAI / Anthropic / Google / Perplexity). |
| Job queue, heartbeat, restart-safe resume | `server/services/job-queue.ts`. |
| Run checkpoints | `runCheckpoints` table; `server/services/prompt-run-executor.ts`. |
| Per-run logging | `server/services/run-logger.ts`; `prompt_run_logs` table. |
| Job timeouts | `server/services/job-timeout.ts` (`JOB_MAX_TIMEOUT_HOURS`). |

## Extraction

| Capability | Files |
|------------|-------|
| Citation extraction | `server/services/citation-extractor.ts` (markdown + bare URL + soft refs). |
| Mention detection (heuristic) | `server/services/mention-detector.ts` with `normalizeBrandToken` Unicode normalizer. |
| Mention detection (LLM) | `server/services/mentionExtractor.llm.ts`. |
| Ranking parsing (heuristic) | `server/services/ranking-parser.ts`. |
| Ranking extraction (LLM, group-aware) | `server/services/rankingExtractor.llm.ts`. |
| ABSA sentiment (LLM) | `server/services/sentimentAbsa.llm.ts`. |

## Scoring

| Capability | Files |
|------------|-------|
| Visibility V1 | `server/services/visibilityScorer.new.ts` (`calculateVisibilityAdvanced`). |
| Visibility V2 | `server/services/visibility-scoring-v2.ts` (`calculateVisibilityAdvancedV2`). |
| Visibility V1↔V2 router | `server/services/visibility-scoring.ts` + `server/config/visibility-weights.ts`. |
| Sentiment heuristic + LLM | `server/services/scoring.ts` (`calculateSentimentScoreAsync`). |
| Sentiment ABSA composer | `server/services/composer.ts: sentimentScoreFromABSA`. |
| Position heuristic | `server/services/scoring.ts: calculatePositionScoreHeuristic`. |
| Position nDCG | `server/services/composer.ts: positionScoreFromRankings`. |
| Position V2 (group-aware) | `server/services/composer.ts: calculatePositionScoreV2`. |
| Overall composition | `server/services/composer.ts: composeOverall` (weights from `AEO_CONFIG.composerWeights`). |
| Score explainability persistence | `server/services/score-explainability.ts` → `score_factors`. |
| Score colors / interpretations | `score_color_bands`, `score_interpretations` tables; `GET /api/v1/score-colors`. |
| Competitor scoring (mirrors client) | `server/services/competitor-scoring.ts`. |

## Site X-Ray

| Capability | Files |
|------------|-------|
| Crawl ingestion | `server/services/xray-ingestion.ts`. |
| Health probe (robots.txt, ai.txt, dual-UA) | `server/services/xray-health-probe.ts`. |
| Structure parsing (headings/lists/tables) | `server/services/xray-structure-parser.ts`. |
| Page-level AI analysis | `server/services/xray-content-analyzer.ts` (uses `gpt-4o-mini` via `buildOpenAIRequestParams`). |
| Entity extraction | `server/services/xray-entity-extractor.ts`. |
| Topic mapping | `server/services/xray-topic-mapper.ts`. |
| Batch analysis with retry | `POST /api/v1/xray/analyze/batch` enqueues an `xray_analysis` job processed by `processXRayAnalysis` in `server/services/job-queue.ts` (Task #58). |

## Recommendations & content

| Capability | Files |
|------------|-------|
| Recommendation generation | `server/services/content-recommendation-analyzer.ts` (`gpt-4o-mini`). |
| Recommendation summary (dedup, sources, filter, sort, paginate) | `server/services/recommendations-summary.ts`. |
| Manual recommendation create | `POST /api/v1/opportunities/recommendations`. |
| Content generation | `server/openai-service.ts` (referenced from `POST /api/v1/opportunities/content/generate`). |

## Reporting & exports

| Capability | Files |
|------------|-------|
| Report job orchestration | `server/services/report-job-processor.ts`. |
| Snapshot aggregation | `server/services/report-snapshot.ts` + `server/services/report-aggregator.ts`. |
| Two-pass narrative generation | `server/services/narrative-generator.ts` (uses `REPORTING_CONFIG.AI_MODEL`, default `gpt-5.1`). |
| PDF rendering | `server/services/pdf-template.ts` + `pdf-renderer.ts`. |
| CSV / JSON / ZIP exports | `csv-exporter.ts`, `json-exporter.ts`, `zip-exporter.ts`. |
| Download endpoints | `server/routes/reports.ts` (`/download/pdf`, `/download/appendix`, `/export`). |

## Cross-cutting concerns

| Capability | Files |
|------------|-------|
| LLM abstraction (provider-agnostic JSON-with-repair) | `server/llm/client.ts`, `openai.ts`, `anthropic.ts`. |
| OpenAI compat (`max_tokens` vs `max_completion_tokens`, GPT-5 reasoning) | `server/utils/openai-compat.ts`. |
| Storage interface | `server/storage.ts` (`IStorage`) + `server/db-storage.ts` (Drizzle impl). |
| Seed data | `server/seed.ts`. |
| Config | `server/config/aeo.ts`, `visibility-weights.ts`, `position-scoring.ts`, `reporting.ts`, `category-mapping.ts`. |
| Frontend query setup | `client/src/lib/queryClient.ts`. |
| Typed OpenAPI client (frontend) | `client/src/lib/api-client.ts` (`openapi-fetch` over `shared/api-types.ts`); generator script `scripts/generate-api-types.ts`. |
| OpenAPI spec (server) | `server/routes/openapi.ts: buildOpenApiDocument()` → `GET /openapi.json`; Swagger UI at `GET /api/docs`. |
| Graceful shutdown (SIGTERM/SIGINT, drain JobQueue, close DB pool) | `server/index.ts:96–164`; `server/services/job-queue.ts: stopAcceptingJobs`, `drain`, `getHealthStats`; `server/db.ts: pingDatabase`, `closePool`. Tunables: `SHUTDOWN_GRACE_MS` (25s), `SHUTDOWN_FORCE_MS` (35s). |
| Route integration tests (50 tests, supertest) | `server/tests/routes-integration.test.ts`. Run via `npx tsx --test server/tests/routes-integration.test.ts`. |

## Session management (Tasks #8, #37, #42)
- Persistent Postgres session store (Task #8) → `server/auth.ts: createSessionStore()` (`connect-pg-simple` over the Neon `pool`; `memorystore` fallback under `SESSION_STORE=memory` / `NODE_ENV=test`). `SESSION_SECRET` required in prod.
- CSRF double-submit → `server/middleware/csrf.ts`.
- Auth rate limits → `server/middleware/auth-rate-limit.ts`.
- Session ledger → `server/services/sessions.ts` + `user_sessions` table (`shared/schema.ts:126`).
- Idle/absolute timeout + epoch enforcement → `server/auth.ts: requireAuth` + `destroyAndReject`.
- Active sessions UI → `client/src/pages/account/sessions.tsx` (linked from `client/src/components/layout/top-navigation.tsx`).
- Active-sessions ↔ session-table consistency (Task #42) → `EXISTS` filter in `db-storage.ts: listUserSessionsForUser` / `countActiveUserSessions`; hourly `pruneOrphanUserSessions` scheduled in `server/auth.ts: setupAuth`.
- Active-sessions API → `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id`, `POST /api/v1/auth/sessions/sign-out-others` (registered in `server/auth.ts:1145+`, OpenAPI in `server/routes/openapi.ts:2251,2273,2281`).
- Cross-tab logout → `client/src/lib/auth.ts: BroadcastChannel("polaris-auth")` + listener installed in `client/src/App.tsx`.
- Security headers → `helmet` mount in `server/index.ts`.

## Project selection & deep-link nav (Tasks #52, #53)

| Capability | Files |
|------------|-------|
| Single source of truth for the selected `clientId` | `client/src/hooks/use-selected-client-id.ts` (`useSelectedClientId`, `useUrlClientId`, `setSelectedClientId`, `getSelectedClientIdSnapshot`). |
| URL→store sync on every navigation | `client/src/components/protected-route.tsx`. |
| URL-first read on every project-scoped page (`urlClientId \|\| storedClientId`) | `client/src/pages/{dashboard,prompts-tracker,client-configuration,site-xray,metadata-topics,metadata-prompts,citation-analysis,recommendations,content-generator,reports}.tsx`. |
| `?clientId=` propagated through every project-scoped sidebar `Link` | `client/src/components/layout/sidebar.tsx`. (Top-nav dropdown + client-catalog "Open" button still use `setLocation()` + `setSelectedClientId()` without a URL query — same-tab works, middle-click does not.) |
| "No Client Selected" empty state when neither URL nor store has a `clientId` | per-page guard. |
