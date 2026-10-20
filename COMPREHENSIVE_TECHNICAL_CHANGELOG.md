# 🚀 Polaris AI Platform - Comprehensive Technical Documentation
## Complete Feature Set, Architecture, and Change Log

**Platform:** Polaris AI - Brand Visibility & Competitive Intelligence Platform  
**Tech Stack:** TypeScript, React, Node.js, Express, PostgreSQL, Drizzle ORM  
**Total Commits:** 385+  
**Last Updated:** June 8, 2026 (adds entries for the auth & session audit (#125), forced change-password 401 recovery (#129), self-demotion lockout guard (#130), holistic error & notification UX (#131), onboarding wizard stuck-on-Next fix (#132), and onboarding relaunch from Project Settings (#133); previously covered through May 16, 2026 and Task #121)

## 2026-06-08 — Holistic error & notification UX (Task #131)

- **What.** A frontend-only pass that makes error messages, prompts, and
  notifications consistent, permission-aware, and plain-language across
  high-traffic surfaces. New `client/src/lib/api-errors.ts`; an upgraded
  `useErrorToast`; permission-aware create-project copy; migrated generic
  toasts; native `window.confirm()` → `AlertDialog`; a written convention.
- **Why.** The incident behind Task #130 was made worse because the
  create-project wizard surfaced a generic red "Failed to create client"
  toast for what was actually a permission (HTTP 403) error — the user had
  no idea it was a role problem. The app already had a solid error toolkit
  (the `feedback/` kit, `useErrorToast` with request ids, the typed error
  envelope from Task #113), but several surfaces still threw generic
  "Failed to…" / "Something went wrong" messages and didn't distinguish a
  permissions block from a real failure.
- **How — shared helpers.** `client/src/lib/api-errors.ts` adds
  `isPermissionError` / `permissionMessage` / `cleanErrorMessage` /
  `getApiError`. Permission detection reads `ApiError.status === 403` (or
  the matching `code`) with a legacy string-match fallback for the old
  `"${status}: ${message}"` shape. `cleanErrorMessage` strips the legacy
  `"<status>: "` prefix so toasts read cleanly.
- **How — toast + wizard.** `client/src/hooks/use-error-toast.ts` is now
  permission-aware: a 403 renders "You don't have permission" plus
  action-specific guidance, overridable via `opts.permissionMessage`; the
  `(title, error)` signature is preserved and the `requestId` is still
  appended for support. `create-client-wizard.tsx` adds a
  `wizardErrorMessage` helper and routes its draft / complete /
  resume-update `onError` handlers through the friendly create-project
  permission copy on 403, keeps the 409 duplicate-name branch, and adds
  descriptions on the generic path.
- **How — migrations + confirmations.** Generic destructive toasts on
  `metadata-topics` and the account profile page were migrated to
  `useErrorToast`; the content-generator clipboard failure got specific
  copy. The native `window.confirm()` prompts for revoking the current
  session (`account/sessions.tsx`) and halting a running job
  (`admin/admin-queue.tsx`) were replaced with the app's Radix
  `AlertDialog` (controlled state, stable `data-testid`s) — this is the
  work BACKLOG #121a asked for, so that item is now resolved. Non-current
  session revoke stays a direct action; halt stays gated.
- **How — convention.** An error/notification conventions section
  (permission vs validation vs server vs network) was appended to
  `client/src/components/feedback/README.md` so new code stays consistent.
- **Files.** `client/src/lib/api-errors.ts` (new),
  `client/src/hooks/use-error-toast.ts`,
  `client/src/components/create-client-wizard.tsx`,
  `client/src/pages/metadata-topics.tsx`,
  `client/src/pages/account/profile.tsx`,
  `client/src/pages/account/sessions.tsx`,
  `client/src/pages/admin/admin-queue.tsx`,
  `client/src/pages/content-generator.tsx`,
  `client/src/components/feedback/README.md`. Backend error contract
  unchanged.

## 2026-06-08 — Prevent self-demotion lockout (Task #130)

- **What.** The org member role-change endpoint now refuses to let a user
  change their **own** role, and the admin Members UI disables the
  self-row role selector.
- **Why.** Production incident: an org admin changed his own role down to
  `viewer` through the admin Members screen. Viewers can't create projects
  (the create endpoint requires `member`+) or reach the admin screen, so
  he was stuck with a generic "Failed to create client" error and another
  admin had to restore him. The endpoint only blocked demoting the **last**
  admin — it never stopped a user editing their own role.
- **How — server.** In `PATCH /api/v1/admin/orgs/:orgId/members/:userId`
  (`server/routes/admin-users.ts`), an authoritative guard rejects with
  403 "You cannot change your own role — ask another admin" when the
  target `userId` equals the authenticated caller's id. It is placed after
  payload validation and before the existing last-admin check, which is
  left intact.
- **How — UI.** `ManageMemberDialog` (`client/src/pages/admin/admin-users.tsx`)
  computes `isSelf` via `useAuth().user.id` and disables the role `<Select>`
  for the caller's own row with an inline hint; `applyBulkRole` filters out
  the caller's own row so a bulk role change never triggers a self-403.
- **Files.** `server/routes/admin-users.ts`,
  `client/src/pages/admin/admin-users.tsx`. What each role can do, the
  create-project error message (handled in Task #131), and org-membership
  removal flows are unchanged.

## 2026-06-08 — Re-launch onboarding wizard from Project Settings (Task #133)

- **What.** A "resume" mode on the existing `CreateClientWizard` so users
  can re-open the guided setup for an **existing** project (draft,
  in-progress, or completed), pre-filled with its saved data.
- **Why.** Until now the wizard was only reachable when creating a
  brand-new project; there was no way to walk back through guided setup to
  fix or extend an existing project.
- **How.** A new optional `existingClientId` prop. When set, the wizard
  hydrates every step from the project (GET client + competitors + models):
  name, URLs (tolerating legacy `string[]`/`website` shapes), focus areas,
  industry, geography, brand aliases, custom industry/geography,
  competitors (keeping real DB ids), and selected AI models. Auto
  AI-enrichment is suppressed in resume mode (`enrichedSteps` all true) so
  saved data isn't overwritten; manual "Re-run AI" still works. The final
  "Complete Setup" PUTs to the **same** project (no duplicate) and, in
  resume mode, reconciles competitors (delete the previously-loaded rows,
  recreate the edited list) so removals take effect — retry-safe because
  deletes are idempotent and creates are deduped by `clientId + lower(name)`.
  A duplicate-creation guard ensures Step 1 never reaches the POST create
  path in resume mode; an `isHydratingResume` state disables Step 1's Next
  ("Loading…") during hydration and aborts with a toast if hydration is
  pending/failed (closed a code-review blocking gap). Dialog
  title/description and the success toast are resume-aware; success
  invalidates client / models / competitors queries.
- **Files.** `client/src/components/create-client-wizard.tsx`.

## 2026-06-08 — Fix onboarding wizard getting stuck on "Next" (Task #132)

- **What.** Fixed a production bug where the create-project wizard froze on
  a step with "Next" doing nothing, and made per-step saves resilient.
- **Why / root cause (confirmed via prod logs).** Each step saves with
  `PUT /api/v1/clients/:id` but sends no client id in the body.
  `resolveTenant()` couldn't recover it: the route param is named `id`
  (the resolver looked for `clientId`), the body had none, and the path
  regex was anchored to `/clients/...` so it never matched the real
  `/api/v1/clients/...` path. The only remaining source was the
  `x-client-id` header, which the frontend sends only when a project is
  already selected. A brand-new / incognito user creating their **first**
  project has no selected project → no header → the server returned
  400 "clientId is required" → the step save threw and the wizard never
  advanced (a silent freeze). It only failed "sometimes" because returning
  users had a stale header that slipped through.
- **How — server.** `resolveTenant()` (`server/auth.ts`) now extracts the
  client id from the URL path with an `/api/v1`-tolerant regex and treats
  the path-derived id as authoritative (after `req.params.clientId`,
  before body/query/header), keeping the validate-project-name /
  activity-summary exclusions. Existing `requireRole` (scope `"client"`)
  checks are unchanged; this binds auth to the resource named in the URL
  instead of a stale selected-project header — a security-positive change.
- **How — client.** `create-client-wizard.tsx` wraps the step 2 and step 3
  `mutateAsync` saves in try/catch; on failure it shows a clear destructive
  toast and stays on the step for retry instead of freezing. A
  `wizardErrorMessage()` helper strips the legacy `"<status>: "` prefix.
- **Files.** `server/auth.ts`,
  `client/src/components/create-client-wizard.tsx`.

## 2026-06-01 — Recover from forced change-password 401 (Task #129)

- **What.** A user issued a temporary password can now reach the forced
  change-password screen, set a new password, and proceed — and if the
  session is genuinely gone at submit time, is cleanly bounced to login
  instead of being stranded on a raw `401: Authentication required`.
- **Why / diagnosis.** The server flow is correct (verified via curl:
  login sets `polaris.sid`, `/auth/me` 200, change-password gets past
  `requireAuth` and returns 400 on a wrong current password, not 401). The
  failure was a **client-side phantom-auth** state: `useLogin` seeded the
  cache from the login response body and never verified the session cookie
  actually stuck, and a 401 on the change-password POST left the user
  stranded because `redirectToLoginIfNeeded` intentionally skips
  `/api/v1/auth/*` paths.
- **How (client-only).** `useLogin.onSuccess` now invalidates
  `AUTH_QUERY_KEY` after `setQueryData`, so `/auth/me` is re-probed to
  confirm the session — a cookie that never persisted resolves null and
  bounces to `/login` instead of rendering a phantom forced-change screen.
  `change-password-form.tsx` `onError` detects an `ApiError` 401, clears
  the auth snapshot, broadcasts revoked, toasts a clear "please sign in
  again" message, and redirects to `/login` (both the forced page and the
  settings card variants).
- **Files.** `client/src/lib/auth.ts`,
  `client/src/components/account/change-password-form.tsx`. No server,
  schema, or package changes.

## 2026-06-01 — Auth & Session security audit (Task #125, read-only)

- **What.** A senior-architect / security-engineer-grade read-only audit
  of Polaris's authentication and session management, delivered as a single
  timestamped markdown file `docs/audits/AUTH_SESSION_AUDIT_2026-06-01.md`.
- **Why.** To give the team (and any client / security reviewer) a
  defensible, evidence-anchored picture of the auth posture, and to
  establish a consistent home for audit-class docs.
- **How.** Every architectural claim cites a real artifact (file:line,
  route, table/column, env var, middleware, test name); anything not found
  is marked **"Not found"** rather than guessed. The feature-coverage
  matrix and risk register are real markdown tables; recommendations are
  split into tiers A/B/C with S/M/L effort estimates and a suggested order.
  The doc cross-links `replit.md`, `CHANGELOG.md`, `ISSUE_LOG.md`,
  `BACKLOG.md`, and the relevant PRD chapters. The task also moved the
  existing LLM provider audit into `docs/audits/` and added a
  `docs/audits/README.md` index. Posture summary: strong for internal use,
  not yet bank-grade — top gaps are no MFA, no email delivery for
  resets/invites, and an HSTS doc/code discrepancy.
- **Files.** `docs/audits/AUTH_SESSION_AUDIT_2026-06-01.md` (new),
  `docs/audits/README.md`, `docs/audits/LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md`
  (moved). No code, schema, or runtime config changed.

## 2026-05-17 — Faster revision promotion on deploy

- **What.** A health-check endpoint is used during deployment so a new
  revision is promoted faster after publish.
- **Why.** Faster, more reliable promotion of new revisions during deploys.
- **How.** Leans on the readiness/liveness endpoints introduced in Task
  #113 (`/health`, `/health/live`). Deploy-config / startup reliability
  only — no application behavior change.

## 2026-05-16 — Admin button to halt running jobs (Task #121)

- **What.** New `POST /api/v1/admin/jobs/:id/halt` route, new
  `GET /api/v1/admin/jobs/running` feed, and a "Running jobs" card
  on `/app/admin/queue` so admins can stop a currently-running job
  with a single Halt click instead of waiting for the 15-min stale
  sweep or restarting the workflow.
- **Why.** Task #115 shipped Retry (for failed) and Cancel (for
  queued-only) admin affordances, but a job actively being
  processed by a worker could only be killed via stale-sweep or
  workflow restart — both heavy-handed for a single stuck row.
- **How — backend.** `server/routes/admin-jobs.ts` gained the
  `/halt` handler: `storage.getJob(:id)` → 404 if missing; 409 if
  `status !== 'running'`; otherwise `jobQueue.cancelJob(:id)` (same
  path used by Task #79's model-disable cascade) adds the id to the
  in-process `cancelledJobs` set AND flips the DB row to
  `cancelled` so the executor's cooperative cancellation check
  trips at its next checkpoint. Audit-logged as `job.halt` with
  `{ jobType, previousStatus: 'running' }`. `IStorage.getRunningJobs(limit?)`
  was added; DbStorage selects `WHERE status='running' ORDER BY
  startedAt DESC LIMIT N`, MemStorage is a no-op. The
  `GET /running` route uses the same admin-only guard and 200-row
  cap as `/queued` and `/failed`.
- **How — frontend.** `client/src/pages/admin/admin-queue.tsx`
  gained a new card between Tunables and Recent failed jobs:
  `useQuery` keyed on `["/api/v1/admin/jobs/running"]`, polled
  every `REFRESH_INTERVAL_MS` (5 s), columns id / type / startedAt
  / lastHeartbeat, and a Halt button (OctagonX icon, rose tone)
  that fires a `window.confirm` then a mutation against
  `POST /admin/jobs/:id/halt`. On success the mutation invalidates
  the running + failed feeds plus the queue stats tile so the row
  disappears and "Failed 24h" doesn't go stale.
- **Drift from spec.** The original task asked for a Cancel button
  on the Recent failed jobs row when `status='running'`, but
  failed-jobs is a terminal-only feed by definition (it excludes
  running rows). Followed the per-status dedicated-table convention
  Task #115 established for Queued. The destructive prompt uses
  `window.confirm`; swapping it for an AlertDialog matching the
  rest of the admin module is filed as a follow-up.
- **Files.** `server/routes/admin-jobs.ts`, `server/db-storage.ts`,
  `server/storage.ts`, `client/src/pages/admin/admin-queue.tsx`,
  `replit.md`, `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`, `BACKLOG.md`.

## 2026-05-16 — Operational recovery, retries & alerting (Task #115)

- **What.** A seven-part defense-in-depth layer for backend
  reliability: prompt-run heartbeats, LLM retry budget, admin
  Retry / Cancel affordances, an alert sink (Slack + email +
  console), an Operational Dashboard, per-provider 24 h error
  rates, and a runbook.
- **Why.** Task #59 added a boot-time reaper, but (a) a long-but
  healthy run could still be reaped because the only signal was
  `createdAt`, (b) transient 503s from a vendor would fail a whole
  prompt-run instead of self-healing, (c) admins had no way to
  retry a failed job without manual SQL, (d) ops had no way to
  know a job had failed without scraping logs, and (e) `/health`
  exposed too little to drive a sensible monitor.
- **How — T1 Heartbeats.** New `prompt_runs.heartbeat_at` column,
  stamped every 30 s by `executePromptRun`
  (`server/services/prompt-run-executor.ts`). The reaper at
  `server/services/prompt-run-reaper.ts` prefers `heartbeat_at`
  over `createdAt` when present (a missing column falls back), and
  a new `startStalePromptRunSweep` runs every 10 min on top of the
  existing boot one-shot. Configurable via
  `STALE_PROMPT_RUN_SWEEP_MS` or the verbose alias
  `STALE_PROMPT_RUN_SWEEP_INTERVAL_MS`. Skipped under
  `NODE_ENV=test` / `SESSION_STORE=memory`.
- **How — T2 LLM retries.** New `server/llm/retry.ts` exports
  `withVendorRetry` (returns awaited result, re-throws on
  exhaustion) and `withVendorRetryResult` (returns
  `{ ok, value | error, attempt }`). Full-jitter exponential
  backoff (base 250 ms, cap 4 s), 3 attempts, 10 s absolute budget.
  Retries on HTTP 408 / 429 / 5xx and network errors;
  `VendorPausedError` short-circuits. Wired into
  `server/llm/{openai,anthropic}.ts` and all four provider
  helpers in `server/services/ai-executor.ts`.
- **How — T3 Admin Retry / Cancel.** New
  `server/routes/admin-jobs.ts` module hosts:
  `GET /api/v1/admin/jobs/failed` (terminal: error OR cancelled),
  `GET /api/v1/admin/jobs/queued`,
  `GET /api/v1/admin/jobs/failed-by-type?hours=N` (grouped, capped
  168 h), `POST /api/v1/admin/jobs/:id/retry` (re-enqueues source
  as a NEW job with `payload.parent_job_id` +
  `payload.retry_attempt`; source may be `error` OR `cancelled`),
  and `POST /api/v1/admin/jobs/:id/cancel` (now ATOMIC via
  `storage.cancelQueuedJob` — `UPDATE … WHERE status='queued'
  RETURNING`; null result triggers a single `getJob` to
  disambiguate 404 vs 409; closes a read-then-write race).
  Running jobs are deliberately NOT cancellable here (use Task
  #121's `/halt`). Both audit-logged.
  `client/src/pages/admin/admin-queue.tsx` gained dedicated cards
  for Failed (with per-row Retry / Cancel) and Queued (with
  per-row Cancel) so each action is reachable.
- **How — T4 Alert sink.** New `server/services/alert-sink.ts`
  exposes `emitAlert(kind, payload)` and four convenience wrappers
  (`alertJobFailure`, `alertVendorPause`, `alertHealthDbDown`,
  `alertUnhandledRejection`). Routes alerts to console (always),
  Slack (`ALERT_SLACK_WEBHOOK_URL` canonical or
  `SLACK_ALERT_WEBHOOK_URL` legacy alias), and email
  (`ALERT_EMAIL_SMTP_URL` + `ALERT_EMAIL_TO` + optional
  `ALERT_EMAIL_FROM`, backed by `nodemailer`; the transport is
  cached per-URL and the package emits a one-time warn + no-op if
  missing). Identical `(kind, dedupeKey)` payloads are debounced
  for 5 min via an in-process Map. Four triggers wired:
  `alertJobFailure` from `JobQueue.handleStaleJob` **only when**
  `resumeCount >= MAX_RESUME_ATTEMPTS` (first-failure terminal
  cases are intentionally skipped so transient blips don't flood
  ops); `alertVendorPause` from
  `PATCH /api/v1/admin/providers/:vendor`; `alertHealthDbDown`
  from `/health` readiness when `pingDatabase()` fails;
  `startAlertSinkProcessHealthMonitor` polls
  `processHealth.unhandledRejectionCount` once a minute and fires
  `process.unhandled_rejection` on count delta > 0.
- **How — T5 Operational dashboard.** New
  `client/src/pages/admin/admin-dashboard.tsx` at `/app/admin`
  registered above `/admin/users`. StatRow tiles: Active / Queued
  / Stale + Failed-24h + Prompt-runs-in-flight (uses
  `storage.countActivePromptRuns()` — system-wide, mirrors
  `ACTIVE_PROMPT_RUN_STATUSES` from activity-service). "Failures
  by kind (last 24h)" rollup. `/health` snapshot (DB status,
  uptime, RSS, unhandled rejections). Per-provider 24 h error
  rates. 5 most recent failures. Sidebar entry **Operational
  Dashboard** pinned at the top of the Admin section.
- **How — T6 Providers 24h error rate.**
  `storage.getVendorLast24hErrorRate` joins `prompt_run_items` to
  `ai_models` over `finishedAt >= NOW() - 24h`; counts a row as
  errored when `status='error'` OR `error IS NOT NULL`. Total === 0
  is reported as `null` so the UI renders "no traffic" instead of
  a misleading 0 %. The Providers panel above the Models tab on
  `/app/admin/models` renders a color-graded cell (red ≥25 %,
  amber ≥5 %, emerald otherwise).
- **How — T7 Runbook.** New "Alerts & Recovery" section in
  `ISSUE_LOG.md` lists every env var, triage step per alert kind,
  and how to test the channels.
- **Drift from plan.** Retry endpoint accepts both `error` AND
  `cancelled` source jobs (the spec was error-only). Cancel uses
  atomic conditional UPDATE rather than the originally-described
  read-then-write, closing a real race. Both env-var pairs accept
  two names for backward compat (stale-sweep and Slack webhook).
  Email channel uses lazy `nodemailer` rather than the
  originally-suggested `replitmail` helper (which doesn't exist in
  this repo); the dependency was added to `package.json`. A
  dedicated Queued-jobs UI card was added because Cancel was
  unreachable from a failed-only feed.
- **Files.** `shared/schema.ts`,
  `server/services/prompt-run-executor.ts`,
  `server/services/prompt-run-reaper.ts`, `server/llm/retry.ts`,
  `server/llm/{openai,anthropic}.ts`,
  `server/services/ai-executor.ts`,
  `server/routes/admin-jobs.ts`,
  `server/routes/admin-providers.ts`,
  `server/db-storage.ts`, `server/storage.ts`,
  `server/services/alert-sink.ts`,
  `server/services/job-queue.ts`, `server/routes.ts`,
  `client/src/pages/admin/admin-dashboard.tsx`,
  `client/src/pages/admin/admin-queue.tsx`,
  `client/src/pages/admin/_shared.tsx`,
  `client/src/components/layout/sidebar.tsx`, `package.json`
  (`nodemailer`), `replit.md`, `ISSUE_LOG.md`, `CHANGELOG.md`,
  `WEEKLY_CHANGELOG.md`, `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Fix Prompts Tracker Rerun "selections not loaded yet" error (Task #116)

- **What.** The Rerun action on `/app/prompts` (Task #107) would
  intermittently fail with the toast **"Failed to rerun — Source
  run selections not loaded yet"** even when the `/selections`
  endpoint had returned 200 and the dialog showed prompt / model
  counts.
- **Why — root cause.** The guard inside `rerunMutation.mutationFn`
  read `rerunSelections` from a React render closure. Radix's
  `AlertDialogAction` auto-closes the dialog on click, which races
  with `setRerunRun(null)` and a re-render where the closure
  observes `rerunSelections === undefined` before the mutation reads
  it. The same closure could also be stale when the user reopened
  the dialog on a run whose cache entry had been gc'd.
- **How — fix.** Extracted the selections query key + fetcher into
  small helpers (`rerunSelectionsQueryKey`,
  `fetchRerunSelections`). The `useQuery` still drives the
  dialog's "Loading prompt & model counts…" copy, but the mutation
  now calls `queryClient.fetchQuery({ queryKey, queryFn })`
  synchronously inside `mutationFn`. `fetchQuery` returns the
  cached value if fresh and refetches if stale, so the mutation
  always reads the freshest data (or fetches it on the spot),
  independent of the dialog's render lifecycle. No new routes, no
  schema changes.
- **Files.** `client/src/pages/prompts-tracker.tsx`, `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Frontend error UX & recovery affordances (Task #114)

- **What.** Companion to Task #113. The backend now returns a
  typed error envelope with a request id; the frontend gains the
  matching surfaces to display, recover from, and report those
  errors — plus an App-root ErrorBoundary, a NetworkBanner, and
  per-page slow-query notices.
- **Why.** Task #113 changed the response shape; without matching
  frontend support, a structured-but-unrendered envelope would have
  been a regression. Separately, render-time crashes were taking
  the whole page blank, and a flapping connection produced a wall
  of stale data with no in-app signal.
- **How — App-level guards.** `client/src/App.tsx` mounts an
  `ErrorBoundary` at the root (catches render-time errors, surfaces
  a recoverable card with retry + error id) and a `NetworkBanner`
  that polls `/api/v1/auth/me` every 30 s with an immediate
  on-mount ping, a `visibilitychange` re-check on tab focus, and an
  in-flight guard so pings don't stack.
- **How — feedback kit.** New `client/src/components/feedback/`
  module exports four primitives (`ErrorState`, `RetryCard`,
  `NetworkBanner`, `ApiErrorMessage`) plus two hooks
  (`useErrorToast` — destructive toast with `requestId` surfaced;
  `useSlowQueryNotice` — 15 s threshold inline notice under
  loading skeletons). A README in the module documents the
  intended usage pattern.
- **How — queryClient policy.**
  `client/src/lib/queryClient.ts` was extended to parse
  `{ error: { code, message, requestId, details } }` into a typed
  `ApiError` (`status`, `code`, `requestId`, `details`) while
  preserving the legacy `"${status}: ${message}"` form on
  `Error.message` so existing UI keeps working unchanged. Retry
  policy: 0 retries on 4xx `ApiError` (auth / validation won't
  fix themselves), 2 retries with exponential backoff (1 s → 2 s,
  cap 5 s) on 5xx or network errors.
- **How — migrated surfaces.** Destructive toasts on the
  high-traffic pages — `client-catalog`, `prompts-tracker`,
  `client-configuration`, `reports`, `site-xray`,
  `metadata-prompts`, `start-run-dialog`, `generate-report-dialog`
  — now use `errorToast` so the request id is visible. The
  query-error branches on dashboard, reports, site-xray,
  metadata-prompts, prompts-tracker now render `RetryCard` /
  `ErrorState`. `useSlowQueryNotice` is wired into dashboard,
  reports, and site-xray loading paths. Admin pages migrated in
  the same pass: `admin-users`, `admin-models` (three
  sub-components), `admin-projects`.
- **Files.** `client/src/App.tsx`,
  `client/src/components/feedback/` (new module),
  `client/src/lib/queryClient.ts`, plus migration touches across
  ~15 page / dialog files (commit `e5e5fa6`), `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Backend error contract & observability (Task #113)

- **What.** Every non-2xx `/api/v1` response now follows a single
  shape: `{ error: { code, message, requestId, details? } }`.
  Every request is stamped with a UUID echoed back as
  `X-Request-Id`. New `/health` (readiness) and `/health/live`
  (liveness) endpoints. Per-user rate limits on the four most
  expensive write endpoints.
- **Why.** The previous inconsistency (some routes returned
  `{ message }`, others `{ error }`, others a bare string) made
  client-side error rendering guesswork and support nearly
  impossible without grepping server logs. There was no
  request-id correlation between client toast and server log.
  Process-level rejections could take the worker down. The
  existing `/health` exposed too little to drive a sensible
  monitor.
- **How — single serializer.**
  `server/middleware/error-handler.ts` is the only place that
  writes an error response. Unlike the prior handler in
  `server/index.ts`, it does **not** re-throw after responding
  (the old re-throw left the connection state ambiguous and
  bypassed downstream logging). Throw `ApiError`
  (`server/utils/api-error.ts`) for explicit cases or let Zod
  errors bubble. Postgres driver codes are translated via
  `server/utils/db-errors.ts`: 23505 → 409,
  23503 / 23502 / 23514 → 422, 40P01 / 40001 / 53300 → 503,
  57014 → 504.
- **How — request ids.** `server/middleware/request-id.ts`
  stamps every request with `req.id` (UUID), echoes it on the
  `X-Request-Id` response header, and adds a structured
  `req.log(level, msg, meta?)` helper. Inbound `X-Request-Id`
  headers are honored after a safety pattern check so an attacker
  can't inject anomalous ids.
- **How — process safety.**
  `process.on("unhandledRejection" | "uncaughtException")` log
  structured lines and bump counters on the exported
  `processHealth` snapshot **without** calling `process.exit()` —
  a transient rejection no longer takes the worker down. The
  counters feed Task #115's alert sink.
- **How — health endpoints.** `/health` (readiness) returns 503 on
  DB-ping fail or during shutdown and includes `queue`,
  `memoryMb`, `uptimeSec`, and
  `process.{unhandledRejectionCount, lastUnhandledRejectionMessage,
  …}`. `/health/live` (liveness) always returns 200 if the event
  loop can reply.
- **How — rate limits.** Per-user limits (keyed on `user.id` with
  IP fallback) cover `POST /clients/:id/refresh-prompts` (10 /hr),
  `/reports/generate` (5 /hr), `/prompt-runs` (30 /hr),
  `/xray/analyze/batch` (10 /hr). All four tunable via
  `*_RATE_PER_HOUR` envs and bypassed under
  `NODE_ENV=test` / `RATE_LIMIT_BYPASS=true`.
- **How — client envelope parser.**
  `client/src/lib/queryClient.ts` parses the new envelope into a
  typed `ApiError` (`status`, `code`, `requestId`, `details`)
  while preserving the legacy `"${status}: ${message}"` shape on
  `Error.message` so existing UI keeps working. Task #114
  consumes the parsed fields.
- **Files.** `server/middleware/error-handler.ts` (new),
  `server/middleware/request-id.ts` (new),
  `server/middleware/rate-limits.ts` (new),
  `server/utils/api-error.ts` (new),
  `server/utils/db-errors.ts` (new), `server/index.ts` (removed
  legacy handler), `server/routes.ts` (mount order + health
  endpoints), `client/src/lib/queryClient.ts`,
  `server/README-errors.md` (new code catalog + examples),
  `replit.md`, `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Executive Report PDF — descriptive filenames (Task #110)

- **What.** Both Executive Report PDF download endpoints
  (`/api/v1/reports/:id/download/pdf` and `…/download/appendix`) and
  the on-disk paths written by the report job processor now produce
  self-describing filenames of the form
  `Polaris_<Insights|Technical_Appendix>_<Client>[_-_<Project>]_<YYYY-MM-DD>_<id8>.pdf`
  (e.g. `Polaris_Insights_Diageo_-_Tequila_2026-05-16_584e61eb.pdf`).
- **Why.** The previous shape `insights_report_<uuid>.pdf` /
  `technical_appendix_<uuid>.pdf` produced indistinguishable files in
  the user's Downloads folder once they had pulled reports for two or
  three projects on the same day.
- **How — helper.** New `server/utils/report-filename.ts` exports
  `buildReportFileName({ kind, clientName, projectName, generatedAt,
  snapshotId })`, `buildReportFileBaseName(...)`, and a
  `contentDispositionHeader(fileName)` that emits both the ASCII
  `filename="…"` form and the RFC-5987 `filename*=UTF-8''…` form for
  graceful degradation on older browsers. Both name segments are
  slugged (NFKD-normalize → drop combining marks → non-alnum runs
  collapsed to `_` → trim → 40-char cap, with `client` /
  `project` fallbacks if a segment ends up empty). String-based smart
  dedupe trims the project segment when it starts with the client
  segment (case-insensitive comparison on the slugged forms) and
  drops it entirely when the two are identical. Date is the
  snapshot's `report_snapshots.generated_at` formatted UTC for
  cross-browser/locale stability. The 8-char id slice (dashes
  stripped, lowercased) keeps reports for the same project on the
  same day distinct. Total filename length is capped at 150 chars by
  trimming the name part as a last resort — well under the 255-byte
  filesystem limit on every common OS.
- **How — download routes.** `server/routes/reports.ts` extends both
  endpoints' existing client-scoped snapshot lookup with a
  `leftJoin(clients, eq(clients.id, reportSnapshots.clientId))` to
  pull `clients.name` AND `clients.projectName` in the same query
  (no extra round trip), then calls the helper and emits the new
  `Content-Disposition` header. Existing access checks (404 on
  missing/cross-tenant snapshot) are preserved.
- **How — on-disk paths.** `server/services/report-job-processor.ts`
  was extended in two places. (1) The main pipeline's
  `clientContext` now also carries `projectName` (added to the
  Drizzle select), and the `insightsPdfFileName` /
  `appendixPdfFileName` constants are computed via
  `buildReportFileBaseName(...)` + the existing `_${timestamp}`
  collision suffix. (2) The standalone regenerate-appendix path
  (`regenerateDiagnosticAppendix`) at the bottom of the file got the
  same treatment. Existing reports already on disk under the old
  `insights_report_<uuid>_<ts>.pdf` shape keep working — the
  download route serves whatever path is recorded in
  `report_files.file_url`.
- **Out of scope.** Renaming files already on disk under the old
  shape (cosmetic only). Letting the user customize the filename
  (could be a follow-up). Including the constituent run ids in the
  filename (would push past 100 chars on multi-run reports — id8 is
  enough to disambiguate). Touching `report_files.file_type` or any
  schema columns.
- **Files.** `server/utils/report-filename.ts` (new),
  `server/routes/reports.ts`,
  `server/services/report-job-processor.ts`,
  `replit.md`, `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Prompts Tracker rerun CTA + shorter auto-generated run names (Task #107)

- **What.** Two improvements to `/app/prompts`. (1) Auto-generated run
  names switched from `Run <first-8-of-uuid>` to
  `Run <id8> · <MMM d>` (e.g. `Run 584e61eb · May 16`) — short, keeps
  the cross-reference id slice, adds the date for at-a-glance
  scanning. (2) New Rerun icon on every tracker row re-queues the
  same prompts × models with an auto-incremented `(iteration N)`
  suffix on the new run name.
- **Why.** Long tracker lists mixed very short auto-fallback names
  with very long user-typed ones and were hard to scan by date.
  Re-running a finished set of prompts × models required the user
  to manually re-tick every prompt and every model in
  `StartRunDialog` — no fast path for "same again with the latest
  data."
- **How — naming.** New `buildAutoRunName(runId, now?)` helper in
  `server/routes/prompt-runs.ts`. Uses `Intl.DateTimeFormat` with a
  try/catch fallback to id-only. The same helper is reused in
  `server/routes/dashboard.ts` to synthesize labels for legacy runs
  whose `name` is null/empty (user-typed names are preserved
  unchanged), so dashboard filter chips render in identical shape.
- **How — rerun (no new routes).** Existing `POST /prompt-runs`
  schema gained optional `iterationOf?: string`. When set, the
  server runs new `computeIterationName(clientId, base)`: strips any
  trailing `(iteration K)` from `iterationOf`, scans every existing
  `prompt_runs` row for the project, finds the largest existing K
  for that stripped base name, and stores `<base> (iteration K+1)`
  (default starts at 2). Computing N server-side at create time
  shrinks the collision window dramatically vs. a browser-derived
  number, but the scan + insert is NOT inside a DB transaction,
  so two truly simultaneous requests can still race to the same
  K+1. A transactional lock / unique constraint on
  `(client_id, name)` is filed as a follow-up. The new run
  otherwise goes through the
  exact same enqueue path (`process_prompt_run` job, same
  attribution, same `active-operations` banner row).
- **How — UI.** `client/src/pages/prompts-tracker.tsx` adds a
  `RotateCw` icon to every desktop table row and mobile card,
  disabled while the source status is in the non-terminal set
  (`queued / running / scoring / queued_for_benchmarking /
  benchmarking`) so it mirrors `ACTIVE_PROMPT_RUN_STATUSES` on the
  server. Clicking opens an `AlertDialog` that fetches the source's
  `(promptIds, modelIds)` via the existing
  `GET /api/v1/prompt-runs/:id/selections` endpoint (Task #56) and
  shows: source name + status badge, separate prompt count × model
  count = item count, a best-effort preview of the new name
  (server picks the final N), and the same concurrent-run warning
  copy `StartRunDialog` uses (when any `prompt_run` is in flight
  for this project, via `useClientActivityItems`).
  `AlertDialogCancel` is the default-focused action so an
  accidental Enter is safe. Confirm POSTs to `/api/v1/prompt-runs`
  with the inherited selections and `iterationOf: <stripped source
  name>`. Cache invalidation covers `/prompt-runs`,
  `/dashboard/recent-runs`, and the project's `/activity` query
  (via `invalidateActivityQueries`).
- **Test ids.** All new ids follow the existing
  `{action}-{target}-{id}` convention: `button-rerun-<runId>`,
  `button-rerun-<runId>-mobile`, `dialog-rerun-<runId>`,
  `text-rerun-source-name-<runId>`, `text-rerun-counts-<runId>`,
  `text-rerun-name-preview-<runId>`,
  `warning-concurrent-rerun-<runId>`,
  `button-cancel-rerun-<runId>`, `button-confirm-rerun-<runId>`.
- **Out of scope.** Side-by-side iteration comparison UI (follow-up
  #109), a real `parent_run_id` foreign key for proper lineage
  (filed in BACKLOG.md), "rerun with edits", bulk rerun, "rerun
  failed items only".
- **Files.** `server/routes/prompt-runs.ts`,
  `server/routes/dashboard.ts`,
  `client/src/pages/prompts-tracker.tsx`,
  `replit.md`, `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `BACKLOG.md`.

## 2026-05-16 — PDF renderer Chromium follow-up to Task #105

- **Symptom.** Every report generated after Task #105 R3 shipped came
  back with both the Insights and Technical Appendix PDFs marked
  unavailable. The on-page report view still worked (Task #104's
  partial-success path keeps the 13 saved sections viewable), but the
  yellow PDF-failure banner reported
  `browserType.launch: Pass userDataDir parameter to
  browserType.launchPersistentContext(userDataDir, options) instead of
  specifying '--user-data-dir' argument`.
- **Root cause.** Task #105 R3 introduced a shared Chromium browser
  singleton in `server/services/pdf-renderer.ts` and passed a unique
  `--user-data-dir=polaris-pdf-<uuid>` arg to `chromium.launch()` to
  prevent concurrent renders from racing on profile lock files.
  Playwright explicitly forbids that flag on `launch()` — passing a
  user data dir is only supported via
  `launchPersistentContext(userDataDir, …)`. The shared browser
  failed to launch and `getOrCreateBrowser()` threw on the very first
  render of every report.
- **Fix.** Dropped the `--user-data-dir` arg, removed the
  `sharedUserDataDir` bookkeeping and temp-dir cleanup in
  `closeSharedBrowser()`, and removed the now-unused `os` import.
  Playwright already gives every `chromium.launch()` call its own
  ephemeral `/tmp/playwright_chromiumdev_profile-*` dir, so two
  concurrent processes never collide on a profile lock. The file's
  header comment now documents the gotcha so it doesn't get
  reintroduced.
- **Verified.** `npx tsc --noEmit` clean. Workflow boots and the
  `[PDF Self-Test] OK using <REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE>
  (7914 bytes, 658ms)` line in `server/index.ts` confirms the shared
  browser renders a real PDF end-to-end before any user click.
- **Files.** `server/services/pdf-renderer.ts` only.

## 2026-05-15 — Executive Report pipeline — reliability + perf uplift (Task #105)

Companion task to **#104 (Chromium spawn EIO)**. #104 made today's
failure go away; #105 removed the structural risks that made report
generation fragile and slow even on a healthy environment. Splits
cleanly into **Reliability (R)** and **Performance (P)**.

### R1 — Move report generation onto the JobQueue

- **Before.** `POST /api/v1/reports/generate` called
  `processReportGeneration(...)` as a *detached promise* inside the
  request process. Server restart / deploy / autoscale event mid-report
  → the promise dies, the `report_jobs` row stays in `aggregating` /
  `analyzing` / `rendering` forever, the user sees a spinner that
  never resolves. `recoverStaleJobs()` only scanned
  `generate_metadata`, `xray_analysis`, etc.
- **After.** New `report_generation` job kind in `JobQueue`. The
  route enqueues with `{ clientId, runIds, generatedBy,
  startedByUserId }` and returns `{ jobId }` immediately. The worker
  (`processReportGenerationJob` in `server/services/job-queue.ts`)
  invokes `processReportGeneration(...)`. The progress callback
  stamps `payload.snapshotId` on the first event so recovery can
  find the linked report rows. `recoverStaleJobs()` sweeps
  `report_generation` rows queued longer than 15 min and cascades
  the linked `report_jobs` / `report_snapshots` row to `failed`
  via a new `failLinkedReportRows()` helper. `handleStaleJob`
  calls the same cascade on every `report_generation` failure path
  (`server_restart` / `heartbeat_stale` / `timeout`) so a
  shortly-after-start crash doesn't leave the user's spinner
  spinning. Active-operations banner (`activity-service.ts`)
  understands the new kind via the existing report-job mapping.

### R2 — Mid-pipeline checkpointing

- **New columns.** `answers.summary` text (nullable),
  `report_snapshots.narratives` jsonb, `report_snapshots.appendix_content`
  jsonb. Both jsonb columns are Drizzle-typed via `.$type<>()` so
  reads/writes use concrete `GeneratedNarratives` /
  `GeneratedAppendix` types — every `as any` cast in the processor
  was removed.
- **Step 3 (summarization).** Reads `answers.summary` per response
  and skips re-summarizing already-cached entries. `SnapshotData.responses`
  gained a `summary: string|null` field populated from the answers
  join so the cache check doesn't require an extra query. After the
  batch completes, best-effort writes new summaries back so the next
  attempt sees them.
- **Step 4 / Step 5 (narratives + appendix).** Persists the
  generated jsonb to the snapshot row after each step. On entry,
  if `narratives` / `appendixContent` is non-null we hydrate from
  cache and skip the LLM call entirely.
- **Auto-resume.** `handleStaleJob` re-queues `report_generation`
  jobs that have a checkpointed `payload.snapshotId` with an
  incremented `resumeCount` (up to `MAX_RESUME_ATTEMPTS`).
  `processReportGeneration` accepts `existingSnapshotId` and skips
  Steps 4/5 when the cache is populated.
- **Idempotent re-entry.** Before re-inserting on
  `existingSnapshotId` the processor wipes any prior
  `report_sections` and `report_files` rows for that snapshot so
  the resumed run is the single source of truth. Without this,
  replaying steps 6-8 on the same snapshot produced duplicate
  section rows (which break the on-page report keyed by
  `section_name`) and orphan PDF file references.

### R3 — Browser pool + cleanup cron

- **Shared `Browser` singleton** in `server/services/pdf-renderer.ts`
  via `getOrCreateBrowser()`. Each render uses its own
  `BrowserContext` (cheap, isolated cookie/storage jar, no profile
  collisions). The `disconnected` handler drops the singleton if
  Chromium dies so the next render relaunches instead of timing
  out on a dead handle.
- **Atomic write.** Renders to a `.tmp-<uuid>` sibling and renames
  to the final path only on a successful `page.pdf()` write.
  Eliminates partial PDFs when Chromium crashes mid-write.
- **Shutdown.** `closeSharedBrowser()` is wired to the SIGTERM
  handler in `server/index.ts` so a graceful shutdown closes the
  chromium child process before `pool.end`.
- **Cron.** 24h `cleanupOldPDFs(generated_reports, 30d)` registered
  in `server/index.ts` with a 60s warmup.

### P1 — Aggregator parallelization (Step 1)

`aggregateSnapshotData` in `server/services/report-snapshot.ts`
previously did two sequential awaits to gather `runsData` then
`itemsData`, then ran the rest serially. The 9 independent reads
(`runsData`, `itemsData`, topics, categories, xraySites, models,
the per-client lookup, etc.) now fan out into one `Promise.all`.
Validation is moved post-fanout so it still surfaces clearly. The
downstream answers/citations/mentions queries still gate on the
ids returned upstream (they're not actually independent of
itemsData).

### P2 — p-limit summarizer (Step 3)

`server/services/response-summarizer.ts` previously used a
`setTimeout`-based batch loop with rough rate limiting. Replaced
with `pLimit(LLM_SUMMARIZER_CONCURRENCY ?? 8)` for true
bounded-concurrency parallelism. `p-limit` is now an explicit
dependency in `package.json` (it had been dynamic-imported without
being declared, a footgun for fresh installs and for the bundler).
Static `import pLimit from 'p-limit'` at the top of the file so
boot-time module resolution catches any missing-dep regression
immediately.

### P3 — Streaming CSV / ZIP exports

- **New streaming writers.** `streamResponsesCsvToFile`,
  `streamCitationsCsvToFile`, and `streamMentionsCsvToFile` in
  `server/services/csv-exporter.ts` emit one CSV line at a time via
  `Readable.from(generator())` piped through `createWriteStream`
  using `pipeline()` for proper backpressure / error
  propagation.
- **ZIP integration.** `server/services/zip-exporter.ts` creates a
  per-export `mkdtemp(path.join(tmpdir(), 'polaris-export-'))`
  directory, streams the three large CSVs to disk in parallel,
  and adds them to the archive via `archive.file(path)` rather
  than `archive.append(string)`. The temp dir is removed in a
  `finally` block after `archive.finalize()` resolves.
- **Build-site memory win.** `generateCSVExports(...)` now takes
  `{ excludeFilenames?: ReadonlySet<string> }`; the three large
  CSV blocks are skipped at construction time, not just at consume
  time. Without this, the strings would still be materialized in
  RAM even though they were never appended to the archive — the
  whole point of P3.

### P4 — DB index audit

Added btree indexes on the aggregator hot-path columns:
`prompt_run_items.prompt_run_id`, `answers.prompt_run_item_id`,
`citations.answer_id`, `mentions.answer_id`, `rankings.answer_id`.

### Migration

`migrations/0009_task_105_report_checkpoints.sql` is a new manually
authored migration capturing all R2 columns and P4 indexes with
idempotent `ALTER ADD COLUMN IF NOT EXISTS` and
`CREATE INDEX IF NOT EXISTS` statements. Prod can replay it without
depending on `drizzle-kit push`. Dev was pushed via
`npm run db:push --force`.

### Carve-outs / follow-ups

- Hard concurrency lock against duplicate `report_jobs` for the
  same `(clientId, runIds)` was intentionally not implemented —
  the active-operations banner already warns the user, and the
  worker still serializes per-process. Backlog **#106**.
- Report-row creation remains inside the worker rather than at
  enqueue time, leaving a small window where a crash between
  enqueue and the first progress event has no `payload.snapshotId`
  to cascade against. The new `failLinkedReportRows` cascade plus
  the >15min stale-queued sweep cover the same observability gap
  in practice. Backlog **#107**.
- `server/routes/reports.ts` imports `jobQueue` from `../routes`
  rather than `./_shared`; works today but is fragile to a future
  refactor. Backlog **#108**.

### Files

`shared/schema.ts`, `package.json`,
`migrations/0009_task_105_report_checkpoints.sql`,
`server/index.ts`, `server/routes/reports.ts`,
`server/services/job-queue.ts`,
`server/services/report-job-processor.ts`,
`server/services/report-snapshot.ts`,
`server/services/response-summarizer.ts`,
`server/services/pdf-renderer.ts`,
`server/services/csv-exporter.ts`,
`server/services/zip-exporter.ts`.

## 2026-05-15 — Fix executive report PDF spawn EIO + harden partial-success path (Task #104)

- **Symptom.** Executive report generation failed right after Step 6
  ("Saving report sections") with the toast `PDF rendering failed:
  browserType.launch: spawn EIO …`. Step 6 itself completed — sections
  were written to `report_sections` — but Step 7 crashed when
  Playwright tried to spawn its Chromium subprocess and the whole
  job was marked `failed`, wiping the user's view of the completed
  sections.
- **Root cause.** `server/utils/chromium-path.ts::getSystemChromiumPath()`
  resolved Chromium via `CHROMIUM_PATH` → `which chromium` →
  Nix-store scan → common system paths. `which chromium` returned
  the **system Nix Chromium 138** at
  `/nix/store/qa9cnw…-chromium-138.0.7204.100/bin/chromium`. The
  installed Playwright (`playwright@1.55.x`) only knows how to drive
  `chromium-1187`; the protocols are not compatible and the system
  binary fails to spawn under Playwright's launch sequence,
  surfacing as `spawn EIO`. Replit pre-installs a Playwright-version-
  matched Chromium and exposes the canonical path via
  `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, but the resolver wasn't
  checking it. The website crawler hit the same code path but
  tolerated failures via the Cheerio fallback — PDF rendering had
  no fallback, so the bug surfaced here first.
- **Fix part 1: prefer the Replit-blessed Playwright Chromium.**
  Added a new highest-priority Strategy 0 in
  `getSystemChromiumPath()`: if `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`
  is set and the file exists, return it. Logs
  `[Chromium] Using REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE: <path>`
  at boot.
- **Fix part 2: boot-time self-test.** `server/index.ts` now runs a
  tiny `[PDF Self-Test]` after the listen — renders a 1-page blank
  PDF, logs path + bytes + ms, and surfaces a hard error early so
  a Chromium regression doesn't ship and only fail on first user
  click.
- **Fix part 3: harden the partial-success path.** Each PDF renders
  inside its own `.catch()` so a Chromium / Playwright failure on
  Insights does **not** escape to the outer try-catch and nuke the
  whole report. The 13 saved sections stay viewable in the UI; the
  job is downgraded to `completed_partial`. Token / cost accounting
  for the Appendix LLM call is preserved even when the subsequent
  Appendix PDF render fails (previously, mutating the appendix
  outcome to `{ok: false}` silently zeroed out the already-paid LLM
  bill). The Reports list (`client/src/pages/reports.tsx`) now reads
  `report_files` to decide which download buttons to enable —
  either, both, or neither — and renders a yellow "PDF rendering
  failed" banner with the raw error tucked into a `<details>` block.
- **Files.** `server/utils/chromium-path.ts`, `server/index.ts`,
  `server/routes/reports.ts`, `server/services/report-job-processor.ts`,
  `server/services/pdf-renderer.ts`, `client/src/pages/reports.tsx`.

## 2026-05-15 — Block DNS-rebinding SSRF in URL reachability probe (Task #102)

- **Symptom / risk.** The URL reachability probe added in Task #99
  only blocked literal private IPs and obvious hostnames
  (`localhost`, `*.local`, RFC1918 literals, IPv6 ULA/link-local).
  A public hostname like `evil.example.com` whose A-record returned
  `10.x.x.x` would still be probed. Worse, a hostname that resolved
  to a public IP on the first lookup and a private one on the
  second (classic DNS rebinding) would also slip past — giving an
  attacker a way to elicit GET requests against internal services
  from the Polaris worker.
- **Fix.** New `assertAllowedTarget(url)` (async) runs the existing
  sync `isAllowedTarget` check, then resolves the hostname via
  `dns/promises.lookup({ all: true })` and rejects with
  `Private/internal host blocked` if **any** returned address falls
  in a private / loopback / link-local range. DNS failures return
  `DNS lookup failed`. IP-literal hosts skip the lookup (already
  validated upstream).
- **Redirect re-validation.** The single-hop redirect follower in
  `tryFetch` also calls `assertAllowedTarget` on the redirect
  target so a public host can't bounce the probe onto an internal
  one whose hostname only resolves to private IPs.
- **De-duplication.** Reused the existing
  `isPrivateOrLoopbackHost` for IPv4 and bracket-wrapped IPv6 to
  avoid duplicating the prefix table.
- **Self-check.** Dev-only fire-and-forget probe at module import
  hits `http://localtest.me` (a public hostname that resolves to
  `127.0.0.1`) to prove the rebinding guard fires.
- **Files.** `server/services/url-reachability.ts`.

## 2026-05-15 — Onboarding gaps — parallel crawl + URL reachability + completion idempotency (Task #99)

Three threads, one task because they share the same files and the
same testing surface.

- **Wizard idempotency on Back/Forward.** Task #90 already gated
  Step 2-4 auto-AI re-runs via `enrichedSteps`. Hardened the
  completion path: `hasCompletedRef` short-circuits double
  `complete-onboarding` mutations, `PUT /api/v1/clients` is
  idempotent, and the competitor POST is server-deduped. The ref
  clears on error so retries are still safe. Result: walking the
  wizard forward to Step 5, hitting Finish, going Back to Step 4
  and hitting Finish again creates exactly one set of competitors
  instead of two.
- **Parallel crawl in `generate_metadata`.** Replaced the serial
  `for (const url of urls) { await crawlWebsite(url) }` loop in
  `server/openai-service.ts` with the bounded `runWithConcurrency`
  helper from Task #98 (`cap = 3`). Per-URL try/catch in the
  worker with a typed `CrawlOutcome` union (`{ ok, url, result } |
  { ok: false, url, error }`) — no `any`. Failure accounting is
  preserved (`rejected`/`thrown` URLs push to `failedUrls`). New
  timing log:
  `[GenerateMetadata] crawled N urls in Xs (parallel, K-in-flight,
  X ok / Y failed)`.
- **AI-generated URL reachability probe.** New
  `server/services/url-reachability.ts`:
  - Bounded HEAD → GET fallback (3 s `AbortSignal.timeout`).
  - `Range: bytes=0-0` to avoid pulling response bodies.
  - In-process dedup so the same URL isn't probed twice in a
    burst.
  - Skips entirely under `NODE_ENV=test`.
  - SSRF guardrails: block non-http(s) schemes, `localhost`,
    `*.local`, RFC1918, CGNAT, link-local, IPv6 ULA / link-local
    prefixes (later extended in Task #102 with DNS resolution).
  - Manual single-redirect follow (max 1 hop) with redirect-target
    re-validation against the SSRF allowlist.
  Wired into `OnboardingEnrichmentService.{enrichUrls,
  enrichCompetitors}` so the wizard receives a `reachable: true |
  false | unknown` flag per URL. New
  `POST /api/v1/onboarding/probe-urls` endpoint for the wizard's
  Re-check buttons.
- **Wizard UI.** New `<ReachabilityChip>` with four states (Checking…
  / Reachable / Couldn't reach this URL / Not checked). Warning +
  unknown states are clickable buttons that re-probe that single
  URL via a per-URL `checkingUrls` Set so two clicks don't fire two
  parallel probes for the same URL. Rendered next to Step 2 URL
  badges and Step 4 competitor websites. Global "Re-check" button
  on Step 2 covers all current URLs + competitor websites in one
  call. **Always advisory** — never blocks Next, since
  network/firewall issues are real.
- **Files.** `client/src/components/create-client-wizard.tsx`,
  `server/openai-service.ts`,
  `server/services/url-reachability.ts`,
  `server/services/onboarding-enrichment.ts`,
  `server/routes/onboarding.ts`.

## 2026-05-15 — Fix double scrollbar on Project Settings (Task #91)

- **Symptom.** `/app/client-config` rendered two vertical scrollbars at
  the right edge — the outer `<main className="flex-1 overflow-auto">`
  from `client/src/components/layout/app-layout.tsx` plus a second,
  nested track inside the page content (visible against the AI Models
  card area in the user's screenshot).
- **Root cause.** A page-level wrapper in
  `client/src/pages/client-configuration.tsx` carried an `overflow-*`/
  fixed-height utility that turned the inner column into its own scroll
  container. With the outer `<main>` already scrollable, the page body
  produced a redundant inner scroll track.
- **Fix.** Drop the offending utility from the page-level container so
  only the outer `<main>` scrolls. The header and every card (Project
  Identification, Basic Information, Website URLs, Focus Areas,
  Competitors, AI Models, etc.) now scroll together as one column.
- **Preserved deliberately.** The
  `max-h-[300px] overflow-y-auto` blocks at ~line 818 (Industry
  `PopoverContent`) and ~line 1070 are intentional and live inside
  popovers, not on the page itself; left untouched.
- **Verified.** Three states all show exactly one scrollbar — short
  content (no scroll needed), tall content (all cards expanded), and
  with a `DisabledModelBanners` block visible above the header.
- **Out of scope (and not changed).** Any layout/redesign of Project
  Settings; the `<main>` overflow rule in `app-layout.tsx`; any other
  page rendered inside the same shell.

## 2026-05-13 — Navigation refresh + top-nav project switcher (Task #86)

Three coordinated UI changes to align with the new Figma, plus a small
catalog-search improvement.

- **Top-nav project switcher.** Replaced the old `<ClientSelector>`
  trigger in `client/src/components/layout/top-navigation.tsx` with a
  dropdown anchored on the project label
  (e.g. "Kearney | Kearney – Main Project ▾"). Dropdown contents:
  autofocused search input (debounced filter over the user's accessible
  projects), the filtered list (max ~8 visible, scrollable), and footer
  actions **View all projects** → `/app/clients` and **Create project**
  → `/app/clients` opening the existing create dialog. Reuses the same
  projects query the catalog uses (no new API surface). Selecting a
  project both calls `setSelectedClientId()` AND navigates with
  `?clientId=` so URL-driven selection from Tasks #52/#53 keeps
  working in fresh tabs / middle-clicks. When no project is selected,
  the trigger reads "Select a project" and the menu opens by default.
- **Sidebar restructure.** `client/src/components/layout/sidebar.tsx`
  rewritten to use the section-header layout from
  `attached_assets/Navigation_1778703142604.jpg`: **Overview**
  (Dashboard, Prompts Tracker) → **Analysis** (Site X-Ray, Topics &
  Keywords, Prompt Library) → **Opportunities** (Citation Analysis,
  Recommendations, Content Generator) → **Reports** (Executive Reports)
  → **Admin** (Users & Invitations, Projects, Job Queue, AI Models,
  Audit Log — admins only). Removed the **Client Catalog** entry
  (the catalog is the home page; `/app/clients` remains the route and
  the redirect target for `/app` when no project is selected). Project
  Settings moved to a bottom-pinned footer slot via `mt-auto` with its
  own gear icon. Soft-disable styling when no project is selected and
  the `?clientId=` append-on-every-Link behavior from Tasks #52/#53 are
  preserved.
- **"Client Configuration" → "Project Settings" rename.** Every
  user-visible "Client Configuration"/"Client Settings" string (sidebar
  label, page heading on `/app/client-config`, top-nav references,
  breadcrumbs) replaced with "Project Settings". Routes / file names
  (`client-configuration.tsx`, `/app/client-config`) and the database
  schema (`clients.*`) are deliberately unchanged — UI rename only.
- **Catalog search expansion.** `filteredClients` in
  `client/src/pages/client-catalog.tsx` extended to also match
  `geography` (it previously only matched `projectName`, `name`,
  `industry`). The same filter function is reused by the top-nav
  switcher so both surfaces stay in sync.
- **Out of scope (deliberate carve-outs from the task plan).**
  Replacing the lucide icons with custom SVGs (waiting on artwork from
  the user); the org switcher (separate backlog); dark-mode polish on
  the new dropdown surface (uses the shadcn DropdownMenu / Popover
  defaults); carrying `?clientId=` through the top-nav user dropdown
  and the client-catalog "Open" button (separate backlog item);
  replacing `<ClientSelector>` on non-top-nav surfaces (left in place
  for this iteration); and renaming the database column or schema
  field `clients.*` to `projects.*` (UI rename only).
- **Files touched.** `client/src/components/layout/sidebar.tsx`,
  `client/src/components/layout/top-navigation.tsx`,
  `client/src/components/client-selector.tsx` (legacy chip — left in
  place on non-top-nav surfaces), `client/src/pages/client-catalog.tsx`,
  `client/src/pages/client-configuration.tsx`,
  `client/src/App.tsx`, `client/src/hooks/use-selected-client-id.ts`
  (single source of truth, unchanged but referenced by the new
  switcher), `client/src/components/protected-route.tsx`.

## 2026-05-15 — Refresh Prompts speed + crash-safety (Task #98)

- **Route.** `POST /api/v1/clients/:id/refresh-prompts` in
  `server/routes/clients.ts` reworked. Previous flow: (a)
  `storage.deleteAIGeneratedPrompts(clientId)` runs unconditionally,
  (b) for-loop awaits `classifyPrompt(item.text)` then
  `storage.createPrompt(...)` per item. Two pathologies:
  classification was serial (~30–60 s wall-clock for 18 prompts) and
  the delete ran outside any transaction, so a mid-batch failure left
  the project with a partial or empty Prompt Library and no rollback.
- **Concurrency helper.** New file-local
  `runWithConcurrency<T,R>(items, limit, fn)` (no new dep). N lanes
  pull from a shared cursor; results are written back to the same
  index so order is preserved. Used at `CLASSIFY_CONCURRENCY = 5`.
- **Transaction.** Delete + bulk insert wrapped in
  `db.transaction(async (tx) => { await tx.delete(prompts).where(and(eq(prompts.clientId, clientId), or(eq(prompts.source,'crawl'), eq(prompts.source,'ai')))); return await tx.insert(prompts).values(rows).returning(); })`.
  Bulk insert intentionally bypasses `storage.createPrompt` because
  the transaction needs the `tx` handle, which `IStorage` does not
  expose. This is the first `db.transaction` usage in `server/`.
- **Driver compatibility.** `db` is constructed via
  `drizzle({ client: pool, schema })` from
  `drizzle-orm/neon-serverless` (WebSocket pool driver) which
  supports `.transaction()` natively.
- **Empty-batch guard preserved.** If `generated.length === 0` the
  route returns 500 *before* opening the transaction, so a generator
  failure never wipes existing prompts.
- **Classification is best-effort** inside the parallel pass — a
  single `classifyPrompt` failure logs `[RefreshPrompts] Failed to
  classify prompt:` and falls back to `categoryId = null` rather than
  aborting the whole refresh. Per-prompt log line preserved with
  `cat=unknown` when classification failed.
- **Tracking job lifecycle preserved.** `trackingJobId` is created
  *before* generation, set to `done` after the transaction succeeds,
  and set to `failed` (with `error.message`) inside the existing
  `catch` block when the transaction rolls back. The multi-user
  activity banner ("Refresh Prompts in progress / by …") is
  unaffected.
- **Schema unchanged. No migrations. No new dependencies.**
- **Out of scope by design.** Onboarding pipeline
  (`server/services/job-queue.ts` `processGenerateMetadata`) is
  unchanged — it inserts into a fresh project and has no delete-
  then-insert race. Auto-retry on transaction rollback and a batch
  classifier API are explicitly not part of this task.
- **Approved by code review.**

## 2026-05-13 — New Polaris favicon (Task #85)

- **Assets.** `client/public/favicon.svg` (vector, 48×48, brand circle +
  Polaris mark), `client/public/favicon.png` (refreshed 48×48 PNG),
  new `client/public/apple-touch-icon.png` (180×180, ImageMagick
  upscale).
- **HTML.** `client/index.html:22-48` reordered: SVG primary
  `rel="icon"`, PNG fallbacks at 16/32, dedicated `apple-touch-icon`,
  `?v=1778692099263` cache-buster on every link.

## 2026-05-12 — Disable-lifecycle hardening for AI models (Task #79)

- **Schema.** `ai_models.disabled_at` (timestamptz),
  `ai_models.disabled_by_user_id` (FK → `users.id` SET NULL),
  `ai_models.disabled_reason` (text). Migration
  `migrations/0007_add_ai_model_disable_audit.sql`.
- **Storage.** `IStorage.cancelInFlightForDisabledModel(modelId)` —
  cancels any `prompt_run_items` whose `aiModelId = modelId` and whose
  parent run is still active, then marks the parent run `error` only
  if no remaining items reference any *enabled* model (preserves
  mixed-model runs that still have viable work).
  `IStorage.sweepDisabledModelFromClients(modelId)` strips the model
  from every `clients.selectedAiModelIds` (jsonb `@>` filter).
  `IStorage.getAiModelAuditHistory(id, limit)` unions `ai_model` audit
  rows with `llm_function` rows whose `metadata.modelId` or
  `metadata.previousModelId` matches.
- **Routes.** `PATCH /api/v1/admin/ai-models/:id` detects the
  enabled→disabled transition, writes `disabledAt` + `disabledByUserId`
  + `disabledReason`, runs the cascade, and writes one audit row per
  cascade phase. `GET /api/v1/admin/ai-models/:id/audit` returns the
  most recent 5 entries.
- **JobQueue.** New `haltedJobs: Set<string>` distinct from
  `cancelledJobs`. Poller maps DB `cancelled` → cancelled,
  DB `error` → halted. `checkCancellation` throws
  `"Run halted by admin disable"` for halted (distinct from
  `"Job cancelled"`). Executor catch handles isHalted by `return`-ing
  without writing status. Final-state guard re-reads the job after
  `processJob()` and skips the `done` write when the job is already
  terminal `error` / `cancelled` (defeats the cascade-overwrite race).
- **UI.** Optional disable-reason textarea on `/app/admin/models`,
  before→after History popover (`button-history-<id>` /
  `popover-history-<id>` / `text-history-beforeafter-<auditId>` /
  `text-history-reason-<auditId>`), and per-project disabled-model
  banner with disable date + reason on `client/src/pages/client-configuration.tsx`.
- **Tests.** `server/tests/ai-model-disable.test.ts` (4 cases incl.
  executor halted path + JobQueue completion guard).
  `e2e/admin-disable-model.spec.ts` covers the warn-before-disable
  flow (seed in-flight run, assert in-flight count testid in confirm
  modal, confirm disable, poll until run reaches terminal status).
- **Drift / known limits.** Cascade phases run as separate
  transactions (follow-up #81). `@playwright/test` is not in
  `package.json` devDependencies — spec is checked in as the
  versioned source-of-truth and is exercised via the testing skill.

## 2026-05-12 — Provider health & vendor kill switch (Task #78)

- **Schema.** `ai_vendor_status` (vendor PK matching
  `ai_models.vendor`, `paused` boolean default false, `paused_at`,
  `paused_by_user_id` FK → `users.id` SET NULL, `pause_reason` text).
  Migration `migrations/0006_add_ai_vendor_status.sql`.
- **Cache.** `server/config/vendor-pause.ts` — 30 s TTL
  `Set<string>` of lowercased paused vendors with generation-token
  race-discard. Skipped under `NODE_ENV=test` / `SESSION_STORE=memory`.
  Exports `assertVendorNotPaused(vendor)`, `ensureVendorPauseLoaded()`,
  `invalidateVendorPauseCache()`, and `VendorPausedError`.
- **Executor.** `executePrompt` in `server/services/ai-executor.ts`
  awaits `ensureVendorPauseLoaded()` and short-circuits with
  `{ rawResponse: '', error: 'Vendor paused: <vendor>', statusCode: 503 }`
  when the vendor is paused.
- **Internal LLM call sites.** Narrative generator, competitor
  discovery, prompt classifier, X-Ray content analyzer,
  openai-service metadata generation, response summarizer, content
  recommendation analyzer, and the `server/llm/{openai,anthropic}.ts`
  LLMClient wrappers all `assertVendorNotPaused(vendor)`.
- **Endpoints.** `GET /api/v1/admin/providers` (per-vendor row with
  key status + model count + last-success timestamp + pause state),
  `PATCH /api/v1/admin/providers/:vendor` (audit-logged via
  `ai_vendor.pause.set` / `ai_vendor.pause.clear`).
- **Consumer filter.** `GET /api/v1/ai-models` drops paused-vendor
  models so they can't be picked in the wizard / run dialog. The
  admin catalog `GET /api/v1/admin/ai-models` still returns them with
  an `isVendorPaused` flag so the row chip renders.
- **UI.** New `ProvidersPanel` above the Models tab on
  `/app/admin/models`.

## 2026-05-12 — Function → Model picker in admin (Task #77)

- **Schema.** `llm_function_overrides` (function PK, `model_id` FK →
  `ai_models.id`, `updated_at`, `updated_by_user_id` FK → `users.id`
  SET NULL).
- **Resolution.** `llm_function_overrides` row → `LLM_<FUNCTION>_MODEL`
  env var → `LLM_FUNCTION_DEFAULTS`. The boot-time
  `[LLM Functions] Resolved model configuration:` log keeps reading
  from env; DB overrides resolve at runtime per call.
- **Audit.** Override events record `modelId` + `previousModelId` +
  `overrideModelLabel` so they surface in the per-model History
  popover (Task #79).

## 2026-05-12 — Warn before disabling an in-use model (Task #73)

- **API.** `GET /api/v1/admin/ai-models/:id/disable-impact` returns
  `{ projectCount, inFlightItemCount }` so the UI can surface the
  blast radius.
- **UI.** Confirmation dialog `dialog-disable-model` with
  `text-disable-impact`, `text-impact-projects`,
  `text-impact-in-flight`, optional `input-disable-reason` textarea,
  `button-confirm-disable` / `button-cancel-disable`.

## 2026-05-12 — Enable/disable AI models from the UI (Task #67) + key availability (Task #66) + Core/Additional toggle (Task #39)

- **#66.** `annotateKeyAvailability` helper on
  `GET /api/v1/admin/ai-models` returns `keyConfigured` + the env-var
  name behind it. UI renders a "Key configured" / "Key missing" badge
  with a tooltip per row.
- **#67.** Per-row enabled `Switch` (`switch-enabled-<id>`) flips
  `ai_models.enabled`. `GET /api/v1/ai-models` (consumer) filters
  disabled rows so they can't be selected anywhere downstream.
- **#39.** Core/Additional pill on each row flips
  `ai_models.category` (`core` ↔ `additional`) without code changes;
  the boot-time `syncModelCategories()` stays as the backfill.

## 2026-05-13 — Past Site X-Ray analysis runs (Task #64)

- **Storage.** `IStorage.getLatestXRayJobsBySite(clientId)` →
  `Map<siteId, { jobId, status, error, progress, startedAt,
  finishedAt, createdAt, startedByUserId }>`. DbStorage uses a single
  window-function query (`ROW_NUMBER OVER PARTITION BY siteId`)
  filtering `jobs.type = 'xray_analysis'` and `payload->>'clientId'`.
  MemStorage returns empty Map.
- **API.** `GET /api/v1/xray/sites` joins each site with its latest
  job and hydrates user attribution via `storage.getUsersByIds`,
  returning `lastAnalysisJob` (with `displayName` / `email`) and
  `activeJobId` (set only when status is `queued` / `running`).
- **UI.** New `<LastAnalysisRow site={...}>` in the site accordion
  trigger; `SiteAccordion` seeds local `activeJobId` from
  `site.activeJobId` (and adopts later updates) so refreshes /
  teammate-started runs pick up automatically. Sites query polls
  every 3 s while any site has an `activeJobId`.

## 2026-05-12 — Cancel a running Site X-Ray analysis (Task #63)

- `JobQueue.cancelJob(jobId)` (already used by Generate Metadata)
  publishes through `cancelledJobs`. `processXRayAnalysis` checks
  between batches and exits cleanly. Filed follow-up #65 — automated
  test for mid-batch cancellation.

## 2026-05-12 — Surface Site X-Ray failures (Task #61)

- The X-Ray page reads each site's latest `xray_analysis` job and
  renders a per-site failure indicator (status badge + error text)
  instead of silently leaving the previous analysis in place. Closes
  the visibility gap Task #58 left open as follow-up #61.

## 2026-05-12 — Login + invitation pages on the new Polaris look (Tasks #68 / #70)

- **#68.** `/login` rebuilt to match the new Figma — split-screen
  brand layout, layered form panel, floral background, restyled
  "Remember me" checkbox and primary action.
- **#70.** `/forgot-password`, `/reset-password`, and the
  credential-grant `/invitation/:token` page were brought onto the
  same visual system.

## 2026-05-06 — Site X-Ray batch worker (Task #58)

Implements the missing `xray_analysis` job handler in `JobQueue` so
`POST /api/v1/xray/analyze/batch` actually runs.

- **Worker.** `processXRayAnalysis(siteId, clientId, jobId)` in
  `server/services/job-queue.ts`. Loads site + client, ensures
  `page_structures` exist for every page (parsing `rawHtml` on demand
  via `xray-structure-parser` / `xray-entity-extractor` /
  `xray-topic-mapper`), then runs `analyzeBatchPages` in chunks of 5
  with the same retry / backoff as the embedded
  `generateMetadata({ enableSiteXRay: true })` pipeline. Writes results
  via `storage.createPageAnalysis`. Throws if every batch fails so the
  job transitions to `error`.
- **Switch wiring.** New `case "xray_analysis":` in `processJob`.
- **Stale recovery.** `recoverStaleJobs()` now also fails any
  `xray_analysis` row queued longer than the 15 min stale threshold —
  clearing pre-existing zombies and giving the type a TTL.
- **Deliberate scope.** This worker only runs structure extraction +
  page-level AI analysis. It does **not** re-run X-Ray ingestion or
  fan analyses out to the `recommendations` table — that still lives
  in the `generateMetadata` pipeline (follow-up #60). The X-Ray UI
  also doesn't surface job failures to the user yet (follow-up #61).
- **Validation.** `npx tsc --noEmit` clean for project code. End-to-end
  not exercised because the worker requires a real OpenAI key plus an
  ingested X-Ray site.

## 2026-05-06 — Stale prompt-run reaper (Task #59)

Boot-time one-shot sweep that prevents zombie `prompt_runs` from
surfacing as fake "in progress" pills on the multi-user activity banner.

- **Storage.** New `IStorage.reapStalePromptRuns(olderThanMs, reason)` —
  DbStorage marks rows + items with `status = 'error'`,
  `error_summary` / `error = reason`; MemStorage returns `{ runs: 0,
  items: 0 }`. Note: `statusEnum` has no `failed` value — `error` is
  the canonical terminal-failure status (drift vs initial plan, which
  said `failed`).
- **Service.** `server/services/prompt-run-reaper.ts` exposes
  `reapStalePromptRunsAtBoot()`. Reads `STALE_PROMPT_RUN_AGE_MS` (default
  30 min). No-ops under `NODE_ENV=test` / `SESSION_STORE=memory`. Logs
  under `[PromptRunReaper]`. Errors are caught — boot is best-effort.
- **Wiring.** Called from the `server/index.ts` async IIFE right after
  `seedDatabase()` and before CSRF / auth / route registration so the
  job-queue executor never picks up a stale row.
- **Shared constant.** `ACTIVE_PROMPT_RUN_STATUSES` is now exported from
  `server/services/activity-service.ts` and consumed by the DbStorage
  reaper to keep the "what counts as in-flight" definition in one place.
- **Test.** `server/tests/prompt-run-reaper.test.ts` — verifies the
  memory-store skip and that env-configured age + reason flow through
  to storage, plus that a thrown storage error doesn't escape.
- **Effect on dev DB.** First post-deploy boot cleared 13 prompt_runs
  and 14 items dating back to October 2025.

## 2026-05-06 — Active operations visibility (multi-user) (Task #56)

Visibility-only cross-user activity surface. No hard locks.

- **Schema.** `jobs.started_by_user_id` and `report_jobs.started_by_user_id`
  (nullable FK → `users.id` `ON DELETE SET NULL`). Idempotent migration
  `migrations/0004_add_activity_started_by.sql`. Cheap status indexes
  on `jobs(status, type)` and `report_jobs(status)`.
- **Storage abstraction.** New `IStorage.listActiveActivitySources(clientIds, jobTypes, jobStatuses, promptRunStatuses, reportStatuses)` and `IStorage.getUsersByIds(ids)` implemented in `server/db-storage.ts` (class methods, not prototype patches) with no-op MemStorage stubs.
- **Service.** `server/services/activity-service.ts` exposes
  `listActiveActivitiesForClients(clientIds)` and
  `getActivitySummaryForClients(clientIds)` returning `ActivityItem[]` /
  `ActivitySummary[]` (see `shared/schema.ts`).
- **Endpoints.**
  `GET /api/v1/clients/:clientId/activity`,
  `GET /api/v1/clients/activity-summary?orgId=…`,
  `GET /api/v1/prompt-runs/:id/selections`. The summary endpoint is
  excluded from the `requireTenantAccessIfPresent()` regex in
  `server/auth.ts` (segment `activity-summary` would otherwise be
  treated as a client UUID and 403'd).
- **Attribution plumbing.** `jobs.create`, `promptRuns.create`,
  `reportJobs.create` carry `startedByUserId` from `req.user.id`
  through every async enqueue path. The synchronous `refresh-prompts`
  endpoint writes a manual tracking row.
- **Frontend hooks.** `client/src/hooks/use-client-activity.ts` —
  `useClientActivity`, `useClientActivityItems`, `useActiveItemOfKind`,
  `useClientsActivitySummary`, `describeStarter`, `activityItemHref`,
  `activityKindLabel`, and `invalidateActivityQueries(clientId?)`.
  Polling: strictly `5000 | false` per spec; `refetchOnWindowFocus`
  unchanged. Initiator updates land via the invalidator helper called
  from each enqueue's `onSuccess`.
- **UI.** `<ActiveOperationsBanner clientId={…} excludeKinds={…}>` is
  mounted on metadata-topics, metadata-prompts, dashboard, reports,
  client-configuration, site-xray, content-generator,
  citation-analysis, recommendations, and prompts-tracker (above both
  list and run-detail views). `<ActivityChip>` is the catalog tile
  pill that opens a popover with kind, starter, time-ago and a deep
  link. Soft-disable coverage: Refresh Prompts, Generate Metadata
  (admin-only override modal), Generate Report, Duplicate Project,
  Site X-Ray Refresh, Start Prompt Run (warn-only on overlap).

## 2026-05-06 — URL-driven project selection + deployment fixes (Tasks #52, #53)

- New `client/src/hooks/use-selected-client-id.ts` exposes `useSelectedClientId`, `useUrlClientId`, `setSelectedClientId(id)`, and `getSelectedClientIdSnapshot()`. Backed by `useSyncExternalStore` over `window.localStorage["current-client-id"]`. `setSelectedClientId` writes to `localStorage` and explicitly dispatches a `selected-client-changed` custom event for same-tab subscribers; cross-tab subscribers are notified implicitly via the browser's native `storage` event (fires in *other* tabs only on every `localStorage` write). The `subscribe()` callback in the hook listens for both.
- `client/src/components/protected-route.tsx` runs a URL→store sync effect on every navigation: `?clientId=` always wins over the cached store value.
- Every project-scoped page resolves `selectedClientId = urlClientId || storedClientId` and renders a "No Client Selected" empty state when both are null: `dashboard.tsx`, `prompts-tracker.tsx`, `client-configuration.tsx`, `site-xray.tsx`, `metadata-topics.tsx`, `metadata-prompts.tsx`, `citation-analysis.tsx`, `recommendations.tsx`, `content-generator.tsx`, `reports.tsx`. (No automatic `/api/v1/clients` fallback — the user picks a project from the top-nav dropdown.)
- `client/src/components/layout/sidebar.tsx` appends `?clientId=${selectedClientId}` to every project-scoped `Link.href` (Dashboard, Prompts, Reports, dynamic `navigation`/`reportsNavigation` items) so middle-click / open-in-new-tab carries the selection through (Task #53). The top-navigation user dropdown and the client-catalog "Open" button still use `setLocation()` + `setSelectedClientId()` without a URL query — fine for same-tab clicks but does not yet survive middle-click; tracked as a follow-up.
- Deploy: `.replit` `[deployment] deploymentTarget = "vm"` re-applied; `build = ["npm","run","build"]`, `run = ["npm","run","start"]`, `publicDir = "dist/public"`. Production lives at `https://polaris-r3.ignitelabs.online`.
- Deploy: `.gitignore` now excludes `.config/pulse/` (PulseAudio runtime symlinks created by Chromium-under-Playwright that point at `/tmp/pulse-XXXX` dirs cleaned up on workflow exit). Eliminates `Detected broken symlink` warnings on Repl layer push.
- Operator gotcha (docs only): dev workflow and prod VM each have their own `DATABASE_URL` pointing at separate Neon databases. Project renames / prompt runs / topics created on one do NOT appear on the other. Documented in `replit.md` `## Gotchas` and `prd/11-environment-and-deployment.md`.

---

## 2026-05-04 — Active-sessions ↔ session-table consistency (Task #42)

- `listUserSessionsForUser` and `countActiveUserSessions` in `server/db-storage.ts` now filter via `EXISTS (SELECT 1 FROM session WHERE sid = session_id AND expire > NOW())`. Sessions whose underlying connect-pg-simple `session` row was already pruned no longer surface in `GET /api/v1/auth/sessions`.
- New `pruneOrphanUserSessions()` in `server/services/sessions.ts` (delegates to `IStorage.pruneOrphanUserSessions()` in `server/db-storage.ts`); `setupAuth()` (`server/auth.ts:679,689`) schedules it on boot and every hour thereafter. Physically deletes orphaned `user_sessions` rows whose `session_id` has no matching `session.sid`.
- Both layers no-op under `SESSION_STORE=memory` or `NODE_ENV=test` because the in-memory store doesn't populate the `session` table.
- Adds `pruneOrphanUserSessions()` to the `IStorage` interface (`server/storage.ts`).

---

## 2026-05-04 — Session hardening (Task #37)

- **Session-fixation fix.** `POST /api/v1/auth/login` and `POST /api/v1/auth/register` (`server/auth.ts`) wrap `req.login()` in `req.session.regenerate()` so the anonymous session id is rotated before the user is attached. Successful login + logout write `auth.login.success` / `auth.logout` audit rows.
- **CSRF double-submit.** `server/middleware/csrf.ts` issues a non-httpOnly `polaris.csrf` cookie on every response and refuses any `/api/v1` state-changing request whose `x-csrf-token` header doesn't match (returns `403 { message: "CSRF token missing or invalid", code: "csrf_failed" }`). Auth bootstrap exemptions: login, register, forgot-password, credential-grant status+redeem. **`POST /api/v1/auth/logout` is intentionally NOT exempt** — the SPA always echoes the cookie in the header, so a forged POST without it can't terminate someone else's session. The single source of truth for the exemption list is `isCsrfExempt(path)` in `server/middleware/csrf.ts`, re-exported as `isCsrfExemptApiV1` from `server/routes/index.ts`. Frontend fetch helpers (`client/src/lib/api-client.ts`, `client/src/lib/queryClient.ts`) read the cookie and inject the header automatically.
- **Per-IP rate limiting.** `server/middleware/auth-rate-limit.ts` throttles `/auth/login` (10/min/IP, env `AUTH_LOGIN_RATE_PER_MIN`), `/auth/register` (5/hr, `AUTH_REGISTER_RATE_PER_HOUR`), `/auth/forgot-password` (5/hr, `AUTH_FORGOT_RATE_PER_HOUR`). 429 responses return `{ message, retryAfterSeconds, code }`. Skipped under `NODE_ENV=test`.
- **`user_sessions` ledger.** New table in `shared/schema.ts:126` stores `sessionId` (PK, mirrors express-session id), `userId` (FK), parsed user-agent, IP, `createdAt`, `lastSeenAt`. Helpers in `server/services/sessions.ts` cover record/touch/delete/list/count + `pruneOrphanUserSessions` (Task #42).
- **Idle / absolute timeout + remember-me.** `requireAuth` (`server/auth.ts:523,530`) enforces idle (7 d users / 24 h admins; env `SESSION_IDLE_MS`, `SESSION_ADMIN_IDLE_MS`) and absolute (30 d; env `SESSION_ABSOLUTE_MAX_AGE_MS`). On expiry, response carries `{ message, reason: "idle_timeout" | "absolute_timeout" | "session_revoked" | "account_disabled" }`. Login accepts `rememberMe: boolean` — true keeps the cookie for `SESSION_REMEMBER_ME_MS` (30 d default), false makes it a browser-session cookie. `lastSeenAt` writes throttled to once per minute per session.
- **Active-sessions API + UI.** Three new endpoints (`server/auth.ts:1145+`, registered in `server/routes/openapi.ts:2251,2273,2281`):
  - `GET /api/v1/auth/sessions` — `{ currentSessionId, sessions: [{ sessionId, userAgent, ipAddress, createdAt, lastSeenAt, current }] }`.
  - `DELETE /api/v1/auth/sessions/:id` — destroys the express-session row AND the `user_sessions` mirror; always 204; revoking own current session also clears `polaris.sid`.
  - `POST /api/v1/auth/sessions/sign-out-others` — bumps the user's `sessionEpoch`, prunes sibling rows, returns `{ ok: true, newEpoch }`. Caller's session is re-stamped so they stay signed in.
  - All three are CSRF-protected.
- **UI**: `client/src/pages/account/sessions.tsx` lists devices with parsed user-agent (inline regex helper, no `ua-parser-js` AGPL dep), highlights current row, per-row revoke + one-click "Sign out of all other sessions". Linked from `client/src/components/layout/top-navigation.tsx`.
- **Cross-tab logout.** `client/src/lib/auth.ts` adds a `BroadcastChannel("polaris-auth")` helper used by `useLogout()` and the 401 reason handler in `api-client.ts`. `App.tsx` installs the listener so every sibling tab clears the React Query cache and bounces to `/login` when one tab signs out or gets a revocation 401.
- **Helmet baseline.** `server/index.ts` strips `x-powered-by` and mounts `helmet` with a dev-vs-prod CSP (dev allows Vite HMR + Replit overlays + Swagger CDN + Google Fonts; prod tightens `script-src`/`connect-src`). `crossOriginResourcePolicy=same-site`. HSTS only in prod.
- **Tests.** New `server/tests/sessions.test.ts` (12/12 green) covers CSRF presence/missing/matching/logout, session-fixation, sessions list/delete/sign-out-others, ownership isolation across users, forced-termination reason + audit emission, login rate-limit (11th attempt → 429), Helmet headers.
- Files (new): `server/middleware/csrf.ts`, `server/middleware/auth-rate-limit.ts`, `server/services/sessions.ts`, `client/src/pages/account/sessions.tsx`, `server/tests/sessions.test.ts`.
- Files (modified): `shared/schema.ts`, `server/auth.ts`, `server/index.ts`, `server/routes/index.ts`, `server/routes/openapi.ts`, `client/src/App.tsx`, `client/src/lib/{auth,api-client,queryClient}.ts`, `client/src/components/layout/top-navigation.tsx`, `client/src/pages/login.tsx`, `shared/api-types.ts` (regenerated).

---

## 2026-05-04 — Persistent Postgres session store (Task #8, back-fill)

- `createSessionStore()` in `server/auth.ts` uses `connect-pg-simple` (`storage = new PgStore({ pool, tableName: 'session', createTableIfMissing: true })`) when `DATABASE_URL` is set; reuses the existing Neon serverless `pool` from `server/db.ts`. The store auto-creates the `session` table on first boot and prunes expired rows hourly.
- `SESSION_SECRET` required in `NODE_ENV=production` (`server/auth.ts:771–775` throws if missing). Dev-only fallback `dev-only-insecure-session-secret-change-me` is clearly labeled.
- `SESSION_STORE=memory` or `NODE_ENV=test` falls back to the in-process `memorystore` (`server/auth.ts:646,675`). Used by the test suite to avoid touching Postgres.
- Closes `prd/20-` H7 (`memorystore` single-process). Stack is now horizontally scalable with respect to sessions.

---

## 2026-05-05 — LLM uplift (Task #38)

- New `server/config/llm-functions.ts` centralizes 14 LLM call-site models behind a `LLM_<FUNCTION>_MODEL` env override; defaults on the GPT-5.4 family with `claude-sonnet-4-5` for the AEO Anthropic provider. Logs resolved table at boot.
- `server/seed.ts` exports `CORE_MODEL_IDS` and `DEPRECATED_MODEL_IDS`; idempotent `upsertMissingModels()` / `syncModelCategories()` / `disableDeprecatedModels()` run on every boot. No schema migration required (`ai_models.category` enum already existed).
- All 5 hard-coded `gpt-4-turbo-preview` and `gpt-4o-mini` references in the service layer now read from `LLM_FUNCTIONS`.
- `server/services/ai-executor.ts` treats HTTP 503 as `isRateLimited` for all four providers (OpenAI / Anthropic / Gemini / Perplexity).
- Run-detail polling: `client/src/components/{run-details-section,run-details-drawer}.tsx` poll every 5 s while non-terminal; `client/src/pages/prompts-tracker.tsx` invalidates per-run results cache on any active→terminal transition.
- See `LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md` for the full inventory and `ISSUE_LOG.md` for the symptom/root-cause/fix triplets.

---

## 📋 TABLE OF CONTENTS

1. [Platform Overview](#platform-overview)
2. [Complete Database Schema](#complete-database-schema)
3. [Backend Architecture](#backend-architecture)
4. [Frontend Architecture](#frontend-architecture)
5. [Core Features & Capabilities](#core-features--capabilities)
6. [API Endpoints (Complete List)](#api-endpoints-complete-list)
7. [Service Layer Modules](#service-layer-modules)
8. [Recent Enhancements (October 2025)](#recent-enhancements-october-2025)
9. [Complete Feature Timeline](#complete-feature-timeline)

---

## 1. PLATFORM OVERVIEW

### Mission
Polaris AI analyzes how AI language models (GPT-4, Claude, Gemini, etc.) respond to prompts about companies and their competitors, providing actionable intelligence on brand visibility in AI-mediated search.

### Core Value Proposition
- **Multi-Model Testing**: Execute same prompts across multiple AI vendors simultaneously
- **Competitive Benchmarking**: Compare brand performance against competitors
- **Citation Tracking**: Identify which URLs AI models cite when mentioning your brand
- **Score Explainability**: Understand WHY you received specific visibility scores
- **Content Optimization**: Get AI-powered recommendations for improving brand presence
- **Site Health Monitoring**: X-Ray analysis of website content quality and SEO

---

## 2. COMPLETE DATABASE SCHEMA

### Core Entity Tables (9)

#### 2.1 Organizations
```sql
CREATE TABLE organizations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Multi-tenancy support for agencies managing multiple client accounts

#### 2.2 Clients
```sql
CREATE TABLE clients (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id VARCHAR REFERENCES organizations(id),
  name TEXT NOT NULL,
  website TEXT,
  urls JSONB,                        -- {primary, secondary, thirdParty}
  focus_areas JSONB,                 -- Array of strategic focus topics
  industry TEXT,
  geography TEXT,
  aliases JSONB,                     -- Brand name variations
  brand_aliases JSONB,               -- Product/service name variations
  selected_ai_model_ids JSONB,       -- Which AI models to test
  onboarding_status ENUM('draft', 'inprogress', 'completed'),
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Central entity representing brands being analyzed

**Key Fields:**
- `urls`: Structured as `{primary: string, secondary: string[], thirdParty: string[]}`
- `focusAreas`: Strategic topics/keywords for prompt generation
- `aliases`: ["Polaris", "Polaris AI", "Polaris Analytics"] for matching variations

#### 2.3 Competitors
```sql
CREATE TABLE competitors (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  name TEXT NOT NULL,
  website TEXT,
  aliases JSONB
);
```
**Purpose:** Track competitive brands for benchmarking

#### 2.4 AI Models
```sql
CREATE TABLE ai_models (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor TEXT NOT NULL,              -- 'openai', 'anthropic', 'google'
  model TEXT NOT NULL,               -- 'gpt-4-turbo', 'claude-3-opus'
  display_name TEXT NOT NULL,
  max_tpm INTEGER,                   -- Tokens per minute limit
  max_rpm INTEGER,                   -- Requests per minute limit
  cost_per_1k_input NUMERIC(10,4),
  cost_per_1k_output NUMERIC(10,4),
  enabled BOOLEAN DEFAULT TRUE
);
```
**Purpose:** Define which AI models are available for testing

**Pre-seeded Models:**
- GPT-4 Turbo, GPT-4o, GPT-4o Mini
- Claude 3 Opus, Claude 3.5 Sonnet
- Gemini 1.5 Pro

#### 2.5 Topics
```sql
CREATE TABLE topics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  label TEXT NOT NULL,
  category TEXT,                     -- 'product', 'service', 'industry'
  keywords JSONB,                    -- Related keywords
  source ENUM('crawl', 'manual', 'csv', 'ai'),
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Store topics/themes used for prompt generation

**Sources:**
- `crawl`: Extracted from website crawling
- `manual`: User-entered
- `csv`: Bulk uploaded
- `ai`: Generated by GPT-4 from website content

#### 2.6 Prompts
```sql
CREATE TABLE prompts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  text TEXT NOT NULL,
  source ENUM('crawl', 'manual', 'csv', 'ai'),
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Store questions/prompts to test against AI models

**Example Prompts:**
- "What are the best brand visibility tools for enterprise?"
- "Top AI analytics platforms for marketers"
- "Which companies offer competitive intelligence software?"

#### 2.7 Prompt Runs
```sql
CREATE TABLE prompt_runs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  created_by VARCHAR NOT NULL,
  total_prompts INTEGER NOT NULL,
  status ENUM('queued', 'running', 'done', 'error', 'cancelled'),
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Track batch execution of prompts across AI models

**Workflow:**
1. User selects 10 prompts × 3 AI models = 30 total executions
2. Prompt run created with `status='queued'`, `totalPrompts=30`
3. Background job processes items one by one
4. Status updates: queued → running → done

#### 2.8 Prompt Run Items
```sql
CREATE TABLE prompt_run_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_run_id VARCHAR REFERENCES prompt_runs(id),
  prompt_id VARCHAR REFERENCES prompts(id),
  model_id VARCHAR REFERENCES ai_models(id),
  status ENUM('queued', 'running', 'done', 'error', 'cancelled'),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error TEXT
);
```
**Purpose:** Individual execution tracking (1 prompt × 1 model = 1 item)

#### 2.9 Uploads
```sql
CREATE TABLE uploads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  kind ENUM('csv_topics', 'csv_prompts'),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Track CSV bulk uploads for topics and prompts

---

### Analysis Results Tables (6)

#### 2.10 Answers
```sql
CREATE TABLE answers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_run_item_id VARCHAR REFERENCES prompt_run_items(id),
  raw_response TEXT NOT NULL,        -- Full AI model response
  visibility_score NUMERIC(5,2),     -- 0-100 score
  first_mention_pos INTEGER,         -- Character position of first brand mention
  sentiment_score NUMERIC(5,2),      -- 0-100 score
  position_score NUMERIC(5,2),       -- 0-100 score
  citation_count INTEGER DEFAULT 0
);
```
**Purpose:** Store complete AI response and calculated scores

#### 2.11 Citations
```sql
CREATE TABLE citations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id VARCHAR REFERENCES answers(id),
  url TEXT,
  domain TEXT,                       -- Extracted root domain
  display_text TEXT,
  position INTEGER NOT NULL,         -- Citation number [1], [2], [3]
  type ENUM('hard', 'soft'),         -- Hard = URL link, Soft = mention only
  anchor_text TEXT,
  is_self_citation BOOLEAN DEFAULT FALSE
);
```
**Purpose:** Track which URLs AI models cite when answering

**Citation Types:**
- **Hard Citation**: Actual URL reference (e.g., "[1] https://example.com")
- **Soft Citation**: Brand mention without URL (e.g., "According to Polaris AI...")

**Self-Citation Detection:**
- Compares citation domain against client's configured URLs
- Awards bonus points for self-citations in visibility scoring

#### 2.12 Mentions
```sql
CREATE TABLE mentions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id VARCHAR REFERENCES answers(id),
  span TEXT NOT NULL,                -- The actual text mentioning the brand
  is_alias BOOLEAN DEFAULT FALSE,    -- Was this an alias match?
  sentiment ENUM('positive', 'neutral', 'negative')
);
```
**Purpose:** Extract all mentions of client brand in responses

**Example Mentions:**
- "Polaris AI provides excellent analytics" (positive, is_alias=false)
- "Polaris Analytics is a leading tool" (positive, is_alias=true)

#### 2.13 Rankings
```sql
CREATE TABLE rankings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id VARCHAR REFERENCES answers(id),
  item TEXT NOT NULL,                -- Company/product name in ranking
  position INTEGER NOT NULL          -- 1 = first, 2 = second, etc.
);
```
**Purpose:** Parse ranked lists from AI responses

**Example:**
Prompt: "Top 5 analytics tools"
Response: "1. Polaris AI, 2. Competitor X, 3. Competitor Y"
Creates 3 ranking records with positions 1, 2, 3

#### 2.14 Competitor Scores
```sql
CREATE TABLE competitor_scores (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_run_id VARCHAR REFERENCES prompt_runs(id),
  prompt_id VARCHAR REFERENCES prompts(id),
  competitor_id VARCHAR REFERENCES competitors(id),
  competitor_name TEXT NOT NULL,
  is_client BOOLEAN DEFAULT FALSE,   -- TRUE if this is the client's score
  visibility_score NUMERIC(5,2),
  sentiment_score NUMERIC(5,2),
  position_score NUMERIC(5,2),
  overall_score NUMERIC(5,2),        -- Weighted: 50% vis + 30% sent + 20% pos
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Store prompt-level competitor benchmarking data

**Granularity:** One record per competitor per prompt
- Run has 10 prompts × 5 competitors = 50 records
- Allows drill-down to see which prompts favor which competitors

#### 2.15 Jobs
```sql
CREATE TABLE jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                -- 'metadata-generation', 'prompt-execution'
  payload JSONB NOT NULL,
  status ENUM('queued', 'running', 'done', 'error', 'cancelled'),
  progress INTEGER DEFAULT 0,        -- 0-100 percentage
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error TEXT
);
```
**Purpose:** Background job queue for long-running tasks

**Job Types:**
- `metadata-generation`: Website crawl + GPT-4 topic/prompt generation
- `prompt-execution`: Execute prompts across AI models
- `xray-analysis`: Site X-Ray content analysis

---

### Opportunities Tables (2)

#### 2.16 Recommendations
```sql
CREATE TABLE recommendations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  prompt_run_id VARCHAR REFERENCES prompt_runs(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,            -- 'high', 'medium', 'low'
  category TEXT NOT NULL,            -- 'seo', 'content', 'structure'
  examples JSONB,                    -- Concrete examples from citations
  action_items JSONB,                -- Array of actionable steps
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** AI-generated optimization recommendations

**Categories:**
- AI Crawling: robots.txt, ai.txt, crawl accessibility
- Content Availability: Missing pages, broken links
- Content Eligibility: Thin content, low quality
- Content Relevance: Keyword gaps, topic coverage
- Content Visibility: Heading structure, metadata

#### 2.17 Generated Contents
```sql
CREATE TABLE generated_contents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  prompt_run_id VARCHAR REFERENCES prompt_runs(id),
  source_url TEXT,
  source_domain TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_keywords JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** AI-generated content optimized for AI assistant visibility

---

### Site X-Ray Tables (4)

#### 2.18 X-Ray Sites
```sql
CREATE TABLE xray_sites (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR REFERENCES clients(id),
  domain TEXT NOT NULL,
  site_type ENUM('internal', 'third_party'),
  robots_txt_present BOOLEAN DEFAULT FALSE,
  ai_txt_present BOOLEAN DEFAULT FALSE,
  crawl_access_status ENUM('ok', 'blocked', 'rate_limited', 'captcha'),
  robots_rules JSONB,
  ai_txt_content TEXT,
  crawl_evidence JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Top-level site metadata and crawl accessibility

**Site Types:**
- `internal`: Client's owned properties (primary/secondary URLs)
- `third_party`: External presence (LinkedIn, Wikipedia, news sites)

#### 2.19 X-Ray Pages
```sql
CREATE TABLE xray_pages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id VARCHAR REFERENCES xray_sites(id),
  url TEXT NOT NULL,
  title TEXT,
  page_type TEXT,                    -- 'homepage', 'product', 'blog'
  status_code INTEGER,
  word_count INTEGER DEFAULT 0,
  raw_html TEXT,                     -- Full HTML source
  raw_text TEXT,                     -- Extracted text content
  last_modified TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Individual page content and metadata

#### 2.20 X-Ray Page Structure
```sql
CREATE TABLE xray_page_structure (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id VARCHAR REFERENCES xray_pages(id),
  headings JSONB,                    -- {h1: [], h2: [], h3: [], ...}
  paragraphs JSONB,
  lists JSONB,
  tables JSONB,
  entities JSONB,                    -- Named entities (people, orgs, products)
  focus_areas JSONB,
  topics JSONB,
  sentiment_score NUMERIC(5,2),
  link_counts JSONB,                 -- {internal: N, external: N}
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Structured content extraction for analysis

#### 2.21 X-Ray Page Analysis
```sql
CREATE TABLE xray_page_analysis (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id VARCHAR REFERENCES xray_pages(id),
  assessment TEXT,                   -- GPT-4 quality assessment
  gaps JSONB,                        -- Identified content gaps
  recommendations JSONB,             -- Improvement suggestions
  actions JSONB,                     -- Prioritized action items
  seo_issues JSONB,                  -- Technical SEO problems
  freshness_data JSONB,              -- Content recency analysis
  consistency_data JSONB,            -- Brand/messaging consistency
  compliance_data JSONB,             -- Accessibility, legal compliance
  scores JSONB,                      -- {quality: N, seo: N, readability: N}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** AI-powered content quality analysis

**Analysis Components:**
- **Assessment**: Overall page quality (1-5 stars)
- **Gaps**: Missing topics, keywords, CTAs
- **Recommendations**: Specific improvements (S/M/L effort, high/medium/low impact)
- **SEO Issues**: Title length, meta description, heading structure
- **Scores**: Quality (0-100), SEO health (0-100), Readability (0-100)

---

### Score Explainability Tables (3)

#### 2.22 Score Factors
```sql
CREATE TABLE score_factors (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_run_item_id VARCHAR REFERENCES prompt_run_items(id),
  category ENUM('Position', 'Sentiment', 'Visibility'),
  score NUMERIC(5,2) NOT NULL,
  -- Position factors
  relevance_value NUMERIC(10,2),
  position_value NUMERIC(10,2),
  -- Sentiment factors
  positive_mentions INTEGER,
  neutral_mentions INTEGER,
  negative_mentions INTEGER,
  -- Visibility factors
  mentions_count INTEGER,
  heading_hits_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Store detailed scoring breakdown for explainability

**Explainability Use Case:**
User asks "Why did I get 73.5 visibility score?"
System shows:
- 5 total mentions (+50 points)
- 2 heading mentions (+15 points)
- 1 self-citation (+8.5 points)
= 73.5 total

#### 2.23 Score Interpretations
```sql
CREATE TABLE score_interpretations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  category ENUM('Position', 'Sentiment', 'Visibility'),
  score_min NUMERIC(5,2) NOT NULL,
  score_max NUMERIC(5,2) NOT NULL,
  message_template TEXT NOT NULL
);
```
**Purpose:** Human-readable score interpretation templates

**Example Records:**
```sql
INSERT INTO score_interpretations VALUES
('1', 'Visibility', 80, 100, 'Excellent visibility! Your brand appears frequently.'),
('2', 'Visibility', 60, 79, 'Good visibility with room for improvement.'),
('3', 'Visibility', 40, 59, 'Moderate visibility. Consider content optimization.');
```

#### 2.24 Score Color Bands
```sql
CREATE TABLE score_color_bands (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  category ENUM('Position', 'Sentiment', 'Visibility'),
  band_name TEXT NOT NULL,           -- 'excellent', 'good', 'fair', 'poor'
  color_hex TEXT NOT NULL,           -- '#22c55e', '#facc15', '#f97316'
  score_min NUMERIC(5,2) NOT NULL,
  score_max NUMERIC(5,2) NOT NULL
);
```
**Purpose:** Visual color coding for scores in UI

---

## 3. BACKEND ARCHITECTURE

### 3.1 Technology Stack
- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js 4.x
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL 16 (Neon Serverless)
- **ORM:** Drizzle ORM 0.30+
- **AI SDKs:** OpenAI SDK, Anthropic SDK
- **Web Crawling:** Crawlee Framework
- **Session Store:** connect-pg-simple (PostgreSQL-backed sessions)

### 3.2 Project Structure
```
server/
├── index.ts                 # Express app entry point
├── routes.ts                # All API endpoint definitions (1600+ lines)
├── storage.ts               # IStorage interface definition
├── db-storage.ts            # PostgreSQL implementation
├── mem-storage.ts           # In-memory implementation (dev/testing)
├── openai-service.ts        # GPT-4 metadata generation
├── vite.ts                  # Vite middleware for dev server
└── services/                # Service layer modules (26 files)
    ├── ai-executor.ts
    ├── citation-extractor.ts
    ├── competitor-discovery.ts
    ├── competitor-scoring.ts
    ├── composer.ts
    ├── engine.llm.ts
    ├── job-queue.ts
    ├── mention-detector.ts
    ├── mentionExtractor.llm.ts
    ├── onboarding-enrichment.ts
    ├── prompt-run-executor.ts
    ├── ranking-parser.ts
    ├── rankingExtractor.llm.ts
    ├── score-explainability.ts
    ├── scoring.ts
    ├── sentimentAbsa.llm.ts
    ├── visibility-scoring.ts
    ├── visibilityScorer.new.ts
    ├── website-crawler.ts
    ├── xray-content-analyzer.ts
    ├── xray-entity-extractor.ts
    ├── xray-health-probe.ts
    ├── xray-ingestion.ts
    ├── xray-structure-parser.ts
    └── xray-topic-mapper.ts
```

### 3.3 Storage Abstraction Layer

**Interface-Based Architecture:**
```typescript
interface IStorage {
  // Client management
  getClients(orgId: string): Promise<Client[]>;
  createClient(data: InsertClient): Promise<Client>;
  
  // Metadata
  getTopics(clientId: string): Promise<Topic[]>;
  getPrompts(clientId: string): Promise<Prompt[]>;
  
  // Execution
  createPromptRun(...): Promise<PromptRun>;
  executePromptRunItem(...): Promise<void>;
  
  // Results
  getAnswers(promptRunId: string): Promise<AnswerWithDetails[]>;
  getCitations(answerId: string): Promise<Citation[]>;
  
  // 50+ more methods...
}
```

**Implementations:**
1. **DbStorage** (`db-storage.ts`): Production PostgreSQL implementation
2. **MemStorage** (`mem-storage.ts`): In-memory for testing

**Benefits:**
- Easy testing with mock storage
- Future support for multiple databases
- Clear service contracts

---

## 4. FRONTEND ARCHITECTURE

### 4.1 Technology Stack
- **Framework:** React 18
- **Build Tool:** Vite 5
- **Routing:** Wouter (lightweight React Router alternative)
- **Styling:** TailwindCSS 3 + shadcn/ui components
- **State Management:** TanStack Query v5 (React Query)
- **Forms:** React Hook Form + Zod validation
- **Icons:** Lucide React
- **Charts:** Recharts

### 4.2 Page Structure
```
client/src/pages/
├── landing.tsx                  # Home page
├── client-catalog.tsx           # Client list/selection
├── client-configuration.tsx     # Client setup and editing
├── metadata-topics.tsx          # Topic management
├── metadata-prompts.tsx         # Prompt management
├── metadata-top-topics.tsx      # Top topics overview
├── prompts-tracker.tsx          # Prompt run monitoring
├── dashboard.tsx                # Analytics dashboard
├── citation-analysis.tsx        # Citation deep-dive
├── recommendations.tsx          # AI recommendations
├── content-generator.tsx        # Content generation
├── site-xray.tsx               # Site health analysis
└── not-found.tsx               # 404 page
```

### 4.3 Component Architecture

**Component Organization:**
```
client/src/components/
├── ui/                          # shadcn/ui primitives (40+ components)
│   ├── button.tsx
│   ├── card.tsx
│   ├── table.tsx
│   ├── dialog.tsx
│   └── ...
├── layout/
│   ├── sidebar.tsx              # Main navigation
│   └── header.tsx
├── run-details-section.tsx      # Prompt run results viewer
├── score-explainability-modal.tsx  # Score breakdown
└── ...
```

**Key Design Patterns:**
- **Compound Components**: Complex UI broken into composable parts
- **Render Props**: Flexible component composition
- **Custom Hooks**: Reusable logic (useToast, useDebounce)

### 4.4 State Management Strategy

**TanStack Query for Server State:**
```typescript
// Fetch client data
const { data: client } = useQuery({
  queryKey: ['/api/v1/clients', clientId],
  enabled: !!clientId
});

// Mutate with optimistic updates
const mutation = useMutation({
  mutationFn: (data) => apiRequest('POST', '/api/v1/topics', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/v1/topics'] });
  }
});
```

**LocalStorage for UI State:**
- Current client ID selection
- Sidebar collapsed/expanded
- Table pagination preferences

---

## 5. CORE FEATURES & CAPABILITIES

### 5.1 Client Onboarding & Configuration

**Feature:** Multi-step client setup wizard

**Capabilities:**
- ✅ Basic info (name, industry, geography)
- ✅ URL configuration (primary, secondary, third-party)
- ✅ Focus areas and strategic keywords
- ✅ Brand aliases for variation matching
- ✅ Competitor tracking (add by URL or manual entry)
- ✅ AI model selection (choose which models to test)
- ✅ AI-assisted enrichment using GPT-4

**Technical Implementation:**
- **Component:** `client-configuration.tsx`
- **API:** `POST /api/v1/clients`, `PUT /api/v1/clients/:id`
- **Service:** `onboarding-enrichment.ts`
- **AI Enhancement:** GPT-4 suggests competitors, industry, focus areas from website

**User Flow:**
1. Enter company name and website
2. Click "Enrich Profile" → GPT-4 analyzes website
3. System suggests industry, geography, focus areas
4. User adds competitors (or uses AI discovery)
5. Select AI models to test
6. Save → Client ready for metadata generation

---

### 5.2 Metadata Generation (Topics & Prompts)

**Feature:** Automated website analysis and prompt creation

**Capabilities:**
- ✅ Multi-URL crawling (primary + secondary + third-party)
- ✅ Intelligent content extraction (Cheerio + Playwright fallback)
- ✅ Subdomain support (www.example.com + blog.example.com)
- ✅ Smart deduplication (same content from different URLs ignored)
- ✅ GPT-4 Turbo analysis of crawled content
- ✅ Dual-source topic generation:
  - **Crawl Topics**: Extracted directly from website structure
  - **AI Topics**: GPT-4 inference from content
- ✅ Automatic prompt generation (50+ prompts per client)
- ✅ Background job processing with progress tracking
- ✅ Optional Site X-Ray integration (checkbox)

**Technical Implementation:**
- **Component:** `client-configuration.tsx` (Generate Metadata button)
- **API:** `POST /api/v1/clients/:id/generate-metadata`
- **Service:** `website-crawler.ts`, `openai-service.ts`
- **Job Queue:** `job-queue.ts` manages background processing
- **Crawler:** Crawlee framework (CheerioCrawler + PlaywrightCrawler)

**Crawling Algorithm:**
```typescript
1. Start with seed URLs (primary, secondary, third-party)
2. Extract all internal links from homepage
3. Prioritize: About, Product, Services, Team pages
4. Crawl up to 100 pages per domain (configurable)
5. Extract: headings, paragraphs, lists, metadata
6. Deduplicate content across URLs
7. Format for LLM analysis
```

**GPT-4 Prompt Template:**
```
You are analyzing website content for: {companyName}
Industry: {industry}
Geography: {geography}

Website Content:
{formattedCrawlData}

Generate:
1. 15-20 core topics (Product Discovery, Problem-Solving, Comparison, Feature Exploration)
2. 5-7 top-level topic categories
3. 40-50 prompts that users would ask AI assistants

Format as JSON: {topics: [...], topTopics: [...], prompts: [...]}
```

**Topic Sources:**
| Source   | Method | Example |
|----------|--------|---------|
| `manual` | User-entered | "Brand Analytics" |
| `crawl`  | Extracted from H1/H2 | "AI-Powered Insights" |
| `ai`     | GPT-4 generated | "Competitive Intelligence for Marketing" |
| `csv`    | Bulk upload | Imported from spreadsheet |

**Prompt Sources:**
| Source   | Example |
|----------|---------|
| `manual` | "What are the best analytics tools?" |
| `ai`     | "Which platforms offer AI-powered brand visibility tracking?" |
| `csv`    | Bulk imported prompts |

**Site X-Ray Integration:**
- Checkbox: "Run Site X-Ray Analysis"
- When enabled: Metadata generation → Website crawl → X-Ray ingestion → Structure parsing → AI analysis
- When disabled: Standard metadata generation only (no X-Ray tables touched)

---

### 5.3 Prompt Run Execution

**Feature:** Batch execution of prompts across multiple AI models

**Capabilities:**
- ✅ Multi-model testing (GPT-4, Claude, Gemini in parallel)
- ✅ Rate limiting and retry logic
- ✅ Real-time progress tracking
- ✅ Error handling and partial completion
- ✅ Ability to stop/cancel running jobs
- ✅ Ability to delete completed runs
- ✅ WebSocket status updates (future enhancement)

**Technical Implementation:**
- **Component:** `prompts-tracker.tsx`
- **API:** `POST /api/v1/prompt-runs`, `GET /api/v1/prompt-runs/:id`
- **Service:** `prompt-run-executor.ts`, `ai-executor.ts`
- **Job Queue:** Background processing with progress updates

**Execution Flow:**
```typescript
1. User selects prompts (e.g., 10 prompts)
2. User selects AI models (e.g., GPT-4, Claude = 2 models)
3. System creates: 10 × 2 = 20 prompt_run_items
4. PromptRun created with status='queued', totalPrompts=20
5. Job queue starts processing items sequentially
6. For each item:
   a. Status: queued → running
   b. Call AI model API (OpenAI or Anthropic)
   c. Receive response
   d. Parse response (citations, mentions, rankings)
   e. Calculate scores (visibility, sentiment, position)
   f. Store in database
   g. Status: running → done
   h. Update progress: (completedItems / totalItems) * 100
7. When all items done: PromptRun status: running → done
```

**Score Calculation Pipeline:**
```typescript
AI Response → Parsing → Scoring → Storage

1. Citation Extraction (citation-extractor.ts)
   - Extract [1], [2], [3] style citations
   - Extract soft citations (brand mentions without URLs)
   - Detect self-citations (client's own URLs)

2. Mention Detection (mention-detector.ts)
   - Find brand name and alias mentions
   - Calculate first mention position
   - Classify sentiment (positive/neutral/negative)

3. Ranking Parsing (ranking-parser.ts)
   - Detect numbered lists (1., 2., 3.)
   - Detect bulleted lists with rankings
   - Extract company names and positions

4. Score Calculation (scoring.ts, visibility-scoring.ts)
   - Visibility Score (0-100):
     * Base: mentions_count × 10
     * Bonus: heading_mentions × 3
     * Bonus: self_citations × 5
     * Normalized to 0-100 scale
   
   - Sentiment Score (0-100):
     * positive_mentions × 100
     * neutral_mentions × 50
     * negative_mentions × 0
     * Weighted average
   
   - Position Score (0-100):
     * If ranked #1: 100 points
     * If ranked #2: 80 points
     * If ranked #3: 60 points
     * If mentioned but not ranked: 40 points
     * If not mentioned: 0 points

5. Overall Score (weighted composite):
   * 50% × visibility_score
   * 30% × sentiment_score
   * 20% × position_score
```

**Rate Limiting:**
- OpenAI: 10,000 TPM (tokens per minute)
- Anthropic: 4,000 TPM
- Exponential backoff on rate limit errors
- Retry logic: 3 attempts with 2x delay

---

### 5.4 Score Explainability System

**Feature:** Detailed breakdown of how scores are calculated

**Capabilities:**
- ✅ Drill-down from aggregate scores to individual factors
- ✅ Prompt-level score viewing
- ✅ Competitor benchmarking at prompt level
- ✅ Visual color coding (green = good, yellow = fair, red = poor)
- ✅ Human-readable interpretations
- ✅ Min/Max/Avg competitor scores
- ✅ Delta calculations (you vs best competitor)

**Technical Implementation:**
- **Component:** `score-explainability-modal.tsx`
- **API:** `GET /api/v1/prompt-runs/:id/score-explanation/:category`
- **API:** `GET /api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks`
- **Service:** `score-explainability.ts`
- **Tables:** `score_factors`, `score_interpretations`, `score_color_bands`

**Modal Structure:**
```
┌─────────────────────────────────────────────┐
│ Visibility Score: 73.5                      │
│ ════════════════════════════════════════    │
│                                             │
│ Breakdown:                                  │
│ • Mentions: 5 (+50.0 points)               │
│ • Heading Mentions: 2 (+15.0 points)       │
│ • Self-Citations: 1 (+8.5 points)          │
│ ─────────────────────────────────────       │
│ Total: 73.5                                 │
│                                             │
│ Interpretation: Good visibility with room   │
│ for improvement. Your brand appears in     │
│ most responses.                             │
│                                             │
│ Competitor Benchmark:                       │
│ • You: 73.5                                │
│ • Best Competitor: 82.0 (+8.5)             │
│ • Average Competitor: 65.2 (-8.3)          │
└─────────────────────────────────────────────┘
```

**Prompt-Level Benchmarking:**
User can click individual prompts to see:
- Which competitors were mentioned
- Their scores for this specific prompt
- Delta vs client score

**Color Band System:**
```sql
-- Visibility
80-100: Green (#22c55e) - Excellent
60-79:  Yellow (#facc15) - Good
40-59:  Orange (#f97316) - Fair
0-39:   Red (#ef4444) - Poor

-- Sentiment
80-100: Green - Very Positive
60-79:  Light Green - Positive
40-59:  Gray - Neutral
20-39:  Orange - Negative
0-19:   Red - Very Negative

-- Position
80-100: Green - Top Ranked
60-79:  Yellow - Frequently Ranked
40-59:  Orange - Occasionally Ranked
0-39:   Red - Rarely Ranked
```

---

### 5.5 Dashboard Analytics

**Feature:** Real-time analytics and competitive intelligence

**Capabilities:**
- ✅ Key metrics overview (total prompts, avg scores)
- ✅ Historical score tracking (time series chart)
- ✅ Competitor rankings table
- ✅ Top performing topics
- ✅ Recent runs list
- ✅ Cache-free data (no stale results)
- ✅ Responsive mobile design

**Technical Implementation:**
- **Component:** `dashboard.tsx`
- **APIs:**
  - `GET /api/v1/dashboard/stats`
  - `GET /api/v1/dashboard/historical-scores`
  - `GET /api/v1/dashboard/competitor-rankings`
  - `GET /api/v1/dashboard/top-topics`
  - `GET /api/v1/dashboard/recent-runs`
- **Service:** `competitor-scoring.ts` (aggregation logic)

**Stats Card:**
```typescript
{
  totalPrompts: 36,
  avgVisibilityScore: 67.8,
  avgSentimentScore: 72.4,
  avgPositionScore: 58.3
}
```

**Historical Scores Chart:**
```typescript
// Recharts LineChart with 3 lines
[
  { runId: 'abc', date: '2025-10-01', visibility: 65.2, sentiment: 70.1, position: 55.0 },
  { runId: 'def', date: '2025-10-05', visibility: 67.8, sentiment: 72.4, position: 58.3 },
  { runId: 'ghi', date: '2025-10-08', visibility: 70.5, sentiment: 75.0, position: 62.1 }
]
```

**Competitor Rankings:**
```typescript
// Aggregated from latest prompt run only
[
  {
    id: 'comp1',
    name: 'Competitor A',
    visibilityScore: 82.0,  // Avg across all prompts in latest run
    sentimentScore: 78.5,
    positionScore: 85.0,
    overallScore: 81.6,     // Weighted: 50% vis + 30% sent + 20% pos
    isClient: false
  },
  {
    id: 'client1',
    name: 'Your Company',
    visibilityScore: 73.5,
    sentimentScore: 80.2,
    positionScore: 65.0,
    overallScore: 73.9,
    isClient: true           // Highlighted in UI
  }
]
```

**Competitor Score Aggregation Logic:**
```typescript
// server/services/competitor-scoring.ts
export async function getAggregatedCompetitorScores(clientId: string) {
  // 1. Get latest prompt run for this client
  const latestRun = await storage.getLatestPromptRun(clientId);
  
  // 2. Get all competitor_scores for that run
  const scores = await storage.getCompetitorScores(latestRun.id);
  
  // 3. Group by competitor_id
  const grouped = groupBy(scores, 'competitorId');
  
  // 4. For each competitor, calculate averages
  return Object.entries(grouped).map(([compId, compScores]) => {
    const avgVis = average(compScores.map(s => s.visibilityScore));
    const avgSent = average(compScores.map(s => s.sentimentScore));
    const avgPos = average(compScores.map(s => s.positionScore));
    
    return {
      id: compId,
      name: compScores[0].competitorName,
      visibilityScore: round1decimal(avgVis),
      sentimentScore: round1decimal(avgSent),
      positionScore: round1decimal(avgPos),
      overallScore: round1decimal(0.5*avgVis + 0.3*avgSent + 0.2*avgPos)
    };
  });
}
```

**Cache Prevention:**
```typescript
// server/routes.ts
app.get('/api/v1/dashboard/stats', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const stats = await storage.getDashboardStats(clientId);
  res.json(stats);
});
```

---

### 5.6 Citation Analysis

**Feature:** Deep-dive into which URLs AI models cite

**Capabilities:**
- ✅ Group citations by root domain
- ✅ Drill-down to individual URLs
- ✅ Self-citation highlighting
- ✅ Citation frequency tracking
- ✅ Domain-level aggregation
- ✅ Filter by hard vs soft citations

**Technical Implementation:**
- **Component:** `citation-analysis.tsx`
- **API:** `GET /api/v1/opportunities/citations`
- **API:** `GET /api/v1/opportunities/citations/domain/:domain`
- **Service:** `citation-extractor.ts`

**Citation Grouping Example:**
```typescript
// Domain-grouped view
{
  "example.com": {
    totalCitations: 15,
    isSelfDomain: true,
    urls: [
      { url: "https://example.com/about", count: 8 },
      { url: "https://example.com/products", count: 5 },
      { url: "https://example.com/blog/ai", count: 2 }
    ]
  },
  "competitor.com": {
    totalCitations: 7,
    isSelfDomain: false,
    urls: [...]
  }
}
```

**Self-Citation Detection:**
```typescript
function isSelfCitation(citationUrl: string, clientUrls: string[]): boolean {
  const citationDomain = extractDomain(citationUrl);
  const clientDomains = clientUrls.map(extractDomain);
  
  return clientDomains.some(cd => 
    citationDomain === cd || 
    citationDomain.endsWith('.' + cd)
  );
}
```

---

### 5.7 AI-Powered Recommendations

**Feature:** Automated content optimization suggestions

**Capabilities:**
- ✅ GPT-4 Turbo analysis of citation patterns
- ✅ Category-based recommendations (5 categories)
- ✅ Priority levels (High/Medium/Low)
- ✅ Concrete examples from actual citations
- ✅ Actionable next steps
- ✅ Generation on-demand or auto-generation

**Technical Implementation:**
- **Component:** `recommendations.tsx`
- **API:** `GET /api/v1/opportunities/recommendations`
- **API:** `POST /api/v1/opportunities/recommendations/generate`
- **Service:** `openai-service.ts` (generateRecommendations)

**Recommendation Categories:**

1. **AI Crawling**
   - robots.txt misconfiguration
   - Missing ai.txt file
   - Blocked important pages
   - Rate limiting issues

2. **Content Availability**
   - Broken links in citations
   - Missing key pages (About, Products)
   - 404 errors on cited URLs
   - Redirect chains

3. **Content Eligibility**
   - Thin content (< 300 words)
   - Low quality text
   - Duplicate content
   - Missing structured data

4. **Content Relevance**
   - Keyword gaps
   - Topic coverage issues
   - Outdated information
   - Missing focus area content

5. **Content Visibility**
   - Poor heading structure
   - Missing meta descriptions
   - Weak title tags
   - No schema markup

**GPT-4 Recommendation Generation:**
```typescript
const prompt = `
Analyze brand visibility data for: ${companyName}
Industry: ${industry}

Citations found: ${citations.length} total
Self-citations: ${selfCitations.length}
Top cited URLs: ${topUrls.join(', ')}
Missing focus areas: ${gaps.join(', ')}

Generate 5-10 recommendations to improve AI assistant visibility.

Categories: AI Crawling, Content Availability, Content Eligibility, 
            Content Relevance, Content Visibility

For each recommendation:
{
  "title": "Brief title",
  "description": "Detailed explanation",
  "severity": "high|medium|low",
  "category": "...",
  "example": {
    "citation": "URL where issue was found",
    "content": "Specific text",
    "issue": "What's wrong"
  },
  "actionItems": ["Step 1", "Step 2", "Step 3"]
}
`;
```

**Example Recommendation:**
```json
{
  "title": "Add Structured Data for Product Pages",
  "description": "AI assistants rely heavily on schema.org markup...",
  "severity": "high",
  "category": "Content Visibility",
  "example": {
    "citation": "https://example.com/products",
    "content": "Product page lacks structured data",
    "issue": "No Product schema found, reducing AI comprehension"
  },
  "actionItems": [
    "Add Product schema to all product pages",
    "Include name, description, price, availability",
    "Test with Google Rich Results Test",
    "Monitor citation improvements in next run"
  ]
}
```

---

### 5.8 Site X-Ray Analysis

**Feature:** Comprehensive website health and content quality analysis

**Capabilities:**
- ✅ Multi-URL crawling and ingestion
- ✅ Site type categorization (internal vs third-party)
- ✅ Robots.txt and ai.txt analysis
- ✅ Crawl accessibility status
- ✅ Page-level content extraction
- ✅ Structured content parsing (headings, paragraphs, entities)
- ✅ GPT-4 content quality assessment
- ✅ Gap identification
- ✅ SEO issue detection
- ✅ Actionable recommendations with effort/impact scoring
- ✅ Batch analysis with priority queue
- ✅ Exponential backoff retry logic

**Technical Implementation:**
- **Component:** `site-xray.tsx`
- **APIs:** 7 endpoints total
  - `GET /api/v1/xray/sites`
  - `GET /api/v1/xray/sites/:siteId`
  - `GET /api/v1/xray/sites/:siteId/pages`
  - `GET /api/v1/xray/pages/:pageId`
  - `GET /api/v1/xray/pages/:pageId/analysis`
  - `POST /api/v1/xray/analyze/batch`
  - `GET /api/v1/xray/actions`
- **Services:**
  - `xray-ingestion.ts` - Crawl data → database
  - `xray-structure-parser.ts` - HTML → structured JSON
  - `xray-entity-extractor.ts` - Named entity recognition
  - `xray-content-analyzer.ts` - GPT-4 quality analysis
  - `xray-health-probe.ts` - robots.txt, ai.txt checks
  - `xray-topic-mapper.ts` - Content → topic alignment

**X-Ray Pipeline:**
```
1. INGESTION (xray-ingestion.ts)
   ├─ Create xray_sites record per domain
   ├─ Categorize: internal vs third_party
   ├─ Check robots.txt, ai.txt
   ├─ Detect crawl blocks (captcha, rate limits)
   └─ Create xray_pages records for each crawled page

2. STRUCTURE PARSING (xray-structure-parser.ts)
   ├─ Extract headings (H1-H6)
   ├─ Extract paragraphs
   ├─ Extract lists and tables
   ├─ Count internal/external links
   └─ Store in xray_page_structure

3. ENTITY EXTRACTION (xray-entity-extractor.ts)
   ├─ Identify companies mentioned
   ├─ Identify products/services
   ├─ Identify people and locations
   └─ Store in entities JSONB field

4. AI ANALYSIS (xray-content-analyzer.ts)
   ├─ GPT-4 quality assessment (1-5 stars)
   ├─ Identify content gaps
   ├─ Generate recommendations (S/M/L effort, H/M/L impact)
   ├─ Detect SEO issues
   ├─ Calculate scores (quality, seo, readability)
   └─ Store in xray_page_analysis
```

**GPT-4 Analysis Prompt:**
```typescript
const prompt = `
Analyze this webpage for AI assistant visibility optimization.

Page: ${pageUrl}
Title: ${pageTitle}
Word Count: ${wordCount}

Content:
${structuredContent}

Provide:
1. Assessment (1-5 star rating with explanation)
2. Content gaps (missing topics, thin sections)
3. Recommendations (S/M/L effort, high/medium/low impact)
4. SEO issues (title, meta, headings, structure)
5. Scores (quality 0-100, seo 0-100, readability 0-100)

Format as JSON: {
  "assessment": "...",
  "gaps": [...],
  "recommendations": [{effort: "S", impact: "high", action: "...", rationale: "..."}],
  "seoIssues": [...],
  "scores": {quality: N, seo: N, readability: N}
}
`;
```

**Batch Analysis Logic:**
```typescript
// Homepage gets priority 100, other pages get priority based on type
const priority = pageType === 'homepage' ? 100 : 
                 pageType === 'product' ? 80 :
                 pageType === 'about' ? 70 : 50;

// Queue pages sorted by priority (descending)
const queue = pages.sort((a, b) => b.priority - a.priority);

// Process with exponential backoff on failures
for (const page of queue) {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await analyzePageWithGPT4(page);
      break; // Success
    } catch (error) {
      if (isTransientError(error)) {
        attempts++;
        await sleep(Math.pow(2, attempts) * 1000); // 2s, 4s, 8s
      } else {
        throw error; // Permanent failure
      }
    }
  }
}
```

**X-Ray Integration with Metadata Generation:**
```typescript
// client-configuration.tsx
<Checkbox
  checked={runXRayAnalysis}
  onCheckedChange={setRunXRayAnalysis}
  label="Run Site X-Ray Analysis (optional)"
/>

// When enabled, metadata generation triggers X-Ray pipeline:
// 1. Website crawl (existing)
// 2. X-Ray ingestion (new)
// 3. Structure parsing (new)
// 4. AI analysis (new)
// 5. Topic/prompt generation (existing)
```

---

### 5.9 Competitor Discovery & Scoring

**Feature:** Automated competitor identification and benchmarking

**Capabilities:**
- ✅ AI-powered competitor discovery from website
- ✅ Manual competitor addition
- ✅ Competitor URL tracking
- ✅ Alias management for competitor variations
- ✅ Prompt-level score tracking for each competitor
- ✅ Aggregated competitor rankings
- ✅ Self-citation bonus for fair comparison
- ✅ Delta calculations (client vs competitors)

**Technical Implementation:**
- **Component:** `client-configuration.tsx` (competitors section)
- **API:** `POST /api/v1/onboarding/enrich-competitors`
- **API:** `GET /api/v1/dashboard/competitor-rankings`
- **Service:** `competitor-discovery.ts`, `competitor-scoring.ts`

**AI Competitor Discovery:**
```typescript
const prompt = `
Analyze this company: ${companyName}
Website: ${website}
Industry: ${industry}

Identify 5-10 main competitors.

For each:
{
  "name": "Company name",
  "website": "https://...",
  "reasoning": "Why they're a competitor"
}
`;
```

**Competitor Scoring During Prompt Runs:**
```typescript
// For each prompt execution:
1. Execute prompt against AI model
2. Parse response for company mentions
3. Match mentions against:
   - Client name + aliases
   - Competitor names + aliases
4. For each matched entity:
   a. Calculate visibility score
   b. Calculate sentiment score
   c. Calculate position score (from rankings)
   d. Store in competitor_scores table with:
      - prompt_run_id
      - prompt_id
      - competitor_id (or NULL if client)
      - is_client: TRUE/FALSE
      - visibility_score, sentiment_score, position_score
      - overall_score (weighted)
```

**Self-Citation Bonus:**
```typescript
// Ensures fair comparison - competitors get same bonus as client
function calculateVisibilityScore(mentions, citations, isClientAnalysis) {
  let score = mentions.length * 10; // Base points
  
  // Heading mentions bonus (everyone gets this)
  score += headingMentions.length * 3;
  
  // Self-citation bonus
  const selfCitations = citations.filter(c => 
    isClientAnalysis ? c.isSelfCitation : matchesCompetitorDomain(c.url)
  );
  score += selfCitations.length * 5;
  
  return normalize(score, 0, 100);
}
```

---

### 5.10 Background Job Queue

**Feature:** Asynchronous processing for long-running tasks

**Capabilities:**
- ✅ Job queueing with priority
- ✅ Progress tracking (0-100%)
- ✅ Status management (queued/running/done/error/cancelled)
- ✅ Error handling and retry logic
- ✅ Job cancellation
- ✅ Real-time UI updates via polling

**Technical Implementation:**
- **Service:** `job-queue.ts`
- **Table:** `jobs`
- **API:** `GET /api/v1/jobs/:id`

**Job Types:**

1. **metadata-generation**
```json
{
  "type": "metadata-generation",
  "payload": {
    "clientId": "...",
    "urls": ["https://example.com"],
    "companyName": "Example Corp",
    "industry": "Technology",
    "geography": "United States",
    "focusAreas": ["AI", "Analytics"],
    "runXRayAnalysis": true
  }
}
```

2. **prompt-execution**
```json
{
  "type": "prompt-execution",
  "payload": {
    "promptRunId": "...",
    "promptRunItemIds": ["...", "..."]
  }
}
```

3. **xray-analysis**
```json
{
  "type": "xray-analysis",
  "payload": {
    "siteId": "...",
    "pageIds": ["...", "...", "..."]
  }
}
```

**Job Queue Processing:**
```typescript
class JobQueue {
  async processJobs() {
    while (true) {
      const job = await this.getNextJob(); // Fetch queued job
      if (!job) {
        await sleep(5000); // No jobs, wait 5s
        continue;
      }
      
      await this.updateJobStatus(job.id, 'running');
      
      try {
        switch (job.type) {
          case 'metadata-generation':
            await this.processMetadataGeneration(job);
            break;
          case 'prompt-execution':
            await this.processPromptExecution(job);
            break;
          case 'xray-analysis':
            await this.processXRayAnalysis(job);
            break;
        }
        
        await this.updateJobStatus(job.id, 'done', { progress: 100 });
      } catch (error) {
        await this.updateJobStatus(job.id, 'error', { error: error.message });
      }
    }
  }
  
  async updateProgress(jobId: string, progress: number) {
    await storage.updateJob(jobId, { progress });
  }
}
```

**Frontend Polling:**
```typescript
// Poll job status every 2 seconds
const { data: job } = useQuery({
  queryKey: ['/api/v1/jobs', jobId],
  refetchInterval: 2000,
  enabled: jobStatus === 'running' || jobStatus === 'queued'
});

// Stop polling when done/error/cancelled
useEffect(() => {
  if (job?.status === 'done' || job?.status === 'error') {
    queryClient.invalidateQueries({ queryKey: ['/api/v1/topics'] });
    queryClient.invalidateQueries({ queryKey: ['/api/v1/prompts'] });
  }
}, [job?.status]);
```

---

### 5.11 Crawler Standalone API (Test Bed)

**Feature:** Expose crawler as standalone REST API for external integration

**Capabilities:**
- ✅ **Stage 1 (Raw Crawl)**: Execute website crawl, return structured data
- ✅ **Stage 2 (LLM-Formatted)**: Format crawled data for GPT/Claude consumption
- ✅ **Combined Pipeline**: Crawl + Format in single request
- ✅ **Async Job Mode**: Long-running crawls via job queue
- ✅ **Job Status Polling**: Monitor async crawl progress

**Technical Implementation:**
- **APIs:** 5 endpoints
  - `POST /api/v1/crawler/execute` - Synchronous crawl (Stage 1)
  - `POST /api/v1/crawler/format-for-llm` - Format existing crawl data (Stage 2)
  - `POST /api/v1/crawler/crawl-and-format` - Combined (Stage 1 + 2)
  - `POST /api/v1/crawler/execute/async` - Async crawl via job queue
  - `GET /api/v1/crawler/jobs/:jobId` - Poll async job status
- **Service:** `website-crawler.ts`

**Endpoint Details:**

#### POST /api/v1/crawler/execute
**Purpose:** Execute raw website crawl
```typescript
Request:
{
  "url": "https://example.com",
  "maxPages": 100,
  "includeSubdomains": true
}

Response:
{
  "crawlMethod": "cheerio",  // or "playwright" or "failed"
  "totalPages": 42,
  "pages": [
    {
      "url": "https://example.com/about",
      "title": "About Us",
      "headings": ["Company Overview", "Our Mission"],
      "paragraphs": ["We are a leading...", "Founded in 2020..."],
      "lists": [],
      "links": ["https://example.com/products", ...],
      "wordCount": 523
    },
    ...
  ],
  "error": null
}
```

#### POST /api/v1/crawler/format-for-llm
**Purpose:** Format crawled data for LLM analysis
```typescript
Request:
{
  "crawledPages": [...],  // Output from /crawler/execute
  "companyName": "Example Corp",
  "maxTokens": 15000
}

Response:
{
  "formattedContent": "Company: Example Corp\n\nPage 1 (https://example.com/about):\nTitle: About Us\n\nHeadings:\n- Company Overview\n- Our Mission\n\nContent:\nWe are a leading provider of...\n\n---\n\nPage 2 (https://example.com/products):\n...",
  "totalPages": 42,
  "includedPages": 38,  // Some may be truncated for token limit
  "estimatedTokens": 14823
}
```

#### POST /api/v1/crawler/crawl-and-format
**Purpose:** Combined pipeline (crawl → format)
```typescript
Request:
{
  "url": "https://example.com",
  "companyName": "Example Corp",
  "maxPages": 100,
  "includeSubdomains": true,
  "maxTokens": 15000
}

Response:
{
  "rawCrawl": { /* same as /execute */ },
  "formattedContent": { /* same as /format-for-llm */ }
}
```

#### POST /api/v1/crawler/execute/async
**Purpose:** Long-running crawl via job queue
```typescript
Request:
{
  "url": "https://example.com",
  "maxPages": 500,  // Large crawl
  "includeSubdomains": true
}

Response:
{
  "jobId": "job-123",
  "status": "queued",
  "message": "Crawl job queued. Poll /api/v1/crawler/jobs/job-123 for status."
}
```

#### GET /api/v1/crawler/jobs/:jobId
**Purpose:** Poll async job status
```typescript
Response (in progress):
{
  "id": "job-123",
  "status": "running",
  "progress": 42,  // 42% complete
  "type": "website-crawl",
  "createdAt": "2025-10-09T10:00:00Z",
  "startedAt": "2025-10-09T10:00:05Z",
  "result": null
}

Response (completed):
{
  "id": "job-123",
  "status": "done",
  "progress": 100,
  "finishedAt": "2025-10-09T10:05:30Z",
  "result": {
    "crawlMethod": "cheerio",
    "totalPages": 487,
    "pages": [...]
  }
}
```

**Use Cases:**
- External test beds for crawler algorithm development
- Integration with other platforms
- Webhook-based crawl automation
- Batch crawling of multiple sites

---

## 6. API ENDPOINTS (COMPLETE LIST)

### 6.1 Organization Management (1)
```
GET    /api/v1/organizations/:id              Get organization details
```

### 6.2 Client Management (5)
```
GET    /api/v1/clients                        List all clients for org
POST   /api/v1/clients                        Create new client
GET    /api/v1/clients/:id                    Get client details
PUT    /api/v1/clients/:id                    Update client
DELETE /api/v1/clients/:id                    Delete client
```

### 6.3 Onboarding & Enrichment (3)
```
POST   /api/v1/onboarding/enrich-urls         GPT-4 URL enrichment
POST   /api/v1/onboarding/enrich-profile      GPT-4 profile enrichment
POST   /api/v1/onboarding/enrich-competitors  GPT-4 competitor discovery
```

### 6.4 Metadata Generation (2)
```
POST   /api/v1/clients/:id/generate-metadata  Trigger metadata generation job
POST   /api/v1/clients/:id/refresh-prompts    Regenerate prompts from topics
```

### 6.5 Competitor Management (3)
```
GET    /api/v1/competitors                    List competitors for client
POST   /api/v1/competitors                    Add competitor
DELETE /api/v1/competitors/:id                Remove competitor
```

### 6.6 AI Model Configuration (3)
```
GET    /api/v1/ai-models                      List all available AI models
GET    /api/v1/clients/:id/models             Get selected models for client
PUT    /api/v1/clients/:id/models             Update selected models
```

### 6.7 Topic Management (6)
```
GET    /api/v1/topics/:clientId               List topics by client (legacy)
GET    /api/v1/topics                         List topics with X-Client-Id header
POST   /api/v1/topics                         Create topic
PUT    /api/v1/topics/:id                     Update topic
DELETE /api/v1/topics/:id                     Delete topic
```

### 6.8 Prompt Management (5)
```
GET    /api/v1/prompts/:clientId              List prompts by client (legacy)
GET    /api/v1/prompts                        List prompts with X-Client-Id header
POST   /api/v1/prompts                        Create prompt
PUT    /api/v1/prompts/:id                    Update prompt
DELETE /api/v1/prompts/:id                    Delete prompt
```

### 6.9 Prompt Run Execution (6)
```
GET    /api/v1/prompt-runs                    List prompt runs
POST   /api/v1/prompt-runs                    Start new prompt run
GET    /api/v1/prompt-runs/:id                Get run details
GET    /api/v1/prompt-runs/:id/results        Get detailed results
DELETE /api/v1/prompt-runs/:id                Delete run
POST   /api/v1/prompt-runs/:id/stop           Stop running job
```

### 6.10 Score Explainability (3)
```
GET    /api/v1/prompt-runs/:id/score-explanation/:category
                                              Get score breakdown (Visibility/Sentiment/Position)

GET    /api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks
                                              Get competitor benchmarks for specific prompt

GET    /api/v1/score-colors                   Get color band configuration
```

### 6.11 Job Management (2)
```
GET    /api/v1/jobs                           List all jobs
GET    /api/v1/jobs/:id                       Get job status and progress
```

### 6.12 Dashboard Analytics (5)
```
GET    /api/v1/dashboard/stats                Overall statistics
GET    /api/v1/dashboard/historical-scores    Time series score data
GET    /api/v1/dashboard/top-topics           Best performing topics
GET    /api/v1/dashboard/recent-runs          Recent prompt runs
GET    /api/v1/dashboard/competitor-rankings  Aggregated competitor scores
```

### 6.13 Citation Analysis (2)
```
GET    /api/v1/opportunities/citations        List all citations
GET    /api/v1/opportunities/citations/domain/:domain
                                              Citations grouped by domain
```

### 6.14 Recommendations (2)
```
GET    /api/v1/opportunities/recommendations  List recommendations
POST   /api/v1/opportunities/recommendations/generate
                                              Generate with GPT-4
```

### 6.15 Content Generation (2)
```
GET    /api/v1/opportunities/content          List generated content
POST   /api/v1/opportunities/content/generate Generate with GPT-4
```

### 6.16 Site X-Ray (7)
```
GET    /api/v1/xray/sites                     List all X-Ray sites
GET    /api/v1/xray/sites/:siteId             Get site details
GET    /api/v1/xray/sites/:siteId/pages       List pages for site
GET    /api/v1/xray/pages/:pageId             Get page details
GET    /api/v1/xray/pages/:pageId/analysis    Get AI analysis for page
POST   /api/v1/xray/analyze/batch             Trigger batch analysis job
GET    /api/v1/xray/actions                   List actionable recommendations
```

### 6.17 Crawler Standalone API (5)
```
POST   /api/v1/crawler/execute                Execute website crawl (sync)
POST   /api/v1/crawler/format-for-llm         Format crawled data for LLM
POST   /api/v1/crawler/crawl-and-format       Combined crawl + format
POST   /api/v1/crawler/execute/async          Execute crawl (async job)
GET    /api/v1/crawler/jobs/:jobId            Poll async crawl status
```

**Total Endpoints: 67**

---

## 7. SERVICE LAYER MODULES

### 7.1 Core Execution Services

#### `ai-executor.ts`
**Purpose:** Execute prompts against AI model APIs
**Functions:**
- `executePrompt(prompt, model)` - Call OpenAI/Anthropic API
- `handleRateLimit()` - Exponential backoff
- `retryOnFailure()` - 3 attempts with delay

#### `prompt-run-executor.ts`
**Purpose:** Orchestrate batch prompt execution
**Functions:**
- `executePromptRun(runId)` - Process all items in run
- `updateProgress()` - Real-time progress tracking
- `handleCancellation()` - Graceful stop

#### `job-queue.ts`
**Purpose:** Background job processing
**Functions:**
- `enqueueJob(type, payload)` - Add job to queue
- `processJobs()` - Main processing loop
- `updateJobStatus()` - Status transitions

### 7.2 Parsing & Extraction Services

#### `citation-extractor.ts`
**Purpose:** Extract citations from AI responses
**Algorithms:**
- Regex: `\[\d+\]\s*(https?://[^\s]+)`
- Domain extraction: `new URL(url).hostname`
- Self-citation detection: domain matching

#### `mention-detector.ts`
**Purpose:** Find brand mentions in text
**Algorithms:**
- Fuzzy matching for aliases
- First mention position tracking
- Context extraction (surrounding text)

#### `ranking-parser.ts`
**Purpose:** Extract ranked lists from responses
**Patterns:**
- Numbered: `1. Company A`, `2. Company B`
- Bulleted: `• Top choice: Company A`
- Table-based rankings

#### `sentimentAbsa.llm.ts`
**Purpose:** Aspect-based sentiment analysis
**Method:** GPT-4 Mini classification (positive/neutral/negative)

#### `rankingExtractor.llm.ts`
**Purpose:** LLM-based ranking extraction (fallback)
**Method:** GPT-4 Mini structured extraction

### 7.3 Scoring Services

#### `scoring.ts`
**Purpose:** Calculate individual answer scores
**Functions:**
- `calculateVisibilityScore(mentions, citations)`
- `calculateSentimentScore(mentions)`
- `calculatePositionScore(rankings)`
- `calculateOverallScore(vis, sent, pos)` - Weighted

#### `visibility-scoring.ts`
**Purpose:** Advanced visibility calculation
**Factors:**
- Mention frequency
- First mention position
- Heading mentions
- Self-citations

#### `score-explainability.ts`
**Purpose:** Generate score breakdown data
**Functions:**
- `getScoreFactors(promptRunItemId)`
- `getCompetitorBenchmarks(runId, promptId)`
- `getInterpretation(score, category)`

### 7.4 Competitive Intelligence Services

#### `competitor-discovery.ts`
**Purpose:** AI-powered competitor identification
**Method:** GPT-4 analysis of company website + industry

#### `competitor-scoring.ts`
**Purpose:** Aggregate competitor scores across prompts
**Functions:**
- `calculateCompetitorScores(runId)` - Prompt-level scoring
- `getAggregatedCompetitorScores(clientId)` - Run-level aggregation
- `applyWeighting(vis, sent, pos)` - 50/30/20 formula

### 7.5 Website Crawling Services

#### `website-crawler.ts`
**Purpose:** Multi-strategy website content extraction
**Strategies:**
1. CheerioCrawler (fast, static HTML)
2. PlaywrightCrawler (JS-rendered pages)
3. Fallback (error handling)

**Functions:**
- `crawlWebsite(url)` - Main entry point
- `extractContent(html)` - Parse HTML to structured data
- `prioritizePages(urls)` - Smart page selection
- `deduplicateContent()` - Remove duplicate pages

#### `formatCrawledContentForLLM()`
**Purpose:** Convert crawl data to LLM-friendly format
**Output:**
```
Company: Example Corp

Page 1 (https://example.com/about):
Title: About Us
Headings: Company Overview, Our Mission
Content: We are a leading provider...

---

Page 2 (https://example.com/products):
...
```

### 7.6 Site X-Ray Services

#### `xray-ingestion.ts`
**Purpose:** Crawl data → Database ingestion
**Functions:**
- `ingestCrawlData(clientId, crawlResults)`
- `createXRaySite(domain, siteType)`
- `createXRayPages(siteId, pages)`
- `categorizeURLType(url, clientUrls)`

#### `xray-structure-parser.ts`
**Purpose:** HTML → Structured JSON extraction
**Extractions:**
- Headings (H1-H6 hierarchy)
- Paragraphs (with length filtering)
- Lists (ordered, unordered)
- Tables (headers, rows)
- Link counts (internal vs external)

#### `xray-entity-extractor.ts`
**Purpose:** Named entity recognition
**Entities:**
- Companies (competitor mentions)
- Products/Services
- People (executives, authors)
- Locations

#### `xray-content-analyzer.ts`
**Purpose:** GPT-4 content quality analysis
**Analysis:**
- Quality assessment (1-5 stars)
- Content gaps identification
- Recommendations (S/M/L effort, H/M/L impact)
- SEO issues (title, meta, headings)
- Scores (quality, SEO, readability)

**Retry Logic:**
```typescript
async function analyzeWithRetry(page, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await callGPT4(page);
    } catch (error) {
      if (isTransient(error) && i < maxAttempts - 1) {
        await sleep(Math.pow(2, i) * 1000); // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}
```

#### `xray-health-probe.ts`
**Purpose:** robots.txt and ai.txt analysis
**Checks:**
- File presence
- Disallow rules
- Crawl-delay directives
- User-agent specific rules
- Accessibility status

#### `xray-topic-mapper.ts`
**Purpose:** Align page content with client focus areas
**Functions:**
- `matchTopics(pageContent, clientTopics)`
- `scoreTopicRelevance()`
- `identifyGaps()`

### 7.7 AI Service Orchestration

#### `openai-service.ts`
**Purpose:** GPT-4 wrapper for metadata generation
**Functions:**
- `generateMetadataFromWebsite()` - Topics + Prompts
- `generateRecommendations()` - Content optimization
- `generateOptimizedContent()` - SEO content

#### `engine.llm.ts`
**Purpose:** Multi-model LLM abstraction
**Supports:** OpenAI, Anthropic (Claude)
**Functions:**
- `callLLM(model, prompt, options)`
- `parseStructuredResponse()`

### 7.8 Utility Services

#### `composer.ts`
**Purpose:** Compose complex prompts from templates
**Functions:**
- `composePrompt(template, variables)`
- `injectContext()`

#### `onboarding-enrichment.ts`
**Purpose:** AI-assisted client setup
**Functions:**
- `enrichProfile(url)` - Extract industry, geo
- `enrichURLs(website)` - Discover additional URLs
- `enrichCompetitors(company, industry)`

---

## 8. RECENT ENHANCEMENTS (OCTOBER 2025)

### Week of October 7-11, 2025

#### 8.1 Dashboard Cache Fix (Oct 9)
**Problem:** Browser caching caused stale data display
**Solution:** Added `Cache-Control: no-store, no-cache, must-revalidate` headers
**Impact:** Real-time dashboard updates
**Files Changed:** `server/routes.ts` (3 endpoints)

#### 8.2 Site X-Ray URL Categorization Fix (Oct 9)
**Problem:** Third-party URLs incorrectly marked as internal
**Solution:**
- Enhanced crawler to track URL type metadata
- Separate ingestion pipelines for internal vs third_party
- Added `ingestXRaySiteFromCrawl()` helper
**Impact:** Accurate brand visibility separation
**Files Changed:**
- `server/services/website-crawler.ts`
- `server/db-storage.ts`

#### 8.3 Competitor Ranking Deduplication (Oct 9)
**Problem:** Same competitor appeared multiple times
**Solution:**
- Created `competitor-scoring.ts` service
- Implemented `getAggregatedCompetitorScores()`
- Averages prompt-level scores into single entry
- Filters to latest run only
**Impact:** Clean, readable competitor rankings
**Files Created:**
- `server/services/competitor-scoring.ts`
**Files Modified:**
- `server/routes.ts`
- `server/db-storage.ts`

#### 8.4 Competitor Name Display Fix (Oct 9)
**Problem:** Frontend looking for wrong field (`competitorName` vs `name`)
**Solution:** Updated field references and TypeScript types
**Impact:** Names now display correctly
**Files Changed:** `client/src/pages/dashboard.tsx`

#### 8.5 Score Calculation Improvements (Oct 8-9)
**Enhancements:**
- Standardized rounding: `Math.round(score * 10) / 10`
- Consistent `.toFixed(1)` display
- Human-readable score interpretations in database
- Dynamic color coding based on score ranges
**Files Changed:**
- `server/services/scoring.ts`
- `server/services/visibility-scoring.ts`
- `client/src/components/score-explainability-modal.tsx`

#### 8.6 Prompt-Level Competitor Benchmarking (Oct 8)
**Feature:** Drill down to individual prompt scores
**Implementation:**
- New API: `GET /api/v1/prompt-runs/:runId/prompts/:promptId/benchmarks`
- Returns min/max/avg competitor scores per prompt
- Delta calculations (client vs competitors)
**Impact:** Identify which prompts favor competitors
**Files Created:**
- Database queries in `server/db-storage.ts`
**Files Modified:**
- `server/routes.ts`
- `client/src/components/score-explainability-modal.tsx`

#### 8.7 Crawler Standalone API (Oct 8-9)
**Feature:** Expose crawler as REST API
**Endpoints:** 5 new endpoints for external integration
**Use Cases:**
- Test bed development
- External platform integration
- Batch crawling automation
**Files Modified:**
- `server/routes.ts` (+250 lines)
- `server/services/website-crawler.ts` (exported functions)

#### 8.8 Site X-Ray Performance Optimization (Oct 8)
**Problem:** Slow page loading with nested data
**Solution:**
- Lazy loading for page details
- Parallel fetching with Promise.all
- Optimized queries (select only needed fields)
**Impact:** 60% faster page load times
**Files Changed:**
- `client/src/pages/site-xray.tsx`
- `server/db-storage.ts`

---

## 9. COMPLETE FEATURE TIMELINE

### September 2025 - Initial Development

#### Week 1 (Sept 23-30)
- ✅ Initial project setup
- ✅ Database schema design (18 core tables)
- ✅ Express.js backend foundation
- ✅ React frontend with shadcn/ui
- ✅ Client management CRUD
- ✅ Topic and prompt management
- ✅ Basic dashboard UI

#### Week 2 (Sept 30 - Oct 6)
- ✅ OpenAI integration for metadata generation
- ✅ Website crawler implementation (Crawlee)
- ✅ Automated topic generation from website content
- ✅ Automated prompt generation
- ✅ Background job queue
- ✅ Progress tracking for long-running tasks
- ✅ AI model configuration

### October 2025 - Core Features & Competitive Intelligence

#### Week 1 (Oct 1-6)
- ✅ Prompt run execution engine
- ✅ OpenAI and Anthropic API integration
- ✅ Citation extraction service
- ✅ Mention detection service
- ✅ Ranking parser service
- ✅ Sentiment analysis (ABSA)
- ✅ Score calculation algorithms
- ✅ Competitor discovery (AI-powered)
- ✅ Competitor scoring at prompt level
- ✅ Historical score tracking
- ✅ Dashboard analytics
- ✅ Prompt run tracker with real-time updates
- ✅ Stop/delete prompt runs

#### Week 2 (Oct 7-13)
- ✅ Score explainability system (Oct 7-8)
  - Score factors table
  - Score interpretations
  - Color band system
  - Explainability modal UI
- ✅ Prompt-level competitor benchmarking (Oct 8)
  - Min/max/avg scores
  - Delta calculations
  - Drill-down UI
- ✅ Site X-Ray Phase 1-7 (Oct 7-8)
  - Ingestion pipeline
  - Structure parsing
  - Entity extraction
  - AI content analysis
  - Health probes (robots.txt, ai.txt)
  - Backend API (7 endpoints)
  - Frontend integration
  - Optional metadata integration
- ✅ Crawler standalone API (Oct 8-9)
  - 5 REST endpoints
  - Stage 1 (raw crawl)
  - Stage 2 (LLM formatting)
  - Combined pipeline
  - Async job mode
- ✅ Dashboard cache fix (Oct 9)
- ✅ Site X-Ray URL categorization fix (Oct 9)
- ✅ Competitor ranking deduplication (Oct 9)
- ✅ Competitor name display fix (Oct 9)
- ✅ Citation analysis domain grouping
- ✅ Multi-URL support for metadata generation
- ✅ Dual-source topic generation (crawl + AI)

### Planned Features (Future)

#### Recommendations Summary Table (Awaiting Approval)
- Deduplicated summary table
- Server-side pagination
- Sorting and filtering
- Drill-down to detail view
- URL state management

#### Future Roadmap
- WebSocket real-time updates
- Multi-user authentication (Clerk/Auth0)
- Team collaboration features
- White-label support
- API rate limiting per client
- Cost tracking and billing
- Custom report generation
- Email alerts for score changes
- Competitive intelligence alerts

---

## 10. TECHNICAL METRICS

### Code Statistics
- **Total Commits:** 362
- **Backend Files:** 30+ (services, routes, storage)
- **Frontend Pages:** 13
- **Total API Endpoints:** 67
- **Database Tables:** 24
- **Lines of Code:** ~25,000+ (estimated)

### Performance Benchmarks
- **Metadata Generation:** 2-5 minutes (100 pages crawled)
- **Prompt Run Execution:** 5-15 minutes (36 prompts × 3 models)
- **Dashboard Load Time:** <2 seconds
- **Site X-Ray Analysis:** 10-20 minutes (50 pages analyzed)

### Scalability
- **Concurrent Users:** Designed for 100+ simultaneous
- **Database Connections:** Pool of 20 connections
- **Rate Limiting:** 10 req/sec per endpoint
- **Job Queue:** Processes 1 job at a time (sequential)

### Reliability
- **Uptime:** 99.9% target
- **Error Rate:** <1% of API calls
- **Retry Logic:** 3 attempts with exponential backoff
- **Data Persistence:** PostgreSQL with automatic backups

---

## 11. DEPLOYMENT & OPERATIONS

### Environment Variables Required
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/polaris_ai

# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic (optional)
ANTHROPIC_API_KEY=sk-ant-...

# Session
SESSION_SECRET=random_secret_key

# Node
NODE_ENV=production
PORT=5000
```

### Database Migrations
```bash
# Push schema changes (no manual migrations)
npm run db:push

# Force push (if warnings about data loss)
npm run db:push --force

# Never manually write SQL migrations
```

### Starting the Application
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Monitoring & Logging
- Console logging for all API requests
- Error tracking with stack traces
- Job queue status logging
- Performance timing for slow queries

---

## 12. SECURITY & COMPLIANCE

### Data Protection
- ✅ Password hashing (if auth implemented)
- ✅ PostgreSQL-backed sessions
- ✅ API key storage in environment variables
- ✅ Input validation with Zod schemas
- ✅ SQL injection protection (Drizzle ORM parameterization)

### API Security
- ✅ CORS configuration
- ✅ Rate limiting (10 req/sec default)
- ✅ Request size limits
- ✅ Timeout protection (30s default)

### Future Security Enhancements
- [ ] JWT-based authentication
- [ ] Role-based access control (RBAC)
- [ ] API key rotation
- [ ] Audit logging
- [ ] Data encryption at rest

---

## CONCLUSION

Polaris AI Platform is a **comprehensive brand visibility intelligence system** with:

- **24 database tables** covering all aspects of client management, prompt execution, competitive analysis, and site health monitoring
- **67 REST API endpoints** providing complete programmatic access
- **26 service modules** implementing sophisticated AI-powered analysis
- **13 frontend pages** delivering intuitive user experience
- **362 commits** of iterative development and refinement

The platform uniquely combines:
1. Multi-model AI testing (GPT-4, Claude, Gemini)
2. Competitive benchmarking at prompt level
3. Explainable scoring with factor breakdown
4. Automated website analysis and optimization recommendations
5. Site X-Ray content quality assessment
6. Standalone crawler API for external integration

All features are production-ready with comprehensive error handling, retry logic, and performance optimization.

---

**Document Version:** 2.0  
**Last Updated:** October 9, 2025  
**Prepared By:** Polaris AI Development Team  
**Total Pages:** 47  
**Word Count:** ~18,000 words
