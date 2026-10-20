# 09 — API Reference

## Activity (Task #56)

- `GET /api/v1/clients/:clientId/activity` → `{ items: ActivityItem[] }`.
  Returns in-flight jobs / prompt runs / report jobs for the project,
  most-recent first. Requires `requireAuth` + project-grant access.
- `GET /api/v1/clients/activity-summary?orgId=…` → `{ summaries: ActivitySummary[] }`.
  One entry per project that has any in-flight work, scoped to the
  caller's visible clients (`viewer`s see only granted; `admin`/`owner`
  see all in the org). Each summary carries `count`, `kinds[]` and the
  full `items[]` so catalog tooltips can render starter+time without an
  extra per-tile fetch.
- `GET /api/v1/prompt-runs/:id/selections` → `{ promptIds: string[]; modelIds: string[] }`.
  Used by Start-Prompt-Run dialog to detect overlapping selections
  with an in-flight run for the same project.

`ActivityItem` and `ActivitySummary` schemas live in `shared/schema.ts`
(see `activityItemSchema`, `activitySummarySchema`). Each item carries
`startedByUserId`, `startedByDisplayName`, `startedByEmail`,
`startedAt`, optional `progress`, and a `refId` used by
`activityItemHref()` to deep-link the user into the owning page.


> **Authoritative spec**: the runtime-authoritative API contract is `GET /openapi.json` (auto-generated from the existing Zod schemas via `@asteasolutions/zod-to-openapi` in `server/routes/openapi.ts: buildOpenApiDocument()`). A Swagger UI viewer is mounted at `GET /api/docs`. The frontend consumes a typed client (`openapi-fetch`) generated from the same spec — see `client/src/lib/api-client.ts` and `shared/api-types.ts`.

All `/api/v1/*` handlers live in **15 per-domain modules** under `server/routes/` (the legacy `server/routes.ts` is a 10-line re-export shim). Each module exports a `register<Domain>Routes(app)` function called from `server/routes/index.ts`. Prefix: `/api/v1/`.

## Authentication & authorization

All `/api/v1/*` routes (except the auth/invitation endpoints below) require an authenticated cookie session (`polaris.sid`). Authorization is enforced in three layers (Task #7):

1. **Global guard** (`server/routes/index.ts`): `requireAuth` + `requireTenantAccessIfPresent` reject unauthenticated callers with `401` and cross-tenant callers with `403` before any handler runs.
2. **Per-route role check** (`server/auth.ts: requireRole({minRole, scope})`): every mutating/execute route declares its minimum role. Roles are ordered `viewer < member < admin`. Viewers are blocked from every write/execute/admin endpoint; members can write/execute; admins manage members, project settings, hard-delete projects, and read the audit log. (The legacy `owner` role was merged into `admin` in May 2026.)
3. **Privilege matrix** (`server/privileges.ts`): single source of truth — ~40 entries with method, route pattern, bucket (`read`/`write`/`execute`/`admin`), `minRole`, and `scope` (`org`/`client`/`none`). Surfaced in OpenAPI as `x-required-role`. Swept by `server/tests/rbac.test.ts`.

`POST /api/v1/auth/register` is **gated**: returns `403` unless `ALLOW_PUBLIC_REGISTRATION=true`. New users join via the invitation flow.

| Method | Path | Public? | Source | Purpose |
|--------|------|---------|--------|---------|
| GET | `/api/v1/auth/me` | yes | `server/auth.ts` | Returns `{ user, orgIds, memberships: [{orgId, role}] }` for the authenticated session, or `401`. |
| POST | `/api/v1/auth/login` | yes | `server/auth.ts` | Body: `{ email, password }`. Sets the session cookie. |
| POST | `/api/v1/auth/register` | gated | `server/auth.ts` | Body: `{ email, password, displayName?, orgId? }`. Returns `403` unless `ALLOW_PUBLIC_REGISTRATION=true`. |
| POST | `/api/v1/auth/logout` | yes | `server/auth.ts` | Destroys the session and clears the cookie. |
| POST | `/api/v1/auth/invitations/:token/accept` | yes | `server/routes/admin-users.ts` | Body: `{ password, displayName? }`. Creates user + membership from a valid (non-expired, non-accepted) invitation token, then logs in. |

### Admin module endpoints (Task #7)

| Method | Path | Min role | Source |
|--------|------|----------|--------|
| GET | `/api/v1/admin/orgs/:orgId/members` | admin | `server/routes/admin-users.ts` |
| POST | `/api/v1/admin/orgs/:orgId/members` | admin | `server/routes/admin-users.ts` |
| PATCH | `/api/v1/admin/orgs/:orgId/members/:userId` | admin | `server/routes/admin-users.ts` |
| DELETE | `/api/v1/admin/orgs/:orgId/members/:userId` | admin | `server/routes/admin-users.ts` |
| GET | `/api/v1/admin/orgs/:orgId/invitations` | admin | `server/routes/admin-users.ts` |
| POST | `/api/v1/admin/orgs/:orgId/invitations` | admin | `server/routes/admin-users.ts` |
| DELETE | `/api/v1/admin/orgs/:orgId/invitations/:id` | admin | `server/routes/admin-users.ts` |
| GET | `/api/v1/admin/orgs/:orgId/audit` | **admin** | `server/routes/admin-users.ts` |
| PATCH | `/api/v1/admin/clients/:id` | admin | `server/routes/admin-projects.ts` (rename / `ownerUserId` reassign / `isActive=false` soft-delete) |
| DELETE | `/api/v1/clients/:id` | **admin** | `server/routes/clients.ts` (hard delete) |

## Tenancy conventions (read this first)

Tenancy is now standardized through `server/routes/_helpers.ts`:

- `getClientId(req)` reads, in priority order: `x-client-id` header (lifted onto `req.clientId` by `/api/v1` middleware in `routes/index.ts`) → `?clientId=` (recommended) → `?client_id=` (legacy snake_case, kept for backwards compatibility).
- `requireClientId(req, res)` is the same as `getClientId` but writes a `400` and returns `null` when none is provided.
- `getOrgId(req)` reads `?orgId=` (recommended) → `?org_id=` (legacy snake_case).

Per-route casing notes (the modules accept *all* of the above; the column reflects the parameter the OpenAPI spec advertises and that the frontend passes today):

- **`GET /api/v1/clients`**: `?org_id=` (legacy snake_case retained for the catalog page).
- **`GET /api/v1/clients/validate-project-name`**: `?orgId=`, `?projectName=`, `?excludeId=`.
- **Most other client-scoped routes**: `x-client-id` header (preferred) or `?clientId=`. Older callers may still send `?client_id=`.
- **`GET /api/v1/score-colors`**: `?category=` is required and must be `Visibility` | `Sentiment` | `Position`; otherwise `400`.
- **`GET /api/v1/xray/actions`**: `?siteId=` is required (not `clientId`); `?owner=` and `?effort=` are optional.

## Operational endpoints

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/openapi.json` | ✅ wired (`server/routes/openapi.ts:1977`) | OpenAPI 3 document built from Zod schemas. |
| GET | `/api/docs` | ✅ wired (`server/routes/openapi.ts:1988`) | Minimal Swagger UI viewer (CDN-loaded). |
| GET | `/health` | ✅ wired | `server/routes/admin.ts` calls `pingDatabase()` + `getHealthStats()` and is registered from `server/routes/index.ts`. |
| GET | `/api/admin/queue` | ✅ wired | `server/routes/admin.ts` exposes the `JobQueue` config/health alongside `/health`. |

## Organizations

| Method | Path | Source | Purpose |
|--------|------|--------|---------|
| GET | `/api/v1/organizations/:id` | `server/routes/clients.ts` | Read org by id. |

## Clients

`server/routes/clients.ts` (389 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/clients?org_id=` | List clients for org. |
| GET | `/api/v1/clients/validate-project-name?orgId=&projectName=&excludeId=` | Check uniqueness of `projectName` for org. |
| POST | `/api/v1/clients` | Create client (uses `CreateClient` schema). |
| GET | `/api/v1/clients/:id` | Read one client. |
| PUT | `/api/v1/clients/:id` | Update client (partial). |
| DELETE | `/api/v1/clients/:id` | Soft/hard delete (per `db-storage.deleteClient`). |
| POST | `/api/v1/clients/:id/copy` | Clone an existing client. |
| POST | `/api/v1/clients/:id/generate-metadata` | Enqueue metadata-generation job. |
| GET | `/api/v1/clients/:id/models` | List models selected for this client. |
| PUT | `/api/v1/clients/:id/models` | Replace selected models. |
| POST | `/api/v1/clients/:id/refresh-prompts` | Re-generate prompts from current topics. |

## Onboarding

`server/routes/onboarding.ts` (108 LoC).

| Method | Path | Purpose | LLM |
|--------|------|---------|-----|
| POST | `/api/v1/onboarding/enrich-urls` | Suggest mainUrl, otherUrls, focusAreas from name. | `OnboardingEnrichmentService.enrichUrls`. |
| POST | `/api/v1/onboarding/enrich-profile` | Suggest industry, geography, brand aliases. | `enrichProfile`. |
| POST | `/api/v1/onboarding/enrich-competitors` | Suggest competitors with aliases. | `enrichCompetitors`. |

## Jobs

`server/routes/jobs.ts` (50 LoC). Consolidated — the old monolith registered `/api/v1/jobs` and `/api/v1/jobs/:id` twice; both registrations are now collapsed into the single (filterable) implementation in this module.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/jobs` | List jobs. Optional tenancy filter via `getClientId(req)`. |
| GET | `/api/v1/jobs/:id` | Read job; `404` if missing. |

## Competitors

`server/routes/competitors.ts` (42 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/competitors?client_id=` | List competitors for client. |
| POST | `/api/v1/competitors` | Create competitor. |
| DELETE | `/api/v1/competitors/:id` | Delete competitor. |

## AI Models

`server/routes/ai-models.ts` (28 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/ai-models` | List all enabled AI models from `aiModels`. |

## Topics

`server/routes/topics.ts` (67 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/topics/:clientId` | List topics for client. |
| GET | `/api/v1/topics?clientId=` | Same as above (query variant). |
| POST | `/api/v1/topics` | Create topic. |
| PUT | `/api/v1/topics/:id` | Update topic. |
| DELETE | `/api/v1/topics/:id` | Delete topic. |

## Prompts

`server/routes/prompts.ts` (104 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/prompts/:clientId` | List prompts for client. |
| GET | `/api/v1/prompts?clientId=` | Same as above (query variant). |
| POST | `/api/v1/prompts` | Create prompt (sets category if recognized). |
| PUT | `/api/v1/prompts/:id` | Update prompt. |
| DELETE | `/api/v1/prompts/:id` | Delete prompt. |
| GET | `/api/v1/prompt-categories` | List prompt categories. |

## Prompt runs

`server/routes/prompt-runs.ts` (588 LoC — the largest domain module).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/prompt-runs?clientId=` | List runs for client. |
| GET | `/api/v1/prompt-runs/metadata?clientId=` | Compact list (id, name, status, createdAt). |
| POST | `/api/v1/prompt-runs` | Start a new run. Body: `{ clientId, promptIds[], modelIds[], createdBy?, name? }` (Zod-validated). Returns `{ run, items }`. |
| GET | `/api/v1/prompt-runs/:id` | Read run summary. |
| PATCH | `/api/v1/prompt-runs/:id` | Update run metadata (e.g. `name`, `status`). |
| GET | `/api/v1/prompt-runs/:id/results` | Full per-item results (joined with answers/mentions/rankings/citations). |
| POST | `/api/v1/prompt-runs/:id/recalculate-position` | Re-run position scoring for a completed run. |
| GET | `/api/v1/prompt-runs/:id/errors` | Errors per item. |
| GET | `/api/v1/prompt-runs/:id/logs` | Structured logs (`prompt_run_logs`). |
| DELETE | `/api/v1/prompt-runs/:id` | Delete run cascade. |
| POST | `/api/v1/prompt-runs/:id/stop` | Cancel run (sets `cancelledJobs`). |
| GET | `/api/v1/prompt-runs/:id/score-explanation/:category` | Returns `score_factors` for the run by category. |
| GET | `/api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks` | Per-prompt client vs competitor benchmarks. |
| GET | `/api/v1/prompt-runs/:runId/prompts/:promptId/metric-details` | Drill-down per metric. |
| GET | `/api/v1/prompt-runs/:runId/benchmarks-bulk` | Bulk benchmark fetch. |

## Score colors

`server/routes/score-colors.ts` (29 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/score-colors?category=` | Returns `score_color_bands` filtered by `category`. **`category` is required and must be one of `Visibility`, `Sentiment`, `Position`** — otherwise returns `400`. The frontend calls this once per category. |

## Dashboard

`server/routes/dashboard.ts` (216 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/dashboard/stats` | Top-line client KPIs (latest scores, counts). |
| GET | `/api/v1/dashboard/historical-scores` | Time series across runs. |
| GET | `/api/v1/dashboard/top-topics` | Top topics by mention/score. |
| GET | `/api/v1/dashboard/recent-runs` | Recent runs. |
| GET | `/api/v1/dashboard/competitor-rankings` | Aggregated competitor table. |

## Opportunities

`server/routes/opportunities.ts` (211 LoC). Covers citations, recommendations, and content drafts.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/opportunities/citations?clientId=&promptRunId=` | Citations grouped by domain. |
| GET | `/api/v1/opportunities/citations/domain/:domain?clientId=&promptRunId=` | Drill-down per domain. |
| GET | `/api/v1/opportunities/recommendations?clientId=&promptRunId=` | List recommendations. |
| GET | `/api/v1/opportunities/recommendations/stats` | Counts by severity/category/source. |
| GET | `/api/v1/opportunities/recommendations/summary` | Deduped, sortable, paginated. |
| POST | `/api/v1/opportunities/recommendations` | Manual create. |
| POST | `/api/v1/opportunities/recommendations/generate` | Trigger AI generation (`content-recommendation-analyzer.ts`, `gpt-4o-mini`). |
| GET | `/api/v1/opportunities/content?clientId=&promptRunId=` | Generated content drafts. |
| POST | `/api/v1/opportunities/content/generate` | Generate new draft (uses `openai-service.ts`). |

## Site X-Ray

`server/routes/xray.ts` (241 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/xray/sites?clientId=` | Sites with metrics. |
| GET | `/api/v1/xray/sites/:siteId` | One site detail. |
| POST | `/api/v1/xray/sites/:siteId/refresh-health` | Trigger dual-UA health refresh. |
| GET | `/api/v1/xray/sites/:siteId/pages` | Page summary list. |
| GET | `/api/v1/xray/pages/:pageId` | Page detail (raw + structure). |
| GET | `/api/v1/xray/pages/:pageId/analysis` | AI analysis (`xray_page_analysis`). |
| POST | `/api/v1/xray/analyze/batch` | Batch AI analysis with retry. |
| GET | `/api/v1/xray/actions?siteId=&owner=&effort=` | Aggregated next-actions across pages. **`siteId` is required**, not `clientId`. |

## Crawler (utility)

`server/routes/crawler.ts` (451 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/crawler/execute` | Synchronous one-URL crawl. |
| POST | `/api/v1/crawler/execute/async` | Async crawl as a job. |
| GET | `/api/v1/crawler/jobs/:jobId` | Read async crawl job. |
| POST | `/api/v1/crawler/format-for-llm` | Take crawl JSON, return LLM-ready text. |
| POST | `/api/v1/crawler/crawl-and-format` | Combined crawl + format. |

## Reports

`server/routes/reports.ts` (527 LoC).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/reports?clientId=` | List report snapshots. |
| POST | `/api/v1/reports/generate` | Start a report job. Body: `{ clientId, runId }` (single id). Returns `202 { message, note }`; the snapshot/job ids are written asynchronously and discovered via subsequent `GET /api/v1/reports?client_id=` polling. |
| GET | `/api/v1/reports/:id` | Snapshot summary. |
| GET | `/api/v1/reports/:id/sections` | Section narrative content (`report_sections`). |
| GET | `/api/v1/reports/:id/files` | Files (`report_files`). |
| GET | `/api/v1/reports/:id/download/pdf` | Insights PDF download. |
| GET | `/api/v1/reports/:id/download/appendix` | Technical Appendix PDF download. |
| GET | `/api/v1/reports/:id/export` | JSON / CSV ZIP export. |
| GET | `/api/v1/reports/:id/job` | Report job status (progress percent, step, model used, tokens, cost). |
| DELETE | `/api/v1/reports/:id` | Delete snapshot + files. |

## Errors

All routes funnel uncaught errors through the global error handler in `server/index.ts`:

```ts
app.use((err, req, res, next) => {
  res.status(err.status || err.statusCode || 500).json({ message: err.message || 'Internal Server Error' });
  throw err;
});
```

## Notes / **Tech-debt**

- The previous monolithic `server/routes.ts` (2,925 LoC, 87 registrations, with two duplicate `/api/v1/jobs` registrations) is gone. `server/routes.ts` is now a 10-line re-export shim. See `20-optimization-and-technical-debt-backlog.md` "Recently resolved (post-merge)".
- `/health` and `/api/admin/queue` are advertised by `replit.md` and the Task #4 commit but are **not currently registered** by any route module — they were lost during the per-domain split. Tracked in `20-` and `22-`.
- The OpenAPI spec is generated from Zod and is the canonical contract. To regenerate the typed frontend client after schema/route changes: `npx tsx scripts/generate-api-types.ts`.

## Session endpoints (Task #37)
- `GET /api/v1/auth/sessions` — returns `{ currentSessionId, sessions: [{ sessionId, userAgent, ipAddress, createdAt, lastSeenAt, current }] }`.
- `DELETE /api/v1/auth/sessions/:id` — destroys the express-session store row AND the `user_sessions` mirror. Always 204 (no foreign-id leak). If the caller revokes their own current session, the response also clears `polaris.sid`.
- `POST /api/v1/auth/sessions/sign-out-others` — bumps the user's `sessionEpoch`, prunes sibling rows, returns `{ ok: true, newEpoch }`. Current session is re-stamped so the caller stays signed in.

All three are CSRF-protected (require `x-csrf-token` matching the `polaris.csrf` cookie). 401 responses across `/api/v1` now include `{ reason: "idle_timeout" | "absolute_timeout" | "session_revoked" | "account_disabled" }` so the SPA can broadcast it to sibling tabs.

### CSRF protection (Task #37)

Every state-changing `/api/v1` request must include an `x-csrf-token` header whose value matches the `polaris.csrf` cookie (set on every response by `csrfTokenIssuer()`, non-httpOnly so the SPA can read it). `GET`, `HEAD`, and `OPTIONS` are never enforced. Mismatch / missing returns `403 { message: "CSRF token missing or invalid", code: "csrf_failed" }`. Implemented in `server/middleware/csrf.ts`; the same `isCsrfExempt(path)` helper is the single source of truth for both the global middleware and the route-level public-path guard in `server/routes/index.ts` (re-exported as `isCsrfExemptApiV1`). The frontend fetch helpers (`client/src/lib/api-client.ts`, `client/src/lib/queryClient.ts`) read the cookie and inject the header automatically.

**Auth-bootstrap exemptions** (no CSRF header required — the request itself authenticates):
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/forgot-password`
- `GET  /api/v1/auth/credential-grants/:token` (status check)
- `POST /api/v1/auth/credential-grants/:token/redeem`

**`POST /api/v1/auth/logout` is NOT exempt** (Task #37 review): the SPA always echoes the cookie in the header, and any caller without the header should not be able to terminate someone else's session via a forged POST.

Test/integration bypass: when both `NODE_ENV=test` AND `TEST_AUTH_BYPASS=true`, CSRF is skipped wholesale.

### Auth rate limits (Task #37)

Per-IP via `express-rate-limit`, set in `server/middleware/auth-rate-limit.ts`. Skipped when `NODE_ENV=test` OR `RATE_LIMIT_BYPASS=true` (deliberately a separate knob from `TEST_AUTH_BYPASS` so the integration suite can run with CSRF + auth ON while still letting supertest replay from a single loopback IP).

| Endpoint | Default cap | Env override | 429 `code` |
|----------|-------------|--------------|------------|
| `POST /api/v1/auth/login` | 10 / minute | `AUTH_LOGIN_RATE_PER_MIN` | `rate_limit.login` |
| `POST /api/v1/auth/register` | 5 / hour | `AUTH_REGISTER_RATE_PER_HOUR` | `rate_limit.register` |
| `POST /api/v1/auth/forgot-password` | 5 / hour | `AUTH_FORGOT_RATE_PER_HOUR` | `rate_limit.forgot_password` |

Throttled requests respond `429 { message: "Too many <scope> attempts — try again in <N>s", retryAfterSeconds, code: "rate_limit.<scope>" }`.
