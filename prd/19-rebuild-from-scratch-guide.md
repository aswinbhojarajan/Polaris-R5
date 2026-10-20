# 19 — Rebuild From Scratch Guide

A pragmatic, in-order plan for re-creating Polaris on top of an empty Replit project, given only this `prd/` pack.

## 0. Prerequisites

- Replit project with `nodejs-20`, `web`, `postgresql-16` modules.
- Nix `chromium` package available for Playwright.
- `OPENAI_API_KEY` (required for any nontrivial functionality).
- Optional: `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY`.
- Replit-managed Postgres (provides `DATABASE_URL`).
- `SESSION_SECRET` (required in production for `setupAuth`; dev has a fallback).
- `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` (optional; defaults to `admin@polaris.local` / `[REMOVED: configure password in Replit Secrets]` — change before any non-dev deploy). Seeded as `admin` of `default-org`.
- `ALLOW_PUBLIC_REGISTRATION` (optional; default `false` → `POST /api/v1/auth/register` returns 403; flip to `true` only for self-serve trials).
- `SHUTDOWN_GRACE_MS` / `SHUTDOWN_FORCE_MS` (optional; defaults 25000 / 35000).
- `TEST_AUTH_BYPASS` (test-only; honored only when `NODE_ENV=test`; used by the legacy integration suite).

## 1. Scaffold

- `npm init -y`; set `"type": "module"`.
- Install runtime deps from `prd/10-tech-stack-and-dependencies.md` Critical/High columns.
- Add `tsx`, `typescript`, `vite`, `esbuild`, `drizzle-kit` as dev deps.
- Create `tsconfig.json` (strict, `module: ESNext`, `moduleResolution: bundler`, `paths` for `@/`, `@shared/`, `@assets/`).
- Create `vite.config.ts` (do not customize beyond the Replit template if you can avoid it).
- Add `package.json` scripts: `dev`, `build`, `start`, `check`, `db:push`, `postinstall` (Playwright).
- Create `.replit`: ports (5000→80), workflow `Start application` running `npm run dev` and waiting for port 5000, deployment target `vm`, `[userenv.shared]` for `JOB_MAX_TIMEOUT_HOURS`, `LLM_MODEL`, `POSITION_SCORING_VERSION`.

## 2. Database & schema

- Define `shared/schema.ts` per `08-database-and-data-model.md`:
  - **20 enums**: all originals plus `user_role_enum` (`admin`/`member`/`viewer`). (The legacy `owner` value was merged into `admin` in May 2026.)
  - **35 tables**: all originals plus `users`, `user_org_memberships` (Task #2), `invitations`, `audit_log` (Task #7).
  - Add `clients.ownerUserId` (FK → `users.id`, nullable) (Task #7).
  - Drizzle relations including `usersRelations`, `userOrgMembershipsRelations`, `invitationsRelations`, `auditLogRelations`.
  - `createInsertSchema(...).omit({ id: true, createdAt: true, ... })` per table.
  - Validation schemas `registerUserSchema`, `loginSchema`, `createInvitationSchema`, `acceptInvitationSchema` in `shared/schema.ts`.
- `npm run db:push`.
- Seed (`server/seed.ts`): default org `"default-org"`, AI models per vendor (`openai/gpt-4o-mini`, `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, etc.), `score_color_bands`, `score_interpretations`, `prompt_categories`, and the bootstrap admin user (`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`) plus its `user_org_memberships` row in `default-org`.

## 3. Backend skeleton

- `server/db.ts`: Neon serverless `Pool` + Drizzle. Export `pool`, `db`, `pingDatabase()` (used by the `/health` endpoint), and `closePool()` (used by the SIGTERM handler).
- `server/storage.ts`: `IStorage` interface (full method list — see `07-backend-architecture.md`).
- `server/db-storage.ts`: Drizzle-backed implementation.
- `server/auth.ts`: `setupAuth(app)` mounting session middleware (memorystore, 7-day cookie, `polaris.sid`, `httpOnly`, `sameSite=lax`, `secure` in prod), passport-local with email + Node-`scrypt` password verify, `passport.serializeUser`/`deserializeUser`, and the four `/api/v1/auth/*` routes. Plus `requireAuth`, `requireTenantAccessIfPresent`, `requireRole({minRole, scope})`, `requireClientAccess`, `userHasOrgAccess`, `userHasClientAccess`, `getUserRoleInOrg`, `assertClientAccess`, `assertOrgAccess`. Honor `TEST_AUTH_BYPASS=true` only when `NODE_ENV=test`.
- `server/privileges.ts`: canonical RBAC matrix `[ { method, pattern, bucket: 'read' | 'write' | 'execute' | 'admin', minRole, scope: 'org' | 'client' | 'none' } ]` covering every `/api/v1` route. Single source of truth for `requireRole` and the OpenAPI `x-required-role` extension.
- `server/services/audit.ts`: `recordAudit({ orgId, actorUserId, action, target, metadata })` → `audit_log`.
- `server/routes/_helpers.ts`: standardize tenancy resolution (`getClientId`, `requireClientId`, `getOrgId`).
- `server/routes/_shared.ts`: hold the singleton `jobQueue` and `enrichmentService`.
- `server/routes/index.ts`: orchestrate per-domain `register*Routes` calls. Mount the `/api/v1` middleware that lifts `x-client-id` onto `req.clientId` AND mount the global RBAC guard (`requireAuth` + `requireTenantAccessIfPresent`) with a public-path skip-list for `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/register`, `/auth/invitations/:token/accept`.
- `server/routes/<domain>.ts`: one module per domain (`clients`, `onboarding`, `jobs`, `competitors`, `ai-models`, `topics`, `prompts`, `prompt-runs`, `score-colors`, `dashboard`, `opportunities`, `xray`, `crawler`, `reports`). Attach `requireRole({minRole, scope})` inline on every mutating handler per the privilege matrix.
- `server/routes/admin.ts`: `/health` (calls `pingDatabase()` + `jobQueue.getHealthStats()`) and `/api/admin/queue` (queue config + health).
- `server/routes/admin-users.ts` (Task #7): members CRUD, invitations create/list/revoke (sha256-hashed single-use tokens, 7-day expiry, atomic accept), admin-only audit read, public `POST /api/v1/auth/invitations/:token/accept`.
- `server/routes/admin-projects.ts` (Task #7): rename, reassign `clients.ownerUserId`, soft-delete (`isActive=false`).
- `server/routes/openapi.ts`: build the OpenAPI document from Zod via `@asteasolutions/zod-to-openapi`; serve at `/openapi.json` and a Swagger UI at `/api/docs`. Decorate every operation with `x-required-role` from the privilege matrix.
- `server/index.ts`: Express boot (JSON middleware with raw-body verify, request log middleware, `setupAuth(app)`, `await registerRoutes(app)`, `seedDatabase()`, error handler, Vite middleware in dev / `serveStatic` in prod, listen on `PORT`). Register SIGTERM/SIGINT handlers that close the HTTP listener, call `jobQueue.stopAcceptingJobs()` then `jobQueue.drain(SHUTDOWN_GRACE_MS)`, close the DB pool, and exit; hard-exit at `SHUTDOWN_FORCE_MS`.
- `server/vite.ts`: standard Replit Vite middleware.
- `server/routes.ts`: 10-line re-export shim — `export { registerRoutes, jobQueue } from "./routes/index"`.

## 4. LLM abstraction

- `server/llm/client.ts`: `LLMClient` interface, `JSON_SYSTEM_PROMPT`, `generateJsonWithRepair`, `getClient(provider, model)`.
- `server/llm/openai.ts`: `OpenAIClient` using `openai` SDK and `buildOpenAIRequestParams` from `server/utils/openai-compat.ts`.
- `server/llm/anthropic.ts`: `AnthropicClient` using `@anthropic-ai/sdk`.
- `server/utils/json.ts`: `extractJson`, `validateJson`.
- `server/utils/openai-compat.ts`: model-family-aware `max_tokens` vs `max_completion_tokens`, optional `reasoning_effort`.
- `server/utils/chromium-path.ts`: Playwright launcher with stealth.

## 5. Configuration

Implement four config files (`server/config/`):
- `aeo.ts` — `AEO_CONFIG` with mode/provider/model/temperature/maxTokens/timeoutMs/retries/thresholds/composerWeights. Validate API keys; log resolved config.
- `visibility-weights.ts` — V1 (sum 2.4) + V2 (sum 1.0) sets, `getVisibilityWeights()`, `validateWeights()`.
- `position-scoring.ts` — `POSITION_SCORING_VERSION` env-driven.
- `reporting.ts` — `REPORTING_CONFIG` (model/temperature/retention/enabled).

## 6. Crawling & onboarding

- **Tenancy conventions to replicate** (matches existing inconsistency for backward-compat — or cleanly normalize to one if rebuilding fresh):
  - `/api/v1/clients` listing uses `?org_id=` (snake_case), default `"default-org"`.
  - Older client-scoped routes use `?client_id=` (snake_case); newer routes accept `?clientId=` (camelCase) or `x-client-id` header.
  - `/api/v1/reports/generate` body: `{ clientId, runId }` (single, not array).
  - `/api/v1/score-colors` requires `?category=`.
  - `/api/v1/xray/actions` requires `?siteId=` (not `clientId`).
- `server/services/website-crawler.ts`: Crawlee `CheerioCrawler` first; on failure fall back to `PlaywrightCrawler` with `playwright-extra` + stealth plugin.
- `formatCrawledContentForLLM`: produce LLM-friendly markdown context.
- `server/openai-service.ts`: `generateMetadataFromWebsite`, `generateAITopicsFromMetadata`, `generatePromptsFromTopics` using `gpt-4-turbo-preview`.
- `server/services/onboarding-enrichment.ts`: `enrichUrls`, `enrichProfile`, `enrichCompetitors` via `getClient()` + Zod schemas.

## 7. Job queue

- `server/services/job-queue.ts`:
  - `MAX_CONCURRENT_JOBS = 4`.
  - Per-client serialization (`processingClients` set).
  - Per-job worker IDs to avoid double-execution after restart.
  - Heartbeats every 30 s to `jobs.lastHeartbeat`.
  - Stale recovery: `STALE_THRESHOLD_MS = 15 min`, `MAX_RESUME_ATTEMPTS = 3`.
  - `recoverStaleJobs()` on boot using `runCheckpoints`.
- `server/services/job-timeout.ts`: per-job timeout from `JOB_MAX_TIMEOUT_HOURS`.

## 8. Prompt run pipeline

- `server/services/ai-executor.ts`: per-vendor `executePrompt(prompt, vendor, model, runId)` with shared system prompt, model-family-specific param handling, status-code propagation (429 → `isRateLimited`), empty/content-filter handling.
- `server/services/batch-executor.ts`: bounded-concurrency runner with rate-limit-aware retry.
- `server/services/prompt-run-executor.ts`: orchestrates fan-out, calls extractors and scorers, persists results, advances `prompt_runs.status`.
- `server/services/run-logger.ts`, `performance-logger.ts`: structured logs + telemetry.

## 9. Extractors

- `server/services/citation-extractor.ts`: markdown links + bare URLs + soft references; mark self-citations against `clients.website`.
- `server/services/mention-detector.ts`: regex-based with `normalizeBrandToken` Unicode normalizer.
- `server/services/mentionExtractor.llm.ts`: LLM equivalent.
- `server/services/sentimentAbsa.llm.ts`: ABSA + direct fallback.
- `server/services/ranking-parser.ts` (heuristic) + `rankingExtractor.llm.ts` (group-aware).
- `server/services/prompt-classifier.ts`.

## 10. Scoring

- `server/services/composer.ts`: `positionScoreFromRankings` (nDCG), `sentimentScoreFromABSA` (confidence-weighted shrinkage), `composeOverall`, `calculatePositionScoreV2` (group-aware).
- `server/services/visibilityScorer.new.ts`: V1 with shifted sigmoid.
- `server/services/visibility-scoring-v2.ts`: V2 normalized weights.
- `server/services/visibility-scoring.ts`: router (`*Versioned`).
- `server/services/scoring.ts`: per-axis async wrappers + heuristic fallbacks + overall.
- `server/services/score-explainability.ts`: persist `score_factors` rows.
- `server/services/competitor-scoring.ts`: mirror the client pipeline for each competitor; persist `competitor_scores`.

## 11. Site X-Ray

- `xray-ingestion.ts` + `xray-health-probe.ts` + `xray-structure-parser.ts` + `xray-content-analyzer.ts` (`gpt-4o-mini`) + `xray-entity-extractor.ts` + `xray-topic-mapper.ts`.
- Routes for sites/pages/analysis CRUD and batch analysis.

## 12. Recommendations & content

- `content-recommendation-analyzer.ts` (`gpt-4o-mini`).
- `recommendations-summary.ts` (dedup + sources + sort + paginate).
- Routes for list/stats/summary/manual create/generate.

## 13. Reporting

- `report-snapshot.ts`, `report-aggregator.ts`, `narrative-generator.ts` (12-section JSON, `gpt-5.1`), `pdf-template.ts`, `pdf-renderer.ts`, `csv-exporter.ts`, `json-exporter.ts`, `zip-exporter.ts`.
- `report-job-processor.ts` consumes `report_jobs`, walks the pipeline, updates progress.
- Routes for generation, download (insights/appendix), export, files, sections, job status, deletion.

## 14. Frontend

- `client/src/main.tsx` + `client/src/App.tsx` (Wouter routes, `QueryClientProvider`, Toaster, Tooltip; `Login` route at `/login`; `InviteAccept` route at `/invite/:token`; admin routes `/app/admin/users` and `/app/admin/projects` gated by `useRole().canAdmin`).
- `client/src/lib/queryClient.ts` (default fetcher + `apiRequest`, plus re-exporting the typed `apiClient`).
- `client/src/lib/auth.ts` (`useAuth`/`useLogin`/`useLogout`/`useRegister`; typed `AuthSession` with `memberships: { orgId, role }[]`).
- `client/src/lib/api-client.ts` (`openapi-fetch` over `shared/api-types.ts`; middleware injects `x-client-id` and redirects to `/login` on 401).
- `client/src/hooks/use-role.ts` (returns `{ role, isViewer, canWrite, canAdmin, atLeast }`).
- `shared/api-types.ts` — generated from `/openapi.json` via `npx tsx scripts/generate-api-types.ts`. Commit it.
- `client/src/components/protected-route.tsx` — calls `GET /api/v1/auth/me`; redirects to `/login` on 401.
- `client/src/pages/login.tsx` — email/password form posting to `/api/v1/auth/login`.
- `client/src/pages/invite-accept.tsx` — public form posting to `/api/v1/auth/invitations/:token/accept`.
- `client/src/pages/admin/users.tsx` — members + invitations management.
- `client/src/pages/admin/projects.tsx` — per-project rename / owner reassign / soft-delete.
- `client/src/index.css` (Tailwind tokens, dark mode).
- Build pages in this order: `landing → login → invite-accept → client-catalog → create-client-wizard → onboarding flows → metadata-topics → metadata-prompts → prompts-tracker → dashboard → site-xray → citation-analysis → recommendations → content-generator → reports → admin/users → admin/projects`.
- Add `data-testid`s as you go. Disable execute/write actions when `useRole().isViewer`.

## 15. Smoke testing

- Create a default org + a sample client; verify URL/profile/competitor enrichment.
- Run metadata generation; verify topics + prompts saved.
- Start a single-prompt run with `gpt-4o-mini`; verify `prompt_runs.status` advances to `done` and `answers` rows have scores.
- Open dashboard; click a score → score-explainability modal renders factor breakdown.
- Generate an executive report; verify both PDFs download.

## 16. Things to *not* re-implement until needed

- Webhooks / external API.
- WebSocket push for run status (the existing polling model is fine).
- Mobile artifact.
- Per-tenant rate limiting.
- External file storage (S3 etc.).
- Database-backed session store (`connect-pg-simple`) — `memorystore` is fine for single-VM deploys.
- Horizontal-scale-friendly job queue (BullMQ / Redis) — the in-process queue + checkpoints + graceful shutdown is sufficient for the current footprint.

## 17. Tests

- `server/tests/routes-integration.test.ts` — 53 supertest-based tests using `node:test` (Tasks #12 + #7). Sets `TEST_AUTH_BYPASS=true` so it can exercise routes without simulating logins. Run via `npx tsx --test server/tests/routes-integration.test.ts`.
- `server/tests/rbac.test.ts` — 10 RBAC-focused tests sweeping the privilege matrix: viewers blocked from every write/execute/admin endpoint, admins pass everywhere, role ladder, bypass off in non-test mode, atomic invitation accept rejects races. Does NOT set `TEST_AUTH_BYPASS`.
- Coverage: tenancy resolution (`x-client-id` header / `?clientId=` / legacy `?client_id=` all resolve to the same tenant), the consolidated `/api/v1/jobs` route with and without filters, representative endpoints across the other domain modules, the RBAC matrix, and `/openapi.json` validity.
- Tests monkey-patch the `storage` singleton's methods so they run without a real Postgres. They set `DATABASE_URL` defensively at the top of the file.
- Run both suites: `npx tsx --test server/tests/rbac.test.ts server/tests/routes-integration.test.ts` (currently 63/63 passing).
