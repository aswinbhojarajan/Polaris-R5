# 01 — Codebase Inventory

A walk of the repo as it exists today. Counts of TypeScript files in key directories are taken from `wc -l` over the actual files. Forbidden-to-edit files (`vite.config.ts`, `server/vite.ts`, `package.json`, `drizzle.config.ts`) are noted but not modified.

## Top-level layout

| Path | Role |
|------|------|
| `client/` | React + Vite frontend (TypeScript, Wouter, shadcn/ui, TailwindCSS). |
| `server/` | Express + TypeScript backend with Drizzle ORM and a custom job queue. |
| `shared/` | Zod + Drizzle schema shared between frontend and backend (`shared/schema.ts`). |
| `prd/` | This documentation pack. |
| `docs/` | Legacy / historical ad-hoc design notes (treat as context, not truth). |
| `scripts/` | Operational scripts (treat as context). |
| `attached_assets/` | User-attached assets (images, fixtures). |
| `.replit` | Replit run/build/deploy and userenv config. |
| `replit.md` | Project memory / agent context. |
| `package.json` | Dependencies and `dev`/`build`/`start`/`db:push` scripts. |
| `drizzle.config.ts` | Drizzle Kit config (do not edit). |
| `tailwind.config.ts` | Tailwind config. |
| `vite.config.ts`, `server/vite.ts` | Vite middleware (do not edit). |

## Frontend (`client/src`)

### Pages (`client/src/pages`)

| Route (Wouter) | File | Notes |
|----------------|------|-------|
| `/` | `landing.tsx` | Public landing page. |
| `/app` (redirect) | (in `App.tsx`) | Redirects to `/app/dashboard` if a client is selected, else `/app/clients`. |
| `/app/clients` | `client-catalog.tsx` | Multi-tenant client picker / create wizard. |
| `/app/dashboard` | `dashboard.tsx` | Client visibility dashboard (scores, charts, recent runs). |
| `/app/prompts` | `prompts-tracker.tsx` | Prompt run launcher + history. |
| `/app/client-config` | `client-configuration.tsx` | Client settings, models, competitors. |
| `/app/site-xray` | `site-xray.tsx` | Site X-Ray pages, structure, AI analysis. |
| `/app/topics-keywords` | `metadata-topics.tsx` | Topics/keywords manager. (Adjacent: `metadata-top-topics.tsx`.) |
| `/app/prompt-library` | `metadata-prompts.tsx` | Prompt library / category management. |
| `/app/citation-analysis` | `citation-analysis.tsx` | Citation results grouped by domain. |
| `/app/recommendations` | `recommendations.tsx` | Recommendations list (filter/sort/pagination, manual create). |
| `/app/content-generator` | `content-generator.tsx` | AI-generated content drafts. |
| `/app/reports` | `reports.tsx` | Executive PDF reports + downloads. |
| `/app/admin/users` | `pages/admin/users.tsx` | Members + invitations management (Task #7). Gated by `useRole().canAdmin`. |
| `/app/admin/projects` | `pages/admin/projects.tsx` | Per-project rename / owner reassign / soft-delete (Task #7). Gated by `useRole().canAdmin`. |
| `/login` | `login.tsx` | Email/password login form. |
| `/invite/:token` | `pages/invite-accept.tsx` | Public invitation accept page. |
| (fallback) | `not-found.tsx` | 404. |

> Page `metadata-top-topics.tsx` exists but is not registered in `client/src/App.tsx`. **Gap candidate** (see `22-validation-and-gap-report.md`).

### Components (`client/src/components`)

Selected high-signal components:

- `layout/` — App shell, sidebar, header.
- `protected-route.tsx` — Wraps routes that require a selected client.
- `client-selector.tsx`, `create-client-wizard.tsx` — Client/onboarding UX.
- `start-run-dialog.tsx` — Launches a prompt run.
- `run-details-drawer.tsx`, `run-details-section.tsx`, `RunFilterBar.tsx`, `OpportunityRunFilter.tsx` — Run detail / filtering UI.
- `rankings-accordion.tsx`, `recommendations-summary.tsx`, `category-dashboard-tiles.tsx` — Result rendering.
- `score-explainability-modal.tsx` — Renders persisted score-factor data.
- `benchmark-modal.tsx`, `ComparisonTable.tsx` — Per-prompt benchmarks vs competitors.
- `metadata-progress-overlay.tsx` — Progress UI for the metadata-generation job.
- `generate-report-dialog.tsx` — Trigger executive report job.
- `ui/` — shadcn/ui primitives.

### Hooks / lib

- `client/src/hooks/use-toast.ts` — re-exported via `@/hooks/use-toast`.
- `client/src/hooks/use-role.ts` — Task #7 RBAC hook; reads memberships from `/api/v1/auth/me` and exposes `{ role, orgId, isViewer, canWrite, canAdmin, atLeast }`. Drives sidebar gating and per-action disable state.
- `client/src/lib/auth.ts` — TanStack-Query-backed `useAuth/useLogin/useLogout/useRegister` (typed `AuthSession` with `memberships: { orgId, role }[]`).
- `client/src/lib/queryClient.ts` — TanStack Query setup; exposes `apiRequest` and the default fetcher.

### Styling

- `client/src/index.css` — Tailwind layers + design tokens (HSL CSS variables).
- `tailwind.config.ts` — shadcn-style theming with `darkMode: ["class"]`.

## Backend (`server/`)

### Entry / wiring

| File | Role |
|------|------|
| `server/index.ts` | Boots Express, runs `seedDatabase()`, wires Vite middleware in dev, `serveStatic` in prod. Listens on `PORT` (default 5000). |
| `server/vite.ts` | Vite/Express integration (do not edit). |
| `server/routes.ts` | **Now a 10-line re-export shim** — `export { registerRoutes, jobQueue } from "./routes/index"`. The original 2,925-LoC monolith was split during Task #3. |
| `server/routes/` | **17 per-domain route modules** + `index.ts` orchestrator + `_helpers.ts` (tenancy: `getClientId` / `requireClientId` / `getOrgId`) + `_shared.ts` (singletons: `jobQueue`, `enrichmentService`). Modules: `clients.ts`, `onboarding.ts`, `jobs.ts`, `competitors.ts`, `ai-models.ts`, `topics.ts`, `prompts.ts`, `prompt-runs.ts`, `score-colors.ts`, `dashboard.ts`, `opportunities.ts`, `xray.ts`, `crawler.ts`, `reports.ts`, `admin.ts` (`/health`, `/api/admin/queue`), `admin-users.ts` (Task #7 — members, invitations, audit), `admin-projects.ts` (Task #7 — rename/owner reassign/soft-delete), `openapi.ts`. |
| `server/auth.ts` | Auth + per-tenant authorization. `setupAuth(app)` wires session middleware (memorystore, 7-day cookie `polaris.sid`), passport-local + Node `scrypt`, and the `/api/v1/auth/{me,login,register,logout}` routes. Exposes `requireAuth`, `requireTenantAccessIfPresent` (global guards), `requireRole({minRole, scope})` (per-route, Task #7), `assertClientAccess`, `assertOrgAccess`, `requireClientAccess`, `userHasOrgAccess`, `getUserOrgIds`, `getUserRoleInOrg`. Honors `TEST_AUTH_BYPASS=true` only when `NODE_ENV=test`. |
| `server/privileges.ts` | Task #7 canonical privilege matrix: ~40 entries `{ method, pattern, bucket, minRole, scope }` covering every `/api/v1` route. Source for `requireRole` and the `x-required-role` OpenAPI extension. |
| `server/services/audit.ts` | Task #7 append-only audit logger (`recordAudit({ orgId, actorUserId, action, target, metadata })` → `audit_log` table). Called from admin module mutations. |
| `server/tests/rbac.test.ts` | Task #7 RBAC unit suite — 10 tests sweeping the privilege matrix (viewers blocked everywhere, owners pass everywhere, role ladder, bypass off). Run via `npx tsx --test server/tests/rbac.test.ts`. |
| `server/tests/routes-integration.test.ts` | 53 supertest-based integration tests. Sets `TEST_AUTH_BYPASS=true` so it can exercise routes without simulating logins. Run via `npx tsx --test server/tests/routes-integration.test.ts`. |
| `scripts/generate-api-types.ts` | Regenerates `shared/api-types.ts` from `/openapi.json` via `openapi-typescript` (added by Task #11). |
| `server/db.ts` | Neon serverless WebSocket pool + Drizzle ORM (`drizzle-orm/neon-serverless`). |
| `server/db-storage.ts` | Drizzle implementation of `IStorage`. |
| `server/storage.ts` | `IStorage` interface and types. |
| `server/seed.ts` | Default org + AI-model seed data. (Referenced from `index.ts`.) |
| `server/openai-service.ts` | Top-level OpenAI helpers used during onboarding/metadata: `generateMetadataFromWebsite`, `generateAITopicsFromMetadata`, `generatePromptsFromTopics`, content/recommendation flows. Uses `gpt-4-turbo-preview`. |

### LLM abstraction (`server/llm/`)

| File | Role |
|------|------|
| `client.ts` | `LLMClient` interface, `getClient(provider, model)`, JSON-with-repair helper, shared system prompt. |
| `openai.ts` | `OpenAIClient` (uses `openai` SDK + `utils/openai-compat.ts`). |
| `anthropic.ts` | `AnthropicClient` (uses `@anthropic-ai/sdk`). |

### Services (`server/services/`)

44 service files; grouped by responsibility:

**Run execution & queue**
- `job-queue.ts` (1,689 LoC) — Heart of background processing: heartbeat, restart-safe resume, MAX_CONCURRENT_JOBS=4, stale recovery.
- `prompt-run-executor.ts` (947 LoC) — Per-run orchestration: model fan-out, batch execution, scoring pipeline.
- `batch-executor.ts` — Concurrency-limited execution helper with rate-limit handling.
- `ai-executor.ts` — Per-vendor LLM execution (OpenAI / Anthropic / Google / Perplexity) with status-code tracking.
- `job-timeout.ts` — Per-job timeout calculation (`JOB_MAX_TIMEOUT_HOURS`).
- `run-logger.ts` — Per-run structured log writes to `prompt_run_logs`.
- `performance-logger.ts` — Latency/status logging.

**Scoring**
- `scoring.ts` (348 LoC) — `calculateSentimentScore*`, `calculatePositionScore*`, `calculateOverallScore`. Heuristic + LLM modes.
- `composer.ts` (193 LoC) — `positionScoreFromRankings` (nDCG), `sentimentScoreFromABSA`, `composeOverall`, `calculatePositionScoreV2`.
- `visibility-scoring.ts` (263 LoC) — Visibility V1 entrypoint with V1↔V2 routing.
- `visibility-scoring-v2.ts` (225 LoC) — Visibility V2 (normalized weights).
- `visibilityScorer.new.ts` (129 LoC) — V1 with shifted-sigmoid `visibilitySigmoid`.
- `score-explainability.ts` — Persists per-factor breakdowns into `score_factors`.
- `competitor-scoring.ts` (504 LoC) — Calculates and persists per-competitor scores using the same pipeline as the client.

**Extraction / classification**
- `mention-detector.ts` — Heuristic mention detection + Unicode normalization (`normalizeBrandToken`).
- `mentionExtractor.llm.ts` — LLM mention extraction.
- `sentimentAbsa.llm.ts` — ABSA sentiment + direct sentiment fallback.
- `rankingExtractor.llm.ts` — LLM ranking extraction (group-aware).
- `ranking-parser.ts` — Heuristic ranking parsing.
- `citation-extractor.ts` — Citation extraction (markdown links, bare URLs, soft refs).
- `prompt-classifier.ts` — Categorizes prompts into the 7-category taxonomy.
- `competitor-discovery.ts` — LLM competitor enrichment.

**Crawling & onboarding**
- `website-crawler.ts` (521 LoC) — Crawlee `CheerioCrawler` → `PlaywrightCrawler` fallback with stealth.
- `onboarding-enrichment.ts` — LLM URL/profile/competitor enrichment.

**Site X-Ray**
- `xray-ingestion.ts` — Stores crawl results into X-Ray tables.
- `xray-health-probe.ts` — robots.txt / ai.txt / dual-UA crawl access probe.
- `xray-structure-parser.ts` — Headings/lists/tables/links extraction.
- `xray-content-analyzer.ts` — GPT page-level assessment.
- `xray-entity-extractor.ts` — Entity extraction from crawled pages.
- `xray-topic-mapper.ts` — Topic mapping for X-Ray pages.

**Reporting & exports**
- `report-job-processor.ts` — Background dual-report PDF generation.
- `report-snapshot.ts` (1,405 LoC) — Snapshot aggregation across runs.
- `report-aggregator.ts` (1,010 LoC) — Aggregator → `ConsultingDataPacket` builder.
- `narrative-generator.ts` (2,639 LoC) — Two-pass GPT narrative across 12 sections.
- `pdf-template.ts`, `pdf-renderer.ts` — HTML→PDF rendering.
- `csv-exporter.ts`, `json-exporter.ts`, `zip-exporter.ts` — Data exports.
- `recommendations-summary.ts`, `content-recommendation-analyzer.ts`, `response-summarizer.ts` — Recommendation/content summarization.

### Config (`server/config/`)

| File | Role |
|------|------|
| `aeo.ts` | `AEO_CONFIG` (mode/provider/model/temperature/maxTokens/thresholds/composerWeights). |
| `visibility-weights.ts` | V1 vs V2 visibility weights + `getVisibilityWeights()`, `validateWeights()`. |
| `position-scoring.ts` | `POSITION_SCORING_VERSION` (`'v1'` | `'v2'`). |
| `reporting.ts` | `REPORTING_CONFIG` (`AI_MODEL`, `AI_TEMPERATURE`, `MAX_RETENTION`, `ENABLED`). |
| `category-mapping.ts` | Sub-category → `HighLevelCategory` map. |

### Utils (`server/utils/`)

| File | Role |
|------|------|
| `json.ts` | `extractJson` / `validateJson` for repair-friendly LLM JSON. |
| `text.ts` | Generic text helpers. |
| `openai-compat.ts` | `buildOpenAIRequestParams` — handles `max_tokens` vs `max_completion_tokens`, GPT-5 reasoning. |
| `chromium-path.ts` | Playwright-extra launch & stealth context options for Replit. |
| `industry-geography-helpers.ts` | Industry/geography lists used across UI/onboarding. |

### Types (`server/types/`)

- `aeo.ts` — `EntityMention`, `EntitySentiment`, `RankingItem`, `VisibilityDetails`, `BrandRecord`, `DocumentInput`.

### Schema (`shared/schema.ts`)

- ~870 lines (post-Task #7).
- 35 `pgTable` definitions (adds `invitations` and `audit_log` on top of Task #2's `users` / `user_org_memberships`); 20 `pgEnum`s; new column `clients.ownerUserId` (FK → `users.id`).
- Full Drizzle relations and Zod insert schemas.
- See `08-database-and-data-model.md` for the full inventory.

## Build / runtime

- `npm run dev` → `NODE_ENV=development tsx server/index.ts` (Vite middleware mounted by `server/vite.ts`).
- `npm run build` → `vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist`.
- `npm run start` → `NODE_ENV=production node dist/index.js`.
- `npm run db:push` → `drizzle-kit push` (schema sync, no migration files).
- `postinstall` → `playwright install chromium chromium-headless-shell` into `./playwright-browsers`.
- `.replit` workflow `Start application` runs `npm run dev`, waits for port `5000`.
- `.replit` `[deployment]` uses `deploymentTarget = "vm"`, `dist/public` as `publicDir`.

## Background jobs

- All async work runs through the in-process `JobQueue` in `server/services/job-queue.ts`.
- Job types include: prompt runs, metadata generation, X-Ray crawls, X-Ray health refresh, X-Ray batch analysis, content recommendation analysis, executive report generation.
- Restart-safe: `runCheckpoints` table stores per-stage progress; `jobs.lastHeartbeat` + `workerId` detect/recover stale jobs.

## Auth / session / RBAC

- Password authentication wired by Task #2; cookie session (`polaris.sid`) issued by `POST /api/v1/auth/login` (passport-local + Node `scrypt`). The frontend reads/writes `current-client-id` in `localStorage` and sends an `x-client-id` header.
- **RBAC (Task #7)**: three roles ordered `viewer < member < admin` (the legacy `owner` role was merged into `admin` in May 2026). Layered enforcement:
  1. **Global guard** mounted on `/api/v1` in `server/routes/index.ts`: `requireAuth` + `requireTenantAccessIfPresent` (skip-list: `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/register`, `/auth/invitations/:token/accept`).
  2. **Per-route role check**: every mutating handler declares `requireRole({minRole, scope})` from the canonical matrix in `server/privileges.ts`.
  3. **IDOR guards**: ID-based GET reads call `assertClientAccess` / `assertOrgAccess` (organizations, clients, xray sites/pages, prompt-run sub-reads).
- Per-project owner: `clients.ownerUserId` (FK → `users.id`); reassignable via `PATCH /api/v1/admin/clients/:id`.
- Public registration is gated: `POST /api/v1/auth/register` returns 403 unless `ALLOW_PUBLIC_REGISTRATION=true`. New users join via `POST /api/v1/auth/invitations/:token/accept` (single-use, sha256-hashed token, 7-day expiry, atomic claim).
- Test bypass: `TEST_AUTH_BYPASS=true` is honored only when `NODE_ENV=test` (used by the legacy 53-test integration suite).
- `passport`, `passport-local`, `express-session`, `memorystore` are wired by `server/auth.ts: setupAuth(app)`. `connect-pg-simple` is installed but unused — `memorystore` is single-process and loses sessions on restart (tracked as `prd/20-` H7).

## Task #37 — session hardening additions (2026-05-04)

- `server/middleware/csrf.ts` — `polaris.csrf` double-submit cookie + header guard.
- `server/middleware/auth-rate-limit.ts` — per-IP throttles for `/auth/login`, `/auth/register`, `/auth/forgot-password`.
- `server/services/sessions.ts` — record/touch/delete/list/count helpers backing the `user_sessions` ledger.
- `client/src/pages/account/sessions.tsx` — `/app/account/sessions` UI.
- `server/tests/sessions.test.ts` — 12 integration tests (CSRF, fixation, sessions API, ownership isolation, forced-termination + audit, rate-limit, logout-CSRF, Helmet).
- New schema row: `user_sessions` (sessionId PK, userId FK, userAgent, ipAddress, createdAt, lastSeenAt).
