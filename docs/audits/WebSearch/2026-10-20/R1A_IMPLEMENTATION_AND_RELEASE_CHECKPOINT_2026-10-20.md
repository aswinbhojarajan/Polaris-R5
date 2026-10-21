# Prompt Runs Web Search — R1A implementation checkpoint

Date: 2026-10-20. This follows the [original audit](PROMPT_RUNS_NATIVE_WEB_SEARCH_AUDIT_2026-10-20.md)
and [foundation checkpoint](R1A_FOUNDATION_AND_CANVAS_REVIEW_2026-10-20.md).
Those documents are historical evidence, not claims that the current integration
was present when they were written.

## Release state

| State | Current result |
|---|---|
| Implementation | Native admission, durable queue execution, recovery/scoring, approved UI and attribution exports integrated |
| Offline verification | 49 passing deterministic checks, including a disposable PostgreSQL cluster |
| Browser UI | Actual components exercised under browser-only synthetic API/auth fixtures; real authentication unavailable to tester |
| Build | `npm run build` passes; existing bundle-size warnings remain |
| Full typecheck | **Fails:** 76 diagnostics versus 91 in the saved baseline; no increased file/error-code diagnostic counts |
| Acceptance | Owner explicitly accepted the documented baseline typecheck exception for this R1A candidate on 2026-10-20; the full check remains red |
| Exact-model live validation | **Not performed**; no paid provider calls |
| Development database | Additive migration applied |
| Production / publishing | **Untouched**; no activation, migration, publishing or GitHub push |

## Implemented scope

### Admission and identity

- Existing POST `/api/v1/prompt-runs`, same run-ID queue payload. Strict optional
  `webSearchEnabled`; omission and false mean OFF. Arbitrary client policy/tool/
  routing JSON is not accepted as authority.
- ON admission rejects the whole mixed selection with exact blocked IDs/reasons.
  It does not substitute models, deselect them or fall back to non-search.
- Immutable server-owned `search_config` records mode, policy version, exact
  selected vendor/model identities, authenticated actor, a 180-second whole-item
  deadline and two-retry maximum. Claude has five uses across the whole item.
- Public validation is scoped to exact provider/model/tool/account/environment
  evidence. Scoped internal cohorts are distinct from public validation.
  Cohort item reservations are cumulative, serialized and do not replenish when
  a run is deleted. A failed admission after reservation may conservatively
  consume allowance; review it rather than automatically refunding uncertain work.
- Account references are operator-maintained labels, not secret fingerprints.
  Rotation to a different provider account must invalidate/revalidate approvals.

### Queue, recovery and controls

- `prompt_run_item_executions` is additive, one execution per run item. Final
  generation text/evidence is saved **inside the item worker**, before sibling
  `allSettled`, result callbacks, pause checks or scoring. Attempt reservations
  are saved before HTTP dispatch.
- Leased token-qualified ownership fences generation, scoring facts and terminal
  writes. Client score computation occurs outside transactions; canonical answer
  and derived facts commit together after renewed ownership/control checks.
  No historical answer deduplication or global uniqueness constraint was added.
- Recovery uses saved permitted generations without diagnostic re-generation.
  An attempted generation with unknown outcome and no saved answer fails
  explicitly rather than automatically repeating possibly paid work.
- Exact application control signals escape unchanged. Active HTTP and waits are
  abortable. A late pause keeps the checkpoint, and stale completion cannot
  overwrite paused/cancelled state.
- Native diagnostic execution bypasses legacy nested retries; OFF execution and
  internal scoring/extraction retry semantics remain unchanged.
- Existing provider concurrency and sequential provider groups remain. ON timeout
  estimation accounts for a three-minute item; the existing job cap is not raised.

### UI and evidence

- The approved desktop/phone Start Prompt Run and Answer Details designs remain
  on Canvas. Integrated controls say **Enable web search**, default OFF on open/
  close/project change, show cost/time guidance and actionable model blockers.
- Toggling search does not remove selected IDs. The dialog's existing close/reopen
  behavior resets prompt/ad-hoc model choices and restores project-prefilled
  models; retaining selections across close was not introduced.
- Reruns inherit the source mode, use current admission policy and explain that
  answers/search results are generated anew.
- Both answer views show Used / Available—not used / Failed / Pending / Unknown,
  requested/reported identities, safe inline attribution, cited versus other
  consulted sources, and saved-before-scoring/failure states without requiring
  an answer row. Missing or invalid required attribution hides grounded prose.
- Details are authenticated and run/item scoped. Evidence does not enter list
  summaries; immutable evidence stops polling once received.
- A provider's consulted list may include a cited URL. Such sources are promoted
  to cited in place, preserving citation IDs rather than misleadingly showing the
  same URL as “other consulted, not cited.”
- `answers.rawResponse` remains final prose only. Native queries, titles, URLs,
  UI citation markers, tool payloads and hidden reasoning do not become scored
  text or analytical citation rows.

### Exports and retention

- New native answer-bearing text/CSV/JSON exports format mandatory inline links
  and source/provenance information at the display/export boundary, never in
  scored text. New snapshots can retain native provenance; old snapshots are not
  backfilled or rewritten. Existing score/citation columns retain their meaning.
- Missing/inconsistent required attribution stops an answer export rather than
  silently exporting uncredited grounded text.
- Retain necessary native attribution with a retained displayed answer/run.
  Execution evidence cascades with run-item/run deletion; existing transactional
  run deletion removes answer dependencies first. Pilot allowance reservations
  intentionally outlive run deletion. Report snapshots/exports follow their
  existing lifecycle; deleting a run is not a promise to revoke exported copies.
- Do not store transient Claude encrypted continuation blocks, raw tool/page
  payloads, raw Google Suggestions HTML or hidden thoughts. No independent source
  archive or broad retention scheduler was added.

## Provider capability matrix

| Provider | Candidate path | Validation/activation status |
|---|---|---|
| OpenAI | Responses, exact selected ID, auto `web_search`, source inclusion, all final text and native annotations | Fixture/runtime/queue integration tested. Exact live model/account/tool not validated; public gate remains closed |
| Claude | Messages, basic `web_search_20250305`, block citations, HTTP-200 tool errors, bounded `pause_turn` continuation | Same hold. Whole-item budget and indeterminate outcome behavior have deterministic tests |
| Gemini | Native generateContent REST fixture adapter, parts/grounding supports/usage/modelVersion/error parsing | **No live grounded analytical execution/storage/scoring/display.** Independent hard block pending applicable written rights and routing/display policy |
| Perplexity | Existing OFF path only | Outside normalized ON scope; OFF is not described as “offline” |

The audited catalog IDs are candidates, not validation claims. Reconfirm exact
current identities and access before proposing any pilot. Do not introduce a
different alias/catalog row just to make a test pass.

## Verification evidence

Run `npm run test:native-search`. The runner creates a private temporary local
PostgreSQL cluster, refuses to reuse an existing server, overrides the test child
database URL, removes provider keys from the child and cleans up afterward.
It does not fall back to the development or production application database.

49 tests cover strict default-OFF input; mixed eligibility and scoped cohort
admission; provider parsing, Unicode mapping and mandatory attribution bounds;
request identity/transport/retry/deadline/control behavior; independent Gemini
blocking; durable generation before sibling barrier; pause/recovery without a
new diagnostic call; concurrent/stale claims; atomic/idempotent canonical scoring;
failed mandatory saves; deletion; cumulative pilot reservations; display/export
attribution; and real client **and** competitor scorer invariance with identical
answer text and 0/5/50 brand-poisoned native sources.

The scorer-invariance check uses the existing deterministic `AEO_MODE=off`
algorithms and identical scorer settings across cases. It is not a claim of
bit-identical stochastic live LLM scores, or equality between different ON and
OFF answers. The live whole-pipeline pilot remains necessary.

Browser-only synthetic fixtures confirmed default OFF, ON blockers retaining
selections while open, disabled invalid submission, OFF reset, phone scrolling/
footer access, rerun ON inheritance payload, safe citation display, not-used,
failed and saved-generation states, and fail-closed malformed attribution.
The tester initially overspecified selection retention across close; existing
reset behavior is retained. A clipped phone filter row and an instrumented React
Fragment warning were fixed afterward with local wrap/inline-span changes.
No second full browser pass was run.

**Not established by fixture tests:** real admin authentication/RBAC, a successful
real create-run/queue journey, real provider routing/attribution, live-mode
pipeline cost/latency, actual report generation, or production behavior. No new
real run was created by the browser.

Real unauthenticated development HTTP checks returned 401 for native evidence
and 403 for an invalid unauthenticated create POST at the existing request
protection boundary. They do not establish authenticated cross-tenant RBAC.

`npm run check` is not green. Baseline: 91 errors; candidate: 76, with no increased
file/error-code counts. Related rerun/answer typing repairs removed diagnostics;
the full check still fails. On 2026-10-20 the owner explicitly selected
“Accept the baseline exception for R1A.” This accepts this implementation
candidate only, not future regressions, paid validation or production changes.

## Approval gates and rollout

1. **Candidate acceptance — accepted:** the owner explicitly accepted the
   documented remaining baseline typecheck failures for this R1A candidate on
   2026-10-20. This does not approve spend or production, make the check green,
   or waive new regressions or future release checks.
2. **Paid development pilot:** obtain approval for exact model IDs, operator,
   tenant, environment/account references, expiry, cumulative item count and
   whole-pipeline spend ceiling. Include diagnostic generation **and** mention/
   ranking/sentiment/scoring, competitor benchmarking, recommendations, drafts
   and any report work that the actual queue triggers. Metadata declaring a USD
   ceiling is not an automatic provider billing stop; monitor real spend and stop
   before the approved ceiling. No budget has been approved by this checkpoint.
3. **OpenAI first, Claude second:** establish a scoped cohort using the managed
   environment flow; run the real queue in a controlled owned project, including
   no-invocation, used, error/control/recovery and required attribution cases.
   Record requested/reported identity, native events, usage, pipeline call counts,
   cost/latency and retained/exported evidence. Confirm Unicode units and any
   explicitly permitted aliases. Only then add exact public validation evidence.
4. **Production schema first, separately approved:** back up and apply the
   additive `migrations/20261020_native_web_search.sql` to the intended production
   database before publishing code that selects the new column/table. Do not run
   a broad schema push as a substitute.
5. **Publish/activate separately:** publish only after approval and production
   schema verification. Configure correct account/environment labels and narrow
   gates; verify OFF parity, denied mixed selections, authorized details,
   attribution, deletion and queued ON behavior. No broad provider enablement.

### Disable and rollback

- Global/provider flags and exact approvals are read afresh at native control/
  dispatch checks; active native control monitors check roughly every 250 ms.
  Catalog UI cache can lag but server enforcement remains authoritative.
- Disable global or provider search first to block queued/new diagnostic calls.
  No automatic OFF downgrade. Saved permitted generations may finish scoring
  under the documented policy; revocation must not delete required attribution.
- Abort is best effort: requests already accepted by providers may be charged.
  Do not “refund” unknown Claude reservations automatically.
- Roll back code only after disabling/draining native work and preserving needed
  attribution. Leave additive database structures in place initially; do not drop
  evidence columns/tables while retained grounded answers still depend on them.

## Immediate follow-on releases

### R1B: Gemini readiness, then controlled activation

Obtain written applicable rights for analytical use, output/attribution retention,
reporting and exports. Resolve automatic routing versus requested/reported
identity, native endpoint-specific grounding offsets and approved Search
Suggestions rendering without raw HTML. Specify deletion/retention and export
attribution. Keep the independent hard block until all conditions pass; removal
needs code review and separate paid pilot/production approvals.

### R1.1: telemetry-led reliability and budget control

Use approved queued pilot evidence to select retry/deadline/concurrency changes,
pipeline budget instrumentation, alerting and operator recovery UX. Track
requested/used/not-used/failed/unknown distinctly. Address observed data-loss/
attribution/recovery risks first. Do not add source-authority analytics,
metadata-derived score bonuses or unrelated reports to the initial search path.
