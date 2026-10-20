# 22 — Validation and Gap Report

This is the meta-report on what the documentation pack does and does not cover, and where the codebase itself has gaps.

## Coverage scorecard

| Area | Coverage | Notes |
|------|----------|-------|
| Codebase inventory | ✅ Full | `01-`. |
| PRD / personas / JTBD | ✅ Full (personas inferred) | `02-`. Personas not authored anywhere in code; inferred from feature surfaces. |
| Pages & flows | ✅ Full | `03-`. `metadata-top-topics.tsx` flagged as unregistered. |
| Capability map | ✅ Full | `04-`. |
| Architecture + Mermaid | ✅ Full | `05-`. |
| Frontend architecture | ✅ Full | `06-`. |
| Backend architecture | ✅ Full | `07-`. |
| Database / data model | ✅ Full (JSONB shapes partially inferred) | `08-`. Some JSONB fields lack Zod schemas; canonical shape lives in service code. |
| API reference | ✅ Full | `09-`. Duplicate `/jobs` route surfaced as tech debt. |
| Tech stack & dependencies | ✅ Full | `10-`. |
| Env & deployment | ✅ Full | `11-`. |
| LLM models & orchestration | ✅ Full | `12-`. |
| Prompt library & schemas | ✅ Full (some prompt strings not reproduced verbatim) | `13-`. |
| Scoring logic | ✅ Full | `14-`, `15-`, `16-`. |
| Reporting | ✅ Full | `17-`. Snapshot data shape partially inferred. |
| Implementation framework | ✅ Full | `18-`. |
| Rebuild guide | ✅ Full | `19-`. |
| Tech-debt backlog | ✅ Full | `20-`. |
| Future agent context | ✅ Full | `21-`. |

## Confirmed gaps in the **codebase** (not docs)

These are real product/engineering gaps surfaced during documentation. They are listed here so that any future planner has them in one place.

### Functional / UX gaps
1. ~~**Authentication is missing** despite passport/session libs being installed.~~ **Resolved by Task #2** — see `Resolved gaps` below.
2. ~~**No tenant authorization checks**~~ — **Resolved by Task #2.**
3. **`metadata-top-topics.tsx` is not registered** in `client/src/App.tsx`.
4. ~~**No top-level error boundary** in the React app.~~ **Resolved by Task #114** — `ErrorBoundary` + `NetworkBanner` mounted at the App root; Task #131 layered permission-aware error toasts (`client/src/lib/api-errors.ts`).
5. ~~**`/api/v1/jobs` registered twice**~~ — **Resolved by Task #3.**
6. ~~**`GET /health` and `GET /api/admin/queue` advertised but unwired**~~ — **Resolved.** Wired in `server/routes/admin.ts` and registered from `server/routes/index.ts`. (See `20-` C2.)
7. ~~**`server/routes/index.ts` has a duplicate `export { jobQueue }`**~~ — **Resolved.** Single export; workflow boots cleanly. Tracked as `20-` C1.

### Reliability / safety gaps
8. ~~**No graceful shutdown** of the JobQueue on SIGTERM.~~ **Resolved by Task #4.**
9. **No rate limiting / quota** at the API layer — partially resolved by Task #37 (per-IP throttle on `/auth/login`, `/auth/register`, `/auth/forgot-password` via `server/middleware/auth-rate-limit.ts`); admin routes, `/auth/sessions/*`, and the data plane are still unthrottled.
10. ~~**No security headers (Helmet)**.~~ **Resolved by Task #37** — `helmet` mounted in `server/index.ts` with a dev-vs-prod CSP, `crossOriginResourcePolicy=same-site`, and HSTS in prod.
11. **Logs are unstructured `console.*`** with no shipper.
12. ~~**Session store is `memorystore`** — single-process; restarts log everyone out; cannot horizontally scale.~~ **Resolved by Task #8 (persistence, back-fill) + Task #37 (hardening) + Task #42 (ledger consistency).** `connect-pg-simple` is the active store; `memorystore` is the no-DB fallback only. Sessions survive restart, deploys, and autoscale.

### Data-model gaps
13. **Foreign-key indexes not declared** for high-cardinality joins (e.g. `answers.promptRunItemId`, `mentions.answerId`).
14. **JSONB shapes for `recommendations.examples`, `xrayPageAnalysis.gaps/actions`, `reportSnapshots.snapshotData`** are constructed in code but not declared as Zod schemas — risk of silent drift.
15. **Per-LLM-call cost/tokens not persisted** at the `answers`/`prompt_run_items` level. Only `report_jobs.tokensUsed`/`costUsd` exists.

### Scoring gaps
16. **Two parallel sentiment paths** (heuristic and LLM) with several fallback layers. Hard to reason about end-to-end behavior.
17. **V1 visibility scoring still in production** even though V2 exists (V2 not enabled in `.replit [userenv.shared]`).

### Reporting gaps
18. **No streaming / progress preview** of narrative as it generates (only percent updates).
19. **External file storage not used** — PDFs live on the deployment VM filesystem.

### Test / DX gaps
20. ~~**No automated tests**~~ — **Resolved by Task #12** (50 supertest tests in `server/tests/routes-integration.test.ts`). Coverage is still narrow — extend with scorer unit tests and a Playwright UI smoke pass.
21. **`data-testid` coverage is uneven** across components.
22. ~~**No OpenAPI spec** generated from the existing Zod schemas.~~ **Resolved by Task #10** — `server/routes/openapi.ts` builds the spec via `@asteasolutions/zod-to-openapi`; served at `/openapi.json`; Swagger UI at `/api/docs`. Frontend uses a typed `openapi-fetch` client (Task #11).

## Resolved gaps (post-merge)

| # | Gap | Resolved by | Evidence |
|---|-----|-------------|----------|
| R1 | No authentication. | Task #2 | `server/auth.ts: setupAuth`; `/api/v1/auth/{me,login,register,logout}` at `auth.ts:265–360`. Wired from `server/index.ts:58`. |
| R7 | RBAC + admin module: viewers could execute write/run endpoints; no per-project owner; no invitations; no audit log; public registration was on. | Task #7 | `server/privileges.ts` (matrix), `server/auth.ts: requireRole`, global guard in `server/routes/index.ts`, `server/routes/admin-{users,projects}.ts`, new `clients.ownerUserId` + `invitations` + `audit_log` tables, `client/src/pages/admin/*`, `server/tests/rbac.test.ts`. Public `/auth/register` now gated by `ALLOW_PUBLIC_REGISTRATION=true`. |
| R2 | No tenant authorization. | Task #2 | `users` + `user_org_memberships` tables (`shared/schema.ts`); `requireClientAccess` / `userHasOrgAccess` in `server/auth.ts`. |
| R3 | `/api/v1/jobs` registered twice. | Task #3 | `server/routes/jobs.ts` (50 LoC) — single registration; the legacy `server/routes.ts` is now a 10-line re-export shim. |
| R4 | `server/routes.ts` is 2,925 LoC monolith. | Task #3 | 15 per-domain modules under `server/routes/` totalling 5,177 LoC. Tenancy standardized in `server/routes/_helpers.ts`. |
| R5 | No graceful shutdown. | Task #4 | SIGTERM/SIGINT handlers in `server/index.ts:96–164`; `JobQueue.stopAcceptingJobs()` + `drain()`. Tunables `SHUTDOWN_GRACE_MS` (25s) / `SHUTDOWN_FORCE_MS` (35s). |
| R6 | No OpenAPI spec. | Task #10 | `server/routes/openapi.ts: buildOpenApiDocument()`; `/openapi.json` at line 1977; Swagger UI at `/api/docs` line 1988. |
| R7 | No typed frontend API client. | Task #11 | `scripts/generate-api-types.ts` → `shared/api-types.ts`; `client/src/lib/api-client.ts` (`openapi-fetch`); re-exported as `apiClient` from `queryClient.ts`. |
| R8 | No automated tests. | Task #12 | `server/tests/routes-integration.test.ts` — 50 supertest tests covering tenancy resolution, `/api/v1/jobs` consolidation, representative endpoints, and `/openapi.json` validity. |

## Documentation gaps (acknowledged, not pretended away)

- **Personas** in `02-` are inferred. The codebase does not author them.
- **Some JSONB shapes** (`xrayPageAnalysis.gaps`/`actions`, `reportSnapshots.snapshotData`) describe field names but not the exact subkeys for every variant. The canonical truth is the producing service file (`xray-content-analyzer.ts`, `report-snapshot.ts`, `report-aggregator.ts`).
- **Full prompt strings** in `13-` are summarized rather than reproduced verbatim where the prompt is large and embedded in a service file (e.g., `narrative-generator.ts`'s 100+ line system prompt). Refer back to the cited line ranges.
- **Per-route request/response shapes** in `09-` are described by intent and storage shape; some routes accept/return ad-hoc JSON not strictly typed. Trust the handler in `server/routes.ts` for the canonical shape.
- **Tenancy parameter casing is inconsistent** in the codebase itself: `/api/v1/clients` listing uses `?org_id=`, older client-scoped routes use `?client_id=`, newer ones use `?clientId=` or the `x-client-id` header. `09-` documents the breakdown but does not normalize it. Treat the route handler as authoritative.
- **Specific contract corrections** (recorded in `09-` and propagated to `17-`, `19-`, `21-`):
  - `POST /api/v1/reports/generate` accepts `{ clientId, runId }` (singular) and returns `202 { message, note }` — not `{ reportId, jobId }`.
  - `GET /api/v1/score-colors` requires `?category=Visibility|Sentiment|Position`; called once per category.
  - `GET /api/v1/xray/actions` requires `?siteId=`, not `?clientId=`.
  - `POST /api/v1/prompt-runs` returns `{ run, items }` (the created `prompt_runs` row + the per-prompt-model `prompt_run_items`), not `{ promptRunId }`.
- **JobQueue internals** are described at the contract level. The exact retry/heartbeat ordering for unusual failure modes (e.g., DB transient outage during heartbeat write) is not exhaustively traced.

## Open questions for future maintenance

- Should V2 visibility be made the default (and Replit `[userenv.shared]` updated)?
- Is `gpt-4-turbo-preview` still the right choice for onboarding/metadata, given `gpt-4o-mini` is the AEO default?
- Should `runCheckpoints` retain history (it's currently a single row per `promptRunId`)?
- Should the report retention policy be configurable per client (currently global)?

## Evidence checklist (sampling, for traceability)

- `server/config/aeo.ts` confirmed `composerWeights = { v: 0.5, s: 0.3, p: 0.2 }`, `temperature = 0`.
- `server/config/visibility-weights.ts` confirmed V1 = `{0.9, 0.6, 0.4, 0.5}` (sum 2.4), V2 = `{0.40, 0.30, 0.15, 0.15}` (sum 1.0).
- `server/services/composer.ts` confirmed nDCG formula and shrinkage formula.
- `server/services/scoring.ts` confirmed heuristic position decay constants.
- `server/services/ai-executor.ts` confirmed four-vendor switch and 429 → `isRateLimited`.
- `.replit` confirmed `[userenv.shared]`: `JOB_MAX_TIMEOUT_HOURS=8`, `LLM_MODEL=gpt-4o-mini`, `POSITION_SCORING_VERSION=v2`.
- `package.json` confirmed scripts and dependencies inventory used in `10-`.
- `client/src/App.tsx` confirmed Wouter route table used in `03-` and `06-`; confirmed `metadata-top-topics.tsx` is not present in the route registration; `/login` route now present.
- `server/routes/jobs.ts` confirms `/api/v1/jobs` and `/api/v1/jobs/:id` registered exactly once (the duplicate registration from the original monolithic `server/routes.ts` is gone).
- `server/auth.ts:265–360` confirms the four `/api/v1/auth/*` routes.
- `server/routes/openapi.ts:1977,1988` confirms `/openapi.json` and `/api/docs`.
- `server/index.ts:96–164` confirms SIGTERM/SIGINT shutdown handlers; `SHUTDOWN_GRACE_MS=25000` and `SHUTDOWN_FORCE_MS=35000` defaults at lines 106–107.
- `rg -n '"/health"|"/api/admin/queue"' server/` returns hits only inside comments / docstrings — no route module registers either endpoint.

### Verified counts (re-run with `rg -c` / `wc -l` on `2026-05-01` post-merge)

| Claim | Source | Verified count |
|-------|--------|----------------|
| `pgTable` declarations in `shared/schema.ts` | `rg -c "= pgTable\(" shared/schema.ts` | **33** (was 31; +`users`, +`user_org_memberships`) |
| `pgEnum` declarations in `shared/schema.ts` | `rg -c "= pgEnum\(" shared/schema.ts` | **20** (was 19; +`user_role_enum`) |
| LoC of `shared/schema.ts` | `wc -l shared/schema.ts` | **812** (was 753) |
| Files in `server/routes/` | `ls server/routes/*.ts \| wc -l` | **18** (15 domain modules + `index.ts` + `_shared.ts` + `_helpers.ts`) |
| LoC across `server/routes/*.ts` | `wc -l server/routes/*.ts` | **5,177** total |
| LoC of legacy `server/routes.ts` | `wc -l server/routes.ts` | **10** (re-export shim) |
| `server/auth.ts` LoC | `wc -l server/auth.ts` | **~350** |
| Integration tests in `server/tests/routes-integration.test.ts` | `rg -c "^test\(" server/tests/routes-integration.test.ts` | **50** |
| Files in `prd/` | `ls -1 prd/ \| wc -l` | **23** (00 index + 01–22) |
| Files in `client/src/pages/admin/` | `ls -1 client/src/pages/admin/*.tsx \| wc -l` | **5** (`_shared.tsx`, `admin-users.tsx`, `admin-projects.tsx`, `admin-queue.tsx`, `admin-audit.tsx`) |

## Task #8 closure (2026-05-04, back-fill)

- Closes backlog item H7 (memorystore single-process). `server/auth.ts: createSessionStore()` now returns a `connect-pg-simple` store reusing the Neon `pool` from `server/db.ts`; the store auto-creates the `session` table on first boot and prunes expired rows hourly.
- `SESSION_SECRET` is required under `NODE_ENV=production` (`server/auth.ts:771–775`); dev-only fallback is clearly labeled.
- `SESSION_STORE=memory` or `NODE_ENV=test` forces the in-process `memorystore` (`server/auth.ts:646,675`) so the test suite never touches Postgres.
- Logged-in users now stay signed in across server / workflow restarts, deploys, and autoscale events.

## Task #42 closure (2026-05-04)

- Keeps the `user_sessions` ledger that powers `/app/account/sessions` in lock-step with the connect-pg-simple `session` table.
- **Read-time filter**: `listUserSessionsForUser` and `countActiveUserSessions` (`server/db-storage.ts`) filter via `EXISTS (SELECT 1 FROM session WHERE sid = session_id AND expire > NOW())`.
- **Hourly sweep**: `setupAuth()` (`server/auth.ts:679,689`) schedules `pruneOrphanUserSessions()` (`server/services/sessions.ts`) on boot and every hour; physically deletes orphaned `user_sessions` rows.
- Both layers no-op under `SESSION_STORE=memory` / `NODE_ENV=test`.
- Adds `pruneOrphanUserSessions()` to `IStorage` (`server/storage.ts`).

## Tasks #52 / #53 closure (2026-05-06)

- Closes the long-standing "looks empty in a fresh tab" bug. Single source of truth for the selected `clientId` is now `client/src/hooks/use-selected-client-id.ts` (`useSelectedClientId`, `useUrlClientId`, `setSelectedClientId`).
- **Read priority** on every project-scoped page: `urlClientId || storedClientId` (URL wins). When both are null, page renders a "No Client Selected" empty state pointing the user at the top-nav project dropdown. No automatic `/api/v1/clients` fallback.
- `ProtectedRoute` runs a URL→store sync effect on every navigation; every project-scoped sidebar `Link` appends `?clientId=${selectedClientId}` so middle-click / open-in-new-tab carries the selection through. (Top-nav dropdown + client-catalog "Open" button still use `setLocation()` + `setSelectedClientId()` without a URL query; tracked as a follow-up.)
- E2e regression coverage tracked separately as Task #54 (Drafts).

## Task #37 closure (2026-05-04)
- Closes backlog items H1 (auth rate-limiting), H7 (session-store horizontal scale via `connect-pg-simple`), and M10 (Helmet baseline).
- Backlog item M16 (route auth state through `IStorage`) is **closed** for the new `user_sessions` surface — `IStorage` exposes the seven session-ledger methods, `DbStorage` owns the drizzle implementations, and `server/services/sessions.ts` is a thin Request-aware wrapper that delegates to storage. The user/membership reads in `server/auth.ts` are still pending an IStorage migration (tracked separately).
- Test coverage: `server/tests/sessions.test.ts` (12/12 green) covers CSRF presence/missing/matching/logout, session-fixation, sessions list/delete/sign-out-others, ownership isolation across users, forced-termination reason + audit emission, login rate-limit (11th attempt → 429), and Helmet headers. `rbac.test.ts` and `credential-grants.test.ts` continue to pass.
