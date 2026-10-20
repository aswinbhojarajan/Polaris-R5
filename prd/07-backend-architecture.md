# 07 — Backend Architecture

## Stack

| Concern | Choice | Source |
|---------|--------|--------|
| Runtime | Node.js 20 (Replit module `nodejs-20`) | `.replit` |
| Framework | Express 4 (`express@^4.21.2`) | `package.json`, `server/index.ts` |
| Language | TypeScript 5.6, ESM (`"type": "module"`) | `package.json` |
| ORM | Drizzle ORM 0.39 (`drizzle-orm/neon-serverless`) | `server/db.ts` |
| DB driver | Neon serverless (WebSocket pool) | `server/db.ts` |
| Schema validation | Zod + drizzle-zod | `shared/schema.ts` |
| LLM SDKs | `openai@^5.23`, `@anthropic-ai/sdk@^0.65` | `server/llm/*` |
| Crawling | Crawlee 3.15 + `playwright-extra` + stealth | `server/services/website-crawler.ts` |
| Queue | In-process custom queue | `server/services/job-queue.ts` |
| HTML→PDF | Custom template + renderer (uses Playwright; see `server/services/pdf-renderer.ts`) | services |
| Exports | `archiver`, `csv-parse` | services |
| Auth (now wired) | `passport`, `passport-local`, `express-session`, `memorystore`, Node `scrypt` | `server/auth.ts` |
| OpenAPI generation | `@asteasolutions/zod-to-openapi`, `openapi-typescript`, `openapi-fetch` | `server/routes/openapi.ts`, `scripts/generate-api-types.ts`, `client/src/lib/api-client.ts` |
| Test runner | `node:test` + `supertest` | `server/tests/routes-integration.test.ts` |

## Boot sequence

`server/index.ts`:

1. `express()` app instance.
2. `app.use(express.json({ verify }))` — captures raw body for potential webhook verification.
3. `app.use(express.urlencoded(...))`.
4. Logging middleware that captures the JSON body of each `/api/*` response and emits a single truncated log line on `res.finish`.
5. **`setupAuth(app)`** (`server/index.ts:58`, defined in `server/auth.ts`): mounts `express-session` (memorystore, 7-day cookie, `polaris.sid`, `httpOnly`, `sameSite=lax`, `secure` in prod), passport with the local strategy (email + scrypt password), and the `/api/v1/auth/{me,login,register,logout}` routes.
6. **`await registerRoutes(app)`** (`server/routes/index.ts`): mounts the `/api/v1` middleware that lifts `x-client-id` onto `req.clientId` AND the global RBAC guard (Task #7) — `requireAuth` + `requireTenantAccessIfPresent` with a public-path skip-list for `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/register`, `/auth/invitations/:token/accept`. Then registers all per-domain routers (15 product modules + `admin-users` + `admin-projects`, see below) and the OpenAPI/Swagger routes. Per-route `requireRole({minRole, scope})` is attached inline to every mutating handler from the matrix in `server/privileges.ts`.
7. `await seedDatabase()` — `server/seed.ts` ensures default org, AI models, score color bands, score interpretations, prompt categories, and the seed admin user (if absent) exist.
8. Error middleware that returns `{ message }` and rethrows (so it shows in dev banner).
9. Dev: `await setupVite(app, server)`. Prod: `serveStatic(app)`.
10. `server.listen({ port: PORT, host: '0.0.0.0', reusePort: true })`.
11. `process.on('SIGTERM' | 'SIGINT')` → graceful shutdown: close HTTP listener, `jobQueue.stopAcceptingJobs()`, `jobQueue.drain(SHUTDOWN_GRACE_MS)`, close DB pool, `process.exit`. Hard-exit at `SHUTDOWN_FORCE_MS` if drain hangs.

## Layered architecture

```
HTTP entry: server/index.ts
   │
   ├─► setupAuth(app)         server/auth.ts
   │     • session (memorystore, 7-day, httpOnly, polaris.sid)
   │     • passport-local (email + scrypt password verify)
   │     • /api/v1/auth/{me,login,register,logout}
   │     • requireClientAccess / userHasOrgAccess (per-tenant authz)
   │
   └─► registerRoutes(app)    server/routes/index.ts
         │
         ├─► server/routes/_helpers.ts   (tenancy: getClientId/requireClientId/getOrgId)
         ├─► server/routes/_shared.ts    (jobQueue + enrichmentService singletons)
         │
         ├─► clients.ts (389)      onboarding.ts (108)   jobs.ts (50)
         ├─► competitors.ts (42)   ai-models.ts (28)     topics.ts (67)
         ├─► prompts.ts (104)      prompt-runs.ts (588)  score-colors.ts (29)
         ├─► dashboard.ts (216)    opportunities.ts (211) xray.ts (241)
         ├─► crawler.ts (451)      reports.ts (527)      openapi.ts (1992)
         │   (15 modules; 5,177 LoC total)
         │
         ▼
   IStorage (server/storage.ts) ──► server/db-storage.ts ──► Neon Postgres
         │
         ▼  (Async work via routes that enqueue)
   JobQueue (server/services/job-queue.ts)
         │
         ├─► prompt-run-executor.ts ─► ai-executor.ts ─► OpenAI / Anthropic / Google / Perplexity
         │           │                       │
         │           ├─► extractors          └─► performance-logger.ts
         │           │   (citation-, mention-, ranking-)
         │           ├─► scoring (composer.ts, scoring.ts, visibility-scoring*.ts)
         │           ├─► competitor-scoring.ts
         │           └─► score-explainability.ts → score_factors
         │
         ├─► website-crawler.ts (Crawlee/Playwright) → xray-ingestion.ts
         ├─► xray-health-probe.ts / xray-content-analyzer.ts (LLM)
         ├─► content-recommendation-analyzer.ts (LLM)
         └─► report-job-processor.ts ─► report-snapshot.ts ─► report-aggregator.ts
                                             │
                                             ▼
                                    narrative-generator.ts (LLM, two-pass)
                                             │
                                             ▼
                                    pdf-template.ts → pdf-renderer.ts
```

## Per-domain route modules

Every module exports a `register<Domain>Routes(app: Express)` function called from `server/routes/index.ts`. The legacy `server/routes.ts` is now a 10-line re-export shim (`export { registerRoutes, jobQueue } from "./routes/index"`).

| Module | LoC | Notable endpoints |
|--------|-----|-------------------|
| `clients.ts` | 389 | `/api/v1/clients`, `/api/v1/organizations/:id`, model selection. |
| `onboarding.ts` | 108 | `/api/v1/onboarding/{enrich-urls,enrich-profile,enrich-competitors}`. |
| `jobs.ts` | 50 | Consolidated `/api/v1/jobs` and `/api/v1/jobs/:id` (duplicate registrations from the monolith are gone). |
| `competitors.ts` | 42 | `/api/v1/competitors`. |
| `ai-models.ts` | 28 | `/api/v1/ai-models`. |
| `topics.ts` | 67 | `/api/v1/topics[/...]`. |
| `prompts.ts` | 104 | `/api/v1/prompts[/...]`, `/api/v1/prompt-categories`. |
| `prompt-runs.ts` | 588 | All `/api/v1/prompt-runs[/...]` routes (start, results, score-explanation, benchmarks). |
| `score-colors.ts` | 29 | `/api/v1/score-colors`. |
| `dashboard.ts` | 216 | `/api/v1/dashboard/*`. |
| `opportunities.ts` | 211 | `/api/v1/opportunities/{citations,recommendations,content}/*`. |
| `xray.ts` | 241 | `/api/v1/xray/*`. |
| `crawler.ts` | 451 | `/api/v1/crawler/*`. |
| `reports.ts` | 527 | `/api/v1/reports/*` (snapshots, sections, files, downloads, exports, jobs). |
| `openapi.ts` | 1992 | `/openapi.json`, `/api/docs`, plus all `OpenAPIRegistry.registerPath(...)` declarations. |
| **Total** | **5,177** | |

## API surface conventions

- Prefix: `/api/v1/`. The auth namespace `/api/v1/auth/*` is mounted directly by `setupAuth`.
- Auth: cookie-session (`polaris.sid`). All `/api/v1/*` routes (except the four `/auth/*` routes themselves) require an authenticated session; per-tenant authorization is checked via `server/auth.ts: requireClientAccess` / `userHasOrgAccess` against `user_org_memberships`.
- Tenancy: `server/routes/_helpers.ts: getClientId` reads `x-client-id` header > `?clientId=` > legacy `?client_id=`. `getOrgId` reads `?orgId=` > legacy `?org_id=`. Per-route casing details remain documented in `09-api-reference.md`.
- Response shape: routes return raw JSON (no envelope). Errors return `{ message }` from the global error handler.
- Status codes: standard 2xx/4xx/5xx. 401 = no session; 403 = session lacks org membership; 400 = missing `clientId`.
- Long-running operations return `{ jobId }` or `{ promptRunId }` and the client polls.
- Authoritative API spec: `GET /openapi.json` (built by `server/routes/openapi.ts: buildOpenApiDocument()`); browsable at `GET /api/docs`.

## Storage interface (`server/storage.ts`)

`IStorage` is the only interface routes depend on. It exposes:
- Org/Client CRUD: `getOrganization`, `getClients`, `createClient`, `updateClient`, `deleteClient`, `findClientByProjectName`.
- Competitors, AI models, client↔model mapping.
- Topics, prompts, prompt categories.
- Prompt runs + items, answers, citations, mentions, rankings.
- Competitor scores (per-run + latest aggregate).
- Benchmarks: `getPromptBenchmarks`, `getBulkPromptBenchmarks`.
- Jobs.
- Aggregations: `getClientAggregatedScores`, `getHistoricalScores`, `getCitationAnalysis`, `getCitationsByDomain`, `getRecommendations`, `getRecommendationsSummary`, `saveRecommendations`, `getGeneratedContents`, `saveGeneratedContents`.
- Site X-Ray: sites/pages/structure/analysis CRUD plus aggregated `getXRaySitesWithMetrics`.

`server/db-storage.ts` is the Drizzle implementation; it composes selects, joins, and SQL aggregates directly against Postgres. It is the largest single backend file (~2400 LoC). User/membership reads currently bypass `IStorage` and use Drizzle directly from `server/auth.ts`.

## Job queue contract

`JobQueue` (`server/services/job-queue.ts`):
- Holds `processingJobs` (id → startTime), `jobTimeouts`, `processingClients` (one in-flight job per client), `jobWorkerIds`, `jobHeartbeatIntervals`, `cancelledJobs`, `pollInterval`, `isShuttingDown`.
- `MAX_CONCURRENT_JOBS = 4`.
- `DEFAULT_TIMEOUT_MS = 15 min`; per-job overridable via `calculateJobTimeout()` (`job-timeout.ts`).
- `HEARTBEAT_INTERVAL_MS = 30 s`; `STALE_THRESHOLD_MS = 15 min`.
- `MAX_RESUME_ATTEMPTS = 3`.
- On boot: `recoverStaleJobs()` re-enqueues prompt runs with checkpoints (`run_checkpoints`) or marks others failed.
- Job types invoked: `prompt_run`, metadata generation (`generateMetadataFromWebsite` etc.), X-Ray crawl, X-Ray health refresh, X-Ray batch analysis (`xray_analysis` — see Task #58 below), recommendation analysis, executive report generation.
- **Shutdown surface (Task #4)**: `stopAcceptingJobs()` flips `isShuttingDown=true` and clears the polling interval; subsequent `enqueue()` calls reject; `processJobs()` short-circuits. `drain(graceMs)` waits for `processingJobs.size` to hit 0, returning `false` if the grace period elapses (those jobs are picked up as stale on next boot via the existing `recoverStaleJobs()` path). `getHealthStats()` returns `{ active, queued, stale, shuttingDown, config }` — consumed by `/health` and `/api/admin/queue` (wired in `server/routes/admin.ts`).

## Structured logging

- Per-request log line in `server/index.ts`.
- Per-run logs in `server/services/run-logger.ts` → `prompt_run_logs` table.
- LLM-call logs in `server/services/performance-logger.ts` (latency, status, error flag).
- Console logs across services for `[AEO Config]`, `[Visibility Config]`, `[Position Config]`, `[OpenAI]`, `[Anthropic]`, `[AI-Executor]`, `[JobQueue]`.

## Concurrency & safety

- One in-flight job per client (`processingClients`).
- Per-job worker IDs (`jobs.workerId`) prevent duplicate execution after restart.
- LLM JSON parse uses `generateJsonWithRepair` (`server/llm/client.ts`) — at most one repair attempt per call.
- `batch-executor.ts` provides bounded concurrency for fan-out across model × prompt combinations and surfaces 429s.
- SIGTERM/SIGINT drain the queue rather than crashing mid-job — uncheckpointed jobs that miss the grace window are re-discovered as stale on the next boot.

## Configuration sources

- `server/config/aeo.ts` reads `AEO_MODE`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_MAX_TOKENS`. Falls back to `heuristic` if API keys missing for chosen provider. Logs the resolved configuration on boot.
- `server/config/visibility-weights.ts` reads `VISIBILITY_SCORING_VERSION`.
- `server/config/position-scoring.ts` reads `POSITION_SCORING_VERSION` (defaults `'v1'`; `.replit` `[userenv]` sets `'v2'`).
- `server/config/reporting.ts` reads `REPORT_AI_MODEL`, `REPORT_AI_TEMPERATURE`, `REPORT_MAX_RETENTION`, `ENABLE_REPORTING`.
- `JOB_MAX_TIMEOUT_HOURS` via `.replit` `[userenv]` (default `8`).
- `DEBUG_AEO`, `DEBUG_VISIBILITY` toggle verbose console logging in scoring modules.
- **Auth**: `SESSION_SECRET` (required in prod, dev fallback), `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD` (seed only).
- **Shutdown**: `SHUTDOWN_GRACE_MS` (default 25000), `SHUTDOWN_FORCE_MS` (default 35000).

## Error taxonomy

- LLM errors: SDK `error.status` propagated; 429 → `isRateLimited`.
- Empty response: treated as error (avoids zero-scoring poisoning) — `executeOpenAI` in `ai-executor.ts`.
- Content moderation: `finish_reason === 'content_filter'` returns explicit error.
- Job-level: stale jobs are recovered or marked `error`; cancellations honored via `cancelledJobs` set + checkpoint-based polling.
- Auth: 401 from `req.isAuthenticated()` failures; 403 from `requireClientAccess` / `userHasOrgAccess`.

## Backend gaps / risks (post-merge)

- **No `/health` or `/api/admin/queue` endpoint registered.** Helpers `pingDatabase()` and `getHealthStats()` exist for them, but no route module wires them up. Replit's deploy probe still falls back to "is the port open?". See `prd/20-` and `prd/22-`.
- **`server/routes/index.ts` declares `export { jobQueue }` twice** (lines 21 and 26) — currently a `SyntaxError` blocking the `Start application` workflow. One-line fix; tracked in `prd/20-` ⛔.
- **No rate limiting / quota.**
- **No background-process supervision** beyond the in-process queue. SIGTERM now drains cleanly; an unexpected crash still loses non-checkpointed in-flight work.
- **No webhook surface, no scheduled cron** (other than poll loops inside `JobQueue`).
- **Two parallel sentiment paths** (heuristic and LLM) with several fallbacks — high cyclomatic surface area in `scoring.ts`.
- **`memorystore` session store** is single-process and process-bound; multi-instance deployments would lose sessions on restart. Migrate to `connect-pg-simple` against the existing Neon DB when horizontally scaling.

## Session hardening (Task #37)
- `server/auth.ts` wraps `req.login()` inside `req.session.regenerate()` on login and register (session-fixation defense). `requireAuth` enforces idle, absolute, epoch, and disabled-account checks; `destroyAndReject` is the single exit path and writes an `auth.session.terminated` audit row with a `reason` (`session_revoked`, `account_disabled`, `idle_timeout`, `absolute_timeout`).
- `server/middleware/csrf.ts` mounts globally and is enforced on every `/api/v1` state-changing request including `/auth/logout`. Exemptions: login, register, forgot-password, credential-grant status/redeem (raw token authenticates).
- `server/middleware/auth-rate-limit.ts` adds per-IP `express-rate-limit` throttles. Skipped under `NODE_ENV=test` for the integration suite.
- `server/services/sessions.ts` is a thin Request-aware wrapper that delegates every CRUD call to `IStorage` (`recordUserSession`, `touchUserSession`, `deleteUserSession`, `deleteUserSessionsForUser`, `listUserSessionsForUser`, `getUserSession`, `countActiveUserSessions`). DbStorage owns the drizzle implementations; MemStorage exposes safe no-ops for unit fixtures. Closes M16 for the `user_sessions` surface.
- Express-session store: `connect-pg-simple` when `DATABASE_URL` is set, `memorystore` fallback otherwise.

## Active operations service (Task #56)

`server/services/activity-service.ts` reads `jobs`, `prompt_runs`, and `report_jobs`+`report_snapshots` via `IStorage.listActiveActivitySources(clientIds)` and joins starter metadata via `IStorage.getUsersByIds(ids)`. Job-type → ActivityKind mapping: `generate_metadata`→`metadata_generation`, `xray_analysis`→`site_xray`, `refresh_prompts`→`refresh_prompts`, `copy_client`→`project_copy`. `crawler_raw` is intentionally unmapped (playground; no project context).

Endpoints (mounted in `server/routes/clients.ts`):
- `GET /api/v1/clients/:clientId/activity` → `{ items: ActivityItem[] }` (per-project)
- `GET /api/v1/clients/activity-summary?orgId=…` → `{ summaries: ActivitySummary[] }` (catalog)

Both filter through `getClients(...viewer)` so users only see projects they're granted on. The summary route is excluded from `requireTenantAccessIfPresent` via the regex in `server/auth.ts:NON_CLIENT_ID_SEGMENTS`.

Attribution: every async enqueue (`enqueueJob`, `createPromptRun`, `createReportJob`) records `startedByUserId` from the request context. The synchronous refresh-prompts endpoint writes a manual `jobs` tracking row (running→done/failed) so other viewers see it.

### Refresh Prompts atomicity + parallelism (Task #98)

`POST /api/v1/clients/:id/refresh-prompts` (`server/routes/clients.ts`) classifies the generated batch in parallel via a file-local `runWithConcurrency(items, 5, fn)` helper (preserves order, no new dep) and wraps the destructive `delete(prompts where source ∈ {crawl, ai})` + bulk `insert(prompts).values(rows).returning()` in a single `db.transaction(async (tx) => …)`. This is the first `db.transaction` in `server/` and works because `db` is constructed with `drizzle-orm/neon-serverless` (WebSocket pool driver). The bulk insert bypasses `storage.createPrompt` because the transaction needs the `tx` handle, which `IStorage` does not expose — the same pattern as the existing direct `db.select(promptCategories)` call already in this route. Classification stays best-effort: a single `classifyPrompt` failure logs and falls back to `categoryId = null` rather than aborting the refresh. The empty-batch guard runs *before* the transaction so a generator failure can never reach the destructive phase. The `refresh_prompts` tracking row transitions running → done after the transaction commits and running → failed inside the existing `catch` on rollback.

## Site X-Ray batch worker (Task #58)

`server/services/job-queue.ts` now ships a real handler for `xray_analysis` jobs (`processXRayAnalysis`). It loads the site + client, ensures `page_structures` exist for every page (parsing `rawHtml` on demand via `xray-structure-parser` / `xray-entity-extractor` / `xray-topic-mapper`), then runs `analyzeBatchPages` in chunks of 5 with the same retry / backoff as the embedded `generateMetadata({ enableSiteXRay: true })` pipeline. Results write through `storage.createPageAnalysis`. Throws if every batch fails so the job transitions to `error`. `recoverStaleJobs()` also fails any `xray_analysis` row older than the 15 min stale threshold so the type has a TTL going forward.

Out of scope by design: this worker does **not** re-run X-Ray ingestion and does **not** fan analyses out to the `recommendations` table — that still lives in the `generateMetadata` pipeline. Follow-ups: #60 (recommendations fan-out), #61 (surface job failures in the X-Ray UI).

## Stale prompt-run reaper (Task #59)

`server/services/prompt-run-reaper.ts` exposes `reapStalePromptRunsAtBoot()`, called from `server/index.ts` right after `seedDatabase()` and before route / executor registration. It uses `IStorage.reapStalePromptRuns(olderThanMs, reason)` (DbStorage uses an `inArray(activeStatuses) AND createdAt < cutoff` predicate; MemStorage no-ops) to mark any `prompt_runs` row stuck in a non-terminal status — the shared `ACTIVE_PROMPT_RUN_STATUSES` exported from `activity-service.ts`: `queued`, `running`, `scoring`, `queued_for_benchmarking`, `benchmarking` — older than `STALE_PROMPT_RUN_AGE_MS` (default 30 min) as `error` with `errorSummary = "Stale run reaped — server restart"`. The same status flip cascades to its `prompt_run_items`. The DbStorage UPDATE re-checks status in the WHERE clause to avoid overwriting a run that races to terminal between SELECT and UPDATE. Skipped under `NODE_ENV=test` / `SESSION_STORE=memory`. Logs under `[PromptRunReaper]`. First post-deploy boot cleared 13 dev zombies and 14 items.

`statusEnum` has no `failed` value — `error` is the canonical terminal-failure status, so the reaper writes `error` rather than the `failed` originally proposed in the task plan. No `heartbeat_at` column was added; periodic mid-run reaping is filed as follow-up #62.
