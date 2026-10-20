# 21 — Future Agent Context Pack

If you (a future agent) only have time to read **one** file, read this one. It is dense by design.

> **Authoritative API contract**: the runtime-authoritative spec is `GET /openapi.json` (built from Zod by `server/routes/openapi.ts: buildOpenApiDocument()`), browsable at `/api/docs`. The narrative API doc in **`09-api-reference.md`** is anchored to the per-domain modules under `server/routes/` (the legacy `server/routes.ts` is a 10-line re-export shim). If anything below disagrees with `09-` or with `/openapi.json`, `/openapi.json` wins.

## What Polaris is in three sentences

Polaris is an **AEO/GEO** (Answer-Engine / Generative-Engine Optimization) platform. It runs user-defined prompts against multiple LLMs (OpenAI, Anthropic, Gemini, Perplexity), extracts mentions / sentiment / rankings / citations, and computes **Visibility / Sentiment / Position / Overall** scores per (prompt × model). It also crawls the brand's website (Site X-Ray), produces deduplicated **Recommendations**, generates **Content drafts**, and ships a two-PDF **Executive Report** built from a 12-section GPT narrative.

## Tech stack — one line each

- **Frontend**: React 18 + Vite 5 + Wouter + TanStack Query v5 + shadcn/ui + Tailwind 3 + Zod + react-hook-form + Recharts + react-markdown.
- **Backend**: Node 20, Express 4 (single process), Drizzle 0.39 over Neon serverless WS, in-process JobQueue, Crawlee + Playwright (stealth), `openai@^5`, `@anthropic-ai/sdk@^0.65`.
- **Build**: `vite build` + `esbuild` for the server. Dev: `tsx server/index.ts` with Vite middleware.
- **Deploy**: `.replit` `[deployment] deploymentTarget = "vm"`, port 5000 → 80, `dist/public` static.

## The map you actually need

```
shared/schema.ts         ← single source of truth (33 pgTable, 20 pgEnum; 812 LoC)
shared/api-types.ts      ← generated typed paths from /openapi.json (regen via scripts/generate-api-types.ts)
server/index.ts          ← Express boot; setupAuth(app) at :58; SIGTERM/SIGINT shutdown at :96–164
server/auth.ts           ← passport-local + scrypt + 7-day sessions; /api/v1/auth/*; requireClientAccess
server/routes.ts         ← 10-line re-export shim (legacy)
server/routes/index.ts   ← orchestrator: registers 15 per-domain modules + openapi
server/routes/_helpers.ts ← getClientId / requireClientId / getOrgId (x-client-id > clientId > client_id)
server/routes/_shared.ts ← jobQueue + enrichmentService singletons
server/routes/openapi.ts ← buildOpenApiDocument() → /openapi.json + /api/docs Swagger UI
server/routes/{clients,onboarding,jobs,competitors,ai-models,topics,prompts,prompt-runs,
               score-colors,dashboard,opportunities,xray,crawler,reports}.ts ← per-domain
server/storage.ts        ← IStorage interface
server/db.ts             ← Neon pool + Drizzle; pingDatabase(); closePool()
server/db-storage.ts     ← Drizzle implementation
server/services/job-queue.ts            ← MAX_CONCURRENT_JOBS=4, heartbeats, restart-safe;
                                          stopAcceptingJobs() / drain() / getHealthStats()
server/services/prompt-run-executor.ts  ← orchestrates one prompt run
server/services/ai-executor.ts          ← per-vendor switch; raw text out
server/services/composer.ts             ← nDCG; ABSA; composeOverall; calculatePositionScoreV2
server/services/scoring.ts              ← per-axis async wrappers + heuristic fallbacks
server/services/visibilityScorer.new.ts ← V1
server/services/visibility-scoring-v2.ts ← V2
server/services/visibility-scoring.ts   ← V1↔V2 router
server/services/report-job-processor.ts ← 4-stage report pipeline
server/services/narrative-generator.ts  ← 12-section GPT narrative (gpt-5.1)
server/llm/{client,openai,anthropic}.ts ← provider-agnostic JSON-with-repair
server/config/{aeo,visibility-weights,position-scoring,reporting}.ts
server/tests/routes-integration.test.ts ← 50 supertest tests; npx tsx --test server/tests/routes-integration.test.ts
client/src/App.tsx       ← Wouter + ProtectedRoute (real auth via /api/v1/auth/me; redirects to /login)
client/src/pages/login.tsx
client/src/lib/api-client.ts ← openapi-fetch typed client (apiClient); injects x-client-id; redirects on 401
```

## Configuration knobs that matter most

- `AEO_MODE`=`heuristic|llm|hybrid` (default `heuristic`).
- `LLM_PROVIDER`=`openai|anthropic`; `LLM_MODEL`=`gpt-4o-mini` (Replit userenv).
- `VISIBILITY_SCORING_VERSION`=`v1|v2` (default `v1`; not set in Replit userenv).
- `POSITION_SCORING_VERSION`=`v1|v2` (Replit userenv = `v2`).
- `REPORT_AI_MODEL`=`gpt-5.1` (default).
- `JOB_MAX_TIMEOUT_HOURS`=`8` (Replit userenv).
- `DEBUG_AEO`, `DEBUG_VISIBILITY` for verbose console logs.
- `SESSION_SECRET` (required in prod); `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` (seed bootstrap, default `admin@polaris.local` / `[REMOVED: configure password in Replit Secrets]`).
- `SHUTDOWN_GRACE_MS` (25000) / `SHUTDOWN_FORCE_MS` (35000) for SIGTERM-driven JobQueue drain.

## Core scoring formulas (memorize these)

- **Visibility V1**: `raw = 0.9·mr + 0.6·fp + 0.4·min(1, hh/5) + 0.5·co`, score = `100 × max(0, 2(σ(raw) − 0.5))`.
- **Visibility V2**: same with weights `{0.40, 0.30, 0.15, 0.15}` (sum 1.0).
- **Sentiment heuristic**: `(pos − neg)/total → (raw + 1) × 50`.
- **Sentiment ABSA**: per entity: `base = (pPos − pNeg + 1) × 50`, `shrunken = 50 + (base − 50) × confidence`, weighted average by confidence.
- **Position heuristic**: 1→100, 2→95, 3→90, 4→85, 5→80, then `80 × e^{−0.2(p−5)}`; average.
- **Position nDCG**: `100 × DCG / IDCG`, all relevances = 1.
- **Position V2**: average of contributing per-group nDCG; relevant-but-absent group penalized at position `groupSize+1`; irrelevant groups never contribute.
- **Overall**: `(V·0.5 + S·0.3 + P·0.2) / 1.0`.

## Pipeline (prompt run)

1. Route `POST /api/v1/prompt-runs` inserts `prompt_runs` + `prompt_run_items` (status `queued`) and enqueues a `prompt_run` job.
2. `JobQueue` picks it up; `prompt-run-executor.ts` builds (prompt × model) batch.
3. `ai-executor.ts: executePrompt` calls vendor; returns raw text (or error).
4. Citations / mentions / rankings extracted (heuristic or LLM).
5. Visibility / Sentiment / Position computed; overall composed.
6. `score_factors` rows persisted for explainability.
7. Competitor pipeline runs (`competitor-scoring.ts`) → `competitor_scores`.
8. Status transitions: `running → scoring → queued_for_benchmarking → benchmarking → done`.

## Known traps / gotchas

- ~~**`server/routes/index.ts` declares `export { jobQueue }` twice**~~ — fixed; the file exports `jobQueue` exactly once. `prd/20-` C1 resolved.
- **`/health` and `/api/admin/queue` are wired** in `server/routes/admin.ts` (registered from `server/routes/index.ts`); helpers `pingDatabase` / `getHealthStats` feed the responses. `prd/20-` C2 resolved.
- **Auth IS real** (passport-local + scrypt + sessions). Don't treat the API as anonymous. The seeded admin (`admin@polaris.local` / `[REMOVED: configure password in Replit Secrets]`) is a member of `default-org`.
- **`memorystore` session store** is single-process; restarting the server logs everyone out.
- **`/api/v1/jobs` and `/api/v1/jobs/:id`** are now registered exactly once each in `server/routes/jobs.ts` (the duplicate registration in the monolith is gone).
- **`metadata-top-topics.tsx` not registered** in `App.tsx`.
- **`visibilitySigmoid` shifts so 0 input → 0 output.** Don't switch to plain sigmoid (would give 50 for empty).
- **Sentiment of empty mentions = 0**, not 50, by design.
- **`report-job-processor.ts` retains last `MAX_RETENTION=5` snapshots per client.**
- **`buildOpenAIRequestParams` (utils/openai-compat.ts)** is the right way to call OpenAI for any model — handles `max_tokens` vs `max_completion_tokens` and reasoning-effort.
- **JSON-with-repair retries once.** A second failure throws; route returns 5xx.
- **Crawler falls back from Cheerio to Playwright** with stealth — both must be functional on the host.
- **`POST /api/v1/prompt-runs/:id/recalculate-position`** exists for re-running position scoring after toggling `POSITION_SCORING_VERSION`.
- **Tenancy param casing is mixed**: older routes use `?org_id=` / `?client_id=` (snake_case), newer ones use `?clientId=` and/or `x-client-id` header. See `09-api-reference.md` for the breakdown — verify per route handler.
- **`POST /api/v1/reports/generate`** takes `{ clientId, runId }` (single id) and returns `202 { message, note }`; the snapshot id is discovered via subsequent `GET /api/v1/reports?client_id=`.
- **`GET /api/v1/score-colors`** requires `?category=Visibility|Sentiment|Position`; the dashboard calls it three times.
- **`GET /api/v1/xray/actions`** takes `?siteId=`, not `?clientId=`.

## When extending

- Add tables in `shared/schema.ts`. Push with `npm run db:push`. Don't write migrations.
- Add storage methods to `IStorage` and `DBStorage`.
- New LLM call? Use `getClient()` + `generateJsonWithRepair` with a Zod schema unless you specifically need raw text.
- New score? Wire it through `score-explainability.ts` so the dashboard can show it.
- New env var? Add to `server/config/*.ts`, log at boot, document in `prd/11-`.
- New page? Add to `client/src/pages/`, register in `App.tsx`, wrap with `ProtectedRoute`, add `data-testid`s.
- **New API endpoint?** Add the handler to the appropriate `server/routes/<domain>.ts`, register it from `server/routes/index.ts` if a new module, and **mirror the registration in `server/routes/openapi.ts`** so the OpenAPI doc and the typed `apiClient` stay in sync. Then run `npx tsx scripts/generate-api-types.ts` and commit the regenerated `shared/api-types.ts`.
- **New auth-required tenant boundary?** Use `getClientId` / `getOrgId` from `server/routes/_helpers.ts` and gate the handler with `requireClientAccess` / `userHasOrgAccess` from `server/auth.ts`.

## Files NOT to edit

- `vite.config.ts`
- `server/vite.ts`
- `package.json`
- `drizzle.config.ts`

## How to verify the system is alive

1. `npm run dev` → `[express] serving on port 5000` line appears.
2. `[AEO Config]` block prints with mode/provider/model/weights.
3. `[Visibility Config]` and `[Position Config]` print version.
4. `GET /api/v1/clients?org_id=default-org` returns at least the seeded org's clients (or `[]` if none). *(Note the snake_case `org_id`; the handler in `server/routes/clients.ts` reads it via `getOrgId(req)` from `server/routes/_helpers.ts`, which accepts both `?orgId=` and legacy `?org_id=`.)*
5. Open `/app/clients` in the preview, create a client, run one prompt, watch the dashboard hydrate.

## Where to look when something breaks

- **Frontend blank** → `client/src/App.tsx` (no error boundary). Check Vite dev modal.
- **API 500** → `server/index.ts` global error handler logs error; cross-reference with `routes.ts` line.
- **LLM error** → `[AI-Executor]` line tells you provider/model/duration/status. Check API key env vars.
- **Job stuck** → `jobs.lastHeartbeat` and `jobs.workerId`; should be < 15 min stale. `recoverStaleJobs()` runs on boot.
- **Wrong score** → enable `DEBUG_AEO=1` and `DEBUG_VISIBILITY=true` and re-run.
- **Report failed** → `report_jobs.errorMessage`; renderer issues usually mean Playwright can't launch.

## Production deployment

- **URL**: `https://polaris-r3.ignitelabs.online` (vm-target deploy in `.replit`).
- **Run command**: `npm run start` (`NODE_ENV=production node dist/index.js`).
- **DB**: dev workflow and prod VM each have their own `DATABASE_URL`. Project renames / prompt runs / topics created on one do **not** appear on the other. (Caught us once — "Masafi looks empty in prod"; the data lived only in the dev DB.) Production data must be created against the production deployment.
- **`.config/pulse/`** is gitignored — Chromium-under-Playwright leaves dangling PulseAudio runtime symlinks that previously triggered `Detected broken symlink` warnings on every Repl layer push.

## Project selection (Tasks #52, #53)

- **Single source of truth**: `client/src/hooks/use-selected-client-id.ts` (`useSelectedClientId`, `useUrlClientId`, `setSelectedClientId`, `getSelectedClientIdSnapshot`). Backed by `useSyncExternalStore` over `localStorage["current-client-id"]`. `setSelectedClientId` writes `localStorage` and explicitly dispatches a `selected-client-changed` custom event for same-tab subscribers; cross-tab subscribers are notified implicitly via the browser's native `storage` event (fires only in *other* tabs on every `localStorage` write). The hook's `subscribe()` listens for both.
- **Read priority on every project-scoped page**: `urlClientId || storedClientId` (URL wins over `localStorage`). When both are null, the page renders a "No Client Selected" empty state telling the user to pick a project from the top-nav dropdown — there is **no** automatic `/api/v1/clients` fallback fetch and no CTA link.
- **`ProtectedRoute`** runs a URL→store sync effect on every navigation so deep links and middle-clicks land on the correct project even with empty `localStorage`.
- **Sidebar `Link`s** (`client/src/components/layout/sidebar.tsx`) append `?clientId=${selectedClientId}` so middle-click carries the selection through. The top-navigation user dropdown and the client-catalog "Open" button still navigate via `setLocation()` + `setSelectedClientId()` (no URL query) — fine for same-tab clicks but does not yet survive middle-click.

## Auth/session quick-reference (Task #37)
- Login/register: `req.session.regenerate()` rotates the cookie before `req.login()`. Login accepts `rememberMe` (browser-session cookie vs 30-day rolling).
- Every protected route runs through `requireAuth` (`server/auth.ts`), which checks epoch / disabled / idle / absolute and exits via `destroyAndReject` — that single path emits an `auth.session.terminated` audit row with a `reason` taxonomy.
- CSRF: `polaris.csrf` cookie + `x-csrf-token` header on every `/api/v1` non-GET (including logout). Exemptions: login, register, forgot-password, credential-grant status/redeem.
- Rate limits: `/auth/login` 10/min/IP, `/auth/register` 5/hr, `/auth/forgot-password` 5/hr; all env-tunable; bypassed under `NODE_ENV=test`.
- Active-sessions UI at `/app/account/sessions`. Revocation truly destroys the session-store row, not just the mirror.
- Cross-tab: `BroadcastChannel("polaris-auth")` carries `{type:"logout"}` and `{type:"revoked", reason}`.
