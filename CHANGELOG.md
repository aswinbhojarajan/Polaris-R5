# Changelog

All notable platform-level changes to Polaris are recorded here, newest first. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry cites the merging task and the headline files touched, so any future agent can trace the change back to the code without spelunking git history.

For the full architectural context behind each change, see the corresponding sections in [`prd/00-documentation-index.md`](prd/00-documentation-index.md).

## 2026-06-08 — Holistic error & notification UX (Task #131)

Frontend-only pass to make error messages, prompts, and notifications
consistent and genuinely helpful — prompted by the incident behind
Task #130, where the create-project wizard showed a generic red
"Failed to create client" toast for what was actually a permission
(HTTP 403) error. New `client/src/lib/api-errors.ts` adds shared
`isPermissionError` / `permissionMessage` / `cleanErrorMessage` /
`getApiError` helpers (detect 403 via `ApiError.status`/`code` with a
legacy string fallback). `useErrorToast` is now permission-aware: a 403
renders "You don't have permission…" + action-specific guidance
(overridable via `opts.permissionMessage`), still appending the
`requestId`. The create-project / onboarding wizard shows the friendly
permission copy on 403 while keeping its 409 duplicate-name branch.
Generic "Failed to…" toasts on `metadata-topics` and the profile page
were migrated to `useErrorToast`, and the content-generator clipboard
failure got specific copy. The native `window.confirm()` prompts for
revoking the current session and halting a running admin job were
replaced with the app's Radix `AlertDialog` (this closes BACKLOG #121a).
A new error/notification conventions section was appended to
`client/src/components/feedback/README.md`. Backend error contract
unchanged.

## 2026-06-08 — Prevent self-demotion lockout (Task #130)

A production incident: an org admin changed his **own** role down to
`viewer` via the admin Members screen and locked himself out — viewers
can't create projects or reach admin screens, so another admin had to
restore him. The role-change endpoint only blocked demoting the **last**
admin; it did not stop a user editing their own role. The route
`PATCH /api/v1/admin/orgs/:orgId/members/:userId` now rejects with 403
"You cannot change your own role — ask another admin" when the target is
the caller (placed before the existing last-admin check, which stays
intact). In the admin UI, `ManageMemberDialog` disables the role
selector for the caller's own row with an inline hint, and bulk role
changes filter out the caller's own row so they never trigger the
self-403. Changing other users' roles is unchanged.

## 2026-06-08 — Re-launch onboarding wizard from Project Settings (Task #133)

The guided create-project wizard could previously only be reached when
creating a brand-new project. `CreateClientWizard` gained an optional
`existingClientId` ("resume") prop: when set, it hydrates every step
from the project (name, URLs in legacy and current shapes, focus areas,
industry, geography, brand aliases, competitors keeping real DB ids, and
selected AI models). Auto AI-enrichment is suppressed in resume mode so
saved data isn't overwritten (manual "Re-run AI" still works). "Complete
Setup" PUTs to the **same** project (no duplicate) and reconciles
competitors (delete previously-loaded rows, recreate the edited list) so
removals take effect; deletes are idempotent and creates deduped by
`clientId + lower(name)` for retry-safety. Step 1 never reaches the POST
create path in resume mode, and an `isHydratingResume` guard disables
Step 1's Next ("Loading…") until hydration finishes so a duplicate
project can't be created mid-hydrate. Dialog title/description and the
success toast are resume-aware.

## 2026-06-08 — Fix onboarding wizard getting stuck on "Next" (Task #132)

On production the create-project wizard sometimes froze on a step with
"Next" doing nothing. Root cause (confirmed via prod logs): each step
saves with `PUT /api/v1/clients/:id` but sends no client id in the body;
`resolveTenant()` couldn't recover it (the route param is `id` not
`clientId`, the body had none, and the path regex was anchored to
`/clients/...` so it never matched the real `/api/v1/clients/...` path),
so it fell back to the `x-client-id` header — which the frontend only
sends when a project is already selected. A brand-new or incognito user
creating their **first** project sent no header → server returned
400 "clientId is required" → the step save threw and the wizard never
advanced (a silent freeze; only "sometimes" because returning users had
a stale header that slipped through). Fix: `resolveTenant()` now extracts
the client id from the URL path with an `/api/v1`-tolerant regex and
treats the path-derived id as authoritative (after `req.params.clientId`,
before body/query/header) — binding auth to the resource in the URL
instead of a stale selected-project header (security-positive). The
wizard's step 2 / step 3 saves are wrapped in try/catch and show a clear
destructive toast (staying on the step for retry) instead of freezing.

## 2026-06-01 — Recover from forced change-password 401 (Task #129)

After an admin issued a temporary password, a user could log in, land on
the forced "Set a new password to continue" screen, submit, and get a
raw `401: Authentication required` with no way forward. The server flow
was correct (verified via curl); the failure was a client-side
phantom-auth state — `useLogin` seeded the cache from the login response
body without verifying the session cookie actually stuck, and a 401 on
the change-password POST stranded the user because the global redirect
helper intentionally skips `/api/v1/auth/*`. Fix (client-only):
`useLogin.onSuccess` now invalidates `AUTH_QUERY_KEY` so `/auth/me`
re-probes and confirms the session (a cookie that never persisted
resolves null and bounces to `/login` instead of rendering a phantom
forced-change screen); `change-password-form.tsx` detects an `ApiError`
401, clears the auth snapshot, broadcasts revoked, toasts "please sign
in again", and redirects to `/login` (both the forced page and the
settings card variants).

## 2026-06-01 — Auth & Session security audit (Task #125, read-only)

A senior-architect / security-engineer-grade **read-only** audit of
Polaris's authentication and session management, delivered as
`docs/audits/AUTH_SESSION_AUDIT_2026-06-01.md`. Every architectural claim
cites a real artifact (file:line, route, table/column, env var); a
feature-coverage matrix and risk register are real tables; recommendations
are tiered A/B/C with S/M/L effort estimates. Posture: strong for internal
use, not yet bank-grade — top gaps are no MFA, no email delivery for
resets/invites, and an HSTS doc/code discrepancy. This task also
established `docs/audits/` as the home for audit-class docs (the LLM
provider audit was moved there) with a `docs/audits/README.md` index. No
code, schema, or runtime config changed.

## 2026-05-17 — Faster revision promotion on deploy

A health-check endpoint is used during deployment so new revisions are
promoted faster (the readiness/liveness endpoints from Task #113 back
this). Deploy-config / startup reliability only — no application
behavior change.

## 2026-05-16 — Admin button to halt running jobs (Task #121)

Until now, admins could re-enqueue failed jobs (Task #115 Retry) and
cancel queued-but-not-yet-claimed jobs (Task #115 Cancel), but a job
that was already running had to be killed by waiting for the 15-min
stale-sweep or restarting the workflow — heavy-handed for a single
stuck worker.

The new **Running jobs** card on `/app/admin/queue` (placed between
the Tunables card and the Recent failed jobs card) polls every 5s
and shows id / type / `startedAt` / `lastHeartbeat` for every row
currently being processed. Each row gets a rose-toned **Halt**
button (OctagonX icon) that calls a new
`POST /api/v1/admin/jobs/:id/halt` endpoint. The endpoint reads the
job, returns 404 if missing or 409 if `status !== 'running'`, then
calls the existing `jobQueue.cancelJob()` — same path Task #79's
model-disable cascade uses — which adds the id to the in-process
`cancelledJobs` set AND flips the DB row to `cancelled`. The
executor's cooperative cancellation check trips at its next
checkpoint and the worker exits cleanly. Audit-logged as
`job.halt` with `previousStatus=running`.

The feed is powered by a new `GET /api/v1/admin/jobs/running` route
and `IStorage.getRunningJobs(limit)` (DbStorage selects
`WHERE status='running' ORDER BY startedAt DESC`; MemStorage is a
no-op). Same admin-only guard and 200-row cap as the existing
`/queued` and `/failed` feeds, kept as a separate table so each
status has its own dedicated affordance — same pattern Task #115
established for queued jobs.

Deviation from the spec: the original task asked for a Cancel
button on the Recent failed jobs row when `status='running'`, but
that feed is terminal-only by definition. Followed the per-status
dedicated-table convention instead. The destructive confirm uses
`window.confirm` to keep the change scoped; a follow-up to swap it
for an AlertDialog matching the rest of the admin module is filed
in BACKLOG.md.

- Files: `server/routes/admin-jobs.ts` (new `/halt` + `/running`),
  `server/db-storage.ts`, `server/storage.ts` (new
  `getRunningJobs`), `client/src/pages/admin/admin-queue.tsx`
  (new Running jobs card + Halt mutation), `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`, `BACKLOG.md`.

## 2026-05-16 — Operational recovery, retries & alerting (Task #115)

A defense-in-depth layer for backend reliability built across seven
sub-items (T1–T7).

**T1 — Prompt-run heartbeats.** Added `prompt_runs.heartbeat_at`,
stamped every 30 s by `executePromptRun`
(`server/services/prompt-run-executor.ts`). The reaper at
`server/services/prompt-run-reaper.ts` now prefers `heartbeat_at`
over `createdAt`, so a long-but-healthy run is no longer reaped while
a server crash mid-run still gets swept. The boot-time one-shot was
joined by a periodic `startStalePromptRunSweep` that runs every 10
min (configurable via `STALE_PROMPT_RUN_SWEEP_MS` or the verbose
alias `STALE_PROMPT_RUN_SWEEP_INTERVAL_MS`; skipped under
`NODE_ENV=test` / `SESSION_STORE=memory`).

**T2 — LLM retries.** New `server/llm/retry.ts` exports
`withVendorRetry` and `withVendorRetryResult` — full-jitter
exponential backoff (250 ms → 4 s, 3 attempts, 10 s absolute budget)
on HTTP 408/429/5xx and network errors. `VendorPausedError`
short-circuits the retry so a paused vendor fails fast instead of
hammering. Wired into `server/llm/{openai,anthropic}.ts` and all
four provider helpers (OpenAI / Anthropic / Google / Perplexity) in
`server/services/ai-executor.ts`.

**T3 — Admin Retry / Cancel.**
`POST /api/v1/admin/jobs/:id/retry` re-enqueues the failed (or
cancelled) row as a NEW job carrying `payload.parent_job_id` and
`payload.retry_attempt` so the original stays as evidence; audit
`job.retry`. `POST /api/v1/admin/jobs/:id/cancel` is now ATOMIC via
the new `storage.cancelQueuedJob` — `UPDATE … WHERE status='queued'
RETURNING` plus a single `getJob` to disambiguate 404 vs 409 when
the row update count is 0 — closing the read-then-write race where
a worker could claim the row mid-cancel; audit `job.cancel`.
Running jobs are deliberately NOT cancellable here (use the
Task #121 `/halt` endpoint instead). `GET /api/v1/admin/jobs/failed`
and `GET /api/v1/admin/jobs/queued` feed the two admin tables on
`/app/admin/queue` (failed-jobs is terminal-only, so a dedicated
Queued-jobs card was added so the Cancel action is actually
reachable).

**T4 — Alert sink.** Single dispatch point in
`server/services/alert-sink.ts` (`emitAlert`) routes alerts to
console (always), Slack (`ALERT_SLACK_WEBHOOK_URL` canonical, with
`SLACK_ALERT_WEBHOOK_URL` legacy alias), and email
(`ALERT_EMAIL_SMTP_URL` + `ALERT_EMAIL_TO` + optional
`ALERT_EMAIL_FROM`, lazy-imported `nodemailer`; the transport is
cached per-URL and the package emits a one-time warn + no-op if
missing). Identical `(kind, dedupeKey)` payloads are debounced for
5 min via an in-process Map. Four triggers wired:
`alertJobFailure` from `JobQueue.handleStaleJob` **only when**
`resumeCount >= MAX_RESUME_ATTEMPTS` so first-failure / no-checkpoint
terminal cases don't flood ops; `alertVendorPause` from
`PATCH /api/v1/admin/providers/:vendor`; `alertHealthDbDown` from
`/health` readiness when `pingDatabase()` fails; and a 60-s tick on
`processHealth.unhandledRejectionCount` delta.

**T5 — Operational dashboard.** New `/app/admin` page
(`client/src/pages/admin/admin-dashboard.tsx`) summarizes queue
stats (Active / Queued / Stale + Failed-24h + Prompt-runs-in-flight
tiles), a "Failures by kind" rollup grouped by `job.type` over the
last 24 h (`GET /api/v1/admin/jobs/failed-by-type?hours=N`, capped
168 h), `/health` snapshot (DB status, uptime, RSS, unhandled
rejections), per-provider 24 h error rates, and the 5 most recent
failures. The prompt-runs in flight count uses
`storage.countActivePromptRuns()` (system-wide, mirrors
`ACTIVE_PROMPT_RUN_STATUSES`). Sidebar gains an **Operational
Dashboard** entry at the top of the Admin section.

**T6 — Providers 24h error rate.**
`storage.getVendorLast24hErrorRate` joins `prompt_run_items` to
`ai_models` over `finishedAt >= NOW() - 24h`; a row counts as
errored when `status='error'` OR `error IS NOT NULL`. `total === 0`
is reported as `null` so the Providers panel cell renders "no
traffic" instead of a misleading 0 %. The Providers panel above
the Models tab on `/app/admin/models` adds a color-graded cell
(red ≥25 %, amber ≥5 %, emerald otherwise).

**T7 — Runbook.** New "Alerts & Recovery" section in `ISSUE_LOG.md`
plus the deep dive in `replit.md`.

Drift from plan: retry endpoint accepts both `error` and `cancelled`
source jobs; Cancel uses atomic conditional UPDATE rather than
read-then-write; stale-sweep + Slack-webhook env vars each accept
two names for backward compat; email channel uses lazy `nodemailer`
(the originally-suggested `replitmail` helper doesn't exist in this
repo); a dedicated Queued-jobs UI card was added because Cancel was
unreachable from a failed-only feed.

- Files: `shared/schema.ts` (`prompt_runs.heartbeat_at`),
  `server/services/prompt-run-executor.ts` (heartbeat loop),
  `server/services/prompt-run-reaper.ts` (periodic sweep + heartbeat
  preference), `server/llm/retry.ts` (new),
  `server/llm/{openai,anthropic}.ts`,
  `server/services/ai-executor.ts`,
  `server/routes/admin-jobs.ts` (new module),
  `server/db-storage.ts` (`cancelQueuedJob`,
  `getQueuedJobs`, `getVendorLast24hErrorRate`,
  `countActivePromptRuns`), `server/storage.ts` (`IStorage`
  surface), `server/services/alert-sink.ts` (new),
  `server/services/job-queue.ts` (alert wiring),
  `server/routes/admin-providers.ts` (alert wiring + 24h rate),
  `server/routes.ts` (alert tick + `/health` integration),
  `client/src/pages/admin/admin-dashboard.tsx` (new),
  `client/src/pages/admin/admin-queue.tsx` (Queued + Failed cards,
  Retry / Cancel mutations), `client/src/pages/admin/_shared.tsx`
  (Providers panel color-graded cell),
  `client/src/components/layout/sidebar.tsx`, `package.json`
  (`nodemailer`), `replit.md`, `ISSUE_LOG.md` (Alerts & Recovery
  runbook), `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Fix Prompts Tracker Rerun "selections not loaded yet" error (Task #116)

The Rerun action on `/app/prompts` (Task #107) would intermittently
fail with the misleading toast **"Failed to rerun — Source run
selections not loaded yet"** even when the
`/api/v1/prompt-runs/:id/selections` endpoint had returned 200 and
the dialog had rendered the prompt / model counts. The guard inside
`rerunMutation.mutationFn` read `rerunSelections` from a React
render closure; Radix's `AlertDialogAction` auto-closes the dialog
on click, racing with `setRerunRun(null)` and a re-render where the
closure observed `rerunSelections === undefined` before the mutation
read it. The same closure could also be stale when the user
reopened the dialog on a run whose cache entry had been
garbage-collected.

Fix: extracted the selections query key + fetcher into small
helpers (`rerunSelectionsQueryKey`, `fetchRerunSelections`). The
`useQuery` still drives the dialog's "Loading prompt & model
counts…" state for the loading copy, but the mutation now calls
`queryClient.fetchQuery({ queryKey, queryFn })` synchronously inside
`mutationFn` so it always sees the freshest data (or fetches it on
the spot), independent of the dialog's render lifecycle. No new
routes, no schema changes.

- Files: `client/src/pages/prompts-tracker.tsx`, `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Frontend error UX & recovery affordances (Task #114)

Companion to Task #113. The backend now returns a typed error
envelope with a request id; the frontend gains the matching
surfaces to display, recover from, and report those errors.

**App-level guards.** An `ErrorBoundary` mounted at the App root
catches render-time crashes that previously took the whole page
blank; a `NetworkBanner` polls `/api/v1/auth/me` every 30 s (with an
immediate-on-mount ping, a `visibilitychange` re-check on tab focus,
and an in-flight guard so we never stack pings) and surfaces a
sticky "You appear to be offline — retrying" banner so a flapping
connection is visible instead of producing a wall of stale data.

**Feedback kit.** `client/src/components/feedback/` adds four
reusable primitives — `ErrorState`, `RetryCard`, `NetworkBanner`,
`ApiErrorMessage` — plus two hooks: `useErrorToast` (renders a
destructive toast with the request id surfaced for support) and
`useSlowQueryNotice` (15 s threshold, mounts an inline notice
under loading skeletons so a user knows the slow page hasn't
silently hung).

**queryClient policy.** `client/src/lib/queryClient.ts` parses the
new `{ error: { code, message, requestId, details } }` envelope
into a typed `ApiError` while preserving the legacy
`"${status}: ${message}"` form on `Error.message` so existing UI
keeps working. Retry policy: 0 retries on 4xx ApiError (auth /
validation won't fix themselves), 2 retries with exponential
backoff on 5xx / network errors.

**Migrated surfaces.** Destructive toasts on the high-traffic
pages (`client-catalog`, `prompts-tracker`, `client-configuration`,
`reports`, `site-xray`, `metadata-prompts`, `start-run-dialog`,
`generate-report-dialog`) now use `errorToast` with `requestId`
surfacing. `RetryCard` / `ErrorState` are wired into the
query-error branches on dashboard, reports, site-xray,
metadata-prompts, and prompts-tracker. `useSlowQueryNotice` is
wired into the dashboard, reports, and site-xray loading paths.
Admin pages migrated in the same pass: `admin-users`, `admin-models`
(three sub-components), `admin-projects`.

- Files: `client/src/App.tsx` (ErrorBoundary + NetworkBanner mount),
  `client/src/components/feedback/` (new module with README),
  `client/src/lib/queryClient.ts`, plus migration touches across
  ~15 page / dialog files (see commit `e5e5fa6`), `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Backend error contract & observability (Task #113)

Every non-2xx `/api/v1` response now follows a single shape:
`{ error: { code, message, requestId, details? } }`. The previous
inconsistency (some routes returned `{ message }`, others
`{ error }`, others a bare string) made client-side error rendering
guesswork and made support nearly impossible without grepping
server logs.

**Single serializer.** `server/middleware/error-handler.ts` is the
only place that writes an error response. Unlike the prior handler
in `server/index.ts`, it does **not** re-throw after responding
(the old re-throw left the connection state ambiguous and bypassed
downstream logging). Throw `ApiError` (`server/utils/api-error.ts`)
for explicit cases or let Zod errors bubble. The middleware also
translates Postgres driver codes via `server/utils/db-errors.ts`:
23505 → 409, 23503 / 23502 / 23514 → 422, 40P01 / 40001 / 53300 →
503, 57014 → 504.

**Request ids.** `server/middleware/request-id.ts` stamps every
request with `req.id` (UUID), echoes it on the `X-Request-Id`
response header, and adds a structured `req.log(level, msg, meta?)`
helper so log lines are correlatable. Inbound `X-Request-Id`
headers are honored after a safety pattern check so an attacker
can't inject anomalous ids.

**Process-level safety.**
`process.on("unhandledRejection" | "uncaughtException")` log
structured lines and bump counters on the exported `processHealth`
snapshot **without** calling `process.exit()` — a transient
rejection no longer takes the worker down.

**Health endpoints.** `/health` (readiness) returns 503 on
DB-ping fail or during shutdown and includes `queue`, `memoryMb`,
`uptimeSec`, and `process.{unhandledRejectionCount,
lastUnhandledRejectionMessage, …}`. `/health/live` (liveness)
always returns 200 if the event loop can reply.

**Rate limits.** Per-user limits (keyed on `user.id` with IP
fallback) cover
`POST /clients/:id/refresh-prompts` (10 /hr),
`/reports/generate` (5 /hr),
`/prompt-runs` (30 /hr),
`/xray/analyze/batch` (10 /hr).
All four are tunable via `*_RATE_PER_HOUR` envs and bypassed under
`NODE_ENV=test` / `RATE_LIMIT_BYPASS=true`.

Full code catalog + examples live in `server/README-errors.md`.

- Files: `server/middleware/error-handler.ts` (new),
  `server/middleware/request-id.ts` (new),
  `server/utils/api-error.ts` (new),
  `server/utils/db-errors.ts` (new),
  `server/middleware/rate-limits.ts` (new),
  `server/index.ts` (removed legacy handler), `server/routes.ts`
  (mount order, health endpoints), `client/src/lib/queryClient.ts`
  (envelope-aware), `server/README-errors.md` (new), `replit.md`,
  `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Executive Report PDF — descriptive filenames (Task #110)

Downloading an Insights Report or Technical Appendix used to save a
file named `insights_report_<uuid>.pdf` /
`technical_appendix_<uuid>.pdf`. After downloading reports for a few
projects on the same day, a user's Downloads folder was a wall of
identical-looking UUIDs with no project, no client, and no date.

The new shared helper `server/utils/report-filename.ts` builds a
self-describing filename of the form:

`Polaris_<Insights|Technical_Appendix>_<Client>[_-_<Project>]_<YYYY-MM-DD>_<id8>.pdf`

Example: `Polaris_Insights_Diageo_-_Tequila_2026-05-16_584e61eb.pdf`.

Both name segments are slugged (lowercase ASCII, non-alnum→`_`, each
capped at 40 chars). String-based smart dedupe trims the project
segment when it starts with the client segment
(`Diageo` + `Diageo Tequila` → `Diageo_-_Tequila`) and drops the
project segment entirely when the two are identical
(`Masafi` + `Masafi` → `…_Masafi_…`). Date is the snapshot's
`generated_at` formatted UTC for cross-browser stability. The 8-char
snapshot-id slice keeps two reports for the same project on the same
day distinct. Total filename length is capped at 150 chars as a
defensive guard.

Both download routes (`server/routes/reports.ts`) extend their
existing client-scoped snapshot lookup with a left join on `clients`
to fetch `name` and `projectName`, then call the helper. The
response uses `Content-Disposition: attachment; filename="…";
filename*=UTF-8''…` so non-ASCII inputs degrade gracefully on older
browsers.

On-disk paths in `server/services/report-job-processor.ts` (both the
main pipeline and the regenerate-appendix path) are rewritten to the
same shape, keeping the existing `_<timestamp>` suffix so two
concurrent renders of the same snapshot can never clobber each other.
The download route serves whatever path is recorded in
`report_files.file_url`, so reports already on disk under the old
shape keep working — only the response filename and any newly written
files change.

Out of scope: renaming files already on disk under the old pattern,
letting the user customize the filename, including the constituent
run ids in the filename.

- Files: `server/utils/report-filename.ts` (new),
  `server/routes/reports.ts`,
  `server/services/report-job-processor.ts`,
  `replit.md`, `CHANGELOG.md`, `WEEKLY_CHANGELOG.md`,
  `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`.

## 2026-05-16 — Prompt Tracker rerun CTA + shorter auto-generated run names (Task #107)

Two small improvements to the Prompts Tracker, shipped together
because they share the same files.

1. **Shorter auto-generated run names.** The fallback name in
   `POST /api/v1/prompt-runs` was `Run ${runId.substring(0, 8)}`
   (e.g. `Run 584e61eb`), which gave no temporal context — users
   scanning a long list had to read the Created column to tell
   runs apart. New `buildAutoRunName(runId, now?)` in
   `server/routes/prompt-runs.ts` returns `Run <id8> · <MMM d>`
   (e.g. `Run 584e61eb · May 16`) using `Intl.DateTimeFormat` with
   a try/catch fallback to id-only. Short (~21 chars), keeps the
   full 8-char id slice users were already cross-referencing, and
   adds the date so the list is scannable at a glance. The same
   helper is reused in `server/routes/dashboard.ts` to synthesize
   labels for legacy runs whose `name` is null, so the dashboard
   filter chips render in identical shape. Only the auto-fallback
   changed — names the user types in `StartRunDialog` are
   untouched.

2. **Rerun CTA on each row.** No new routes. The existing
   `POST /api/v1/prompt-runs` schema gained an optional
   `iterationOf?: string` field. When set, the server strips any
   trailing `(iteration K)` from it, scans every existing run for
   the project, finds the largest existing K for that base name,
   and stores the new run as `<base> (iteration K+1)`. The scan +
   insert happen inside a single request handler (not a DB
   transaction), so the window for two truly simultaneous reruns
   to compute the same K+1 is much smaller than a browser-side
   counter — but it is not zero. A DB-side transactional lock /
   unique constraint is filed as a follow-up. The new run
   otherwise goes through the
   exact same enqueue path as a manual start, so attribution, the
   JobQueue, and the multi-user active-operations banner all light
   up identically.

   Frontend (`client/src/pages/prompts-tracker.tsx`) adds a
   `RotateCw` icon button to every row (desktop table + mobile
   card). It's **disabled** while the source run is non-terminal
   (`queued / running / scoring / queued_for_benchmarking /
   benchmarking`) — there's no sensible "rerun this" until the
   source has settled. Clicking it opens an `AlertDialog` that
   fetches the source's selection via the existing
   `GET /api/v1/prompt-runs/:id/selections` endpoint and shows:
   - The source run name + its status badge.
   - Separate prompt count × model count = item count (e.g.
     "Will re-execute 12 prompts × 3 models = 36 items.").
   - A best-effort preview of the new run name (the server picks
     the final N, may bump higher if siblings have shown up).
   - The same "another prompt run is already in flight" warning
     copy used in `StartRunDialog` when any `prompt_run` activity
     item is live for the project.
   `AlertDialogCancel` is the default-focused action so an
   accidental Enter press is safe. Confirm POSTs to
   `/api/v1/prompt-runs` with the inherited selections plus
   `iterationOf: <stripped source name>`. Cache invalidation
   covers `/prompt-runs`, `/dashboard/recent-runs`, and the
   project's `/activity` query (via `invalidateActivityQueries`)
   so the new row + activity banner appear immediately. All
   confirm-dialog testids follow the `{action}-{target}-{id}`
   convention (e.g. `button-confirm-rerun-<runId>`).

Out of scope: no UI yet to compare iterations side-by-side
(filed as follow-up), no real `parent_run_id` column for proper
lineage (also follow-up), no "rerun with edits", no bulk rerun,
no "rerun failed items only" mode.

- Files: `server/routes/prompt-runs.ts`,
  `server/routes/dashboard.ts`,
  `client/src/pages/prompts-tracker.tsx`.

## 2026-05-16 — PDF renderer: drop bad `--user-data-dir` arg (Task #105 follow-up)

Task #105 R3 introduced a shared Chromium browser singleton and
passed a unique `--user-data-dir=polaris-pdf-<uuid>` arg to
`chromium.launch()` to keep concurrent renders from colliding on
profile state. Playwright explicitly forbids that flag on
`launch()` — that's what `launchPersistentContext(userDataDir, …)`
is for — and rejects with `browserType.launch: Pass userDataDir
parameter to browserType.launchPersistentContext(userDataDir,
options) instead of specifying '--user-data-dir' argument`. The
shared browser therefore failed to launch and **both** the
Insights and Technical Appendix PDFs were marked unavailable on
every report (sections were still saved, so the on-page report
remained viewable — see Task #104 below for that safety net).

Fix: removed the `--user-data-dir` arg, the bookkeeping for
`sharedUserDataDir`, the now-unused `os` import, and the temp-dir
cleanup in `closeSharedBrowser()`. Playwright already gives every
`chromium.launch()` call its own ephemeral
`/tmp/playwright_chromiumdev_profile-*` dir, so concurrent
processes do not collide. The file's header comment now records
the gotcha. Verified with `npx tsc --noEmit` and the `[PDF
Self-Test] OK … 658ms` log line at boot.

- Files: `server/services/pdf-renderer.ts`.

## 2026-05-15 — Executive Report pipeline — reliability + perf uplift (Task #105)

Companion to Task #104. #104 fixed the immediate spawn EIO; this
task removes the structural risks that made report generation
fragile and slow even on a healthy environment. Seven sub-items
across two halves.

**Reliability**

- **R1 — Move report generation onto the JobQueue.** `POST
  /api/v1/reports/generate` no longer kicks off `processReportGeneration`
  as a detached promise from the request process. It now enqueues a
  new `report_generation` job kind and returns `{ jobId }`
  immediately; the queue worker
  (`processReportGenerationJob` in `server/services/job-queue.ts`)
  runs the pipeline and stamps `payload.snapshotId` on the first
  progress event. `recoverStaleJobs()` was extended to sweep
  long-queued `report_generation` rows (>15 min) and cascade the
  linked `report_jobs` / `report_snapshots` row to `failed` via a
  new `failLinkedReportRows()` helper. `handleStaleJob` calls the
  same cascade on every `report_generation` failure path
  (`server_restart` / `heartbeat_stale` / `timeout`) so a
  shortly-after-start crash doesn't leave the user's spinner
  spinning.
- **R2 — Mid-pipeline checkpointing.** New `answers.summary` text
  column, plus `report_snapshots.narratives` and `appendix_content`
  jsonb columns. Step 3 reads `answers.summary` per response and
  skips re-summarizing already-cached entries (true read+write
  reuse) and best-effort persists new summaries back after the
  batch completes. Step 4 persists `narratives` jsonb; Step 5
  persists `appendixContent` jsonb. `handleStaleJob` auto-resumes
  `report_generation` jobs that have a checkpointed
  `payload.snapshotId` by re-queuing with an incremented
  `resumeCount` (up to `MAX_RESUME_ATTEMPTS`).
  `processReportGeneration` accepts `existingSnapshotId`,
  hydrates cached narratives/appendix from the snapshot row, and
  skips Steps 4/5 when present. Idempotent resume:
  before re-inserting on `existingSnapshotId` it wipes any prior
  `report_sections` and `report_files` rows for that snapshot so
  the resumed run is the single source of truth (no duplicate
  section rows breaking the on-page report).
  `SnapshotData.responses` gained a `summary: string|null` field
  populated from the answers join so the processor can read the
  cache without an extra query. Both jsonb columns are typed
  via Drizzle `.$type<>()` so reads/writes use concrete
  `GeneratedNarratives` / `GeneratedAppendix` types — `as any`
  casts removed throughout.
- **R3 — Browser pool + cleanup cron.** Shared `Browser` singleton
  in `server/services/pdf-renderer.ts` (per-render
  `BrowserContext`, atomic `.tmp` → final rename), closed in the
  SIGTERM handler before `pool.end`. `server/index.ts` registers a
  24h `cleanupOldPDFs(generated_reports, 30d)` cron with a 60s
  warmup.

**Performance**

- **P1 — Aggregator parallelization.** `aggregateSnapshotData`
  fans out `runsData` + `itemsData` + 7 other independent queries
  into one `Promise.all` (was 2 sequential awaits). Validation
  moved post-fanout.
- **P2 — p-limit summarizer.** Replaced the `setTimeout`-batch
  loop in `server/services/response-summarizer.ts` with
  `pLimit(LLM_SUMMARIZER_CONCURRENCY ?? 8)`. Added `p-limit` as an
  explicit dependency (was previously dynamic-imported without
  being declared). Static `import pLimit from 'p-limit'` so
  boot-time module resolution catches missing-dep regressions.
- **P3 — Streaming CSV/ZIP exports.** New
  `streamResponsesCsvToFile`, `streamCitationsCsvToFile`,
  `streamMentionsCsvToFile` in `server/services/csv-exporter.ts`
  emit one CSV line at a time via `Readable.from(generator)` →
  `createWriteStream` pipeline. `server/services/zip-exporter.ts`
  writes the three largest CSVs to a per-export `mkdtemp(
  'polaris-export-')` dir, archives them via `archive.file(path)`
  instead of `archive.append`, and cleans up the tmp dir in
  `finally`. `generateCSVExports` now takes
  `{ excludeFilenames }` so the three large CSV strings are never
  materialized in memory when the streaming path is used (the
  memory win is at the build site, not just the consume site).
  Smaller CSVs (metadata, models, prompts, etc.) keep the
  in-memory path.
- **P4 — DB index audit.** Added btree indexes on
  `prompt_run_items.prompt_run_id`,
  `answers.prompt_run_item_id`, `citations.answer_id`,
  `mentions.answer_id`, `rankings.answer_id` — the aggregator hot
  path.

**Schema.** `migrations/0009_task_105_report_checkpoints.sql`
captures the R2 columns and P4 indexes with idempotent
`ALTER ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
so prod deploys can replay without depending on
`drizzle-kit push`. Dev pushed via `npm run db:push --force`.

**Out of scope (deliberate carve-outs).** Hard concurrency lock
against duplicate `report_jobs` for the same `(clientId, runIds)`
was descoped — the active-operations banner already warns the user
and the worker still serializes per-process. Report-row creation
remains inside the worker rather than at enqueue time; the new
`failLinkedReportRows` cascade plus the >15min stale-queued sweep
cover the same observability gap. Backlog items #106 (concurrency
dedupe), #107 (early `snapshotId` stamp), and #108 (`jobQueue`
circular-ish import in `routes/reports.ts`) capture the
non-blocking review feedback.

- Files: `shared/schema.ts`, `package.json`,
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

**Problem.** Executive report generation failed right after Step 6
("Saving report sections") with the toast
`PDF rendering failed: browserType.launch: spawn EIO …`. Step 6
completed — sections were written to `report_sections` — but
Step 7 (PDF rendering for the Insights and Appendix PDFs) crashed
when Playwright tried to spawn its Chromium subprocess, and the
whole job was then marked `failed`, wiping the user's view of
the completed sections.

**Root cause.** `server/utils/chromium-path.ts::getSystemChromiumPath()`
resolved Chromium via `CHROMIUM_PATH` → `which chromium` → Nix-store
scan → common system paths. On Replit `which chromium` returned
the system Nix Chromium 138 at
`/nix/store/qa9cnw…-chromium-138.0.7204.100/bin/chromium`. Playwright
1.55.x only knows how to drive `chromium-1187`; the protocols are
not compatible and the system binary fails to spawn under
Playwright's launch sequence, surfacing as `spawn EIO`. Replit
pre-installs a Playwright-version-matched Chromium and exposes the
canonical path via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, but
the resolver wasn't checking it.

**Fix.**

1. **Prefer the Replit-blessed Playwright Chromium.** Added a new
   highest-priority Strategy 0 in `getSystemChromiumPath()`: if
   `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set and the file
   exists, return it. Logs `[Chromium] Using
   REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE: <path>` at boot. The
   website crawler hit the same code path but tolerated failures
   via the Cheerio fallback — PDF rendering had no fallback so the
   bug surfaced here first.
2. **Boot-time self-test.** `server/index.ts` now runs a tiny
   `[PDF Self-Test]` after the listen — renders a 1-page blank
   PDF, logs path + bytes + ms, and surfaces a hard error early so
   we don't ship a regression that only fails on first user
   click.
3. **Harden the partial-success path.** Each PDF renders inside a
   `.catch()` so a Chromium / Playwright failure on Insights does
   **not** escape to the outer try-catch and nuke the whole
   report. The 13 saved sections stay viewable in the UI; the job
   is downgraded to `completed_partial`. Token / cost accounting
   for the Appendix LLM call is kept intact even when the
   subsequent Appendix PDF render fails (previously mutating the
   appendix outcome to `{ok:false}` silently zeroed out the
   already-paid LLM bill). The Reports list (`client/src/pages/
   reports.tsx`) now reads `report_files` to decide which download
   buttons to enable — either, both, or neither — and renders a
   yellow "PDF rendering failed" banner with the raw error tucked
   into a `<details>` block.

- Files: `server/utils/chromium-path.ts`, `server/index.ts`,
  `server/routes/reports.ts`,
  `server/services/report-job-processor.ts`,
  `server/services/pdf-renderer.ts`, `client/src/pages/reports.tsx`.

## 2026-05-15 — Block DNS-rebinding SSRF in URL reachability probe (Task #102)

The URL reachability probe added in Task #99
(`server/services/url-reachability.ts`) previously only blocked
literal private IPs and obvious hostnames (`localhost`, `*.local`,
RFC1918 literals, IPv6 ULA/link-local). A public hostname like
`evil.example.com` that resolved to `10.x.x.x` (or to a public IP
on first lookup and a private one on the second — classic DNS
rebinding) would still be probed, giving an attacker a way to
elicit GET requests against internal services from the Polaris
worker.

Changes:

- New `assertAllowedTarget(url)` (async) runs the existing sync
  `isAllowedTarget` check, then resolves the hostname via
  `dns/promises.lookup({ all: true })` and rejects with
  `Private/internal host blocked` if **any** returned address falls
  in a private / loopback / link-local range. DNS failures return
  `DNS lookup failed`. IP-literal hosts skip the lookup (already
  validated upstream).
- `probeUrlReachability` awaits `assertAllowedTarget(url)` for the
  initial guardrail.
- The single-hop redirect follower in `tryFetch` also calls
  `assertAllowedTarget` on the redirect target so a public host
  can't bounce the probe onto an internal one whose hostname only
  resolves to private IPs.
- Reused the existing `isPrivateOrLoopbackHost` for IPv4 and
  bracket-wrapped IPv6 addresses to avoid duplicating the prefix
  table.
- Dev-only fire-and-forget self-check at module import probes
  `http://localtest.me` (a public hostname that resolves to
  `127.0.0.1`) to prove the rebinding guard fires.

- Files: `server/services/url-reachability.ts`.

## 2026-05-15 — Onboarding gaps — parallel crawl + URL reachability + completion idempotency (Task #99)

Three related improvements to the create-project wizard, shipped
together because they share files.

1. **Wizard idempotency on Back/Forward.** Task #90 already gated
   Step 2-4 auto-AI re-runs via `enrichedSteps`. The completion
   path is now also hardened: `hasCompletedRef` short-circuits
   double `complete-onboarding` mutations, `PUT /api/v1/clients`
   is idempotent, and the competitor POST is server-deduped. The
   ref clears on error so retries are still safe — clicking
   Finish twice (or Back to Step 4 → Finish again) now creates
   exactly one set of competitors instead of two.
2. **Parallel crawl in `generate_metadata`.** Replaced the serial
   `for (const url of urls) await crawlWebsite(url)` loop in
   `server/openai-service.ts` with the bounded
   `runWithConcurrency(urls, 3, …)` helper introduced in Task #98,
   wrapped in a per-URL try/catch with a typed `CrawlOutcome`
   union (no `any`). Failure accounting is preserved
   (`rejected`/`thrown` URLs push to `failedUrls`). New timing
   log: `[GenerateMetadata] crawled N urls in Xs (parallel,
   K-in-flight, X ok / Y failed)`. Typical 3-URL wizard project
   wall-clock drops from ~30-60 s to ~10-20 s.
3. **AI-generated URL reachability probe.** New
   `server/services/url-reachability.ts` does a bounded HEAD → GET
   fallback with `AbortSignal.timeout(3000)`, a `Range` header to
   avoid pulling bodies, in-process dedup, and skips entirely
   under `NODE_ENV=test`. SSRF guardrails block non-http(s)
   schemes, `localhost`, RFC1918, CGNAT, link-local, IPv6
   ULA/link-local prefixes. Manual single-redirect follow (max 1
   hop) with redirect-target re-validation. Wired into
   `OnboardingEnrichmentService.{enrichUrls, enrichCompetitors}`.
   New `POST /api/v1/onboarding/probe-urls` endpoint. The wizard
   renders a `ReachabilityChip` (Checking… / Reachable / Couldn't
   reach this URL / Not checked) next to Step 2 URL badges and
   Step 4 competitor websites — warning + unknown states are
   clickable buttons that re-probe that single URL via a per-URL
   `checkingUrls` Set. A global "Re-check" button on Step 2 covers
   all current URLs + competitor websites in one call. The chip
   is **always advisory** — never blocks Next, since
   network/firewall issues are real and we don't want to gate.

- Files: `client/src/components/create-client-wizard.tsx`,
  `server/openai-service.ts`,
  `server/services/url-reachability.ts`,
  `server/services/onboarding-enrichment.ts`,
  `server/routes/onboarding.ts`.

## 2026-05-15 — Fix double scrollbar on Project Settings (Task #91)

The Project Settings page (`/app/client-config`) was rendering a second,
nested vertical scrollbar inside the page content in addition to the
app-shell scrollbar from `<main>` in `app-layout.tsx`. A stray
`overflow-*`/fixed-height utility on the page-level wrapper in
`client/src/pages/client-configuration.tsx` was clipping the form and
producing the inner scroll track. Removed the offending utility so only
the outer `<main>` scrolls; verified across short, tall, and
banner-visible states. Intentionally preserved the
`max-h-[300px] overflow-y-auto` blocks on the Industry popover (~line 818)
and the second popover at ~line 1070 — those live inside `PopoverContent`
and are correct.

- Files: `client/src/pages/client-configuration.tsx` (page-wrapper
  overflow utility removed). `app-layout.tsx` and `index.css` were
  inspected and left untouched.

## 2026-05-13 — Navigation refresh + top-nav project switcher (Task #86)

Brought the left nav and top nav in line with the new Figma in three
coordinated changes:

1. **Top nav becomes the project switcher.** The current project label in
   `client/src/components/layout/top-navigation.tsx` is now a dropdown
   trigger that opens a quick menu with an autofocused search input
   (typeahead over the user's accessible projects), the filtered list (max
   ~8 visible, scrollable), and footer actions **View all projects** →
   `/app/clients` and **Create project** → `/app/clients` opening the
   existing create dialog. Selecting a project calls
   `setSelectedClientId()` AND navigates with `?clientId=` so URL-driven
   selection (Tasks #52/#53) keeps working in fresh tabs / middle-clicks.
   When no project is selected, the trigger reads "Select a project".
2. **Sidebar restructured.** `client/src/components/layout/sidebar.tsx`
   now uses the section-header layout from Navigation.jpg: **Overview**
   (Dashboard, Prompts Tracker) → **Analysis** (Site X-Ray, Topics &
   Keywords, Prompt Library) → **Opportunities** (Citation Analysis,
   Recommendations, Content Generator) → **Reports** (Executive Reports)
   → **Admin** (admins only). The "Client Catalog" entry was removed
   (the catalog is the home page). Project Settings moved to a
   bottom-pinned footer slot (`mt-auto` flex column) with its own gear
   icon. Soft-disable styling when no project is selected and the
   `?clientId=` append-on-every-Link behavior from Tasks #52/#53 are
   preserved.
3. **"Client Configuration" → "Project Settings" rename** across every
   user-visible surface (sidebar label, page heading on `/app/client-config`,
   top-nav references). Routes / file names stay as-is to avoid a broader
   refactor; the database column / schema field `clients.*` is unchanged
   (UI rename only).

Also extended the home/catalog search filter in
`client/src/pages/client-catalog.tsx` to also match `geography` (it
previously only matched `projectName`, `name`, `industry`); the same
filter is reused by the new top-nav switcher for consistency.

Out of scope (deliberate carve-outs from the task plan): swapping the
lucide icons for custom SVGs (waiting on artwork), the org switcher
(separate backlog), dark-mode polish on the new dropdown surface,
carrying `?clientId=` through the top-nav user dropdown and the
client-catalog "Open" button, and replacing `<ClientSelector>` on
non-top-nav surfaces.

## 2026-05-15 — Refresh Prompts speed + crash-safety (Task #98)

The synchronous `POST /api/v1/clients/:id/refresh-prompts` route was
previously serial (one classifier call at a time, ~30–60 s for an
18-prompt batch) and not crash-safe (it called
`storage.deleteAIGeneratedPrompts(clientId)` *before* the inserts, so
a vendor pause / network blip / schema error mid-insert left the
project's Prompt Library partially or fully empty with no recovery).
Two changes close both problems:

1. **Parallel classification.** A small inline
   `runWithConcurrency(items, 5, fn)` helper now runs the
   `classifyPrompt` calls 5-in-flight, preserving order. Wall-clock
   for 18 prompts drops from ~30–60 s to ~5–10 s. Per-prompt
   `[RefreshPrompts] tier=… focus=… cat=…` log line is preserved
   (now logs `unknown` when classification failed).
2. **Atomic delete + insert.** The pair is wrapped in a single
   `db.transaction(async (tx) => { tx.delete(prompts)…; tx.insert(prompts).values(rows).returning(); })`.
   Anything that throws inside rolls back, so the user's existing AI
   prompts remain intact and the catch block marks the
   `refresh_prompts` tracking row as `failed`. Classification stays
   best-effort (a single failure logs and falls back to
   `categoryId = null`) so a vendor blip on one prompt doesn't void
   17 good ones.

Out of scope: the onboarding metadata-generation worker
(`server/services/job-queue.ts`) still uses the original storage
methods — it doesn't have the same delete-then-insert race because it
inserts into a fresh project. Auto-retry and a batch classifier API
are explicitly *not* in this task.

- Routes: `server/routes/clients.ts` — added `runWithConcurrency`
  helper, replaced the serial classifier loop, and wrapped the
  delete + insert in `db.transaction`. Bulk insert intentionally
  bypasses `storage.createPrompt` because the transaction needs the
  `tx` handle, which the storage interface does not expose. This is
  consistent with the existing direct `db.select(promptCategories)`
  usage already in the same route.
- Tracking job lifecycle preserved: empty-generation guard runs
  *before* the transaction (no destructive action on zero prompts),
  success path still sets `done`, catch path still sets `failed`.
- Approved by code review.

## 2026-05-13 — New Polaris favicon (Task #85)

The browser-tab icon now renders the new Polaris compass mark from the
brand refresh. SVG is the primary `rel="icon"` for crisp rendering at
every zoom; the 48×48 PNG is the fallback for browsers without SVG
favicon support, and a dedicated 180×180 `apple-touch-icon` is wired up
for iOS "Add to home screen". `?v=` cache-busters bumped on every link
so existing users pick up the new mark.

- New `client/public/favicon.svg`, refreshed `client/public/favicon.png`,
  new `client/public/apple-touch-icon.png` (generated with ImageMagick).
- `client/index.html:22-48` link tags reordered to put SVG first.

## 2026-05-12 — Disable-lifecycle hardening for AI models (Task #79)

When an admin disables a model the change is now safe end-to-end. New
`disabled_at` / `disabled_by_user_id` / `disabled_reason` columns on
`ai_models` capture attribution. The disable cascade (1) cancels any
`prompt_run_items` already running against the model, (2) error-wraps
the parent runs and `process_prompt_run` jobs that would have produced
nothing useful, (3) sweeps the model out of every
`clients.selectedAiModelIds`, and (4) queues a one-time per-user
project banner explaining the change. The `JobQueue` was extended with
a separate `haltedJobs` set + cooperative cancellation token so the
executor's halt path can `return` early without overwriting the
cascade-set `error` state.

- Schema/migration: `migrations/0007_add_ai_model_disable_audit.sql`.
- Storage: `IStorage.cancelInFlightForDisabledModel`,
  `sweepDisabledModelFromClients`, `getAiModelAuditHistory` (now unions
  `ai_model` rows with `llm_function` rows whose
  `metadata.{modelId|previousModelId}` matches).
- Routes: `PATCH /api/v1/admin/ai-models/:id` writes audit metadata on
  disable; `GET /api/v1/admin/ai-models/:id/audit` returns the most
  recent 5 entries powering the per-row History popover.
- UI: optional Disable Reason textarea, before→after History popover,
  per-project banner with the disable date and reason.
- Tests: `server/tests/ai-model-disable.test.ts` (4 cases incl. the
  JobQueue completion guard) + Playwright spec
  `e2e/admin-disable-model.spec.ts` covering the warn-before-disable
  flow. Filed follow-ups: #81 (atomic cascade tx), #82 (banner styling).

## 2026-05-12 — Provider health & vendor kill switch (Task #78)

Admins can now pause an entire AI vendor in one click — paused vendors
disappear from the consumer-facing model list, are refused at execute
time with a 503, and render a "Vendor paused" chip on the admin model
rows. Pause survives reboot via a new `ai_vendor_status` table.

- Schema: `ai_vendor_status` (vendor PK, `paused`, `paused_at`,
  `paused_by_user_id` FK→users SET NULL, `pause_reason`).
- Cache: `server/config/vendor-pause.ts` — 30s TTL `Set<string>` of
  paused vendors with generation-token race-discard, skipped under
  `NODE_ENV=test` / `SESSION_STORE=memory`. Exports
  `assertVendorNotPaused()` + `VendorPausedError` so internal LLM call
  sites that bypass `executePrompt` (narrative generator, competitor
  discovery, prompt classifier, X-Ray content analyzer, openai-service
  metadata, response summarizer, content recommendation analyzer, and
  the `server/llm/{openai,anthropic}.ts` LLMClient wrappers) all gate
  the same way.
- Endpoints: `GET /api/v1/admin/providers`,
  `PATCH /api/v1/admin/providers/:vendor` (audit-logged via
  `ai_vendor.pause.set` / `ai_vendor.pause.clear`).
- UI: new `ProvidersPanel` above the Models tab on `/app/admin/models`.

## 2026-05-12 — Function → Model picker in admin (Task #77)

Admins can override which model serves each of the 14 internal LLM
functions from the UI (replacing the env-var-only path). Resolution
order is now `llm_function_overrides` row → `LLM_<FUNCTION>_MODEL` env
var → `LLM_FUNCTION_DEFAULTS`. Override events are recorded in the
audit log with `modelId` + `previousModelId` + `overrideModelLabel` and
show up in the per-model History popover (Task #79).

## 2026-05-12 — Warn admins before disabling an in-use model (Task #73)

Toggling a model off now opens a confirmation dialog that reports how
many projects reference the model and how many in-flight
`prompt_run_items` are currently running against it. Optional Reason
field is captured on the audit row (consumed by Task #79). Admin can
cancel without side-effect.

## 2026-05-12 — Enable / disable AI models from the UI (Task #67)

Per-row enabled switch on `/app/admin/models`. The consumer endpoint
`GET /api/v1/ai-models` filters disabled rows out so they can no longer
be selected in the Wizard or Run dialog. Builds on Task #66 (key
availability badge) and is the foundation Task #73/#79 hardened.

## 2026-05-12 — API-key availability on admin AI Models (Task #66)

Each admin model row now shows a "Key configured" / "Key missing" badge
plus a tooltip with the env-var name, so operators can tell at a glance
which providers actually have credentials. Driven by a new
`annotateKeyAvailability` helper on `GET /api/v1/admin/ai-models`.

## 2026-05-12 — Re-categorize models as Core or Additional (Task #39)

Admin Models table exposes a Core/Additional pill that flips
`ai_models.category` without code changes. Replaces the previous boot-
time `syncModelCategories()` for routine recategorization (the boot
sync stays as the default backfill).

## 2026-05-13 — Past Site X-Ray runs surface across users (Task #64)

Site cards on `/app/site-xray` now show, for each site, the most recent
`xray_analysis` run (any user, any tab): status badge, when it ran, who
started it, and the failure reason if it failed. Runs already in flight
when the page loads — including runs a teammate started — are picked up
automatically and resume polling toasts to completion.

- Storage: `IStorage.getLatestXRayJobsBySite(clientId)` →
  `Map<siteId, { jobId, status, error, progress, startedAt, finishedAt,
  createdAt, startedByUserId }>` (DbStorage uses a single window-function
  query; MemStorage returns empty Map).
- API: `GET /api/v1/xray/sites` joins each site with its latest job and
  hydrates user attribution, returning `lastAnalysisJob` and
  `activeJobId`.
- UI: `SiteAccordion` seeds `activeJobId` from the API response, sites
  query polls every 3s while any site has an `activeJobId`.

## 2026-05-12 — Cancel a running Site X-Ray analysis (Task #63)

Users can stop a long-running X-Ray batch from the UI. The `JobQueue`
publishes the cancellation through its existing `cancelledJobs` set;
the `processXRayAnalysis` worker checks between batches and exits
cleanly. Filed follow-up #65 — automated test that proves cancellation
really stops mid-batch.

## 2026-05-12 — Surface Site X-Ray failures in the UI (Task #61)

The X-Ray page now reads each site's latest `xray_analysis` job and
renders a per-site failure indicator (status, when it failed, the
error message) instead of silently leaving the previous analysis in
place. Closes the visibility gap left open as a follow-up by Task #58.

## 2026-05-12 — Login + invitation pages on the new Polaris look (Tasks #68 / #70)

`/login` was rebuilt to match the new Figma — split-screen brand
layout, layered form panel, floral background, restyled "Remember me"
and primary action. The `/forgot-password`, `/reset-password`, and
credential-grant `/invitation/:token` pages were brought onto the same
visual system in the same pass.

## 2026-05-06 — Stale prompt-run reaper (Task #59)

Boot-time one-shot sweep that prevents zombie `prompt_runs` from
surfacing as fake "in progress" pills on the multi-user activity banner.
Marks any prompt-run (and its items) older than `STALE_PROMPT_RUN_AGE_MS`
(default 30 min) and still in any of the `ACTIVE_PROMPT_RUN_STATUSES`
as `error` with `errorSummary = "Stale run reaped — server restart"`.

- New `IStorage.reapStalePromptRuns(olderThanMs, reason)` (DbStorage in
  `server/db-storage.ts`; no-op MemStorage). Note: `statusEnum` has no
  `failed` value — `error` is the canonical terminal-failure status.
- New `server/services/prompt-run-reaper.ts` exposes
  `reapStalePromptRunsAtBoot()`. Called from `server/index.ts` after
  `seedDatabase()` and before route registration. Logs under
  `[PromptRunReaper]`. No-ops under `NODE_ENV=test` /
  `SESSION_STORE=memory`.
- `ACTIVE_PROMPT_RUN_STATUSES` is now exported from
  `server/services/activity-service.ts` so the reaper and the
  multi-user activity banner share one definition of "in flight".
- First post-deploy boot cleared 13 dev zombies and 14 items dating back
  to October 2025.

## 2026-05-06 — Site X-Ray batch worker (Task #58)

Implements the missing `xray_analysis` job handler in `JobQueue` so
`POST /api/v1/xray/analyze/batch` actually runs to completion.

- New `processXRayAnalysis(siteId, clientId, jobId)` worker in
  `server/services/job-queue.ts`. Ensures `page_structures` exist for
  every page (parsing `rawHtml` on demand), then runs `analyzeBatchPages`
  in chunks of 5 with the same retry / backoff as the embedded
  `generateMetadata({ enableSiteXRay: true })` pipeline. Throws if every
  batch fails so the job transitions to `error`.
- Wired into the `processJob` switch and `recoverStaleJobs()` extended
  to fail any `xray_analysis` row queued longer than the 15 min stale
  threshold (clears pre-existing zombies, gives the type a TTL).
- Out of scope (filed as follow-ups): emit `recommendations` rows from
  the worker (#60); surface job failures to users in the X-Ray UI (#61).

## 2026-05-06 — Active operations visibility (multi-user) (Task #56)

Surfaces in-flight work for a project to *every* viewer, not just the user
who started it. Visibility-only — no hard locks. Soft-disable on triggers
(with starter identity + start time in tooltips) plus an admin-only
override modal where re-running could overwrite another user's results.

- DB: `jobs.started_by_user_id`, `report_jobs.started_by_user_id` (nullable
  FK → `users.id` `ON DELETE SET NULL`). Idempotent migration
  `migrations/0004_add_activity_started_by.sql`. Cheap status indexes on
  `jobs(status,type)` and `report_jobs(status)`.
- Server: `server/services/activity-service.ts` reads in-flight jobs +
  prompt runs + report jobs through `IStorage.listActiveActivitySources()`
  (with no-op MemStorage stubs). New endpoints
  `GET /api/v1/clients/:clientId/activity`,
  `GET /api/v1/clients/activity-summary`,
  `GET /api/v1/prompt-runs/:id/selections`.
- Attribution: every async enqueue (`jobs.create`, `promptRuns.create`,
  `reportJobs.create`) now carries `startedByUserId` from `req.user.id`
  through the route handlers. The synchronous `refresh-prompts` endpoint
  writes a manual tracking row so other viewers see it too.
- Frontend: `<ActiveOperationsBanner clientId={…} excludeKinds={…}>`
  rendered on every project-scoped page. Per-row deep-links wouter into
  the owning page (Prompts Tracker for `prompt_run`, Prompt Library for
  `refresh_prompts`, Client Configuration for `metadata_generation`,
  Site X-Ray for `site_xray`, Reports for `report_generation`, Catalog
  for `project_copy`). Optional progress bar when an item reports
  0<progress<100. Polling: `5000 | false` (active or paused) and
  always paused while `document.hidden`.
- Soft-disable coverage: Refresh Prompts, Generate Metadata
  (admin-only override AlertDialog), Generate Report, Duplicate Project,
  Site X-Ray per-site Refresh, Start Prompt Run (warns only on
  overlapping `(promptId × modelId)` selection).
- Catalog tile chip: `<ActivityChip>` Popover lists each in-flight item
  with kind, who started it, time-ago and a deep link.

## 2026-05-06 — URL-driven project selection + sidebar deep-link nav + deployment fixes (Tasks #52, #53)

A two-task pass that fixes a long-standing "looks empty" bug whenever a user opened Polaris in a fresh tab or middle-clicked a sidebar link, plus the deployment hardening needed to ship it on `https://polaris-r3.ignitelabs.online`. **No API or schema changes.**

- **Task #52 — URL-driven `clientId`.** Every project-scoped page now resolves the active project as `urlClientId || storedClientId` — the URL `?clientId=` wins over the cached `current-client-id` in `localStorage`. New `client/src/hooks/use-selected-client-id.ts` exports `useSelectedClientId`, `useUrlClientId`, `getSelectedClientIdSnapshot`, and a single `setSelectedClientId(id)` writer that writes `localStorage["current-client-id"]` and dispatches a `selected-client-changed` custom event for same-tab subscribers; cross-tab subscribers are notified implicitly via the browser's native `storage` event (which fires in *other* tabs on every `localStorage.setItem`/`removeItem`). `ProtectedRoute` runs a URL→store sync effect on every navigation. When neither URL nor store carries a `clientId`, each page renders a "No Client Selected" empty state telling the user to pick a project from the top-nav dropdown (instead of firing API calls with `clientId=null`).
- **Task #53 — Sidebar deep-link `?clientId=` propagation.** Every project-scoped `Link` rendered by `client/src/components/layout/sidebar.tsx` now appends `?clientId=${selectedClientId}` to its `href` (Dashboard, Prompts, Reports, and the dynamic `navigation`/`reportsNavigation` items), so middle-click / open-in-new-tab carries the selection through. Combined with #52, opening any sidebar link in a new tab lands on the correct project without a manual switch. The top-navigation user dropdown and the client-catalog "Open" button still navigate via `setLocation()` + `setSelectedClientId()` (no URL query) — fine for same-tab clicks, but those paths do not yet carry the selection on middle-click.
- **Deployment — vm target + production URL.** Re-applied the `[deployment] deploymentTarget = "vm"` config so the prod build runs `npm run start` (`NODE_ENV=production node dist/index.js`) on a single VM, preserving the in-process JobQueue and cached browsers. Production lives at `https://polaris-r3.ignitelabs.online`.
- **Deployment — `.config/pulse/` symlink cleanup.** Chromium-under-Playwright creates PulseAudio runtime symlinks under `.config/pulse/` that point at `/tmp/pulse-XXXX` directories cleaned up on workflow exit. Every Repl layer push then warned `Detected broken symlink`. Added `.config/pulse/` to `.gitignore` so the symlinks never enter the deploy bundle.
- Files (new): `client/src/hooks/use-selected-client-id.ts`.
- Files (modified): `client/src/components/protected-route.tsx`, `client/src/components/layout/sidebar.tsx`, `client/src/pages/{dashboard,prompts-tracker,client-configuration,site-xray,metadata-topics,metadata-prompts,citation-analysis,recommendations,content-generator,reports}.tsx`, `client/src/pages/client-catalog.tsx`, `.gitignore`, `.replit`.

## 2026-05-05 — Self-service profile (Task #47)

New `/app/account/profile` page lets any signed-in user change their own
display name and password without admin help. Adds two cards: **Profile
information** (display name + read-only email; PATCHes
`/api/v1/auth/me`, refreshes `AUTH_QUERY_KEY` so the topbar updates
immediately) and **Security** (the existing `/change-password` form
extracted into a shared
`client/src/components/account/change-password-form.tsx` component used
by both this page and the forced-change interstitial at `/change-password`,
so policy enforcement can't drift). Below the security form, a "Forgot
your current password? Reset it via email." link routes to
`/forgot-password`. New `PATCH /api/v1/auth/me` endpoint
(`requireAuth`, Zod-validated `displayName: z.string().max(60).nullable().optional()`,
empty/whitespace stored as `null`, returns the sanitized user shape).
A new "Profile" item in the top-nav user dropdown is the discovery
surface. No re-auth required on display-name change (industry standard
for non-security profile fields); password change still requires the
current password and continues to bump session epoch via the existing
endpoint. Forced-change users still hit the standalone `/change-password`
interstitial — Profile lives under `/app` which `ProtectedRoute`
already guards.

- Files: `server/routes/auth-credentials.ts` (PATCH `/me`),
  `client/src/pages/account/profile.tsx` (new),
  `client/src/components/account/change-password-form.tsx` (new shared
  component), `client/src/pages/change-password.tsx` (refactored to use
  the shared form), `client/src/components/layout/top-navigation.tsx`
  (Profile menu item), `client/src/App.tsx` (route registration).

## 2026-05-05 — Fix frozen UI after closing admin row dialogs (Task #46)

On the admin Users and Projects pages, dismissing the row "..." menu's
**Manage role & access** / **Edit project** sheets sometimes left the
rest of the page uninteractive — every button, link, and row menu went
dead until reload. Root cause was the well-known Radix race: when a
`Sheet` mounts as the `DropdownMenu` is unmounting, both components set
`document.body.style.pointerEvents = "none"` and their cleanup callbacks
race; the dropdown's deferred restore can fire **after** the sheet's
restore, leaving `<body>` stuck. Both pages already had a one-shot 250 ms
defensive `useEffect` workaround that silently missed when Radix
re-applied the style after its own close animation tick. Replaced both
local workarounds with a single shared `useBodyPointerEventsGuard()` hook
mounted once at the app root that uses `MutationObserver` on
`document.body` to watch for `style` attribute changes, and clears
`pointer-events: none` whenever it's re-applied while no Radix overlay
(`[data-state="open"][role="dialog"]`,
`[data-radix-popper-content-wrapper]`, etc.) is in the DOM. Catches the
race no matter when it fires and benefits the whole app, not just the
two admin pages.

- Files: `client/src/hooks/use-body-pointer-events-guard.ts` (new),
  `client/src/App.tsx` (mount the hook once at the shell),
  `client/src/pages/admin/admin-users.tsx` and
  `client/src/pages/admin/admin-projects.tsx` (removed the now-redundant
  local `useEffect` workaround). The intentional
  `setTimeout(() => setAccessMember(m), 0)` open pattern is unchanged.

## 2026-05-05 — Update browser tab favicon (Task #45 — superseded by Task #85)

First pass at refreshing the browser-tab icon: swapped the four
favicon `<link>` tags in `client/index.html` (`rel="icon"` 32×32 / 16×16,
`apple-touch-icon` 180×180, `shortcut icon`) from the older Polaris PNG
to a PNG generated from the new compass mark and bumped the `?v=`
cache-buster. Subsequently superseded by Task #85, which added a primary
SVG favicon (crisp at every zoom), a refreshed 48×48 PNG fallback, and a
dedicated 180×180 `apple-touch-icon` at proper paths under
`client/public/`. Kept here for trace.

- Files at the time: `client/index.html`,
  `attached_assets/Polaris_Favicon_1_600_1777972091204.jpg` (source
  artwork). The old asset
  `attached_assets/image_1760043348792_1764017649544.png` was left on
  disk, just unreferenced.

## 2026-05-05 — Send the root URL straight into the app (Task #44)

Visiting `/` previously rendered a marketing landing page (Polaris AI
hero, Features / How It Works / Screens / FAQ / Contact, Book Demo /
Launch App buttons). The user wanted the focus on the tool, not the
marketing site, so the root route now redirects directly to
`/app/clients` (the same place "Launch App" went and the same place
login already lands). Unauthenticated visitors are bounced to `/login`
by the existing protected-route logic, then back into `/app/clients`
after signing in. Also rewired the in-app "Polaris AI" wordmark in
`top-navigation.tsx` from `/` to `/app/clients` so clicking the header
keeps users inside the tool. The marketing page file
`client/src/pages/landing.tsx` is left in the repo but no longer
reachable from any link.

- Files: `client/src/App.tsx` (root route → redirect to `/app/clients`),
  `client/src/components/layout/top-navigation.tsx` (wordmark `Link`).
  Login, logout, password reset, change password, and `/invite/...` flows
  unchanged.

## 2026-05-05 — LLM uplift: GPT-5.4 family, central function config, polling fix (Task #38)

Replicates the 30-Mar-2026 LLM uplift in the Polaris repo. **No breaking API changes.**

- **R1 — Deprecated model IDs purged.** `gpt-4-turbo-preview`, `gpt-4o-mini`, `claude-3-5-haiku-20241022`, `gemini-1.5-pro`, `claude-3.5-sonnet`, and `gemini-pro` are no longer hard-coded in service paths. Files: `server/openai-service.ts` (5×), `server/services/{competitor-discovery,prompt-classifier,response-summarizer,xray-content-analyzer,content-recommendation-analyzer}.ts`, `server/storage.ts` MemStorage seed.
- **R2 — Stale-score polling fixed.** `client/src/components/{run-details-section,run-details-drawer}.tsx` now poll `/api/v1/prompt-runs/:id/results` every 5 s while the run is non-terminal and freeze polling on done/failed/stopped/cancelled/error. `client/src/pages/prompts-tracker.tsx` invalidates the per-run results cache on any active→terminal transition, so an open drawer/section refreshes immediately.
- **R3 — Core/additional categorization.** `server/seed.ts` now exports `CORE_MODEL_IDS` (`gpt-5.2`, `gpt-5.4`, `claude-sonnet-4-5`, `gemini-2.5-pro`, `gemini-2.5-flash`) and runs `syncModelCategories()` on every boot to backfill `ai_models.category` (`core` / `additional`). The wizard and configuration screens already split the accordion on this column.
- **R4 — Centralized LLM function config.** New `server/config/llm-functions.ts` is the single source of truth: 14 function keys, defaults on the GPT-5.4 family, per-key `LLM_<FUNCTION>_MODEL` env override, with `REPORT_AI_MODEL` and `LLM_MODEL` kept as backward-compat fallbacks. The resolved table is logged at boot under `[LLM Functions] Resolved model configuration:` (entries flagged `(override)` when an env var won). `server/config/{aeo,reporting}.ts`, `server/utils/openai-compat.ts` (added `gpt-5.2`, `gpt-5.4`/`-mini`/`-nano`, `o3`, `o4`), `server/services/ai-executor.ts` (503 ⇒ `isRateLimited`), `server/services/narrative-generator.ts` (cost table extended), and `server/llm/openai.ts` (default `gpt-5.4-nano`) all now read from it.
- **R5 — Idempotent ai_models seed.** `upsertMissingModels()` inserts only rows missing from `ai_models` (matched on `model`); `disableDeprecatedModels()` flips `enabled = false` on `claude-3-5-haiku-20241022` and `gemini-1.5-pro` without deleting the rows so historical runs continue to render.
- **R6 — Documentation.** New: `LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md`, `BACKLOG.md`, `ISSUE_LOG.md`. Six legacy planning docs (`IMPLEMENTATION_PHASES.md`, `PROJECT_NAME_*`, `SEED_PLAN.md`, `UPDATED_SEED_PLAN.md`) moved to `docs/archive/`. `replit.md`, `WEEKLY_CHANGELOG.md`, `LEADERSHIP_SUMMARY.md`, `COMPREHENSIVE_TECHNICAL_CHANGELOG.md`, `docs/POLARIS_PLATFORM_FEATURES.md`, and `prd/12-llm-models-prompts-and-orchestration.md` updated with the new model lineup and resolution flow.
- Files (new): `server/config/llm-functions.ts`, `LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md`, `BACKLOG.md`, `ISSUE_LOG.md`.
- Files (modified): `server/seed.ts`, `server/storage.ts`, `server/openai-service.ts`, `server/config/{aeo,reporting}.ts`, `server/utils/openai-compat.ts`, `server/services/{ai-executor,narrative-generator,competitor-discovery,prompt-classifier,response-summarizer,xray-content-analyzer,content-recommendation-analyzer}.ts`, `server/llm/openai.ts`, `client/src/components/{run-details-section,run-details-drawer,create-client-wizard}.tsx`, `client/src/pages/{prompts-tracker,client-configuration}.tsx`.

## 2026-05-04 — Active-sessions ↔ session table consistency (Task #42)

A small but important follow-on to Task #37. The `user_sessions` ledger that powers `/app/account/sessions` is now kept in lock-step with the connect-pg-simple `session` table on two layers, so the UI never shows a session whose underlying express-session row was already pruned, and the ledger can't grow unbounded for users who never log in again. **No API or schema changes.**

- **Read-time filter.** `listUserSessionsForUser` and `countActiveUserSessions` in `server/db-storage.ts` filter via `EXISTS (SELECT 1 FROM session WHERE sid = session_id AND expire > NOW())`. Sessions that exist only in the mirror table (because the express-session row already expired) are hidden from `GET /api/v1/auth/sessions`.
- **Hourly orphan sweep.** `setupAuth()` in `server/auth.ts` now schedules `pruneOrphanUserSessions()` (`server/services/sessions.ts`) on boot and every hour thereafter. The sweep physically deletes orphaned `user_sessions` rows that no longer have a matching `session.sid`.
- **Skip in tests / no-DB mode.** Both layers no-op under `SESSION_STORE=memory` or `NODE_ENV=test` — the in-memory store doesn't populate the `session` table, so the JOIN/sweep would produce false negatives.
- Files (modified): `server/db-storage.ts`, `server/storage.ts` (`pruneOrphanUserSessions` on `IStorage`), `server/services/sessions.ts`, `server/auth.ts`.

## 2026-05-04 — Persistent Postgres session store (Task #8, back-fill entry)

This entry back-fills the persistence work that shipped quietly alongside Task #37 and was previously only documented in `replit.md`. **No API or schema changes.**

- **`connect-pg-simple` is now the active session store** when `DATABASE_URL` is set. `createSessionStore()` in `server/auth.ts` reuses the existing Neon serverless `pool` from `server/db.ts`. The store auto-creates the `session` table on first boot (`createTableIfMissing: true`) and prunes expired rows hourly.
- **Logged-in users now stay signed in across server / workflow restarts, deploys, and autoscale events** instead of being silently logged out — closes `prd/20-` H7.
- **`SESSION_SECRET` is required in production** — `server/auth.ts` throws on boot if missing under `NODE_ENV=production`. A clearly-labeled dev-only fallback is used otherwise.
- **`memorystore` is the no-DB / test fallback** — set `SESSION_STORE=memory` or `NODE_ENV=test` to force it.
- Files (modified): `server/auth.ts` (`createSessionStore()`), `replit.md`, `prd/11-environment-and-deployment.md`, `prd/20-optimization-and-technical-debt-backlog.md`.

## 2026-05-04 — Harden session management (Task #37)

A defense-in-depth pass on the auth/session stack. **No breaking API changes.**

- **Session-fixation fix**: `POST /api/v1/auth/login` and `POST /api/v1/auth/register` now wrap `req.login()` inside `req.session.regenerate()` so the anonymous session id is rotated before the authenticated user is attached. Successful login + logout also write `auth.login.success` / `auth.logout` audit rows. Files: `server/auth.ts`.
- **CSRF double-submit**: new `server/middleware/csrf.ts` issues a non-httpOnly `polaris.csrf` cookie on every response and refuses any `/api/v1` state-changing request whose `x-csrf-token` header does not equal that cookie (returns `403 { code: "csrf_failed" }`). Auth bootstrap endpoints (login / register / forgot-password / credential-grant status+redeem) are exempted because they have no session cookie attached. **`POST /api/v1/auth/logout` is intentionally NOT exempt** — the SPA always echoes the cookie in the header, so a forged POST without it can't terminate someone else's session. Both fetch helpers (`client/src/lib/api-client.ts`, `client/src/lib/queryClient.ts`) now read the cookie and inject the header automatically.
- **Per-IP rate limiting**: new `server/middleware/auth-rate-limit.ts` adds `express-rate-limit`-backed throttles on `/auth/login` (10/min/IP, env `AUTH_LOGIN_RATE_PER_MIN`), `/auth/register` (5/hr, `AUTH_REGISTER_RATE_PER_HOUR`), and `/auth/forgot-password` (5/hr, `AUTH_FORGOT_RATE_PER_HOUR`). 429 responses return `{ message, retryAfterSeconds, code }`. Skipped under `NODE_ENV=test`.
- **`user_sessions` ledger + service**: new table (`shared/schema.ts`) stores `sessionId` (PK, mirrors express-session id), `userId` (FK), parsed user-agent, IP, `createdAt`, `lastSeenAt`. Helpers in `server/services/sessions.ts` cover record/touch/delete/list/count.
- **Idle / absolute timeout + remember-me**: `requireAuth` now enforces an idle clock (default 7d users, 24h admins; env `SESSION_IDLE_MS`, `SESSION_ADMIN_IDLE_MS`) and an absolute clock (default 30d, env `SESSION_ABSOLUTE_MAX_AGE_MS`). On expiry, the session is destroyed and the response carries `{ message, reason: "idle_timeout" | "absolute_timeout" | "session_revoked" | "account_disabled" }`. The login payload accepts `rememberMe: boolean` — true keeps the cookie for `SESSION_REMEMBER_ME_MS` (default 30d), false makes it a browser-session cookie. `lastSeenAt` writes are throttled to once per minute per session.
- **Active-sessions UI + API**: three new endpoints on the spec — `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id`, `POST /api/v1/auth/sessions/sign-out-others` (last bumps the user's session epoch). New page `/app/account/sessions` (`client/src/pages/account/sessions.tsx`) lists devices with parsed user-agent (inline regex helper, no AGPL dep), highlights the current row, and offers per-row revoke + a one-click "Sign out of all other sessions". Linked from the user dropdown in `top-navigation.tsx`.
- **Cross-tab logout**: `client/src/lib/auth.ts` adds a `BroadcastChannel("polaris-auth")` helper used by `useLogout()` and the 401 reason handler in `api-client.ts`. `App.tsx` installs the listener so every sibling tab clears the React Query cache and bounces to `/login` when one tab signs out or gets a revocation 401.
- **Helmet baseline**: `server/index.ts` strips `x-powered-by` and mounts `helmet` with a dev-vs-prod CSP (dev allows Vite HMR + Replit overlays + Swagger CDN + Google Fonts; prod tightens `script-src` / `connect-src`). `crossOriginResourcePolicy=same-site`, HSTS only enabled in prod.
- **Tests**: new `server/tests/sessions.test.ts` (9/9 green) covers CSRF presence/missing-header/matching-header, session-id rotation across login, sessions list / revoke / sign-out-others, logout side-effects, and Helmet header presence.
- Files (new): `server/middleware/csrf.ts`, `server/middleware/auth-rate-limit.ts`, `server/services/sessions.ts`, `client/src/pages/account/sessions.tsx`, `server/tests/sessions.test.ts`.
- Files (modified): `shared/schema.ts`, `server/auth.ts`, `server/index.ts`, `server/routes/index.ts`, `server/routes/openapi.ts`, `client/src/App.tsx`, `client/src/lib/auth.ts`, `client/src/lib/api-client.ts`, `client/src/lib/queryClient.ts`, `client/src/components/layout/top-navigation.tsx`, `client/src/pages/login.tsx`, `shared/api-types.ts` (regenerated).

## 2026-05-04 — Admin UI design-system pass: Projects, Users, Login (Tasks #32 / #33 / #34 / #35)

A four-task polish sweep that aligns every admin surface and the login page on a single visual language. **No API or schema changes.**

- **Task #32 — Projects page redesign + shared admin primitives.** Extracted `client/src/pages/admin/_shared.tsx` with reusable `AdminPageShell`, `PageHeader`, `StatRow` (toned KPI tiles: blue/emerald/amber/purple/rose/slate), `StatusBadge` (toned status pills: active/disabled/invited/warning/neutral), `TableState` (loading/empty rows), `AdminForbidden`, and the canonical `roleBadgeClass`/`AdminRole` types. `client/src/pages/admin/admin-projects.tsx` was rewritten to consume them and gained: search, status & owner filters, sortable columns, multi-select bulk activate/disable, row-click → right-side `Sheet` for project properties, and per-row dropdown actions. Files: `client/src/pages/admin/{_shared.tsx (new), admin-projects.tsx}`.
- **Task #33 — Users & Invitations adopts the same design language.** `client/src/pages/admin/admin-users.tsx` swapped its hand-rolled header, KPI grid, status badges, role badges, table chrome, and forbidden state for the shared primitives from `_shared.tsx`. `Card` table wrappers became bordered `div`s; loading/empty cells became `<TableState>`; member status logic became a tiny `memberStatus(m) → {tone, label}` helper feeding `<StatusBadge>`. All existing `data-testid`s preserved (stat-total-members / stat-active / stat-pending-invites / stat-admins, row-member-*, status-member-*, badge-role-*, row-invitation-*, status-invitation-*, etc.). Files: `client/src/pages/admin/admin-users.tsx`.
- **Task #34 — Login page redesign (split-screen).** Replaced the single-card `/login` with a `lg:grid-cols-2` shell. Left panel: cosmic-purple hero illustration with the Polaris wordmark, "Search leadership for the AI era" headline, three value-prop rows, and the "Secure workspace access" glass card baked into the asset. Right panel: "Welcome back" form with email + password (with Eye/EyeOff visibility toggle), client-only "Remember me" checkbox, Forgot password link, full-width Sign in button, optional SSO button (hidden unless `VITE_ENABLE_SSO=true`; click shows "SSO coming soon" toast), and "Don't have an account? Request access" footer that opens `mailto:VITE_REQUEST_ACCESS_EMAIL` or shows a fallback toast. The `useLogin()` mutation, error handling, redirect target (`/app/clients`), and all existing `data-testid`s (`text-login-title`, `input-email`, `input-password`, `link-forgot-password`, `text-login-error`, `button-submit-login`) are unchanged. Mobile collapses cleanly to a single centered form. Files: `client/src/pages/login.tsx`, `attached_assets/image_1777956038609.png` (refreshed hero asset, Task #43; superseded the original `image_1777922739999.png`).
- **Task #35 — Admin popup-blocker fix + Manage Member as right-side Sheet.**
  - **Bug fix**: opening certain admin row-action popups (e.g. Edit project, Manage members from a row dropdown) sometimes left `pointer-events: none` stuck on `<body>`, freezing the whole admin page until reload. Root cause: when a Radix `DropdownMenu` and a Radix `Dialog/Sheet` mounted/unmounted in the same animation frame, their scroll-locks overlapped and the second one's cleanup ran while the first still held the lock. Fix: every `DropdownMenuItem` whose handler opens a Dialog/Sheet (or triggers a mutation that opens one on success) now uses `onSelect={(e) => { e.preventDefault(); setTimeout(fn, 0); }}`, letting Radix finish unmounting the dropdown before the next overlay mounts. Defensive `useEffect` at the top of each admin page also clears any leftover `document.body.style.pointerEvents = "none"` 250 ms after every modal/sheet flag returns to closed.
  - **UX**: `ManageMemberDialog` (admin-users.tsx) is now a right-side `Sheet` (`sm:max-w-2xl flex flex-col`, body wrapped in `flex-1 overflow-y-auto`) matching the Projects edit sheet, instead of a centered Dialog. All existing `data-testid`s preserved (`title-manage-member`, `tab-org-role`, `tab-project-access`, `select-dialog-role`, `row-access-${id}`, `checkbox-access-${id}`, `badge-source-${id}`, `text-admin-access-note`, `button-save-project-access`). Invite-user Dialog and one-shot revealed-credential Dialog kept as centered Dialogs (out of scope).
  - Files: `client/src/pages/admin/{admin-projects,admin-users}.tsx`.

## 2026-05-04 — Per-user project access (Task #26)

Org membership no longer implies project access. A new `client_user_grants` join table grants individual members visibility into individual projects; admins manage grants from the existing Manage Member sheet (new "Project access" tab); the Users page exposes an Access Matrix tab summarizing which user can see which project. The `clients.ownerUserId` from Task #7 is treated as an automatic owner-grant (cannot be revoked without reassigning the owner). All `/api/v1/clients`-scoped routes filter by the caller's grants in addition to the existing org/role checks, so a member with no grants sees zero projects until an admin grants access. Files: `shared/schema.ts`, `server/routes/admin-users.ts`, `server/routes/clients.ts`, `server/routes/_helpers.ts`, `client/src/pages/admin/admin-users.tsx`.

## 2026-05-04 — Retire legacy `invitations` table (Task #21)

Now that credential grants (Task #18 / #19) cover invitation, password-reset, and temp-password issuance through a single hashed-token table (`credential_grants`), the legacy `invitations` table and its bespoke `/api/v1/admin/orgs/:orgId/invitations*` admin endpoints have been removed. The accept endpoint is now `POST /api/v1/auth/credential-grants/:token/accept`; admin invite/list/revoke flows use `/api/v1/admin/orgs/:orgId/credential-grants`. The frontend admin Users page already used the unified surface; nothing user-visible changed. The legacy schema row + Drizzle migration shim were dropped via `drizzle-kit push`. Files: `shared/schema.ts`, `server/routes/admin-users.ts`, `server/routes/auth.ts`, `server/services/audit.ts`, `server/tests/rbac.test.ts`.

## 2026-05-04 — Queue health alerts (Task #5) + visible admin Queue page (Task #6)

- **Task #5 — Alerting**: a new `server/services/queue-alerts.ts` polls `getHealthStats()` on a configurable interval (`QUEUE_ALERT_POLL_MS`, default 60 s) and emits an alert when stuck-job count or queue depth crosses configurable thresholds (`QUEUE_ALERT_STUCK_THRESHOLD`, `QUEUE_ALERT_DEPTH_THRESHOLD`). Alerts are de-duplicated for `QUEUE_ALERT_COOLDOWN_MS` and dispatched to a webhook (`QUEUE_ALERT_WEBHOOK_URL`, generic JSON POST) and/or Slack (`QUEUE_ALERT_SLACK_WEBHOOK_URL`). Email delivery is tracked separately as Task #30.
- **Task #6 — Admin Queue page**: `/app/admin/queue` (`client/src/pages/admin/admin-queue.tsx`) surfaces the data behind `GET /api/admin/queue` — running/queued/stuck job counts, recent failures, and a manual "resume stuck jobs" button. Gated by `useRole().canAdmin`; the sidebar Admin section now lists Users / Projects / Queue / Audit. Files: `server/services/queue-alerts.ts` (new), `server/index.ts`, `client/src/pages/admin/admin-queue.tsx` (new), `client/src/components/layout/sidebar.tsx`, `client/src/App.tsx`.

## 2026-05-04 — Merged `owner` role into `admin` (Task #7 follow-up)

The four-role hierarchy (viewer < member < admin < owner) is now three roles (viewer < member < admin). The legacy `owner` role had no surface area distinct from `admin` other than two endpoints (hard-delete project, read audit log); both now require `admin`. `admin` is the new top role.

- **DB migration**: `UPDATE user_org_memberships/invitations SET role='admin' WHERE role='owner'` (2 rows migrated), then `user_role_enum` was recreated as `('admin','member','viewer')` with the `'member'` default restored on both columns. The `clients.ownerUserId` FK (per-project owner assignment) is unrelated to the role and was not touched.
- **Privilege matrix**: `DELETE /api/v1/clients/:id` and `GET /api/v1/admin/orgs/:orgId/audit` are now `minRole: "admin"` (were `"owner"`). `ROLE_RANK` no longer includes `owner`.
- **Last-admin safeguard**: the "cannot demote/remove the last owner" guard in `server/routes/admin-users.ts` was rewritten as "cannot demote/remove the last admin" so an org cannot be orphaned.
- **Seed**: bootstrap `admin@polaris.local` is now seeded as `admin` (was `owner`); the redundant `owner@polaris.local` sample user was removed.
- **Tests**: `server/tests/rbac.test.ts` updated (4 tests renamed/rescoped). 63/63 tests pass.
- Files: `shared/schema.ts`, `server/auth-types.ts`, `server/auth.ts`, `server/privileges.ts`, `server/routes/{clients,admin-users,admin-projects,openapi,index}.ts`, `server/seed.ts`, `server/tests/rbac.test.ts`, `client/src/lib/auth.ts`, `client/src/hooks/use-role.ts` (dropped `canOwn`), `client/src/pages/admin/admin-users.tsx`, `client/src/components/layout/sidebar.tsx`.

## 2026-05-04 — Router fix for `/app/admin/*` 404 (Task #7 follow-up)

- **Bug fix**: `/app/admin/users` and `/app/admin/projects` rendered the bare 404 page (outside `AppLayout`) instead of the admin pages. Root cause: the outer wrapper route in `client/src/App.tsx` used `path="/app/:rest*"`, but Wouter v3 ships with `regexparam@3` where `:name*` is "optional single segment" (equivalent to `:name?`), not "rest". Two-segment URLs like `/app/dashboard` matched, but three-segment URLs like `/app/admin/users` fell through to the top-level `NotFound`. Switched to the anonymous wildcard `path="/app/*?"`, which `regexparam` treats as a true rest match.
- Files: `client/src/App.tsx`.

## 2026-05-04 — Login response carries memberships + per-role sample users

Operator impact:

- **Bug fix**: `POST /api/v1/auth/login` and `POST /api/v1/auth/register` now return the same `{ user, orgIds, memberships }` shape as `GET /api/v1/auth/me`. Previously they omitted `memberships`, and the frontend's login mutation cached that incomplete payload — which made `useRole().canAdmin` resolve to `false` even for owners and hid the sidebar's Admin section until a hard refresh. Files: `server/auth.ts`.
- **Sample users for local QA**: `server/seed.ts` now seeds one user per RBAC role in `default-org` (idempotent). All share the password `[REMOVED: configure password in Replit Secrets]`:
  - `owner@polaris.local` → `owner`
  - `adminuser@polaris.local` → `admin` (note: the bootstrap `admin@polaris.local` row was originally seeded as `owner`; after the May 2026 role-merge it is `admin`)
  - `member@polaris.local` → `member`
  - `viewer@polaris.local` → `viewer`
- Files: `server/auth.ts`, `server/seed.ts`, `replit.md`, `CHANGELOG.md`.

## 2026-05-04 — Documentation refresh for Task #7

Scope: documentation only. No functional code changes.

- Brought every PRD doc that referenced auth/tenancy/routes into line with the merged Task #7 surface: `prd/01-codebase-inventory.md` (admin pages, `use-role` hook, `lib/auth.ts`, `admin-*` route modules, `privileges.ts`, `audit.ts`, `rbac.test.ts`, schema counts updated to 35 tables / 20 enums / ~870 LoC, new RBAC section), `prd/02-product-requirements-document.md` (RBAC bullet, gated registration, removed "no auth" out-of-scope item, added SSO/comments items), `prd/04-capability-map.md` (full Auth/Tenancy/RBAC table), `prd/06-frontend-architecture.md` (admin pages, `hooks/use-role`, `lib/auth.ts`, RBAC section), `prd/08-database-and-data-model.md` (`invitations`, `audit_log`, `clients.ownerUserId`, unique `tokenHash`, relations), `prd/10-tech-stack-and-dependencies.md` (passport/memorystore now Critical, `connect-pg-simple` flagged unused), `prd/19-rebuild-from-scratch-guide.md` (env vars, 35 tables, `privileges.ts`/`audit.ts`/`admin-users`/`admin-projects` rebuild steps, frontend pages, tests section showing 63/63).
- Resolved stale claims about `/health` and `/api/admin/queue` not being wired (they live in `server/routes/admin.ts`) and the duplicate `jobQueue` export across `prd/00`, `07`, `09`, `11`, `20`, `21`, `22`.
- Tests: `npx tsx --test server/tests/rbac.test.ts server/tests/routes-integration.test.ts` → 63/63 passing.

## 2026-05-04 — RBAC enforcement + admin module (Task #7)

Operator impact:

- **Authorization is now enforced for every `/api/v1` endpoint.** Unauthenticated requests get 401, cross-tenant requests get 403 (regardless of tenant id source: path, body, query, or `x-client-id` header), and viewers are blocked from every write/execute/admin endpoint. Members can write/execute; admins manage org members and projects; owners can hard-delete projects and read the audit log.
- **Public registration is now OFF by default.** `POST /api/v1/auth/register` returns 403 unless `ALLOW_PUBLIC_REGISTRATION=true`. Add new users via the admin module's invitation flow.
- **Admin module shipped.** Admins/owners can:
  - List/add/role-change/remove org members (`/api/v1/admin/orgs/:orgId/members`).
  - Send/list/revoke single-use invitations (sha256-hashed token, 7-day expiry) and a public accept endpoint at `/api/v1/auth/invitations/:token/accept`.
  - Rename projects, reassign per-project owner (new `clients.ownerUserId` FK to `users`), and soft-delete (`isActive=false`) via `PATCH /api/v1/admin/clients/:id`. Hard delete (`DELETE /api/v1/clients/:id`) is owner-only.
  - Owners only: read the new `audit_log` table at `GET /api/v1/admin/orgs/:orgId/audit`.
- **Frontend admin pages**: `/app/admin/users` and `/app/admin/projects`. The new `useRole()` hook reads per-org memberships from `/auth/me` and gates the sidebar's Admin section. The Membership row of `/auth/me` now includes a `memberships: [{orgId, role}]` array.
- **Schema additions**: `clients.ownerUserId`, `invitations`, `audit_log`. Migration applied via `npx drizzle-kit push --force`.
- **Privilege matrix**: `server/privileges.ts` enumerates ~40 non-read endpoints with min role + scope. OpenAPI surfaces it as the `x-required-role` extension.
- **Test bypass**: `TEST_AUTH_BYPASS=true` (only honored when `NODE_ENV=test`) lets the legacy 53-test integration suite keep running without simulated logins. The new RBAC suite (`server/tests/rbac.test.ts`, 10 tests) runs WITHOUT this flag and exercises the real middleware + sweeps the matrix to prove viewers are blocked everywhere and owners pass everywhere.

Files: `shared/schema.ts`, `server/privileges.ts` (new), `server/auth-types.ts` (new), `server/auth.ts`, `server/routes/index.ts`, `server/routes/admin-users.ts` (new), `server/routes/admin-projects.ts` (new), `server/services/audit.ts` (new), `server/routes/openapi.ts`, `server/routes/{clients,onboarding,competitors,topics,prompts,prompt-runs,reports,xray,opportunities,crawler}.ts`, `server/tests/rbac.test.ts` (new), `server/tests/routes-integration.test.ts`, `client/src/lib/auth.ts`, `client/src/hooks/use-role.ts` (new), `client/src/pages/admin/{admin-users,admin-projects}.tsx` (new), `client/src/App.tsx`, `client/src/components/layout/sidebar.tsx`, `replit.md`, `CHANGELOG.md`.

## 2026-05-01 — Documentation refresh (Task #13)

Scope: documentation only. No functional code changes.

- Refreshed every `/prd` file affected by the five platform merges below: `00`, `03`, `04`, `05`, `07`, `08`, `09`, `11`, `19`, `20`, `21`, `22`.
- Moved seven previously-open tech-debt items into a "Recently resolved (post-merge)" section in `prd/20-`, each anchored to the merging task.
- Added two new critical tech-debt items to `prd/20-`: (C1) the duplicate `export { jobQueue }` at `server/routes/index.ts` that previously broke startup (now fixed), and (C2) the `/health` and `/api/admin/queue` endpoints that were lost during the per-domain routes split (now wired in `server/routes/admin.ts`).
- Updated counts: `shared/schema.ts` = 33 tables / 20 enums / 812 LoC; `server/routes/` = 15 domain modules + 3 internals files; 50 integration tests.
- Updated `replit.md` to reflect that `/health` and `/api/admin/queue` are now wired via `server/routes/admin.ts`.

Files: `prd/00`, `prd/03`, `prd/04`, `prd/05`, `prd/07`, `prd/08`, `prd/09`, `prd/11`, `prd/19`, `prd/20`, `prd/21`, `prd/22`, `replit.md`, `CHANGELOG.md` (new).

## 2026-05-01 — Route integration tests (Task #12, commit `72ea226`)

Operator impact:

- The per-domain routes split, the consolidated `/api/v1/jobs` endpoint, and the OpenAPI spec are now covered by a real test suite. Refactors that break tenancy resolution, `/api/v1/jobs`, or the OpenAPI contract fail tests instead of silently regressing.
- The suite (50 tests, supertest + `node:test`) does not require a real Postgres — it monkey-patches the `storage` singleton so it runs anywhere.
- Run via `npx tsx --test server/tests/routes-integration.test.ts`.

Files: `server/tests/routes-integration.test.ts`.

## 2026-05-01 — Typed frontend API client (Task #11, commit `9194019`)

Operator impact:

- The frontend now consumes a typed `openapi-fetch` client (`apiClient`) generated from the live OpenAPI spec. Existing call sites continue to work via the legacy `apiRequest` helper; new ones get end-to-end type checking on params, body, and response.
- After any change to OpenAPI registrations or the Zod schemas they reference, regenerate the types: `npx tsx scripts/generate-api-types.ts`. Commit the updated `shared/api-types.ts`.

Files: `scripts/generate-api-types.ts`, `shared/api-types.ts`, `client/src/lib/api-client.ts`, `client/src/lib/queryClient.ts`.

## 2026-05-01 — Full OpenAPI coverage + Swagger UI (Task #10, commit `532fd09`)

Operator impact:

- Every `/api/v1/*` route is now described in an OpenAPI 3 document built from the existing Zod schemas (no hand-maintained spec to drift). Available at `GET /openapi.json`.
- A minimal Swagger UI is mounted at `GET /api/docs` so any team member can browse the API without running curl.
- The OpenAPI document is the canonical contract. `prd/09-api-reference.md` now defers to it.

Files: `server/routes/openapi.ts` (1,992 LoC), `server/routes/index.ts` (registration).

## 2026-05-01 — Graceful shutdown + health helpers (Task #4, commit `89b126c`)

Operator impact:

- The server now responds cleanly to SIGTERM and SIGINT: it stops accepting new HTTP connections, tells the `JobQueue` to stop picking up new work, drains in-flight jobs for `SHUTDOWN_GRACE_MS` (default 25s), closes the DB pool, and exits. A separate `SHUTDOWN_FORCE_MS` (default 35s) hard-exit timer guarantees the process dies before SIGKILL lands.
- Jobs that don't drain in time are picked up as "stale" on the next boot via the existing heartbeat-based recovery path — no work is lost permanently.
- `pingDatabase()` and `JobQueue.getHealthStats()` were added as the building blocks of `GET /health` and `GET /api/admin/queue`.

Follow-up resolved: the `/health` and `/api/admin/queue` route registrations have been restored in `server/routes/admin.ts`.

Files: `server/index.ts`, `server/services/job-queue.ts`, `server/db.ts`.

## 2026-05-01 — Per-domain router split + OpenAPI scaffolding (Task #3, commit `531cb94`)

Operator impact:

- The 2,925-line monolithic `server/routes.ts` is now a 10-line re-export shim. Real handlers live in 15 per-domain modules under `server/routes/`, totalling 5,177 LoC.
- Tenancy is standardized through `server/routes/_helpers.ts`: `getClientId` reads `x-client-id` header > `?clientId=` > legacy `?client_id=` (the legacy snake-case forms keep working).
- The duplicate `/api/v1/jobs` and `/api/v1/jobs/:id` registrations from the monolith are consolidated in `server/routes/jobs.ts`.
- Initial OpenAPI scaffolding lands in `server/routes/openapi.ts` (extended to full coverage by Task #10).

Known follow-up: an editing accident left two `export { jobQueue }` declarations in `server/routes/index.ts` (lines 21 and 26), which raises a `SyntaxError` at module load and currently prevents the workflow from starting. Tracked as `prd/20-` C1 — one-line fix.

Files: `server/routes/` (new directory, 18 files), `server/routes.ts` (now a shim).

## 2026-05-01 — Auth + per-tenant authorization (Task #2, commit `4da231e`)

Operator impact:

- `/api/v1/*` is no longer anonymously accessible. Email/password login (`POST /api/v1/auth/login`) issues a 7-day cookie session (`polaris.sid`, `httpOnly`, `sameSite=lax`, `secure` in prod). Passwords are hashed with Node's built-in `scrypt`.
- New tables `users` and `user_org_memberships` (plus enum `user_role_enum`) drive per-tenant authorization: a request for an org or client the caller doesn't belong to returns `403`.
- A bootstrap admin (`admin@polaris.local` / `[REMOVED: configure password in Replit Secrets]`) is seeded into `default-org` so a fresh database is immediately usable. Override with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`. **Change the default password before any non-dev deploy.**
- The frontend now has a `/login` page; `ProtectedRoute` calls `GET /api/v1/auth/me` and redirects to `/login` on 401.
- `SESSION_SECRET` is now required in production (a dev fallback exists). Sessions are stored in `memorystore` — they evaporate on restart and cannot horizontally scale (tracked as `prd/20-` H7).

Files: `server/auth.ts` (~350 LoC), `server/index.ts` (`setupAuth(app)` at line 58), `shared/schema.ts` (auth tables, enums, validation schemas), `server/seed.ts` (bootstrap admin), `client/src/pages/login.tsx`, `client/src/components/protected-route.tsx`.

## Pre-2026-05-01 — Original `/prd` documentation pack (Task #1)

The 22-file evidence-based `/prd` documentation pack landed (commit `3a7b2ad`). At the time of writing it described the platform as: no authentication, no `/health`, no graceful shutdown, no OpenAPI, monolithic 2,925-LoC `server/routes.ts`, duplicate `/api/v1/jobs` registration, and no automated tests. Tasks #2, #3, #4, #10, #11, and #12 above incrementally closed those gaps — see `prd/22-validation-and-gap-report.md` "Resolved gaps" for the audit trail.
