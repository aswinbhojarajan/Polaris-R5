# R1A live pilot — first OpenAI probe and safety stop

**Historical checkpoint:** the owner subsequently approved continuation. See
[completed development matrix and freshness finding](../2026-10-21/R1A_PAID_VALIDATION_RESULTS_2026-10-21.md)
for the current status. The initial stopped ledger and accounting below remain
unchanged; this document is not the latest release decision.

**Date:** 2026-10-20 (UTC)  
**Status:** partial native-search success; whole-pipeline validation paused.
**Release:** not complete; not production activated.

## Authorization and actual scope

The owner approved OpenAI, then Claude, under one shared USD 50 allowance.
The development-only pilot used a new isolated organization, project and
operator, public Mozilla Firefox / Google Chrome test content, real Argon2
login, CSRF, and the actual managed application queue. No customer project or
credentials were changed. Production was not inspected, mutated or published.

Only the initial one-item OpenAI current-fact probe ran. Neither its remaining
core/paired/OFF cases nor any Claude case was admitted. Gemini remains blocked
and outside R1A paid scope.

## What the first probe actually proved

- Native Responses generation reported `gpt-5.6-terra`; search was `invoked`.
- Four tool calls and two searches were reported. Canonical evidence retained
  29 sources and one span-associated citation.
- Usage: 30,772 input tokens, 611 output tokens, 31,383 total tokens.
- The saved answer identifies Firefox 158.0.1, release date October 20, 2026,
  with the official release-notes URL:
  `https://www.firefox.com/en-US/firefox/158.0.1/releasenotes/`.
- A separate read-only fetch of that official page confirmed the version and
  first-offered date. JSON export retained the complete native evidence
  unchanged; the response CSV retained the reported model and cited native URL.
  The stored citation span is within the saved answer's bounds.
- Authenticated evidence retrieval and native answer persistence worked. The
  genuine operator cookie created before the guarded workflow restart remained
  valid afterward, exercising development PostgreSQL session persistence.
- Actual snapshot, CSV and JSON export paths were exercised without additional
  provider calls. This is a provenance/export check, not a healthy-scoring or
  full PDF/report validation claim.

One successful response does not establish the full live matrix, historical
report behavior, Unicode offset behavior for astral characters, browser review,
Claude behavior, public model approval or production parity.

## Why this is not an end-to-end pass

The original pilot guard required every generation request to explicitly
declare an output limit no larger than 8K. An existing downstream request
omitted that limit. The guard latched `UNBOUNDED_OUTPUT` **before dispatch**.
No further provider dispatch occurred.

Some existing scorers fall back after SDK connection errors, so the run still
reached core status `done` and the native execution phase reached `scored`.
Recommendations and drafts were `needs_attention`. Those statuses and any
fallback scores **must not be counted as a successful pilot**. The initial
guard ledger does not identify the exact first rejected logical call; do not
infer it from later retry/fallback stack traces.

Separately, the evidence controller initially treated the JSON exporter's
object result as a string. That local file-writing bug was fixed; exports were
rebuilt from the existing saved answer without rerunning or billing generation.

## Accounting and cleanup

| Measure | Result |
| --- | --- |
| Provider HTTP dispatches | 4: one Terra native request, three GPT-4o mini requests |
| Conservative accounted upper debit | **USD 0.430336** |
| Unsettled dispatches | **0** |
| Claude dispatches | **0** |
| Mathematical remainder of original allowance | **USD 49.569664** |
| Proposed rounded-down continuation allowance | **USD 49.56**, not a new USD 50 |

The debit uses the deliberately high accounting rates and full allowed search
fees. It is **not the provider invoice or an invoice reconciliation**.

The original manifest, stopped ledger and evidence remain in ignored private
storage under `generated-artifacts/web-search-pilot/`. Scope/account-reference
details are recorded there, without API keys. The private session-cookie file
was removed, the isolated operator was logged out and disabled with its session
epoch increased, temporary development policy variables were removed, and
`Start application` was restored to `npm run dev`. Public native search remains
OFF. No public model approval was granted.

## Unpaid correction and continuation proposal

Official OpenAI model cards were rechecked. For ordinary text-only OpenAI Chat
Completions that omit a token limit, the corrected guard reserves the model's
full published maximum output instead of changing the request:

- GPT-4o mini: **16,384** output tokens.
- GPT-5.4 and GPT-5.6 Terra: **128,000** output tokens.

Native search still requires its explicit <=8K cap. The correction does not
inject output limits, change models, rewrite scoring prompts or change scoring
semantics. Unknown models/tools and ambiguous outcomes still fail closed.
Changed accounting-policy data changes the ledger hash; the stopped original
ledger is not reset or silently resumed.

Verification: **11 focused synthetic budget tests pass**, including the new
omitted-limit case preserving the original request and reserving the published
maximum before dispatch. Typecheck remains at the same **75 pre-existing
diagnostics**, with none in the pilot controller or guard. The earlier broader
65-test run and application build passed before this guard-only correction.

**Continuation requires revised explicit approval.** Proposed scope: retry the
initial OpenAI end-to-end probe, then its remaining core/inherited-ON/OFF cases;
continue to Claude only after OpenAI passes. That is at most eight further runs
and ten further diagnostic generations, including one additional probe beyond
the originally planned matrix. A new expiring window must preserve the old
ledger and cap further conservative debits at **USD 49.56**, retaining the
original aggregate USD 50 ceiling. Do not create that manifest, reactivate an
operator or make further paid calls until approved.

Production ownership/schema inspection, publishing, post-publish validation and
activation remain separate approval gates. Gemini R1B and reliability R1.1
remain later work.
