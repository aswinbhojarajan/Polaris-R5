# Issue Log

Running log of production-impacting issues and their resolutions. New
entries go on top.

## 2026-10-21 — Published Prompt Runs omit Web Search (resolved)

The public main asset `/assets/index-BLJ1M47X.js` returned HTTP 200 at
05:17:54 UTC but omitted the Web Search control, search configuration and
evidence-route markers. This is a served-build mismatch; frontend inspection
does not establish the effective production backend policy.

The owner-restored workspace already contains the authentic R1A application
implementation. No further rollback or application overwrite was performed.
Fresh offline regressions (75/75), emitted-build guard tests (5/5) and production
build pass. A build guard now rejects missing frontend/matching backend modules
and emits a content identity for subsequent live comparison.

**Post-publish update:** current asset `index-B747PyT8.js` contains the feature;
production schema and approval checks pass. The served-build omission is fixed.
Genuine production login and signed-in control checks now pass: both approved
providers eligible, OFF default, unsupported-model blocking and normal OFF
selection. Remaining native-answer/rerun/report UI coverage is documented
separately rather than claimed as passed. See
[release evidence](docs/audits/WebSearch/2026-10-21/R1A_RESTORED_CANDIDATE_2026-10-21.md).

## 2026-06-08 — Create-project wizard freezes on "Next" for first-time users (Task #132)

**Symptom.** On production the Create Project wizard sometimes froze on
a step — clicking **Next** did nothing and no error was shown. It
appeared to happen only "sometimes."

**Root cause.** Each wizard step saves with
`PUT /api/v1/clients/:id` but sends no client id in the request body.
`resolveTenant()` could not recover the id: the route param is named
`id` (the resolver looked for `clientId`), the body had none, and the
path regex was anchored to `/clients/...` so it never matched the real
`/api/v1/clients/...` path. The only remaining source was the
`x-client-id` request header, which the frontend sends only when a
project is already selected. A brand-new user, an incognito session, or
anyone creating their **first** project has no selected project → no
header → the server returned `400 "clientId is required for this
endpoint"`. The wizard advances only after the save succeeds, so the
failed save left the user stuck; because it surfaced no error it looked
frozen. Returning users with a stale selected-project header slipped
through, which is why it only failed "sometimes."

**Fix.** `resolveTenant()` (`server/auth.ts`) now extracts the client
id from the URL path with an `/api/v1`-tolerant regex and treats the
path-derived id as authoritative (after `req.params.clientId`, before
body/query/header), keeping the validate-project-name /
activity-summary exclusions. This binds auth to the resource named in
the URL instead of a stale selected-project header — a security-positive
change; the existing `requireRole` (scope `"client"`) checks are
unchanged. The wizard's step 2 / step 3 saves were also wrapped in
try/catch so a genuine save failure shows a clear destructive toast and
stays on the step for retry instead of freezing.

**Verification.** Confirmed a first-project / incognito user can advance
past the URLs step; returning users with a selected project keep
working.

## 2026-06-01 — Forced change-password screen dead-ends with a 401 (Task #129)

**Symptom.** After an admin issued a temporary password, the user logged
in, was sent to the forced "Set a new password to continue" screen, and
on submit got a raw `401: Authentication required` stuck inline with no
way forward. Reported from production.

**Root cause.** The server flow is correct (verified via curl: login
sets `polaris.sid`, `/auth/me` returns 200, change-password gets past
`requireAuth` and returns 400 on a wrong current password, not 401). The
failure was a **client-side phantom-auth** state: `useLogin` seeded the
React Query cache from the login response body and never verified the
session cookie actually stuck, so the forced screen rendered even when
the browser had no usable session. The change-password POST then failed
`requireAuth`, and the client deliberately does NOT redirect on
`/api/v1/auth/*` 401s (`redirectToLoginIfNeeded` skips them), leaving the
user stranded on the error.

**Fix (client-only).** `useLogin.onSuccess` now invalidates
`AUTH_QUERY_KEY` after `setQueryData`, so `/auth/me` is re-probed to
confirm the session — a cookie that never persisted resolves null and
bounces to `/login` instead of rendering a phantom forced-change screen.
`change-password-form.tsx` `onError` detects an `ApiError` 401, clears
the auth snapshot, broadcasts revoked, toasts "please sign in again",
and redirects to `/login` (both the forced page and the settings card
variants). No server, schema, or package changes.

**Verification.** Happy-path login → `/auth/me` → change-password
confirmed via curl; the 401 fallback now redirects cleanly to login.

## 2026-05-16 — "Couldn't load data. Unexpected token '<', '<!doctype'…" on the new admin Running jobs card (Task #121 follow-up)

**Symptom.** Immediately after Task #121 merged, the new **Running
jobs** card on `/app/admin/queue` displayed
`Couldn't load data. Unexpected token '<', "<!doctype "... is not
valid JSON` instead of the running jobs table. Queued jobs and
Failed jobs rendered normally on the same page.

**Root cause.** The dev workflow runs the backend under plain
`tsx server/index.ts` (no `tsx watch`), so server-side file edits do
NOT automatically reload — only the Vite frontend hot-reloads.
Between the moment Vite picked up the new admin-queue page (which
calls `GET /api/v1/admin/jobs/running`) and the moment the workflow
was manually restarted with the new server code, every request to
the new route fell through to the Vite SPA catch-all and got
`<!doctype html>…` back. The TanStack Query `getQueryFn` happily
called `res.json()` on the 200-OK HTML response and threw the
familiar JSON-parse error.

**Fix.** None — transient. The workflow restart at 22:11 brought
the `/api/v1/admin/jobs/running` route online; a curl confirms it
returns proper JSON (401 unauthenticated). A hard refresh of the
Job Queue page resolved the symptom for the user. Verified
end-to-end:
- Route registered (`server/routes/admin-jobs.ts:248`)
- Wired in (`server/routes/index.ts:153 registerAdminJobRoutes(app)`)
- Storage method present in DbStorage (`db-storage.ts:1651`) and
  MemStorage (`storage.ts:987`)
- Frontend query key matches (`["/api/v1/admin/jobs/running"]`)

**Prevention follow-ups (not yet filed as tasks).**
(a) Switch the dev script from `tsx` to `tsx watch` so server file
edits auto-reload — eliminates the entire class of "frontend HMR
raced ahead of the server" bugs.
(b) Detect a non-JSON 2xx response in
`client/src/lib/queryClient.ts` (Content-Type sniff) and surface a
friendlier "Server is restarting — please refresh" message instead
of the raw JSON parse error.

## 2026-05-16 — Every report generated with both PDFs unavailable (Task #105 follow-up)

**Symptom.** Generating any executive report came back with both
download buttons disabled and a yellow banner reading
`PDF rendering failed — please try again or contact support. Both
PDFs are unavailable. The report sections are saved and viewable
above.` Expanding the technical details revealed the same error
twice — once for Insights, once for Appendix:
`browserType.launch: Pass userDataDir parameter to
browserType.launchPersistentContext(userDataDir, options) instead of
specifying '--user-data-dir' argument`. The on-page report view
still worked (Task #104's partial-success path kept the saved
sections viewable), but no user could ever download a PDF.

**Root cause.** Task #105 R3 introduced a shared Chromium browser
singleton in `server/services/pdf-renderer.ts` and passed a unique
`--user-data-dir=polaris-pdf-<uuid>` arg to `chromium.launch()` to
keep two concurrent renders from racing on profile lock files.
Playwright explicitly forbids that flag on `launch()` — passing a
user data dir is only allowed via
`launchPersistentContext(userDataDir, options)`. The shared browser
therefore failed to launch on its very first call, and the failure
was correctly contained by Task #104's `.catch()` on each PDF
promise — so the symptom was visible to users instead of crashing
the worker.

**Fix.** Removed the `--user-data-dir` arg, the `sharedUserDataDir`
bookkeeping, the temp-dir cleanup in `closeSharedBrowser()`, and the
now-unused `os` import. Playwright already gives every
`chromium.launch()` call its own ephemeral
`/tmp/playwright_chromiumdev_profile-*` dir, so two concurrent
processes never collide on a profile lock. The file's header comment
now documents the gotcha. Verified at boot via the existing
`[PDF Self-Test] OK … 658ms` log line that renders a real PDF
end-to-end before the first user click. Pre-existing failed report
cards keep their saved sections (still viewable via View Report) but
will not retroactively get PDFs — regenerate to get both downloads.

## 2026-05-15 — Executive report generation hung the spinner forever on server restart (Task #105)

**Symptom.** A handful of executive reports across multiple users
showed the in-progress spinner indefinitely even though no worker
was doing anything for them. Hitting Refresh did not advance the
state. The pattern matched a server restart / deploy / autoscale
event that occurred during Steps 1-6 of report generation.

**Root cause.** `POST /api/v1/reports/generate` called
`processReportGeneration(...)` as a detached promise inside the
request process. A server restart killed the promise but the
`report_jobs` row stayed in `aggregating` / `analyzing` /
`rendering` because `recoverStaleJobs()` only scanned
`generate_metadata`, `xray_analysis`, etc. — `report_generation`
was not a recognized job kind. Additionally, two users on the same
project both clicking Generate would run two full pipelines in
parallel (2× LLM cost, 2× Chromium spawns).

**Fix.** Task #105 R1 — moved report generation onto the `JobQueue`
as a new `report_generation` job kind. `POST /reports/generate` now
enqueues and returns `{ jobId }`; the worker runs the pipeline and
stamps `payload.snapshotId` on the first progress event for recovery
linkage. `recoverStaleJobs()` was extended to sweep
`report_generation` rows queued longer than 15 min and cascade the
linked `report_jobs` / `report_snapshots` row to `failed` via a new
`failLinkedReportRows()` helper. `handleStaleJob` calls the same
cascade on every `report_generation` failure path so the user-facing
spinner can never sit forever. Mid-pipeline checkpointing (R2)
additionally allows a restart-during-Step-3-or-4 to resume from the
last completed step instead of redoing all the LLM work.

## 2026-05-15 — Executive report generation failed at PDF rendering with `spawn EIO` (Task #104)

**Symptom.** Generating an executive report worked through Step 6
("Saving report sections") and then failed with the toast
`PDF rendering failed: browserType.launch: spawn EIO …`. The job
was marked `failed`, hiding the 13 saved report sections even
though they were written to `report_sections` and structurally
viewable.

**Root cause.** `server/utils/chromium-path.ts::getSystemChromiumPath()`
resolved Chromium via `CHROMIUM_PATH` → `which chromium` →
Nix-store scan → common system paths. `which chromium` returned
the system Nix Chromium 138 at
`/nix/store/qa9cnw…-chromium-138.0.7204.100/bin/chromium`. The
installed Playwright (`playwright@1.55.x`) only knows how to drive
its bundled `chromium-1187`; the protocols are not compatible and
the system binary fails to spawn under Playwright's launch
sequence, surfacing as `spawn EIO`. Replit pre-installs a
Playwright-version-matched Chromium and exposes the canonical path
via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, but the resolver
wasn't checking it. The website crawler hit the same code path
but tolerated failures via the Cheerio fallback — PDF rendering
had no fallback, so the bug surfaced here first.

**Fix.** Three coordinated changes.

1. Added a new highest-priority Strategy 0 in
   `getSystemChromiumPath()`: if
   `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set and the file
   exists, return it. Logs `[Chromium] Using
   REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE: <path>` at boot.
2. `server/index.ts` runs a tiny `[PDF Self-Test]` after the
   listen — renders a 1-page blank PDF, logs path + bytes + ms,
   and surfaces a hard error early so a Chromium regression
   doesn't ship and only fail on first user click.
3. Hardened the partial-success path so a Chromium failure on the
   Insights PDF does NOT escape and nuke the report — each PDF
   renders inside its own `.catch()`, the 13 saved sections stay
   viewable, the job is downgraded to `completed_partial`, and
   the Reports list reads `report_files` to decide which download
   buttons to enable. Token / cost accounting for the Appendix
   LLM call is preserved even when its PDF render fails
   (previously zeroed out the already-paid bill).

## 2026-05-15 — DNS-rebinding SSRF in the URL reachability probe (Task #102)

**Symptom / risk.** The URL reachability probe added in Task #99
only blocked literal private IPs and obvious hostnames
(`localhost`, `*.local`, RFC1918 literals, IPv6 ULA/link-local).
A public hostname like `evil.example.com` whose A-record returned
`10.x.x.x` would still be probed; a hostname that resolved to a
public IP on the first lookup and a private one on the second
(classic DNS rebinding) would also slip past. Either gave an
attacker a way to elicit GET requests against internal services
from the Polaris worker.

**Fix.** New async `assertAllowedTarget(url)` runs the existing
sync check, then resolves the hostname via
`dns/promises.lookup({ all: true })` and rejects with
`Private/internal host blocked` if **any** returned address falls
in a private / loopback / link-local range. The single-hop
redirect follower also re-validates the redirect target. Dev-only
self-check at module import probes `http://localtest.me` (a public
hostname that resolves to `127.0.0.1`) to prove the guard fires.

## 2026-05-15 — Onboarding wizard re-fires AI enrichment + duplicates competitors on Back/Forward (Task #99)

**Symptom.** Two user-visible issues in the create-project wizard.
(1) Going Back to Step 2 / 3 / 4 and Next again could re-fire the
auto AI enrichment for that step, overwriting the user's manual
edits with a fresh suggestion. (2) Walking the wizard forward to
completion, hitting Finish, going Back to Step 4, and hitting
Finish again created two sets of competitors on the same project
(every competitor in `competitors` state was re-POSTed to
`/api/v1/competitors` with no de-dup).

**Root cause.** Step 1's idempotency guard was already in place
(Task #90), but Steps 2-4's auto-enrichment effect was only gated
by mount, not by a "have we already fetched for this step?" flag.
And the completion mutation had no de-dup on the competitor
inserts.

**Fix.** Hardened the completion path: `hasCompletedRef`
short-circuits double mutations, `PUT /api/v1/clients` is
idempotent, the competitor POST is server-deduped, and the ref
clears on error so retries are still safe. The auto-enrichment
gates use the existing `enrichedSteps` set introduced in Task #90.
Also shipped alongside this fix: parallel crawl in
`generate_metadata` (3-URL wizard drops from ~30-60 s to
~10-20 s) and a new URL reachability probe that tags AI-suggested
URLs with `reachable: true | false | unknown` so the user can
see a "Couldn't reach this URL" chip and re-check before
proceeding (always advisory, never blocks Next).

## 2026-05-15 — Project Settings page rendered two scrollbars (Task #91)

**Symptom.** Visiting `/app/client-config` showed two vertical scroll
tracks side by side at the right edge of the AI Models card area —
the outer app-shell scrollbar plus a second, nested one inside the
page body. Scroll wheel could land on either track; the inner one
captured input separately from the page.

**Root cause.** The page-level wrapper in
`client/src/pages/client-configuration.tsx` carried an `overflow-*`/
fixed-height utility that turned the inner column into its own scroll
container. With the outer `<main className="flex-1 overflow-auto">`
in `app-layout.tsx` already handling page-level scrolling, the inner
container produced a redundant track.

**Fix.** Removed the offending utility from the page-level wrapper
so only the outer `<main>` scrolls. Verified across short, tall, and
banner-visible states. The intentional `max-h-[300px] overflow-y-auto`
blocks at ~line 818 (Industry `PopoverContent`) and ~line 1070 were
preserved — those live inside popovers, not on the page itself.

## 2026-05-05 — Admin row dialogs left the page un-clickable on close (Task #46)

**Symptom.** On `/app/admin/users` and `/app/admin/projects`, opening
the row "..." menu and choosing **Manage role & access** /
**Edit project** opened a side sheet. Dismissing the sheet (Escape,
click-outside, X, or Save) sometimes left the rest of the page dead
to clicks — buttons, sidebar links, row menus all stopped responding
until the page was reloaded.

**Root cause.** Well-known Radix race when a `Dialog`/`Sheet` is opened
from inside a `DropdownMenuItem`. Both components set
`document.body.style.pointerEvents = "none"` while open and restore it
on close. When the sheet mounts as the dropdown is unmounting, the
dropdown's deferred restore can fire **after** the sheet's, leaving
`<body>` stuck at `pointer-events: none`. The two admin pages already
had a one-shot defensive `useEffect` that cleared the style 250 ms
after the React state flipped, but Radix sometimes re-applied the
style **after** that window during its own close animation / focus
restore tick — so the workaround silently missed.

**Fix.** Replaced the per-page workaround with a single shared
`useBodyPointerEventsGuard()` hook mounted once at the app root
(`client/src/App.tsx`). The hook uses `MutationObserver` on
`document.body` watching `style` attribute changes; whenever it sees
inline `pointer-events: none` AND no Radix overlay element is open
(`[data-state="open"][role="dialog"]`,
`[data-radix-popper-content-wrapper]`, etc.), it clears the style.
Catches the race no matter when it fires and benefits the whole app
at once. Removed the now-redundant local `useEffect` from
`admin-users.tsx` and `admin-projects.tsx`. The intentional
`setTimeout(() => setAccessMember(m), 0)` open pattern (separate
Radix workaround for opening a Dialog from a DropdownMenuItem) was
left untouched.

## 2026-05-15 — Refresh Prompts could empty a project's Prompt Library on a mid-batch failure (Task #98)

**Symptom.** A user clicking "Refresh Prompts" on a project that
already had AI-generated prompts could end up with a partially
populated or completely empty Prompt Library if anything failed in
the middle of the operation — most commonly a vendor pause flipped
on partway through, a transient network blip, or a single classifier
call timing out. The UI showed an error toast, but the project's
previous prompts were already gone and there was no in-app way to
recover them. Compounding the issue, the same operation took ~30–60 s
for an 18-prompt batch, which made the failure window large.

**Root cause.** `POST /api/v1/clients/:id/refresh-prompts` did the
work in three sequential phases with no transactional boundary:
(1) generate the new prompts via `generateRealisticPrompts`,
(2) `storage.deleteAIGeneratedPrompts(clientId)` — destructive,
unconditional — and only *then* (3) loop and call
`storage.createPrompt` per row. Each row also serially awaited a
`classifyPrompt` call, which is what dragged the total wall-clock
into the 30–60 s range. A failure between step 2 and the end of
step 3 left the user with whatever subset of inserts had succeeded
before the throw.

**Fix.** Two changes to the same route. First, classification now
runs 5 calls in flight via a tiny inline `runWithConcurrency` helper,
preserving order, dropping wall-clock to ~5–10 s for 18 prompts.
Second, the delete and the bulk insert are wrapped in a single
`db.transaction(...)` — anything that throws inside rolls back, so
the project's existing AI prompts remain intact and the
`refresh_prompts` tracking job is marked `failed` for the multi-user
activity banner. Classification stays best-effort (one classifier
failure logs and falls back to `categoryId = null` rather than
aborting). The empty-batch guard runs before the transaction so a
generator failure can never reach the destructive phase.

## 2026-05-13 — Site X-Ray mislabeled pre-existing analyses as "never analyzed" (Task #64 follow-up)

**Symptom.** On the Site X-Ray page, every site showed "No X-Ray
analysis has been run for this site yet." even when the card header
clearly displayed page count, issue count, and recommendation count
from a real analysis (e.g. mashreq.com — "3 pages, 21 issues,
9 recommendations").

**Root cause.** Task #64's `LastAnalysisRow` reads `lastAnalysisJob`,
which the API populates from `getLatestXRayJobsBySite()` — i.e. the
most recent `xray_analysis` *job* row. The standalone `xray_analysis`
job worker only landed in Task #58. Sites first analyzed via the
embedded `generateMetadata({ enableSiteXRay: true })` pipeline have
`xray_page_analysis` rows but no `xray_analysis` job row, so the row
fell into the `!job` branch and rendered the misleading empty-state
copy.

**Fix.** `client/src/pages/site-xray.tsx` `LastAnalysisRow` now
suppresses the row entirely when `lastAnalysisJob` is null *and*
`site.pageCount > 0` (the card header already communicates that an
analysis exists). The empty-state copy now only renders for sites
that truly have zero analyses.

## 2026-05-12 — Disabled models could leave runs and jobs in inconsistent states (Tasks #73 / #79)

**Symptom.** Admins disabling a model from the UI had no visibility
into the blast radius (how many projects referenced it, how many
prompt_run_items were running against it). Worse, the previous
implementation flipped `enabled = false` in place — runs already
executing against the model would either crash mid-call with a vague
provider error, or finish "successfully" against a model the operator
believed was already gone, and the row stayed selected on every
project's `selectedAiModelIds` until someone manually cleaned up.
There was no audit trail and no way to tell users their selection had
changed.

**Root cause.** Disable was a single-column update with no cascade and
no attribution. The job-queue executor had no cooperative-cancel
signal for "halted by admin disable", so even when we *tried* to halt
a run by writing `error` to the DB, the post-`processJob` completion
path would race and overwrite it back to `done`.

**Fix.** Two-part. (1) Task #73 added the warn-before-disable
confirmation dialog driven by a new `/disable-impact` endpoint
(`{ projectCount, inFlightItemCount }`) plus an optional Reason
textarea. (2) Task #79 added `disabled_at` / `disabled_by_user_id` /
`disabled_reason` columns and a four-phase cascade — cancel in-flight
items, error-wrap the parent runs whose remaining items can no longer
do useful work, sweep the model out of every
`clients.selectedAiModelIds`, queue a one-time per-user project
banner. The `JobQueue` was extended with a separate `haltedJobs` set
and a post-`processJob` completion guard that re-reads the job state
and skips the `done` write when it's already terminal `error` /
`cancelled`. Per-model History popover (most recent 5 events,
including LLM-function overrides via metadata join). Tests:
`server/tests/ai-model-disable.test.ts` (4 cases) +
`e2e/admin-disable-model.spec.ts`. Filed follow-ups: #81 (atomic
cascade tx so partial failures can't leave the system half-disabled),
#82 (banner reason styling).

## 2026-05-12 — Site X-Ray failures were invisible to users (Task #61)

**Symptom.** When `xray_analysis` jobs failed (provider error, network
issue, malformed page), the Site X-Ray page silently left the previous
analysis in place. Operators had no way to tell whether the most
recent batch had succeeded, was still running, or had errored — they
could only see a stale "last analyzed" timestamp.

**Root cause.** The X-Ray UI was rendering only the persisted
`xray_page_analysis` rows; it never read the underlying `jobs` row's
status / error fields. Closing this gap was deliberately filed as
follow-up #61 by Task #58.

**Fix.** The X-Ray page now reads each site's latest `xray_analysis`
job and renders a per-site failure indicator (status badge + when it
failed + the error message). Task #64 then went further and surfaced
*who* started the run + when, with teammate-started runs picked up
automatically.

## 2026-05-06 — `xray_analysis` jobs queued forever (no worker) (Task #58)

**Symptom.** `POST /api/v1/xray/analyze/batch` enqueued `xray_analysis`
jobs that never moved off `queued`. The Active Operations banner could
show "Running site X-Ray" indefinitely, and the affected sites never
got their batch page analyses written.

**Root cause.** The `JobQueue.processJob` switch had no `case
"xray_analysis":`. Both the route handler and the activity service
already referenced the type, so the system *thought* the work was in
flight while nothing was running it. Recovered stale rows on restart
also slipped through because `recoverStaleJobs()` only swept job types
it knew about.

**Fix.** Added `processXRayAnalysis(siteId, clientId, jobId)` to
`server/services/job-queue.ts`. The worker loads the site + client,
ensures `page_structures` exist for every page (parsing `rawHtml` on
demand via `xray-structure-parser` / `xray-entity-extractor` /
`xray-topic-mapper`), then runs `analyzeBatchPages` in chunks of 5 with
the same retry / backoff as the embedded `generateMetadata({
enableSiteXRay: true })` pipeline. Results write through
`storage.createPageAnalysis`. Throws if every batch fails so the job
goes to `error`. Wired the type into the `processJob` switch and
extended `recoverStaleJobs()` with a Task #58 sweep that fails any
`xray_analysis` row older than the 15 min stale threshold — clearing
pre-existing zombies. Two follow-ups stayed open by design: this worker
does **not** produce `recommendations` rows (#60) and the X-Ray UI
still doesn't surface job failures to users (#61).

## 2026-05-06 — Zombie prompt_runs surfaced as fake "in progress" pills (Task #59)

**Symptom.** After Task #56 shipped the multi-user activity banner, the
project catalog showed an "N in progress" pill on projects that had no
real in-flight work. The dev DB had 13 `prompt_runs` rows stuck in
non-terminal statuses (oldest from October 2025) — every operator
landing on the catalog saw the bogus pills indefinitely.

**Root cause.** Prompt-run executors don't write a heartbeat column, so
when the workflow crashes / restarts mid-run, the row is left in
`running` / `scoring` / etc. forever. The activity service correctly
treated those rows as "active" — they really were marked active in the
DB.

**Fix.** Boot-time one-shot reaper (`server/services/prompt-run-reaper.ts`)
called from `server/index.ts` right after `seedDatabase()` and before
the executor / route registration. Uses the new
`IStorage.reapStalePromptRuns(olderThanMs, reason)` to mark any
prompt_run (and its items) older than `STALE_PROMPT_RUN_AGE_MS`
(default 30 min) and still in any of the `ACTIVE_PROMPT_RUN_STATUSES`
(now exported from `server/services/activity-service.ts` so the reaper
and banner share one list) as `error` with
`errorSummary = "Stale run reaped — server restart"`. Skipped under
`NODE_ENV=test` / `SESSION_STORE=memory`. First boot after the change
cleared all 13 dev zombies (`[PromptRunReaper] Reaped 13 stale prompt_run(s)
and 14 item(s) older than 1800000ms`). Smoke test in
`server/tests/prompt-run-reaper.test.ts`.

## 2026-05-06 — Active operations were invisible to non-initiator users (Task #56)

**Symptom.** When two operators were signed in to the same project, only
the user who *triggered* a long-running operation (Generate Metadata,
Refresh Prompts, Site X-Ray, Project Duplicate, Report Generation,
Prompt Run) saw any indication that work was in flight. The other
operator could re-trigger the same action in parallel (occasionally
overwriting results) or wonder why the dashboard "looked stale".

**Root cause.** Job/run/report progress was kept in component-local
React state on the initiator's tab; nothing was queryable per project,
and nothing carried `started_by_user_id` so attribution was impossible.

**Fix.** Visibility-only (no hard locks) cross-user surface:
- DB: `jobs.started_by_user_id`, `report_jobs.started_by_user_id`
  (nullable FK → `users.id` `ON DELETE SET NULL`) +
  `migrations/0004_add_activity_started_by.sql`.
- Server: `server/services/activity-service.ts` plus
  `GET /api/v1/clients/:clientId/activity`,
  `GET /api/v1/clients/activity-summary`,
  `GET /api/v1/prompt-runs/:id/selections`. Reads via the new
  `IStorage.listActiveActivitySources()` abstraction.
- Frontend: `<ActiveOperationsBanner clientId={…}>` on every
  project-scoped page; `<ActivityChip>` "N in progress" pill on the
  catalog tile. Trigger buttons soft-disable with a tooltip showing
  "{name|you} started {kind} {Xago}". Generate-Metadata adds an
  admin-only override AlertDialog. Start-Prompt-Run warns on
  overlapping `(promptId × modelId)` selection.
- Polling: `useClientActivity` and `useClientsActivitySummary` use
  `5000 | false` (active vs idle) and pause while `document.hidden`.
  Initiator visibility is preserved by `invalidateActivityQueries()`
  fired from each enqueue mutation.



## 2026-05-06 — Dev and prod use separate Neon databases ("Masafi looks empty in prod")

**Symptom.** An operator reported that the **Masafi** project "looked empty
in production" — they had been running prompts against it on the dev
deployment and assumed the data would also appear at
`https://polaris-r3.ignitelabs.online`.

**Root cause.** The dev workflow and the production VM each have their own
`DATABASE_URL` pointing at separate Neon databases. The dev DB had renamed
the project to `Renamed_3NjN` and accumulated 43 prompts, 65 topics, 1
xray run, and 1 prompt run; the prod DB still carried the project under
its original name `Masafi Test 4th May R3` with zero content. **This is
expected behavior**, not a bug — but it was undocumented and bit an
operator once.

**Fix.** Documentation only. Added a `## Gotchas` section in `replit.md`
and a callout in `prd/11-environment-and-deployment.md` making it
explicit that dev and prod are separate Neon databases and that
prompt runs / topics / project renames performed in one do **not**
appear in the other. Production data must be created against the
production deployment.

## 2026-05-06 — `Detected broken symlink` warnings on every Repl layer push

**Symptom.** Every prod build/push surfaced `Detected broken symlink`
warnings, slowing layer compression and cluttering the deploy log.

**Root cause.** Chromium-under-Playwright creates PulseAudio runtime
symlinks in `.config/pulse/` that point at `/tmp/pulse-XXXX` directories.
The `/tmp/pulse-XXXX` directories are cleaned up when the workflow exits;
the symlinks are not, so every subsequent layer push tried to package
dangling links.

**Fix.** Added `.config/pulse/` to `.gitignore` so the symlinks never
enter the deploy bundle. Warning is gone.

## 2026-05-06 — Project-scoped pages render blank on deep-link / new-tab open

**Symptom.** Middle-clicking any sidebar item (Dashboard, Reports, Site
X-Ray, …) opened the page in a fresh tab where `localStorage` was empty,
and the page rendered with `clientId=null` — most surfaces showed an
empty state ("No data yet") even though the user clearly had projects.
A hard refresh after a normal click would fix it.

**Root cause.** The `current-client-id` selection lived only in
`localStorage` and was not propagated through internal links. New tabs
inherit no localStorage from the parent until a write happens, so every
project-scoped query fired with `clientId=null`.

**Fix (Tasks #52 + #53).**
- New `client/src/hooks/use-selected-client-id.ts` exports
  `useSelectedClientId`, `useUrlClientId`, `setSelectedClientId(id)`,
  and `getSelectedClientIdSnapshot()`. `setSelectedClientId` writes
  `localStorage["current-client-id"]` and explicitly dispatches a
  `selected-client-changed` custom event for same-tab subscribers;
  cross-tab subscribers are notified implicitly via the browser's
  native `storage` event (fires only in *other* tabs on every
  `localStorage` write). The hook's `subscribe()` listens for both.
  Internal `getServerSnapshot` (returns `null`) provides SSR safety
  but is not exported.
- `ProtectedRoute` runs a URL→store sync effect on every navigation so
  `?clientId=` always wins over the cached value.
- Every project-scoped page (`dashboard.tsx`, `prompts-tracker.tsx`,
  `client-configuration.tsx`, `site-xray.tsx`, `metadata-topics.tsx`,
  `metadata-prompts.tsx`, `citation-analysis.tsx`, `recommendations.tsx`,
  `content-generator.tsx`, `reports.tsx`) resolves
  `urlClientId || storedClientId` and renders a "No Client Selected"
  empty state when both are null.
- Every project-scoped `Link` in `client/src/components/layout/sidebar.tsx`
  now appends `?clientId=${selectedClientId}` to its `href` so middle-click
  / open-in-new-tab carries the selection through. (The top-navigation
  user dropdown and the client-catalog "Open" button still navigate via
  `setLocation()` + `setSelectedClientId()` without a URL query — fine
  for same-tab clicks; tracked as a follow-up.)
- Empty-state guard: when neither URL nor store carries a `clientId`,
  each page renders a "No Client Selected" empty state telling the user
  to pick a project from the top-nav dropdown, instead of silently
  querying with `clientId=null`.

## 2026-05-05 — Stale per-run scores after worker completion

**Symptom.** Opening the Run Details drawer or section while a run was in
`scoring` / `benchmarking` showed 0/0/0 scores indefinitely; the user had to
hard-refresh after the run finished to see real numbers.

**Root cause.** The per-run `useQuery` for `/api/v1/prompt-runs/:id/results`
had no `refetchInterval`, and the parent `prompts-tracker` page only
invalidated dashboard / list queries — not the per-run results cache —
when a run transitioned out of an active state.

**Fix.**
- `client/src/components/run-details-section.tsx` and
  `client/src/components/run-details-drawer.tsx` now poll every 5s while the
  run status is non-terminal; polling freezes on `done`/`failed`/`stopped`/
  `cancelled`/`error`.
- `client/src/pages/prompts-tracker.tsx` invalidates the `['/api/v1/prompt-runs', runId, 'results', clientId]` query key on any active→terminal transition, so a drawer/section open at the
  moment of completion picks up final scores immediately.

## 2026-05-05 — Deprecated model IDs hard-coded in service paths

**Symptom.** `gpt-4-turbo-preview`, `gpt-4o-mini`, `claude-3-5-haiku-20241022`,
`gemini-1.5-pro`, and `claude-3.5-sonnet` were referenced directly in
service code, the ai_models seed, and MemStorage seed — making it
impossible to roll forward to the GPT-5.4 family without a code edit per
call site.

**Fix.** All such call sites now read from `server/config/llm-functions.ts`
(R4). The seed catalog uses `claude-sonnet-4-5`, `claude-opus-4-1`,
`gemini-2.5-pro`, `gemini-2.5-flash`, and the GPT-5.x family;
deprecated rows are disabled in place by `disableDeprecatedModels()`.

## 2026-05-05 — Provider 503 not retried

**Symptom.** OpenAI and Gemini occasionally return HTTP 503 under load.
The job queue only retried 429s, so 503s surfaced as hard failures even
though they're equally transient.

**Fix.** All four executors in `server/services/ai-executor.ts` now set
`isRateLimited` for both 429 and 503 status codes.

## 2026-05-16 — Alerts & Recovery (Task #115)

### Environment variables

- `ALERT_SLACK_WEBHOOK_URL` — Slack incoming-webhook URL. Unset = Slack channel disabled.
- `ALERT_EMAIL_SMTP_URL` — `smtp://user:pass@host:port` URL passed to nodemailer.
- `ALERT_EMAIL_TO` — comma-separated recipient list.
- `ALERT_EMAIL_FROM` — sender header. Defaults to `alerts@polaris.local`.
- `STALE_PROMPT_RUN_SWEEP_MS` (alias `STALE_PROMPT_RUN_SWEEP_INTERVAL_MS`) — periodic reaper interval (default 600000 = 10 min). Both names are accepted to avoid operator misconfiguration.
- `STALE_PROMPT_RUN_AGE_MS` — threshold for reaping (default 1800000 = 30 min).

All alert env vars are skipped under `NODE_ENV=test` / `SESSION_STORE=memory`
so test runs never spam Slack/email; console output is always on.

### Triage runbook

1. **Job failed after MAX_RESUME_ATTEMPTS** — open `/app/admin/queue`, find
   the row in "Recent failed jobs", inspect the `error` text. If transient
   (vendor 5xx, timeout), click Retry — a new job row is created with
   `payload.retry_attempt` bumped. If the failure is a real bug, leave the
   row and file an issue with the request id (errors carry `requestId`).
2. **Vendor pause flipped** — `PATCH /api/v1/admin/providers/:vendor` fires
   `ai_vendor.pause.{set,clear}` alerts. The pause is enforced everywhere
   via the kill-switch cache (Task #78); resume by toggling the same switch.
3. **/health DB unreachable** — alert `health.db_down` (debounced 5 min).
   First check Neon dashboard; the Express server stays up but returns 503
   readiness so load balancers drain it. No manual restart needed once Neon
   recovers — the pool reconnects on the next request.
4. **Unhandled rejection counter climbing** — the alert payload includes
   `lastUnhandledRejectionMessage`. Search server logs for it; the most
   common cause is a missing `await` on a fire-and-forget call. Bouncing
   the workflow resets the counter but does not fix the underlying bug.
5. **Stale prompt runs** — the reaper sweeps every 10 min, preferring
   `heartbeat_at` over `createdAt`. A run "stuck" in `running` for >30 min
   is auto-failed with `errorSummary = "Stale run reaped — server restart"`.

### Files

- `server/services/alert-sink.ts` — dispatcher + 4 trigger helpers.
- `server/llm/retry.ts` — `withVendorRetry` / `withVendorRetryResult`.
- `server/routes/admin-jobs.ts` — admin Retry/Cancel endpoints.
- `client/src/pages/admin/admin-dashboard.tsx` — `/app/admin` summary view.
