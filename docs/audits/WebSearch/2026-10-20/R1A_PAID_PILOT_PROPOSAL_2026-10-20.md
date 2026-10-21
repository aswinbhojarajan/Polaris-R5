# R1A paid pilot proposal — OpenAI, then Claude

**Date:** 2026-10-20  
**Decision recorded:** owner selected **USD 50 as the planning ceiling**.  
**Paid authorization:** owner approved OpenAI, then Claude under the shared
$50 allowance. Actual results are recorded separately; approval itself is not
evidence of successful live validation or production activation.

**Latest outcome:** the first probe stopped at $0.430336. The owner approved
$49.56 further allowance, and eight continuation runs completed for OpenAI then
Claude. Aggregate conservative debit: $7.149218. Native integration passed;
Claude freshness failed. See
[paid results](../2026-10-21/R1A_PAID_VALIDATION_RESULTS_2026-10-21.md).
Both ledgers are preserved; neither this proposal nor unused allowance grants
production approval.

## Proposed approval

Approve one development-only, single-operator pilot, with a **shared USD 50
conservative request allowance across both providers and the whole pipeline**.
This is not USD 50 per provider. Production inspection, publishing, production
validation spend and public activation are excluded and require separate approval.

The new pilot launcher must be used. It is not sufficient to put `50` in cohort
metadata or merely watch a provider dashboard.

## Scope and sequence

Use a new isolated development project/operator for fictional pilot administration,
with public Mozilla Firefox/Google Chrome facts as test content; do not use or
alter an existing customer's project or credentials. Record its exact IDs and
the current account-reference mappings in private evidence before dispatch.
No credentials are printed, copied to the proposal or written to the ledger.

| Order, for each provider | Cases | Queued runs | Diagnostic generations |
| --- | --- | ---: | ---: |
| 1. Initial probe | Current-fact prompt, ON; inspect before proceeding | 1 | 1 ON |
| 2. Remaining core cases | Branded and comparative prompts, ON | 1 | 2 ON |
| 3. Paired comparison | Initial prompt/selection, inherited ON rerun, then explicit OFF | 2 | 1 ON + 1 OFF |
| **Both providers** | **OpenAI completes and is reviewed before Claude starts** | **8** | **8 ON + 2 OFF** |

This refines the earlier six-run proposal by splitting each initial three-item
run into a one-item probe followed by two items. It checks the live protocol
before paying for the rest, without increasing diagnostic generation count.
It **does** increase finalization to at most **eight recommendation sets and
twenty-four drafts**, which are included in this budget.

Suggested controlled prompts:

1. Check Mozilla's official release notes for the current stable Firefox
   version and release date at answer time.
2. Summarize Firefox's current privacy protections using Mozilla documentation.
3. Compare Firefox and Chrome privacy and cross-platform availability using
   official documentation; distinguish facts from judgement.

Ask for English text and a short Sources section listing literal URLs, so the
existing prose-based citation analysis can be exercised without inserting
native metadata into scoring. Do not force tool invocation, change scorer
semantics, manufacture citations or repeat cases solely to obtain invocation.
If citation/index/model policy remains uncertain, stop and review it; no
additional paid calibration or replacement model is implicitly approved.

### Exact native combinations

- `gpt-5.6-terra`, OpenAI Responses `/v1/responses`, `web_search`.
- `claude-sonnet-5`, Anthropic Messages `/v1/messages`,
  basic `web_search_20250305`.
- Existing configured provider credentials, with separate non-secret
  development account references. Do not rotate credentials or change model
  overrides during the window. Account references are operator-maintained,
  not credential fingerprints.
- One expiring cohort per exact provider/model/operator/project/environment,
  **four cumulative ON items per cohort**, and an empty public approval list.
  Deletion does not replenish the allowance.
- Preserve the 180-second native item deadline and maximum two retries.
  Claude retains five search uses across its whole item. OpenAI now explicitly
  limits built-in tool calls to **five per response**, rather than allowing an
  unbounded number inside a response.

OFF comparisons and all automatic internal calls are also potentially billable.
Competitor discovery can expand beyond manually seeded competitors; do not
estimate its work solely from the initial competitor list.

## Cost worksheet — assumptions, not measured results

Current official standard prices checked on 2026-10-20:

| Model | Input / output per million text tokens |
| --- | ---: |
| GPT-5.6 Terra | $2 / $12 |
| Claude Sonnet 5 | $2 / $10 |
| GPT-5.4, recommendations/drafts/discovery | $2.50 / $15 |
| GPT-4o mini, current internal extraction/scoring model | $0.15 / $0.60 |

Both native search tools charge $10/1,000 searches/calls, in addition to tokens.
Long-context/cache/regional pricing must also be respected. The current
development DB has no internal-function model overrides; recheck immediately
before starting, rather than relying on this observation indefinitely.

Illustrative successful-request worksheet:

| Included work | Pricing assumption | Approximate standard cost |
| --- | --- | ---: |
| Five OpenAI diagnostic generations | 50K total input and 8K output tokens per generation | $0.98 |
| Five Claude diagnostic generations | 50K total input and 4K output tokens per generation, aggregating any continuations | $0.70 |
| Native search | Forty searches/calls across the eight ON generations | $0.40 |
| Eight recommendation sets | 12K input / 4K output tokens each, GPT-5.4 | $0.72 |
| Twenty-four drafts | 12K input / 3K output tokens each, GPT-5.4 | $1.80 |
| Extraction, scoring and competitor analysis | Allowance for 500 successful GPT-4o-mini requests at 16K input / 4K output each | $2.40 |
| Additional discovery/context work | Allowance for twelve GPT-5.4 requests at 12K input / 4K output each | $1.08 |
| **Illustrative subtotal** | **Not an instruction to issue 500 analysis calls** | **$8.08** |

Use **roughly $5–15 as a working estimate**, not a quote or a completion
guarantee. Actual token volume, discovered competitors, tool use and retries
can differ substantially. The request guard, not that estimate, is the safety
control. It may stop the matrix early; insufficient allowance is a blocked
result, not permission to increase the limit.

## Pilot-only spending enforcement

`scripts/start-budgeted-web-search-pilot.ts` installs the guard before importing
the application, so the installed OpenAI and Anthropic SDKs inherit it.
Normal `npm run dev` does not install it. The launcher requires development
mode, a private expiring manifest and `--approved`; that flag is an accident
barrier, **not a substitute for owner authorization**.

The guard:

- Accounts for each actual provider HTTP dispatch, including SDK/vendor retries
  and JSON repairs, across native calls, OFF calls and internal processing.
- Uses only four explicitly priced models above, text-only ordinary requests,
   the approved native search tools and default service tiers. Native search
   requires an explicit output limit at most 8K. Following the first safety
   stop, ordinary OpenAI Chat requests omitting a limit reserve the published
   model maximum without changing the request: 16,384 for GPT-4o mini, 128,000
   for GPT-5.4/Terra. Unknown models/providers/tools/tiers and streaming fail closed.
- Reserves full documented context windows before native search: 1.05M for
  Terra and 1M for Sonnet 5. Ordinary requests use a pessimistic UTF-8-byte input
  token bound plus framing allowance.
- Uses deliberately higher accounting rates: Terra/Sonnet **$10/$30**,
  GPT-5.4 **$15/$45**, GPT-4o mini **$1/$2**, per million tokens, plus **$0.02**
  for every allowed search use. These are conservative accounting rates,
  not provider invoice prices.
- Writes and syncs a private reservation before dispatch. Known bounded usage
  can reduce that reservation, still using the higher rates and full search-fee
  allowance. Missing/malformed usage, HTTP/network failures and uncertain
  outcomes retain the reservation and stop further billable dispatch.
- Includes pending reservations in the aggregate $50 test, preventing concurrent
  requests from oversubscribing it. It aborts active requests on a latched stop;
  already sent requests can still be charged and remain reserved.
- Persists across restarts, fingerprints the manifest/rate policy and excludes
  concurrent processes with a lock. Unresolved restart state remains stopped;
  changing a manifest or deleting a run cannot reset the allowance.
- Stores only cost/token/model receipts, not prompts, response prose, reasoning,
  headers or credentials, under ignored `generated-artifacts/web-search-pilot/`.

The largest Terra reservation is **$10.84 per native HTTP request** and the
largest Sonnet reservation is **$10.34** (8K requested output). Before either two-item core stage,
require at least **$22 unused allowance**, with no outstanding requests from the
previous stage. Full-context reservations need temporary headroom even when
actual usage is small. Do not split the guard into independent $25 budgets.

This is an application-process request allowance based on checked public prices,
documented limits and reported usage. It does **not** cap unrelated account/key
spending, replace the provider invoice, or guarantee pricing against an
unannounced provider/account-contract change. Recheck pricing/limits before
launch; do not start if the applicable account terms exceed these upper rates.

## Operational conditions and stop rules

1. Explicit owner paid approval must precede configuration or launch.
2. Establish a single-operator development window with no unrelated pending/
   active generative jobs. Do not run a second application/queue alongside the
   existing workflow. Temporarily use the guarded launcher in that same managed
   workflow; capture and later restore prior non-secret development settings.
3. Keep public approvals empty. Configure only the new controlled project/
   operator's expiring cohorts; record exact identities before dispatch.
4. Use a manifest expiring within **60 minutes**. Do not auto-extend expiry,
   reset/delete the ledger, raise its budget, or refund unknown outcomes.
5. Inspect the first probe before the remaining cases. After OpenAI, review
   identity, invocation, attribution, queue completion, finalization, usage and
   remaining allowance before starting Claude.
6. Stop on any guard denial, unknown usage/outcome, model/account/policy drift,
   invalid/ambiguous attribution or unexpected paid work. Freeze further test
   admission and use existing controls for active work. Any applicable retry
   must remain inside the approved allowance; the pilot is intentionally more
   conservative than normal retry handling after uncertain wire outcomes.
7. A legacy scorer can catch a transport error and fall back. Therefore a run
   marked done is **not** sufficient proof: the guard must have no stop/denial,
   required outputs must be valid, and all changed flows must be reviewed.
8. No automatic extra probes or model substitutions. If more calibration is
   necessary, present a revised manifest/scope and remaining budget for approval.
9. Keep ledger and release evidence after restoration. A stale lock or unresolved
   receipt requires operator review, not an automatic cleanup/refill.

## Exclusions and release interpretation

- No Gemini grounding or removal of its independent rights/display/identity gate.
- No paid PDF/narrative report generation, onboarding enrichment or unrelated
  analysis. The current narrative-report model is not priced in this pilot and
  is blocked if accidentally requested. CSV/JSON snapshot/export checks do not
  require paid narrative generation.
- No production data/configuration mutation, schema execution, publishing,
  production-scoped smoke spend or public validation approvals.
- No claim that native parsing is live-validated merely because metadata GETs
  or synthetic transport tests passed.
- Approval of the OpenAI stage alone does not approve an OpenAI-only MVP release;
  Claude remains pending unless its stage is also approved and passes.

Remaining authenticated browser/report/retention checks and production release
gates stay explicit. If the eight-run matrix cannot complete safely, record its
precise blocked result; do not mark the whole release complete.

## Unpaid verification

- Native/authentication/queue/export suite: **55 passing tests**.
- Pilot ledger/transport suite: **10 passing tests**, including real SDK default-
  fetch inheritance with synthetic HTTP, concurrency, uncertainty, expiry,
  durable restart, lock exclusion and write-failure checks.
- Application build passes. Typecheck remains at **75 pre-existing diagnostics**;
  no new guard/launcher/native-search diagnostics were introduced.
- No guarded paid launcher, active manifest or provider enablement was started.

Sources:
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4),
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini),
[OpenAI tools pricing](https://developers.openai.com/api/docs/pricing),
[Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/overview),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).
