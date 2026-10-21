# Web Search R1A — paid development validation results

**Date:** 2026-10-21, Asia/Dubai. Execution timestamps below use UTC on 2026-10-20.  
**Status:** OpenAI and Claude native integration validated in development;
Claude freshness checks failed. Production release is not complete.

**Follow-up:** [Read-only production readiness and Claude recommendation](R1A_PRODUCTION_READINESS_AND_CLAUDE_DECISION_2026-10-21.md)
now verifies the published schema gap and additive Publish diff. The owner's
release target explicitly includes both OpenAI and Claude.

## Authorization and execution

The owner approved OpenAI followed by Claude under a shared USD 50 development
allowance. The first probe stopped safely at a downstream omitted output limit,
accounting conservatively for USD 0.430336. The owner then approved a new window
with at most USD 49.56 further allowance, preserving the initial ledger.

The corrected guard reserves published model maximum output for ordinary
OpenAI requests without explicit limits. It does not inject limits or rewrite
scoring requests. Native search retains explicit <=8K output bounds, the
existing deadline/retry policy and five-use Claude whole-item limit.

The continuation used a separate isolated development organization/project/
operator, real login/cookies/CSRF, actual registered routes, the real job queue,
provider APIs and PostgreSQL. No authentication or provider transport was mocked.
The first OpenAI probe was reviewed before its core cases; all OpenAI cases
passed before Claude started. No public validation approval was manufactured.

## Technical execution matrix

Every row reached core `done` and deliverables `ready`, with no delivery error.
Sources/citations are native provenance counts, **not analytical citation counts**.

| Provider/model | Case | Items | Native result | Sources / citations |
| --- | --- | ---: | --- | --- |
| OpenAI `gpt-5.6-terra` | Current fact probe | 1 | invoked; scored | 17 / 1 |
| OpenAI `gpt-5.6-terra` | Branded + comparative | 2 | invoked; scored, both | 21 / 9; 37 / 11 |
| OpenAI `gpt-5.6-terra` | Inherited-ON rerun | 1 | invoked; scored | 18 / 1 |
| OpenAI `gpt-5.6-terra` | Explicit OFF | 1 | legacy direct path; no native evidence | — |
| Claude `claude-sonnet-5` | Current fact probe | 1 | invoked; scored | 14 / 2 |
| Claude `claude-sonnet-5` | Branded + comparative | 2 | invoked; scored, both | 36 / 24; 46 / 27 |
| Claude `claude-sonnet-5` | Inherited-ON rerun | 1 | invoked; scored | 18 / 5 |
| Claude `claude-sonnet-5` | Explicit OFF | 1 | legacy direct path; no native evidence | — |

Totals: **8 completed runs, 10 diagnostic generations, 8 native ON + 2 OFF**.
The failed first window adds one earlier run/generation; it is not counted as
a successful run and its cost is not discarded.

- Actual reported identities matched the selected model names in both modes.
- All ON generations observed native invocation and had nonempty sources and
  citations. The Claude comparative item used all five permitted searches.
  No native retry or continuation dispatch was observed in this matrix.
- The application generated recommendations and all three drafts for every
  continuation run. Receipt counts include eight discovery calls, eight
  recommendation-set calls and twenty-four draft calls.
- Reruns fetched the source run's actual selections and reused its search bit;
  they were re-admitted through the ordinary protected create-run endpoint.
- Actual snapshots and CSV/JSON exports were generated from the saved results
  without additional generation. Every ON JSON export retained the complete
  canonical native evidence unchanged. All 80 native citation spans were within
  their saved answer and referred to retained source IDs. OFF JSON contained no
  native evidence. These counts do not prove universal factual accuracy.
- The guard stayed healthy throughout the continuation and every dispatch
  settled with known bounded usage. No scorer fallback/guard-denial condition
  from the original stopped attempt is being accepted as a pass.

## Freshness finding — do not hide or silently correct it

The selected current-fact prompt asks for the current stable Firefox version
and release date using official release notes.

- OpenAI's probe reported **158.0.1, October 20, 2026**.
- Claude's probe **and same-prompt inherited-ON rerun** reported **158.0,
  October 13, 2026**, selecting older major-release documentation.
- Mozilla's 158.0.1 release page confirms the October 20 point release.
- A direct HTTPS check of Mozilla's official product-details JSON at
  **20:17:13 UTC** reported `LATEST_FIREFOX_VERSION: "158.0.1"`.
  Its `Last-Modified` was **13:52:47 UTC**, before both probes, with
  `Cache-Control: max-age=300` and `Age: 95`.
- A separate extracted/cached fetch of the same JSON still returned `158.0`.
  That extraction is not reliable current-version ground truth. The direct,
  timestamped official response and release page support the discrepancy.

Sources:
- `https://www.firefox.com/en-US/firefox/158.0.1/releasenotes/`
- `https://product-details.mozilla.org/1.0/firefox_versions.json`

Therefore Claude passes **technical native-search integration**, not the
current-fact freshness check. Search invocation and valid attribution do not
guarantee a correct/latest answer. Canonical evidence cannot establish whether
retrieval/index freshness or answer selection caused this; raw search payloads
are deliberately not retained.

Preserve the observed provider output. Do not alter selected prompts, inject
provider-specific freshness instructions, substitute models, rewrite answers
or claim an additional successful retry. Investigating with further paid probes
requires a new scope decision. Claude activation needs an explicit decision on
this limitation; an OpenAI-only release would also require explicit approval.

## Conservative accounting, not an invoice

| Window / model | Dispatched requests | Conservative debit |
| --- | ---: | ---: |
| Original stopped window | 4 | USD 0.430336 |
| Approved continuation | 230 | USD 6.718882 |
| **Aggregate** | **234** | **USD 7.149218** |

Continuation requests comprise:
- Terra: 5 diagnostic requests, of which 4 used native search.
- Sonnet 5: 5 diagnostic requests, of which 4 used native search.
- GPT-4o mini: 180 internal scoring/extraction requests.
- GPT-5.4: 40 discovery/recommendation/draft requests.

There are **zero unsettled dispatches**. USD 7.149218 uses deliberately high
accounting rates and full allowed search fees; actual provider invoices have
not been reconciled. It is not an account-wide spending cap. Unused allowance
does not authorize production calls or new experiments.

Private manifests, receipts, native answers, exports, exact fixture IDs and
matrix summary remain in ignored `generated-artifacts/web-search-pilot/`.
No API keys or session cookies are in the committed release evidence.

## Cleanup and verification

- Both isolated operators were logged out and disabled, with session epochs
  increased. Both private session-cookie files were removed.
- Temporary development enablement, account-reference and cohort variables were
  removed; the main workflow was restored to `npm run dev`.
- Public search remains OFF and no public model approvals were granted.
- The original stopped ledger and continuation ledger are preserved separately.
- No production inspection, migration, publishing, production call or activation
  occurred in this scope.
- Controller changes passed typecheck without new diagnostics; the repository
  remains at the accepted **75 pre-existing diagnostics**, not a green check.
  The prior 11 focused guard tests and broader pre-pilot test/build results
  remain valid; unchanged suites were not redundantly rerun.

## Release decision and remaining work

**Development integration: GO for both exact tested combinations.**  
**Freshness acceptance: OpenAI observed pass; Claude observed failure.**  
**Production activation: NO-GO until remaining gates and approvals close.**

1. Read-only inspection initially identified the missing R1A structures and
   eight additive statements. Since then the owner approved recovery/publishing,
   published the candidate OFF, and follow-up checks confirmed all three
   structures, no remaining schema diff and the new live UI artifact. See the
   [current checkpoint](R1A_REPORT_VERIFICATION_AND_PUBLISH_GATE_2026-10-21.md).
2. Complete the focused genuine authenticated browser review and applicable
   full/retained report attribution checks. These are not established by API
   execution or engine startup PDF self-tests.
3. Claude quality limitation accepted by the owner; both providers remain in
   scope. The [frozen investigation record](CLAUDE_FRESHNESS_INVESTIGATION_2026-10-21.md)
   preserves the exact test. Activation approval remains separate; do not
   redefine the scope as OpenAI-only or call the freshness case a pass.
4. Separately approve the exact additive production schema plan, user publishing
   with public search initially OFF, production account/model/tool pilot and
   spending plan, activation order, monitoring and disable/drain procedure.
5. Verify published artifact/schema parity, run the approved production cohort,
   then activate only approved combinations. Do not promote development
   account/environment evidence to production approval.
6. Close the release record only after production criteria are satisfied.
   Gemini stays separately blocked for R1B; R1.1 operational improvements remain
   subsequent work.
