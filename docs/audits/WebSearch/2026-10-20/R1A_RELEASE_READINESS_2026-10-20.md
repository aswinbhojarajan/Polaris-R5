# Prompt Runs Web Search — R1A release readiness

**Date:** 2026-10-20  
**Status:** OpenAI and Claude development integration matrix completed; Claude freshness failed. Production release remains pending.

**Production follow-up:** [Read-only readiness and Claude recommendation](../2026-10-21/R1A_PRODUCTION_READINESS_AND_CLAUDE_DECISION_2026-10-21.md):
the live service is healthy but pre-R1A; eight additive Publish statements are
pending. Both providers remain the release scope. Recommend conditional Claude
GO with the quality limitation recorded, not an OpenAI-only release.

This supplements, rather than replaces, the historical
[implementation checkpoint](R1A_IMPLEMENTATION_AND_RELEASE_CHECKPOINT_2026-10-20.md).
It is not evidence that R1A is published, publicly enabled or fully live-validated.

**Latest paid checkpoint:** the owner approved continuation under a $49.56
additional allowance after the original $0.430336 stop. Eight continuation runs
and ten diagnostics completed, with native attribution, scoring, recommendations
and drafts ready. Combined conservative debit: $7.149218; zero unsettled
requests. Claude's current-fact probe and inherited rerun selected an outdated
version, so technical integration passes but freshness does not. Temporary
settings were removed and both operators disabled. See
[paid results and remaining release gates](../2026-10-21/R1A_PAID_VALIDATION_RESULTS_2026-10-21.md).
The [original safety-stop checkpoint](R1A_LIVE_PILOT_CHECKPOINT_2026-10-20.md)
and unpaid evidence below remain historical, not production approval.

## Verified in this pass

| Area | Evidence and limits |
| --- | --- |
| Unpaid suite | `npm run test:native-search`: **55 passed, zero failures or skips**. Original parser, admission, persistence, fencing, scoring-invariance and recovery tests remain included. |
| Authentication | Real Argon2 passwords, Passport login, cookies, `/auth/me`, CSRF and actual registered API routes; no authentication bypass. Test-mode sessions use the application's memory store, not a proof of production PostgreSQL session persistence across restarts. |
| Authorization | Anonymous and missing-CSRF denials; viewer/member/admin admission restrictions; cross-tenant prompt, item and evidence checks; forged actor/configuration fields cannot grant cohort eligibility. |
| Resource-bound writes | Patch, recalculate, delete, stop, pause and resume check the role for the run's actual project. A viewer there cannot borrow a member role from another selected project through header/body hints. Authenticated regression cases cover all six routes. |
| Actual queue | Search-ON creation, saved native generation, canonical scoring/finalization, attributed evidence, inherited ON rerun, explicit OFF and legacy omission use actual queue/executor/storage modules. Only provider transports and downstream recommendation/draft generators are synthetic. This is not live LLM output-quality validation. |
| Controls | Actual pause aborts an in-flight synthetic native HTTP request. Resume refuses an indeterminate paid replay. Actual membership revocation aborts generation; existing deterministic tests also cover cancel, halt, fencing and retained-generation recovery. |
| Durable allowance | Deleting a run removes its evidence but does not refund consumed cohort items. Exhausted cumulative allowance rejects admission before further dispatch. |
| Exports | Actual database snapshot aggregation and CSV/JSON generators retain raw canonical prose separately from native provenance, emit attributed display text and reject invalid citation ranges. Full report-job/PDF generation and historical report retrieval/deletion are not newly end-to-end verified by this pass. |
| Build | `npm run build` passes; existing large-bundle warnings remain. |
| Typecheck | `npm run check` remains red at **75 diagnostics**, versus the accepted candidate's 76. No increased file/error-code counts; the undeclared OpenAPI error-handler `next` was fixed. This is not a green repository typecheck or a claim that all remaining errors are harmless. |
| Application | Main workflow restarted once after the code batch. Clean startup, `/health/live` responds alive, and the public login screen renders. Its unauthenticated `/auth/me` 401 is expected; this screenshot is not authenticated browser-journey evidence. |

### Isolation

The runner starts and destroys a private PostgreSQL cluster on loopback port
55432, refuses an existing server there, and explicitly targets only its
generated database URL. Full schema push is used **only on that fresh disposable
cluster**, never the application's development or production database.
Provider/bootstrap/GitHub/session credentials are removed from test children.
Fixture authentication credentials are generated in-process and not printed.
The test-only native PostgreSQL bridge does not change the application's Neon
database driver or introduce an application database migration.

## Readiness fixes

1. Scoped validation cohorts can supply reported-model aliases and verified
   OpenAI citation offset units without inventing a public validation approval.
   Execution uses those parsing policies only for a currently eligible actor.
   Tenant/operator/account/environment, expiry, role, item ceiling, reservation,
   dispatch and lease checks remain required. Public eligibility remains
   unverified in regression tests.
2. Prompt Run resource-write authorization now resolves the authoritative
   project from the stored run, instead of accepting the selected-project hint
   as proof of the required write role.
3. The OpenAPI error path can pass errors to the next handler instead of
   referencing an undeclared variable.

Approved UI remains unchanged; no new Canvas approval is needed for these
server-side fixes.

## Non-generating model/account preflight

Read-only development catalog inspection found both original candidates enabled
and not internal-only. Two non-generating provider metadata requests returned:

| Provider | Exact requested model | Metadata result | What it does not prove |
| --- | --- | --- | --- |
| OpenAI | `gpt-5.6-terra` | HTTP 200; reported ID matches | Responses execution, native invocation, live offset units, usage or attribution |
| Anthropic | `claude-sonnet-5` | HTTP 200; reported ID matches; server-tool search capability true | Execution with the specific basic `web_search_20250305` tool, continuation, live citations or usage |

No diagnostic generation, paid search, live scoring, live recommendation/draft
generation or paid report generation was requested. Metadata access is not
search-validation approval. No model substitution was made.

The development master/OpenAI/Claude search enablement variables are absent,
so their fail-closed defaults remain in force. No deployment or environment
configuration was changed. Production flags and account mapping are unverified.

## Paid pilot: planning packet, not authorization

Order remains **OpenAI first, Claude second**. Gemini stays independently blocked.
The proposed full matrix remains:

| Per provider | Selection | Runs / diagnostic generations |
| --- | --- | --- |
| Core cases | Current-fact, branded and comparative prompts, ON | One run / three generations |
| Paired case | Identical selection/prompt, ON then OFF | Two runs / two generations |

Across both providers this is **six runs, eight ON and two OFF generations**.
It is not ten total HTTP calls. With current finalization, six successful runs
can also create six recommendation sets and up to eighteen drafts, in addition
to extraction/scoring, competitor processing and response analysis. Report jobs
must be expressly included and priced, or excluded from the pilot; they must
not be started as an unbudgeted verification step.

Before requesting paid authorization:

- Agree the whole-pipeline USD budget, then size the matrix to it.
- Freeze the actual controlled-project prompts, competitor count, metadata,
  operator/tenant, exact model/tool/account/environment and effective internal
  model settings. Resolve current DB overrides; boot defaults are insufficient.
- Include native retrieval tokens, selected-model tokens, all internal calls,
  repair/SDK/vendor retries and unknown outcomes in the cost bound.
- Preserve the 180-second native item deadline, maximum two retries and Claude
  five-use whole-item search allowance. Do not silently change scoring to make
  a cost estimate smaller.
- Define expiry, unique approval references, cumulative ON item reservations
  and separate operator accounting for OFF/downstream/report charges.
- If a conservative bound cannot fit, reduce/review the scope or add minimum
  pilot enforcement before asking to spend. `spendCeilingUsd` is metadata,
  **not an automatic billing cutoff**. Do not promise it as a hard cap.
- Stop on identity/attribution errors, uncertain usage, unexpected billable
  activity, eligibility drift or insufficient remaining budget. A valid
  not-invoked answer does not justify unapproved reruns to force invocation.

### Pricing inputs checked on 2026-10-20

- [OpenAI Terra model card](https://developers.openai.com/api/docs/models/gpt-5.6-terra):
  $2 input / $12 output per million text tokens; prompts over 272K input tokens
  have higher full-request rates. This matters when bounding search context.
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing):
  standard web search $10/1,000 calls **plus search-content tokens** at model
  rates. Request/output deadlines alone do not establish a USD cap.
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing):
  Sonnet 5 standard $2 input / $10 output per million tokens; search
  $10/1,000 searches plus search-generated input tokens.

These are unit prices, **not a completed whole-pipeline estimate**. Pricing,
effective internal model choices, retry exposure and included report work must
be rechecked for the final approved manifest. A budget-planning response alone
does not authorize provider calls.

## Production: explicit hold

The read-only production database callback refused this execution with
“Production database access requires an authenticated user.” No credential
workaround or production connection was attempted. Production schema/catalog/
configuration parity therefore remains unknown.

Before production work:

1. Obtain owner-authenticated read-only inspection of the actual deployed
   artifact and its intended database. Confirm managed versus external database
   provenance; the Neon driver alone does not establish which it is.
2. Review the additive schema change and recovery plan, with separate owner
   approval. For **Replit-managed PostgreSQL**, let the user review/apply the
   schema diff through Publish; do not manually run production DDL or add deploy/
   startup migration automation. For an **external** application database, use
   its confirmed existing workflow only with explicit authorization.
3. Have the user publish compatible code with public search still closed.
4. Obtain separate production-scoped pilot/configuration/spend approval, verify
   actual production combinations, then narrowly activate OpenAI before Claude.
5. Use an agreed finite launch observation window and disable/drain procedure.
   Never discard evidence or replay an uncertain paid request as a rollback.

The earlier plan's generic “apply the additive upgrade before publishing” wording
is conditional on the confirmed database ownership/workflow, not permission to
bypass the managed Publish migration process.

## Remaining milestones

Development pilot approval/execution and read-only production inspection are
complete; they are not remaining work. The latest
[report verification and Publish gate](../2026-10-21/R1A_REPORT_VERIFICATION_AND_PUBLISH_GATE_2026-10-21.md)
also closes actual PDF attribution and retained-download checks.

1. Owner confirmed production recovery availability and approved OFF-only staged
   publishing. No independent recovery-window inspection is claimed.
2. Owner publishing is complete: live candidate/UI asset and production schema
   parity are verified; native configuration remains absent/OFF.
3. Obtain separately bounded production validation/configuration/spend approval.
4. Validate both providers and complete the final genuine browser acceptance.
5. Explicit joint activation, launch observation and final release closure.

**The complete R1A release remains in progress.** Neither this checkpoint nor
the previously accepted baseline typecheck exception authorizes spending,
production changes, publishing or activation.
