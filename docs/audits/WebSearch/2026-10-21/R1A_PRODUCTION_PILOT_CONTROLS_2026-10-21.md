# R1A production pilot: approval, controls and next Publish

## Approval and remaining gate

The owner approved a **fresh shared production allowance of up to $50**, OpenAI
then Claude, with joint activation **only after all release checks pass**.
This is separate from the closed development allowance. No production paid
generation has been submitted as part of preparing these controls.

This candidate is **not the completed release**. Publish the controlled private
pilot first; the already-published candidate has Web Search OFF. The next Publish
adds a durable budget table and the controls below, while public eligibility
remains closed. Publish must preserve production data: **do not overwrite it with
development data**.

## Scope and limits

- One new isolated internal organization, temporary administrator, Firefox
  project and fixed single prompt. No customer project is modified.
- The temporary account uses the existing `SAMPLE_USER_PASSWORD` secret through
  normal application bootstrap. No password is copied into code, documentation,
  configuration JSON, responses or logs. Its email/IDs are generated in ignored
  private release scope; its session epoch is advanced and access disabled on
  activation, close or expiry.
- Six single-prompt runs, in order: OpenAI ON, inherited rerun ON, OFF; Claude
  ON, inherited rerun ON, OFF. Exact catalog models are `gpt-5.6-terra` and
  `claude-sonnet-5`. Gemini is not enabled.
- The one-hour window starts when the published application first initializes
  the durable approval. Neither restart nor operator/run deletion refills it.
  Operator writes outside Prompt Run create/control and the narrow release
  operations are denied. Worker admission checks the exact operator, project,
  prompt text, selected model, predecessor completion and order.
- Operator HTTP handlers also inherit a non-admitted sentinel context: an
  accidental generating GET/helper cannot bypass accounting. Only an approved
  worker can replace that sentinel with its admitted run identity.
  Non-Prompt-Run jobs from that operator/project are rejected; unrelated jobs
  start outside the caller's async scope so the pilot cannot block customer work.
- All pilot-scoped native/legacy primary calls, scoring, recommendations,
  drafts and provider SDK retries share one budget. No paid narrative reports.
  Other production traffic is **not** charged against or limited by this
  validation allowance. Public Web Search use after activation incurs normal
  provider charges; it does not inherit the pilot's $50 lifetime cap.

## Accounting and failure behavior

The database stores reservations **before** provider dispatch under a row lock.
No database lock is held across network I/O. The transport settles verified
token usage with conservative unit-rate bounds and retained search allowances.
These are conservative accounting estimates, not invoice reconciliation.

Unpriced models, unexpected primary provider/mode, streaming, tools beyond the
approved search tools, unbounded requests, unknown usage/tier, rejected or
uncertain provider outcomes, expired/revoked scope and failed persistence stop
the pilot. Unknown outcomes retain the full reservation. A process restart with
an unresolved reservation latches the stop; no automatic refill, retry or
replacement approval is created. A process-instance check closes the
startup/worker race. This temporary pilot is scoped to the current single
production VM, not an autoscaling multi-instance rollout.

The production launcher installs the transport before dynamically loading the
application/SDKs. ESM splitting preserves that ordering and shares the same
async context/store; flattening the launcher and app into one bundle can hoist
SDK imports too early. Normal SDK parameters/model selection are not rewritten,
apart from the already-approved default/standard service-tier pin.

## Prompt and verification

The isolated prompt is:

> Check Mozilla's official release notes. What is the current stable Firefox
> version and release date at the time of your answer? Answer in English. Start
> your answer with the literal marker "🧭 " exactly once, so citation positions
> can be checked. Finish with a short Sources section listing the literal
> official URLs. Do not invent facts or citations.

The non-BMP prefix intentionally differs from the earlier no-emoji development
prompt to exercise production Unicode attribution. No date, domain filter,
forced search, temperature, reasoning or model substitution is introduced.
Claude's accepted freshness limitation remains documented; a quality miss is
not relabelled a pass.

Production evidence must establish completed core runs and ready deliverables,
canonical native answers, retained valid evidence, actual model identity,
positive invocation and cited sources for each provider, correct OpenAI Unicode
positions, and metered downstream execution. OFF controls must have no native
search requests. The real browser pass must cover ordinary sign-in,
Start Run/rerun inheritance, selected models and ON/OFF state, Answer Details
citations/consulted sources, permissions, and the retained report/export evidence
without starting a paid narrative report.

The narrow activation operation rejects incomplete or unsettled matrices and
requires the final real-browser audit reference. It derives **new production**
approvals from actual production evidence, never copies development approvals,
activates both providers together, and atomically revokes the operator.
Persisted activation survives clean restarts; environment kill flags remain
authoritative.

## Unpaid verification completed

- Final complete native-search suite: **75/75 passed** in one combined run after
  the fixture, schema and async-scope fixes, including the eight new production
  safety tests. Earlier partial attempts are superseded by this final result.
- Final focused production-controls suite: **8/8 passed** using disposable local
  PostgreSQL and synthetic HTTP, including real SDK transport inheritance,
  concurrent ceiling enforcement, SDK retry/uncertainty retention, restart/hash guards,
  expiry/revocation, scope fencing and successful joint activation persistence.
  These are **not** live production or browser results.
- Typecheck: **75 documented baseline diagnostics**, no new diagnostics in the
  changed production controls. The accepted baseline exception remains in
  effect; this is not a clean typecheck.
- Production build passed. The compiled launcher's static dependency graph has
  no provider SDK imports and installs the guard before dynamic app import.
- Development schema applied through the normal development flow; production
  schema changes must occur through the owner's Publish action, never direct
  DDL or startup schema repair.
- Final managed Publish preview adds **one budget table with its size check**;
  no table/column removals, structural data loss, compatibility flags or
  warnings. Existing native-search checks and foreign-key names are preserved.

## Release-only operations

Production-only private-pilot configuration has been staged with empty public
approval/cohort arrays; it requires the next Publish. No production data has
been overwritten or modified directly during this preparation.

The ignored private scope is under
`generated-artifacts/web-search-r1a-production/`. The release helper
`scripts/web-search-production-pilot.ts` supports `login`, `status`, `activate`
and `close` only. It does not start Prompt Runs or call provider APIs. It uses
real cookie/CSRF authentication, refuses development origins and redirects, and
does not print credentials. Activation also requires an existing browser-audit
file in the workspace. Session cookies are stored with owner-only permissions
in the system temporary directory, outside preview-served/deployed workspace
files, and removed after close/activation.

After Publish: verify the production table/approval/operator initialization,
run the single genuine browser acceptance pass and approved paid matrix, archive
the exact responses/evidence/accounting, activate only after all gates pass,
then observe the enabled eligibility and operator revocation without generating
unbudgeted test traffic.
