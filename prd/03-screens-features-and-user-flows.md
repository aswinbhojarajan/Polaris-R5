# 03 — Screens, Features, and User Flows

This catalog describes every page in `client/src/pages` registered in `client/src/App.tsx`, plus the end-to-end flows that span them.

For each page: route, primary purpose, key components used, frontend API calls, backend routes invoked, services and tables touched, LLM calls, and known limitations.

> **Authoritative API contract**: route paths, methods, query/body parameter casing, and response shapes are normalized in **`09-api-reference.md`**, which in turn cites the per-domain route modules under `server/routes/` (the legacy `server/routes.ts` is now a 10-line re-export shim). The runtime-authoritative spec is `GET /openapi.json` (auto-generated from Zod) with a Swagger UI viewer at `GET /api/docs`.

## End-to-end primary flow

```
Landing → Client Catalog → (Create Client wizard or pick existing)
   → Onboarding enrichment (URLs, profile, competitors)
   → Generate Metadata (crawl + topics + prompts)
   → Topics & Keywords / Prompt Library curation
   → Start Prompt Run (select prompts, models)
   → JobQueue executes prompts × models, scores, persists
   → Dashboard (scores, trends, competitor table, recent runs)
   → Citation Analysis / Recommendations / Content Generator (per-run filters)
   → Reports → generate Insights PDF + Technical Diagnostic Appendix PDF
   → Re-run later → Historical scores update
```

Selected runs propagate through screens via the `runId` query param (see `OpportunityRunFilter.tsx`, `RunFilterBar.tsx`).

---

## Page-by-page catalog

### `/` — Landing (`landing.tsx`)
- **Purpose**: marketing/landing entry; CTA into `/app`.
- **Auth**: public.

### `/login` — Login (`login.tsx`)
- **Purpose**: email/password sign-in. Posts to `POST /api/v1/auth/login` (passport-local). On success, the cookie session is set and the page redirects to `/app/clients`.
- **Layout** (Task #34): split-screen on `lg+` — left brand panel (cosmic-purple hero with wordmark, value props, and "Secure workspace access" card baked into `attached_assets/image_1777956038609.png`) + right "Welcome back" form panel. Mobile collapses to a single centered form. Form fields: email, password (with Eye/EyeOff visibility toggle), client-only Remember-me checkbox, Forgot password link, full-width Sign in button, optional "Continue with SSO" outline button (hidden unless `VITE_ENABLE_SSO=true`; click shows a "SSO coming soon" toast), and a "Don't have an account? Request access" footer that opens `mailto:VITE_REQUEST_ACCESS_EMAIL` or shows a "Contact your organization admin" toast. Preserved test ids: `text-login-title`, `input-email`, `input-password`, `link-forgot-password`, `text-login-error`, `button-submit-login`. New: `button-toggle-password`, `checkbox-remember-me`, `button-sso` (when visible), `link-request-access`.
- **Backend routes**: `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- **Auth**: public (entry point). New users join via credential-grant tokens issued by an admin (`POST /api/v1/admin/orgs/:orgId/credential-grants` → recipient hits `POST /api/v1/auth/credential-grants/:token/accept`); the legacy `invitations` table and `/auth/invitations/:token/accept` endpoint were retired in Task #21. Public self-registration is disabled by default — it returns 403 unless `ALLOW_PUBLIC_REGISTRATION=true`. The seeded admin (`admin@polaris.local`) is created on boot as `admin` of `default-org` if absent.

### `/app/account/sessions` — Active Sessions (Task #37, `client/src/pages/account/sessions.tsx`)
- **Audience**: any authenticated user, accessed from the user dropdown in `top-navigation.tsx`.
- **Purpose**: self-service device list. One row per active session with parsed user-agent (inline regex helper — no `ua-parser-js` AGPL dep), IP, created-at, last-seen-at, and a **current** badge on the caller's row.
- **Actions**: per-row "Revoke" (calls `DELETE /api/v1/auth/sessions/:id`; revoking the current session also clears `polaris.sid`), and a one-click "Sign out of all other sessions" button (calls `POST /api/v1/auth/sessions/sign-out-others`, which bumps the user's `sessionEpoch` so every other tab/device is force-terminated on its next request).
- **Backend routes**: `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id`, `POST /api/v1/auth/sessions/sign-out-others`. All CSRF-protected.
- **Cross-tab**: revocations broadcast through `BroadcastChannel("polaris-auth")` so sibling tabs clear the React Query cache and bounce to `/login` immediately.
- **Consistency (Task #42)**: the list is filtered via `EXISTS (SELECT 1 FROM session WHERE sid = session_id AND expire > NOW())` so sessions whose underlying connect-pg-simple row was already pruned never appear; an hourly sweep (`pruneOrphanUserSessions`) physically deletes orphaned `user_sessions` rows.

### Admin module (`/app/admin/{users,projects,queue,audit}`)
- **Audience**: admins only (gated by `useRole().canAdmin`; the sidebar Admin section is hidden otherwise).
- **Design system**: every admin page is built on the shared primitives in `client/src/pages/admin/_shared.tsx` (`AdminPageShell`, `PageHeader`, `StatRow`, `StatusBadge`, `TableState`, `AdminForbidden`, `roleBadgeClass`) introduced in Task #32 and adopted by `admin-users.tsx` (Task #33). See `prd/06-frontend-architecture.md → Admin design system` for the catalog.
- **Users & Invitations** (`admin-users.tsx`): three tabs — **Members** (search + role filter + bulk activate/disable/sign-out, per-row dropdown with reset/temp-password/disable/remove, and a right-side **Manage Member** Sheet with role + per-project access tabs from Task #26), **Invitations & Resets** (pending credential-grant invites and self-service password reset tokens), and **Access Matrix** (which member sees which project). Invitations are single-use, sha256-hashed, 7-day expiry, issued via `POST /api/v1/admin/orgs/:orgId/credential-grants` and accepted at `POST /api/v1/auth/credential-grants/:token/accept`.
- **Projects** (`admin-projects.tsx`): search + status & owner filters + sortable columns + multi-select bulk activate/disable; row-click opens a right-side **Project properties** Sheet for rename, owner reassignment (`clients.ownerUserId`), or soft-delete (`isActive=false`). Hard delete (`DELETE /api/v1/clients/:id`) requires admin role.
- **Queue** (Task #6, `admin-queue.tsx`): JobQueue health from `GET /api/admin/queue` — running / queued / stuck job counts, recent failures, and a manual **resume stuck jobs** action. Backed by the alerting service introduced in Task #5 (`server/services/queue-alerts.ts`).
- **Audit log** (`admin-audit.tsx`): admins only — read-only feed of admin actions from the `audit_log` table.

### `/app` — Redirect (in `App.tsx`)
- If `localStorage['current-client-id']` is set → `/app/dashboard`, else → `/app/clients`.
- `ProtectedRoute` (`client/src/components/protected-route.tsx`) now performs a real check via `GET /api/v1/auth/me`; unauthenticated users are redirected to `/login`. The legacy "selected client" gate is layered on top of the auth gate.

### `/app/clients` — Client Catalog (`client-catalog.tsx`)
- **Purpose**: pick or create a client (project).
- **Components**: `client-selector.tsx`, `create-client-wizard.tsx`.
- **Backend routes**:
  - `GET /api/v1/clients?org_id=...` *(snake_case; verified at `server/routes.ts:56`)*
  - `GET /api/v1/clients/validate-project-name`
  - `POST /api/v1/clients`
  - `POST /api/v1/clients/:id/copy`
  - `POST /api/v1/onboarding/enrich-urls`, `/enrich-profile`, `/enrich-competitors`
- **Services**: `OnboardingEnrichmentService` (`onboarding-enrichment.ts`), `db-storage.createClient`.
- **LLM**: `getClient()` from `server/llm/client.ts` (provider depends on `LLM_PROVIDER`/keys; default `openai`/`gpt-4o-mini`).
- **Limitations**: no preview of crawled URLs before save.

### `/app/dashboard` — Dashboard (`dashboard.tsx`)
- **Purpose**: aggregate scores, historical trends, recent runs, top topics, competitor rankings.
- **Components**: `category-dashboard-tiles.tsx`, `RunFilterBar.tsx`, `ComparisonTable.tsx`, `score-explainability-modal.tsx`, `recommendations-summary.tsx`.
- **Backend routes**:
  - `GET /api/v1/dashboard/stats`
  - `GET /api/v1/dashboard/historical-scores`
  - `GET /api/v1/dashboard/top-topics`
  - `GET /api/v1/dashboard/recent-runs`
  - `GET /api/v1/dashboard/competitor-rankings`
  - `GET /api/v1/score-colors`
  - `GET /api/v1/prompt-runs/:id/score-explanation/:category`
- **Services**: `db-storage.getClientAggregatedScores`, `getHistoricalScores`, `getAggregatedCompetitorScores`.
- **Tables**: `prompt_runs`, `prompt_run_items`, `answers`, `competitor_scores`, `score_factors`, `score_color_bands`, `score_interpretations`.
- **Limitations**: Aggregations rely on the latest run unless `runIds` is passed.

### `/app/prompts` — Prompts Tracker (`prompts-tracker.tsx`)
- **Purpose**: launch and track prompt runs.
- **Components**: `start-run-dialog.tsx`, `run-details-drawer.tsx`, `run-details-section.tsx`.
- **Backend routes**:
  - `GET /api/v1/prompt-runs`, `:id`, `:id/results`, `:id/errors`, `:id/logs`
  - `POST /api/v1/prompt-runs` (start)
  - `PATCH /api/v1/prompt-runs/:id`
  - `POST /api/v1/prompt-runs/:id/stop`
  - `POST /api/v1/prompt-runs/:id/recalculate-position`
  - `DELETE /api/v1/prompt-runs/:id`
- **Services**: `JobQueue`, `prompt-run-executor.ts`, `ai-executor.ts`, `composer.ts`, `competitor-scoring.ts`.
- **Tables**: `prompt_runs`, `prompt_run_items`, `answers`, `mentions`, `rankings`, `citations`, `competitor_scores`, `prompt_run_logs`, `run_checkpoints`.
- **LLM**: depends on selected `aiModels` (OpenAI / Anthropic / Google / Perplexity) — see `12-llm-models-prompts-and-orchestration.md`.

### `/app/client-config` — Client Configuration (`client-configuration.tsx`)
- **Purpose**: edit client profile, competitors, AI model selection.
- **Backend routes**:
  - `GET/PUT /api/v1/clients/:id`
  - `GET /api/v1/competitors?client_id=...` *(snake_case; verified at `server/routes.ts:421`)*
  - `POST/DELETE /api/v1/competitors[/:id]`
  - `GET /api/v1/ai-models`, `GET/PUT /api/v1/clients/:id/models`
  - `POST /api/v1/clients/:id/generate-metadata`
  - `POST /api/v1/clients/:id/refresh-prompts`
- **Services**: `openai-service.ts` (metadata via `gpt-4-turbo-preview`), `JobQueue` (background).

### `/app/site-xray` — Site X-Ray (`site-xray.tsx`)
- **Purpose**: technical AI-readiness audit of the client's site(s).
- **Backend routes**:
  - `GET /api/v1/xray/sites`
  - `GET /api/v1/xray/sites/:siteId`
  - `POST /api/v1/xray/sites/:siteId/refresh-health`
  - `GET /api/v1/xray/sites/:siteId/pages`
  - `GET /api/v1/xray/pages/:pageId`
  - `GET /api/v1/xray/pages/:pageId/analysis`
  - `POST /api/v1/xray/analyze/batch`
  - `GET /api/v1/xray/actions`
- **Services**: `website-crawler.ts`, `xray-ingestion.ts`, `xray-health-probe.ts` (dual-UA), `xray-structure-parser.ts`, `xray-content-analyzer.ts` (GPT), `xray-entity-extractor.ts`, `xray-topic-mapper.ts`.
- **Tables**: `xray_sites`, `xray_pages`, `xray_page_structure`, `xray_page_analysis`.

### `/app/topics-keywords` — Topics & Keywords (`metadata-topics.tsx`)
- **Purpose**: manage topics / keywords used to seed prompts.
- **Backend routes**:
  - `GET/POST /api/v1/topics[/:clientId]`
  - `PUT/DELETE /api/v1/topics/:id`
- **LLM**: topics may originate from `openai-service.ts: generateMetadataFromWebsite` or `generateAITopicsFromMetadata`.

### `/app/prompt-library` — Prompt Library (`metadata-prompts.tsx`)
- **Purpose**: manage prompts and their categories.
- **Backend routes**:
  - `GET/POST/PUT/DELETE /api/v1/prompts[/:id]` and `/api/v1/prompts/:clientId`
  - `GET /api/v1/prompt-categories`
- **Services**: `prompt-classifier.ts` for category assignment.

### `/app/citation-analysis` — Citation Analysis (`citation-analysis.tsx`)
- **Purpose**: explore citations grouped by domain (drill-down per domain).
- **Components**: `OpportunityRunFilter.tsx`.
- **Backend routes**:
  - `GET /api/v1/opportunities/citations[?promptRunId=]`
  - `GET /api/v1/opportunities/citations/domain/:domain`
- **Tables**: `citations` joined back to `answers → prompt_run_items → prompt_runs`.

### `/app/recommendations` — Recommendations (`recommendations.tsx`)
- **Purpose**: deduplicated, source-attributed recommendations with manual-create + filter/sort/pagination.
- **Components**: `recommendations-summary.tsx`.
- **Backend routes**:
  - `GET /api/v1/opportunities/recommendations[?promptRunId=]`
  - `GET /api/v1/opportunities/recommendations/stats`
  - `GET /api/v1/opportunities/recommendations/summary`
  - `POST /api/v1/opportunities/recommendations` (manual create)
  - `POST /api/v1/opportunities/recommendations/generate` (trigger AI)
- **Services**: `content-recommendation-analyzer.ts` (GPT-4o-mini), `recommendations-summary.ts`.

### `/app/content-generator` — Content Generator (`content-generator.tsx`)
- **Purpose**: generate AEO-optimized content drafts targeted at gaps.
- **Backend routes**:
  - `GET /api/v1/opportunities/content[?promptRunId=]`
  - `POST /api/v1/opportunities/content/generate`
- **Services**: `openai-service.ts` (gpt-4-turbo-preview).
- **Tables**: `generated_contents`.

### `/app/reports` — Reports (`reports.tsx`)
- **Purpose**: generate and download executive PDFs (Insights + Appendix), JSON, CSV ZIP.
- **Components**: `generate-report-dialog.tsx`.
- **Backend routes**:
  - `GET /api/v1/reports`
  - `POST /api/v1/reports/generate`
  - `GET /api/v1/reports/:id`, `/:id/sections`, `/:id/files`, `/:id/job`
  - `GET /api/v1/reports/:id/download/pdf`, `/download/appendix`, `/export`
  - `DELETE /api/v1/reports/:id`
- **Services**: `report-job-processor.ts`, `report-snapshot.ts`, `report-aggregator.ts`, `narrative-generator.ts`, `pdf-renderer.ts`, `pdf-template.ts`, `csv-exporter.ts`, `json-exporter.ts`, `zip-exporter.ts`.

### Fallback — `not-found.tsx`
- 404 page for unknown routes inside `/app/*` and outside.

---

## Cross-page concerns

- **URL-driven project selection (Tasks #52, #53)**: every project-scoped page (`dashboard`, `prompts-tracker`, `client-configuration`, `site-xray`, `metadata-topics`, `metadata-prompts`, `citation-analysis`, `recommendations`, `content-generator`, `reports`) resolves the active project as `urlClientId || storedClientId` — the URL `?clientId=` wins over the cached `current-client-id` in `localStorage`. The single source of truth is `client/src/hooks/use-selected-client-id.ts` (`useSelectedClientId`, `useUrlClientId`, `setSelectedClientId`); `ProtectedRoute` runs a URL→store sync effect on every navigation. The sidebar (`client/src/components/layout/sidebar.tsx`) appends `?clientId=${selectedClientId}` to every project-scoped `Link.href` so middle-click / open-in-new-tab carries the selection through. When neither URL nor store carries a `clientId`, each page renders a "No Client Selected" empty state telling the user to pick a project from the top-nav dropdown, instead of silently calling APIs with `clientId=null`. (The top-navigation user dropdown and the client-catalog "Open" button still navigate via `setLocation()` + `setSelectedClientId()` without a URL query — fine for same-tab clicks but does not yet carry the selection on middle-click.)
- **Run filtering**: the `runId` query param surfaces in `prompts-tracker`, `dashboard`, `citation-analysis`, `recommendations`, `content-generator` so that all "opportunity" surfaces can show data for a specific historical run (`OpportunityRunFilter.tsx`).
- **Score explainability**: clicking a score on `dashboard` opens `score-explainability-modal.tsx`, which calls `GET /api/v1/prompt-runs/:id/score-explanation/:category`, backed by `score_factors`.
- **Benchmarks vs competitors**: `benchmark-modal.tsx` + `ComparisonTable.tsx` use `GET /api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks` and the bulk variant.

## Known UX limitations / gaps

- `metadata-top-topics.tsx` exists but is **not registered** as a route in `App.tsx`. **Gap.**
- `ProtectedRoute` now performs a real auth check (`GET /api/v1/auth/me`) and a "selected client" check; the legacy "no real auth" caveat in earlier revisions of this doc no longer applies (resolved by Task #2).
- There is no error boundary at the route level — Vite's runtime-error-modal plugin (`@replit/vite-plugin-runtime-error-modal`) catches dev-time errors, but not in production.

## Active operations visibility (Task #56)

Every project-scoped page mounts `<ActiveOperationsBanner clientId={...} excludeKinds={...}>` (`client/src/components/activity/active-operations-banner.tsx`). Excluded kinds per page: client-config excludes `metadata_generation`, site-xray excludes `site_xray`, prompts-tracker excludes `prompt_run`, prompt-library excludes `refresh_prompts`, reports excludes `report_generation`. The banner displays "{Activity} started by you / by {name} / in background ({Xago})" with a deep-link "Open" button (`activityItemHref`).

The project catalog (`client/src/pages/clients.tsx`) renders `<ActivityChip summary={...}>` reading `summary.items` from the cross-project summary endpoint — no per-tile poll.

Soft-disable rules: Refresh Prompts greys out while a `refresh_prompts` row is active; Duplicate greys out while a `project_copy` row is active; the StartRunDialog warns with a confirm modal when a `prompt_run` is already in flight (no hard locks). Metadata regenerate shows a confirm modal naming the active starter. Cross-user discovery on a fully idle page is not delivered by background polling (per polling-contract spec) — discovery happens via remount, navigation, or the next user-driven mutation that calls `invalidateActivityQueries`. Initiator visibility is immediate.
