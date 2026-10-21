# R1A restored candidate — 2026-10-21

## Status

**Published omission repaired; genuine signed-in production control checks now
pass. Core R1A user controls and effective OpenAI/Claude eligibility are verified.
Residual production evidence/report UI coverage is explicitly limited below.**

### Final signed-in acceptance

The owner supplied a separate verification secret. Because the tester notebook
cannot consume environment secrets, a local Playwright process used it directly
at runtime against the production URL, without returning its value to chat,
writing session state, or capturing populated login fields. This was the first
successful authenticated browser pass, not a repeat of already-passed UI checks.

- Normal login form submission succeeded; authenticated `/api/v1/auth/me` passed.
- Effective `/api/v1/ai-models` reports `eligible: true`, reason `validated`, for
  both `gpt-5.6-terra` and `claude-sonnet-5`.
- Actual Start Prompt Run dialog: OFF by default; each approved provider permits
  starting with search ON; unsupported selection blocks starting and shows a
  warning; OFF restores ordinary selection.
- Start was never clicked. No generation/report/rerun/provider work was requested.
- Verification session logout returned HTTP 200.
- Non-secret result and screenshot retained under the ignored
  `generated-artifacts/r1a-live-check/` directory.
- This account's 55 visible projects had no native-search runs in the inspected
  newest-100-per-project pages. Four existing reports were listed, but no report
  download was verified. Native answer/rerun UI was not exercised in this pass.
- Fresh production read-only SQL confirms four historical ON runs remain `done`
  with deliverables `ready` and one execution-evidence row each. Those belong to
  the isolated pilot project, not the projects visible in this session.
- A supplemental API-only attempt did not establish a verified session; no
  additional report/native API coverage is claimed from that attempt.

The published-control defect is closed. Live native-answer/rerun/report UI
coverage remains a follow-up limitation, supported meanwhile by the existing
production pilot evidence and the fresh 75-test offline suite. Typecheck debt and
Claude freshness remain the owner's accepted exceptions. Gemini remains disabled.

### Post-publish verification, 05:39 UTC

- Production `/health/live`: HTTP 200.
- Served `/release-build.json`: build
  `24e1e0039caa2214d420d43185e710da11aca8553b06cfdc1944893ced531363`,
  built at `2026-10-21T05:22:04.227Z`.
- Actual HTML references `/assets/index-B747PyT8.js`; fetched JS contains
  `checkbox-enable-web-search`, `webSearchEnabled`, and `search-evidence`.
  The former published omission is no longer observed.
- Fresh owner-authenticated schema check: no diff, no statements, no warnings.
- Fresh production read-only query: phase `active`, two exact provider approvals
  (`gpt-5.6-terra`, `claude-sonnet-5`), six cases, stop `PILOT_COMPLETE`;
  conservative accounted USD 3.137806; pilot operator disabled.
- One production browser pass reached the empty login screen. No existing
  authorized session or safe secret injection path was available. Authenticated
  catalog eligibility, ON/OFF UI, unsupported-model blocking, existing native
  answers/rerun previews and report downloads remain **unverified**.
- No new paid calls, account changes, budget changes or database mutations.

The earlier observations below remain provenance, not current publishing state.

### Authentication follow-up

The existing tester confirmed its browser notebook has no environment-secret
input bridge. A single normal API login using the existing bootstrap secret
(consumed directly at runtime, never printed or saved) returned HTTP 401.
No authenticated session was established and no credential retries or account
resets were attempted. Bootstrap credentials therefore cannot currently establish
the required production test session; the reason for rejection is not inferred.
An owner-designated current production test account is needed before continuing.

## Provenance and scope

- Starting workspace HEAD: `be04651`, owner restoration to `eeea27f`.
  Tracked tree matched that checkpoint at inspection.
- `git diff 29c65dd HEAD -- client server shared` is empty: restored application
  code matches the preserved completed R1A implementation. No application
  re-integration, rollback, migration, UI redesign or score changes were necessary.
- One historical helper difference remains: the restored
  `scripts/web-search-production-pilot.ts` login probe does not tolerate anonymous
  HTTP 401 as the later helper did. This is not a production server dependency.
  Do not use that helper to reopen the closed pilot. A future approved pilot
  would need its own reviewed tooling and fresh bounded approval.
- Changes here: compiled-release omission guard, its tests, package build command,
  and documentation. Existing approved UI is unchanged; no new Canvas review
  is required for this build-only change.

## Current verification

| Check | Result / boundary |
|---|---|
| `npm run test:native-search` | 75 passed, 0 failed/skipped; fresh run, private temporary PostgreSQL, provider credentials removed |
| `npm run test:release-build` | 5 passed: complete build, omitted UI/backend, stale HTML, disconnected backend chunk |
| `npm run build` | Pass, including emitted frontend/backend omission guard |
| `npm run check` | Fails with 75 diagnostics; existing exception still needed, not a clean typecheck |
| Production metadata | Published public VM; successful build; primary URL `https://polaris-r5.ignitelabs.online` |
| Public served JS at 05:17:54 UTC | `/assets/index-BLJ1M47X.js`, HTTP 200, missing control/config/evidence markers |
| Fresh production SQL / schema diff | Blocked: production database access requires authenticated user |

Native regression coverage includes real cookie/CSRF authorization, viewer/member/
admin and cross-tenant rejection, ON/OFF and legacy omission, saved rerun choice,
canonical evidence and scoring, pause/resume without replaying indeterminate paid
work, membership revocation, budget persistence/restart/expiry, and actual Chromium
PDF attribution plus authenticated retained downloads after source-run deletion.
These use isolated fixtures; they are not new real-provider or published-browser tests.

Current local compiled candidate:

- Frontend asset: `/assets/index-DFf5Epwq.js`
- Build identity: `b03a9843de0e2d65c7b11cea5ab449209f7a62e417bd1149279bf38a2151073d`
- Built at `2026-10-21T05:17:44.618Z`
- `/release-build.json` is emitted during build, contains no credentials,
  and explicitly labels its verification `compiled-presence-only`.
- Guard follows Vite's entry/import graph and esbuild's production-entry output
  graph. Unreferenced stale files cannot satisfy it. It does not prove provider
  eligibility, successful runtime startup or functional acceptance.
- Rebuilding may produce a different fingerprint; inspect the actual publish
  output and served assets rather than treating this identifier as immutable.

## Preserved production history, not fresh access

The earlier owner-authenticated inspection recorded active OpenAI and Claude
approvals, six completed cases, `PILOT_COMPLETE`, no unsettled reservations and
USD 3.137806 conservative accounted spend. Earlier schema parity was clean.
Those observations were not refreshed in this assigned execution because access
was denied. No credentials were extracted to work around that denial.

The historical browser acceptance is available in Git at
`29c65dd:docs/audits/WebSearch/2026-10-21/R1A_PRODUCTION_BROWSER_ACCEPTANCE_2026-10-21.md`.
It documented limitations: normal password-form login was not verified,
production report downloads were not exercised, and the default organization
selection caused catalog/background access issues. The private test suite verifies
report behavior, not these production acceptance gaps.

## Required before closing the production repair

1. Owner-authenticated read-only schema/approval/budget inspection. Preserve
   existing validated approvals, stopped spending ledger and disabled operator.
   Do not recreate them. Investigate any unexpected schema preview before Publish.
2. Owner-controlled Publish of this checked candidate using the configured
   build/start commands. No automatic publishing is performed by this task.
3. Verify production health, `/release-build.json`, its referenced served JS,
   and the authenticated model eligibility response. Bundle presence alone is
   not backend verification.
4. One genuine authorized browser pass: normal login without logging credentials,
   Start Prompt Run OFF default, ON control, approved OpenAI/Claude eligibility,
   unsupported-model message/start blocking, and OFF allowing ordinary selection.
   Inspect existing source-bearing answers, rerun-choice preview and existing
   report downloads where available; do not submit new billable runs/reports.
5. If production report data or safe access is unavailable, record that gate as
   blocked rather than fabricating evidence. Any new provider-based validation
   needs a fresh bounded approval; historical USD 50 allowances remain closed.

Claude freshness limitation remains accepted. Gemini remains outside R1A.
