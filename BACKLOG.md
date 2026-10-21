# Polaris Backlog

Tracks deferred work that is not blocking but should be picked up in a
following iteration.

## Prompt Runs Web Search release sequence

**Current status (2026-10-21):** the candidate passes offline tests/build and has
now been owner-published. Served JS contains Web Search; fresh production schema
and approval inspection pass. Genuine production login, effective eligibility
and signed-in ON/OFF control checks now pass; the published-control repair is
verified. Remaining coverage: native-answer/rerun UI and report downloads in
production (no native runs were visible to the verification account). Earlier
pilot notes below are historical checkpoints; do not reset closed allowances
or repeat paid calls.
See [current evidence and remaining gates](docs/audits/WebSearch/2026-10-21/R1A_RESTORED_CANDIDATE_2026-10-21.md).

- **R1A activation hold:** both exact provider combinations completed the real
  development integration matrix: eight runs, ten diagnostics, native evidence,
  scoring and deliverables. Claude's latest-version probe and inherited rerun
  were stale; its freshness check is not a pass and needs an explicit release
  decision. Combined conservative debit: $7.149218 across both windows, no
  unsettled dispatches. Public search is OFF, temporary cohorts removed,
  operators disabled and ledgers preserved.
  [Paid results](docs/audits/WebSearch/2026-10-21/R1A_PAID_VALIDATION_RESULTS_2026-10-21.md).
  Remaining: focused genuine browser/report checks and separately approved
  production schema/publish/cohort-spend/activation gates.
  Read-only production inspection is now complete: live app healthy but R1A
  schema/UI absent; Publish preview is eight additive statements, no destructive
  warnings. **Joint OpenAI + Claude release required**; owner accepted Claude's
  documented freshness limitation, subject to production acceptance/approval.
  [Readiness decision](docs/audits/WebSearch/2026-10-21/R1A_PRODUCTION_READINESS_AND_CLAUDE_DECISION_2026-10-21.md).
  PDF attribution/retention checks are now closed: deterministic source-bearing
  appendices, clickable native PDF citations and historical downloads after run
  deletion are verified without paid calls. Final genuine browser acceptance
  remains a pre-activation gate. Recovery confirmation and owner publishing are
  complete; live artifact/schema parity is verified with native search OFF.
  The owner approved a fresh shared $50 production ceiling and conditional
  joint activation. Durable isolated controls are implemented and verified
  offline; the private-pilot configuration is staged with public approvals
  empty. The next owner Publish adds one bounded budget table only, preserving
  existing constraints and production data. Both-provider production validation,
  final genuine browser acceptance and activation remain pending.
  [Publish gate](docs/audits/WebSearch/2026-10-21/R1A_REPORT_VERIFICATION_AND_PUBLISH_GATE_2026-10-21.md).
  Owner-authenticated
  production inspection, user publishing and activation remain separate gates.
  See [latest readiness checkpoint](docs/audits/WebSearch/2026-10-20/R1A_RELEASE_READINESS_2026-10-20.md).
- **R1B — Gemini readiness:** obtain applicable written rights for analytical
  use, retained attribution and reporting; resolve exact model routing,
  Search Suggestions rendering and retention/deletion before allowing live
  grounded calls. Fixtures are not live support.
- **R1.1 — Measured reliability and budgets:** use approved pilot telemetry to
  tune deadlines, concurrency and retry budgets; add operational search/cost
  observability without introducing source-authority scoring or changing
  diagnostic score semantics.
- **Existing typecheck debt:** 91 baseline diagnostics, reduced to 75 during
  narrowly related integration repairs. The repository-wide check is not green;
  do not describe the remaining failures as native-search validation success.

Detailed gates, recovery limits and follow-on acceptance:
[R1A implementation checkpoint](docs/audits/WebSearch/2026-10-20/R1A_IMPLEMENTATION_AND_RELEASE_CHECKPOINT_2026-10-20.md).

## AI model lifecycle follow-ups (Tasks #67 / #73 / #77 / #78 / #79)

- **#80 — Honor the vendor pause switch for background AI work too.**
  Task #78 enforces vendor pause across every internal LLM call site
  it could find, but a periodic sweep (or a centralized provider-call
  registry) would prove no future call site can sneak past
  `assertVendorNotPaused()`.
- **#81 — Atomic disable cascade.** Task #79 cancels in-flight items,
  error-wraps runs, sweeps client selections, and writes audit rows in
  separate transactions. A partial failure (e.g. DB connection drop
  between phases 2 and 3) can leave the system half-disabled. Wrap
  all four phases in a single transaction.
- **#82 — Show project members the disable reason on the next-visit
  banner.** The banner currently includes the reason but only as
  inline text. A small visual treatment (icon + de-emphasized "Reason:"
  label) would make scanning easier for users with multiple
  project-banners.

## Admin queue follow-ups (Task #121)

- ~~**#121a — Replace the Halt `window.confirm` with an AlertDialog.**~~
  **Resolved by Task #131.** The Halt action (and the revoke-current-session
  prompt) now use the app's Radix `AlertDialog` with controlled state and
  stable `data-testid`s, matching the rest of the admin module.
- **#121b — Surface admin Halt to the user whose work was killed.**
  When an admin halts a running prompt-run, the run row flips to
  `error` with `errorSummary = "Run halted by admin disable"` (or
  similar). The user who started the run gets no in-app
  notification — they only see the failed state next time they
  open the Prompts Tracker. Mirror the per-user banner pattern
  Task #79 introduced for model disables.

## Dev workflow follow-ups (Task #121 follow-up)

- **#121c — Switch the dev script to `tsx watch`.** The Task #121
  follow-up ISSUE_LOG entry documents how the dev workflow's plain
  `tsx server/index.ts` (no watch) caused a transient HTML-instead-of-JSON
  error on the new admin Running jobs card because Vite hot-reloaded
  the frontend before the server was restarted. Switching to
  `tsx watch server/index.ts` (or `nodemon`-style) would eliminate
  the entire class of "frontend HMR raced ahead of the server"
  bugs. Trade-off: server restarts on every save make in-flight
  long jobs (Site X-Ray batches, executive report generation) more
  fragile in dev. Could be guarded behind a `DEV_WATCH=1` opt-in.
- **#121d — Surface non-JSON 2xx responses in the queryClient.**
  When the Vite SPA fallback serves `<!doctype html>` to a fetch
  expecting JSON, the user sees the raw `Unexpected token '<'`
  parse error. Add a Content-Type sniff in `getQueryFn` so a
  non-JSON 2xx response surfaces a friendly "Server is restarting
  — please refresh" toast / inline notice instead.

## Prompts Tracker follow-ups (Task #107)

- **#107b — Make `(iteration N)` increment fully atomic.** Task
  #107 computes the next N server-side by scanning existing runs
  before insert, which is much tighter than a browser-derived
  counter but still allows two truly simultaneous reruns to land
  on the same N. Wrap the scan + insert in a DB transaction or
  add a unique constraint on `(client_id, name)` with a small
  retry loop, so the guarantee is hard.
- **#107a — Add a real `parent_run_id` column for prompt-run lineage.**
  Task #107 inferred rerun lineage purely from the
  `<base> (iteration N)` name pattern in `prompt_runs.name`, so a
  user renaming a run breaks the chain. A proper `parent_run_id`
  foreign key on `prompt_runs` (set when `iterationOf` is supplied
  to `POST /api/v1/prompt-runs`) would survive renames and unlock
  proper rerun-of/-by graph queries plus an explicit "rerun of …"
  link in the UI. Schema migration + backfill (best-effort name
  match for existing rows) + small read-side surface change.
- **#109 — Side-by-side iteration comparison view.** Now that runs
  can carry an `(iteration N)` suffix and share a stripped base
  name, build a Compare view that groups every run sharing the same
  base for a project and shows per-prompt visibility / sentiment /
  position deltas across iterations. Already filed as project task
  #109.

## Active operations & job-queue follow-ups (Tasks #56 / #58 / #59)

- **#60 — Wire X-Ray batch worker → `recommendations` rows.** Task #58
  added the `xray_analysis` worker but it only writes
  `xray_page_analysis`. The richer `recommendations` rows are still
  produced only by `generateMetadata({ enableSiteXRay: true })`. Wire
  the same fan-out from `processXRayAnalysis` so an isolated batch
  re-analysis fully refreshes the recommendations table.
- **#62 — Catch stuck prompt runs without a server restart.** Task #59
  reaps zombie `prompt_runs` only at boot. A periodic in-process sweep
  (e.g. every 10 min, behind a feature flag) plus a real `heartbeat_at`
  column on `prompt_runs` would let us detect and recover from
  mid-run crashes that don't take the workflow down.
- **#65 — Test that cancelling an X-Ray analysis really stops it
  mid-batch.** Task #63 ships the cancel button; an automated test
  would prove `processXRayAnalysis` checks the cancel signal between
  batches and never writes a partial result after cancellation.

## Session / auth follow-ups (Tasks #37, #42)

- **e2e regression test for the URL-driven selection contract.** Tracked
  as Task #54 in Drafts. Cover: deep-link with `?clientId=`, fresh-tab
  open of a sidebar item, the empty-state path when neither URL nor
  store carries a `clientId`, the same-tab `selected-client-changed`
  custom event, and the cross-tab native `storage` event (which is
  what propagates a `localStorage` write to other open tabs).
- **Carry `?clientId=` through the top-nav dropdown and client-catalog
  "Open" button.** Today only sidebar `Link`s append `?clientId=`. The
  top-navigation user dropdown (`top-navigation.tsx`) and the
  client-catalog "Open" button (`client-catalog.tsx:313–315`) navigate
  via `setLocation()` + `setSelectedClientId()` without a URL query —
  same-tab works, but middle-click / open-in-new-tab on those surfaces
  silently drops the selection.
- **Extend `auth-rate-limit` middleware to `/auth/sessions/*`.** Today
  only `/auth/login`, `/auth/register`, and `/auth/forgot-password` are
  throttled. Revoking sessions in a tight loop is not currently capped.
- **Org switcher in the UI.** The data model already supports many-to-many
  org memberships and the selection is now URL-driven (Task #52), so the
  client-side seam is the only thing missing. Small product question:
  do we surface the switcher in the user dropdown or as a separate page?

## LLM uplift follow-ups (Task #38)

- **Wire `topics` and `prompts` LLM_FUNCTIONS keys.** Both are reserved
  defaults today and currently fall back to the `metadata` call paths in
  `server/openai-service.ts`. When the topic-extraction and prompt-generation
  flows are split out of the metadata pipeline, switch them to
  `LLM_FUNCTIONS.topics` / `LLM_FUNCTIONS.prompts`.
- **Per-tenant model overrides.** `LLM_FUNCTIONS` is process-global,
  and the new admin function-override picker (Task #77) is global too.
  A per-org override map would let enterprise tenants pin specific
  model IDs.
- ~~**Surface model categories in admin UI.**~~ Done by Task #39.
- ~~**Schema migration for `enabled = false` audit trail.**~~ Done by
  Task #79 (`disabled_at` / `disabled_by_user_id` / `disabled_reason`).

## Executive Report pipeline follow-ups (Tasks #104 / #105)

- **#106 — Hard concurrency lock on duplicate report generations.**
  Task #105 moved report generation onto the `JobQueue`, but two
  users on the same project clicking Generate within seconds will
  still result in two `report_generation` jobs running back-to-back
  (the queue serializes them but doesn't dedupe). The
  active-operations banner warns the user, and per-project
  serialization keeps Chromium spawns sane, but each run still
  bills the LLM. Add a server-side guard that rejects or coalesces
  a second request for the same `(clientId, runIds)` while a job
  is in flight.
- **#107 — Stamp `snapshotId` onto the queue payload before
  enqueue (or create the snapshot pre-enqueue).** Today the
  processor inserts the snapshot inside the worker and the queue
  payload's `snapshotId` is filled in on the first progress event.
  A crash between enqueue and that first progress event leaves the
  job with no `payload.snapshotId` for `failLinkedReportRows` to
  cascade against. The >15min stale-queued sweep covers it in
  practice but the window is sloppy.
- **#108 — Remove circular-ish `jobQueue` import in
  `server/routes/reports.ts`.** Currently imports from
  `../routes` instead of `./_shared`. Works today but is fragile
  to a future refactor of the routes barrel file.
- **#109 — Persist Step 3 summaries incrementally during the batch,
  not only at the end.** Task #105 R2 best-effort writes
  `answers.summary` after the whole Step 3 batch completes. A
  failure mid-batch (vendor pause partway through, container OOM
  on a giant project) still loses all the summary work for that
  attempt. Flushing per-chunk (or per-N completions) would tighten
  the cost-recovery window further.

## Onboarding wizard follow-ups (Tasks #132 / #133)

- **#134 — Hard-guarantee that re-running setup never creates a duplicate
  project.** Task #133's resume mode already routes "Complete Setup" to a
  PUT on the same project and disables Step 1's create path while
  hydrating (`isHydratingResume`), so the common cases are covered. A
  belt-and-braces follow-up would make the no-duplicate guarantee
  structural rather than UI-state-dependent — e.g. resume mode should
  carry the `existingClientId` through the final mutation so even a
  mis-fired Step 1 can't reach the POST create path, plus a server-side
  idempotency check on rapid double-submits.
- **#135 — Make "an admin can never lock themselves out of admin"
  structural.** Task #130 blocks a user changing their **own** role and
  preserves the last-admin guard, which removes the known footgun. This
  follow-up generalizes the invariant: cover every path that could strip
  the last reachable admin (org-membership removal, account disable,
  bulk operations) with a single enforced "org must always retain at
  least one active admin who is not the caller demoting themselves" rule,
  and add a regression test so it can't silently regress. Overlaps with
  and extends #130.

## Other

- Browserslist database is 19 months old (boot warning). Run
  `npx update-browserslist-db@latest`.
