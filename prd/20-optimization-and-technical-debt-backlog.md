# 20 — Optimization and Technical-Debt Backlog

Each item is anchored to a file/path. **Severity** = ⛔ Critical / 🔥 High / ⚠️ Medium / 💡 Low. **Effort** = S / M / L. None of the *open* items below are blocking the product today, except the duplicate-export bug at the top of the Critical section, which currently breaks the `Start application` workflow.

## ⛔ Critical (production correctness / safety)

| # | Item | Severity | Effort | Where |
|---|------|----------|--------|-------|
| C1 | ~~**Duplicate `export { jobQueue }` in `server/routes/index.ts`.**~~ **Resolved.** The file now exports `jobQueue` exactly once and `Start application` boots cleanly. | ✅ | — | `server/routes/index.ts`. |
| C2 | ~~**`/health` and `/api/admin/queue` advertised but unwired.**~~ **Resolved.** `server/routes/admin.ts` registers both endpoints and is mounted from `server/routes/index.ts`. Helpers (`pingDatabase()`, `getHealthStats()`) feed the responses. | ✅ | — | `server/routes/admin.ts`, `server/routes/index.ts`. |

## 🔥 High

| # | Item | Severity | Effort | Where |
|---|------|----------|--------|-------|
| H1 | **Rate limiting** — partial. Auth endpoints (login/register/forgot-password) are throttled per-IP via `server/middleware/auth-rate-limit.ts` (Task #37). Admin routes, `/auth/sessions/*`, and the data plane are still unthrottled. | 🔥 | S | extend `server/middleware/auth-rate-limit.ts` and add per-tenant quotas. |
| H2 | ~~**No global error boundary in the React app.**~~ **Resolved by Task #114** — an `ErrorBoundary` (plus `NetworkBanner`) is mounted at the App root; Task #131 added permission-aware error toasts on top. | ✅ | — | `client/src/App.tsx`, `client/src/components/feedback/`. |
| H3 | **`metadata-top-topics.tsx` is not registered as a route.** Either wire it or delete. | 🔥 | S | `client/src/App.tsx`, `client/src/pages/metadata-top-topics.tsx`. |
| H4 | **Two parallel sentiment paths** (heuristic + LLM with multi-step fallback) increase complexity in `scoring.ts`. Consolidate fallback strategy. | 🔥 | M | `server/services/scoring.ts`. |
| H5 | **Foreign-key indexes not declared.** Drizzle defines FKs but no explicit indexes for high-cardinality joins (`answers.promptRunItemId`, `mentions.answerId`, `citations.answerId`, `score_factors.promptRunItemId`, `competitor_scores.promptRunId`). Postgres performance suffers as data grows. | 🔥 | S | `shared/schema.ts`. |
| H6 | **No structured logger / log shipper.** All logs are `console.*`. Hard to triage in production. | 🔥 | M | server-wide. |
| H7 | ~~**`memorystore` session store is single-process.**~~ Resolved in Task #8 (back-fill, persistence) and hardened by Task #37 — `connect-pg-simple` is the active store; `memorystore` is the no-DB / test fallback. Sessions survive restart, deploys, and autoscale. Task #42 keeps the `user_sessions` ledger in lock-step with the session table. | ✅ | — | `server/auth.ts: createSessionStore()`, `server/db-storage.ts`, `server/services/sessions.ts`. |
| H8 | **`(req as any).clientId` casts** still appear in some legacy handlers; the new `_helpers.getClientId` should replace them so tenancy is uniformly typed. | 🔥 | S | `server/routes/*.ts`. |

## ⚠️ Medium

| # | Item | Severity | Effort | Where |
|---|------|----------|--------|-------|
| M1 | **`db-storage.ts` is 2,400+ LoC.** Split into per-domain repositories aligned with the route split. | ⚠️ | M | `server/db-storage.ts`. |
| M2 | **`server/routes/openapi.ts` is 1,992 LoC.** Almost all of it is `OpenAPIRegistry.registerPath(...)` calls. Split into per-domain spec files mirroring the route modules so adding a route only touches one file. | ⚠️ | M | `server/routes/openapi.ts`. |
| M3 | **Per-LLM-call cost not persisted.** `aiModels` has cost fields, but per-`answers`/`prompt_run_items` cost/tokens are not stored. Only `report_jobs.tokensUsed`/`costUsd` exists. | ⚠️ | M | schema + `ai-executor.ts`. |
| M4 | **In-process job queue** can't horizontally scale. Replace with BullMQ + Redis when traffic warrants. | ⚠️ | L | `server/services/job-queue.ts`. |
| M5 | **No frontend telemetry** (Mixpanel / PostHog). Hard to know which features are used. | ⚠️ | S | client. |
| M6 | **`AEO_MODE` dynamic at module load.** Requires restart to switch modes; would benefit from per-request override for testing. | ⚠️ | M | `server/config/aeo.ts`. |
| M7 | **`narrative-generator.ts` is 2,639 LoC.** Split prompt builders, schema definitions, GPT calls, and post-processors into separate modules. | ⚠️ | M | `server/services/narrative-generator.ts`. |
| M8 | **Visibility V1 weights sum to 2.4** intentionally; the heuristic-only path still uses V1 algebra. Decide whether V2 should fully supersede V1, then schedule deprecation. | ⚠️ | M | `server/services/visibilityScorer.new.ts`, `visibility-scoring.ts`. |
| M9 | **Reporting renderer assumes Playwright is available**; failures cascade to a `failed` job with a generic message. Add explicit fallback or fail-fast diagnostics. | ⚠️ | S | `server/services/pdf-renderer.ts`. |
| M10 | ~~**No CSP, HSTS, or other security headers. No Helmet middleware.**~~ Resolved in Task #37 — `helmet` is mounted in `server/index.ts` with a dev-vs-prod CSP, `crossOriginResourcePolicy=same-site`, and HSTS in prod. | ✅ | — | `server/index.ts`. |
| M11 | **Score color band / interpretation seeds** are not formally version-controlled — if seeded directly from `seed.ts`, bumping requires care. | ⚠️ | S | `server/seed.ts`. |
| M12 | **No retry policy on Anthropic / Gemini / Perplexity** beyond 429-aware single retry in batch executor. | ⚠️ | M | `ai-executor.ts`, `batch-executor.ts`. |
| M13 | **Reports `MAX_RETENTION` cleanup** logic should be auditable and idempotent. | ⚠️ | S | `report-job-processor.ts`. |
| M14 | **Stale Playwright host-deps warnings** appear in post-merge logs (`apt install` not available on the Replit Nix container). The crawler still works because the Nix `chromium` package is provided, but the warnings are noisy. Suppress in `postinstall` or document the intentional skip. | ⚠️ | S | `package.json` `postinstall`, `prd/11-`. |
| M15 | **`_shared.ts` vs `_helpers.ts` naming overlap.** `_shared.ts` holds singletons (`jobQueue`, `enrichmentService`); `_helpers.ts` holds tenancy helpers. Either consolidate (single `_internals/` folder) or rename so the distinction is obvious. | ⚠️ | S | `server/routes/_shared.ts`, `_helpers.ts`. |
| M16 | **Auth state in storage abstraction.** `server/auth.ts` reads `users` and `user_org_memberships` directly via Drizzle; everything else goes through `IStorage`. Adding `getUserByEmail`, `createUser`, `getUserMemberships`, `addUserToOrg` to `IStorage` keeps the storage layer the only place that touches the DB. | ⚠️ | S | `server/storage.ts`, `server/auth.ts`. |

## New tech-debt (post-merge, May 2026)

| # | Item | Severity | Effort | Where |
|---|------|----------|--------|-------|
| N1 | **Dev/prod DB-separation gotcha is docs-only.** No automated guard prevents an operator from running a prompt against dev and assuming it lands in prod. Could surface a banner on the dev URL ("You are on the dev environment") or check the host. | ⚠️ | S | docs + optional banner in `client/src/App.tsx`. |
| N2 | **`.config/pulse/` cleanup happens via `.gitignore` only.** A `predeploy` step that `find .config/pulse -type l -xtype l -delete`'s the dangling symlinks would be more robust if Replit ever stops respecting `.gitignore` during layer push. | 💡 | S | `.replit` build hook. |
| N3 | **No e2e regression test for the URL-driven selection contract** (Tasks #52/#53). Tracked as Task #54 in Drafts. Cover deep-link with `?clientId=`, fresh-tab open, the empty-state path when neither URL nor store has a `clientId`, the same-tab `selected-client-changed` custom event, and the cross-tab native `storage` event (which is what propagates a `localStorage` write to other tabs). | ⚠️ | M | new Playwright suite under `tests/e2e/`. |
| N6 | **`?clientId=` is only carried by sidebar `Link`s.** The top-navigation user dropdown (`top-navigation.tsx`) and the client-catalog "Open" button (`client-catalog.tsx:313–315`) navigate via `setLocation()` + `setSelectedClientId()` without a URL query. Same-tab works, but middle-click / open-in-new-tab on those surfaces won't carry the selection. | ⚠️ | S | `client/src/components/layout/top-navigation.tsx`, `client/src/pages/client-catalog.tsx`. |
| N4 | **`/auth/sessions/*` endpoints are not rate-limited.** Trivially abusable to enumerate session IDs or hammer the sign-out-others endpoint. Should reuse `auth-rate-limit.ts` patterns. | ⚠️ | S | `server/middleware/auth-rate-limit.ts`, `server/auth.ts`. |
| N5 | **No org switcher in the UI.** The data model and the URL-driven selection both already support it (Task #52); only the client-side seam is missing. | 💡 | M | `client/src/components/layout/top-navigation.tsx`. |

## 💡 Low / DX

| # | Item | Severity | Effort |
|---|------|----------|--------|
| L1 | Test coverage is currently the 50 supertest-based integration tests in `server/tests/routes-integration.test.ts` — extend to unit tests for the scorers and to a Playwright UI smoke pass. | 💡 | M |
| L2 | `data-testid` coverage on UI is uneven. Add to all interactive elements per `fullstack_js` guideline. | 💡 | M |
| L3 | Replace ad-hoc console tags with a `pino` (or similar) child-logger per module. | 💡 | M |
| L4 | Add a per-run "rerun this run" button that copies the same prompts/models into a fresh run. | 💡 | S |
| L5 | Frontend lacks an accessible focus indicator for some shadcn primitives in dark mode; audit and add. | 💡 | S |
| L6 | The seeded admin password (`[REMOVED: configure password in Replit Secrets]`) is well-known. Add a first-login forced-rotation path or surface a setup wizard the first time the seed account logs in. | 💡 | S |

## Cross-cutting performance ideas

- **Cache LLM responses** by `(prompt_text, model, vendor)` for a configurable TTL — large savings during repeated runs.
- **Stream responses** from OpenAI → store as they arrive (large prompts).
- **Use Postgres `LISTEN/NOTIFY`** for job-completion notifications instead of polling (avoids dead client polls when nothing is active).

## Recently resolved (post-merge)

These items were open in the original `/prd` pack and are now closed by merged work. They are kept here, not deleted, so the trail is auditable.

| # | Original item | Resolved by | How |
|---|---------------|-------------|-----|
| R10 | **Admin pages duplicated layout, header, KPI, status-badge and forbidden code in every file.** | Task #32 | `client/src/pages/admin/_shared.tsx` exports `AdminPageShell`, `PageHeader`, `StatRow`, `StatusBadge`, `TableState`, `AdminForbidden`, `roleBadgeClass`. Adopted by `admin-projects.tsx` (Task #32) and `admin-users.tsx` (Task #33); all preserved data-testids. |
| R11 | **Admin row-action popups occasionally left `<body>` `pointer-events:none` stuck**, freezing admin pages until reload. | Task #35 | `DropdownMenuItem.onSelect` wraps `setTimeout(fn, 0)` after `e.preventDefault()` so Radix unmounts the menu before the next overlay mounts; defensive `useEffect` clears stuck `pointer-events` 250 ms after every overlay flag returns to closed. `ManageMember` is now a right-side `Sheet` for parity with Projects. |
| R12 | **Login page used a single bare card** with no brand presence; no SSO seam, no "request access" affordance. | Task #34 | `client/src/pages/login.tsx` rewritten as a split-screen `lg:grid-cols-2` layout (cosmic-purple hero with wordmark + value props + secure-access card on the left, "Welcome back" form on the right) with Eye/EyeOff password toggle, client-only Remember-me, optional `VITE_ENABLE_SSO` button, and `VITE_REQUEST_ACCESS_EMAIL` mailto fallback. Mobile collapses to a centered form. Auth contract unchanged. |
| R13 | **Org membership implied access to every project**, with no per-user grants. | Task #26 | New `client_user_grants` join table; `_helpers.ts` filters every `/api/v1/clients`-scoped query by the caller's grants (admins/owner-grants are bypass-allowed). Admins manage grants from the Manage Member Sheet → Project access tab; Users page exposes an Access Matrix tab. |
| R14 | **Two parallel invitation surfaces** after credential grants shipped (legacy `invitations` table from Task #7 + `credential_grants` from Task #18). | Task #21 | Legacy `invitations` table dropped; `/api/v1/admin/orgs/:orgId/invitations*` and `/api/v1/auth/invitations/:token/accept` removed; admin Users page already used the unified `/credential-grants` surface. Schema dropped via `drizzle-kit push`. |
| R15 | **JobQueue health was visible only via curl `/api/admin/queue`** — no UI; no alerting. | Task #5 + Task #6 | Task #5 adds `server/services/queue-alerts.ts` (configurable poll, stuck/depth thresholds, dedup, webhook + Slack dispatch). Task #6 adds `/app/admin/queue` (`client/src/pages/admin/admin-queue.tsx`) with running/queued/stuck counts, recent failures, manual resume action; sidebar Admin section now lists Users / Projects / Queue / Audit. |
| R1 | **No authentication.** All `/api/v1/*` routes were open. | Task #2 (commit `4da231e`) | `server/auth.ts` adds passport-local + scrypt + 7-day cookie sessions; `setupAuth(app)` is wired from `server/index.ts:58`. Auth namespace at `/api/v1/auth/{me,login,register,logout}`. |
| R7 | **No RBAC; no admin module.** Any authenticated user could write/execute on any tenant they belonged to; there was no per-project owner, no invitation flow, no audit trail, and `/auth/register` was open to the world. | Task #7 | `server/privileges.ts` (canonical role matrix, surfaced in OpenAPI as `x-required-role`); `server/auth.ts: requireRole({minRole, scope})`; global `requireAuth` + `requireTenantAccessIfPresent` guard in `server/routes/index.ts`; admin module at `server/routes/admin-{users,projects}.ts` + `server/services/audit.ts`; new `clients.ownerUserId` FK + `invitations` + `audit_log` tables; frontend `client/src/{hooks/use-role.ts, pages/admin/*}`; integration coverage in `server/tests/rbac.test.ts`. Public registration is now gated behind `ALLOW_PUBLIC_REGISTRATION=true`. |
| R2 | **No tenant authorization.** Routes filtered by `clientId` from query/header without verifying the caller could access that client. | Task #2 | `users` + `user_org_memberships` tables (`shared/schema.ts`); `requireClientAccess` and `userHasOrgAccess` in `server/auth.ts` reject `403` when the session lacks membership for the target org. |
| R3 | **Duplicate `/api/v1/jobs` registration** in `server/routes.ts` (lines 382/406 and 1280/1289). | Task #3 (commit `531cb94`) | `server/routes/jobs.ts` (50 LoC) is the sole registration; the old monolith is now a 10-line re-export shim. |
| R4 | **`server/routes.ts` is 2,925 LoC** — split into per-domain routers. | Task #3 | 15 modules under `server/routes/` totalling 5,177 LoC; orchestrated by `server/routes/index.ts`. Tenancy standardized through `_helpers.ts`. |
| R5 | **No graceful shutdown.** SIGTERM didn't drain the JobQueue or stop heartbeats. | Task #4 (commit `89b126c`) | SIGTERM/SIGINT handlers in `server/index.ts:96–164`; `JobQueue.stopAcceptingJobs()` + `drain(SHUTDOWN_GRACE_MS)`; hard-exit at `SHUTDOWN_FORCE_MS`. Defaults 25s / 35s. |
| R6 | **No OpenAPI / API spec.** | Task #10 (commit `532fd09`) | `server/routes/openapi.ts: buildOpenApiDocument()` uses `@asteasolutions/zod-to-openapi` over the existing Zod schemas. Served at `/openapi.json` with a Swagger UI viewer at `/api/docs`. |
| R7 | **No typed API client on the frontend.** | Task #11 (commit `9194019`) | `scripts/generate-api-types.ts` runs `openapi-typescript` against the spec → `shared/api-types.ts`; `client/src/lib/api-client.ts` instantiates `openapi-fetch`. Re-exported as `apiClient` from `queryClient.ts`. |
| R8 | **Missing tests entirely.** | Task #12 (commit `72ea226`) | 50 supertest-based integration tests in `server/tests/routes-integration.test.ts` covering tenancy resolution, the consolidated `/api/v1/jobs` route, representative endpoints across other domain modules, and `/openapi.json` validity. Run via `npx tsx --test server/tests/routes-integration.test.ts`. |
| R9 | **No `/health` endpoint** (originally listed at L1 in the previous revision of this file). | Task #4 — **partially**; the helpers exist (`pingDatabase`, `getHealthStats`) but the route was lost during the Task #3 split. Promoted to **C2** above until re-wired. | See C2. |

| T56-A | **Cross-user idle discovery is invalidation-driven, not polled.** Per spec, `useClientActivity` is strictly `5000 \| false`; idle pages discover other-user starts only on remount/nav or the next mutation that calls `invalidateActivityQueries`. Acceptable trade-off; revisit if users complain. | Task #56 — open | Defer to Task #57/#58. |
| R16 | **`xray_analysis` jobs queued forever — no `JobQueue` handler.** `POST /api/v1/xray/analyze/batch` and the activity service both referenced the type, so jobs sat queued indefinitely and the "Active operations" banner could show "Running site X-Ray" forever. | Task #58 | New `processXRayAnalysis` worker in `server/services/job-queue.ts` runs structure extraction + `analyzeBatchPages` in chunks of 5; `recoverStaleJobs()` extended to fail `xray_analysis` rows older than the 15 min stale threshold. Recommendations fan-out and UI failure surface deferred (follow-ups #60, #61). |
| R17 | **Zombie `prompt_runs` showed as fake "in progress" pills.** After Task #56 shipped, the catalog showed bogus pills because executors don't write a heartbeat column and the dev DB had 13 rows stuck in non-terminal statuses since October 2025. | Task #59 | Boot-time `server/services/prompt-run-reaper.ts` calls `IStorage.reapStalePromptRuns(olderThanMs, reason)` after `seedDatabase()`; marks rows + items older than `STALE_PROMPT_RUN_AGE_MS` (default 30 min) as `error` (the canonical terminal-failure status — `statusEnum` has no `failed`). Periodic in-process reaping deferred (follow-up #62). |

## Active operations & job-queue follow-ups (open, post-Tasks #56/#58/#59)

| # | Item | Severity | Effort | Where |
|---|------|----------|--------|-------|
| T58-A | **X-Ray batch worker doesn't emit `recommendations` rows.** `processXRayAnalysis` only writes `xray_page_analysis`; the richer recommendations table is still produced only by `generateMetadata({ enableSiteXRay: true })`. | ⚠️ | M | `server/services/job-queue.ts: processXRayAnalysis`. Tracked as follow-up #60. |
| T58-B | **X-Ray UI doesn't surface `xray_analysis` job failures.** The Site X-Ray page silently leaves the previous analysis in place when a job errors out — no toast, no per-site indicator, no retry button. | ⚠️ | S | `client/src/pages/site-xray.tsx`; read `jobs.status='error'` + `result.error` payload. Tracked as follow-up #61. |
| T59-A | **Stale prompt-runs are only reaped at boot.** Task #59 catches zombies on workflow restart but a stuck run during normal operation will still surface as a fake pill until the next deploy. | ⚠️ | M | `server/services/prompt-run-reaper.ts` + `prompt_runs.heartbeat_at` (new column). Tracked as follow-up #62. |
| T56-B | **No two-context Playwright e2e for multi-user banner/chip.** Service-layer smoke (`server/tests/activity-multiuser.test.ts`) covers data flow; no browser harness exists in repo. | Task #56 — deferred | Add Playwright dual-context test once e2e infra lands. |
