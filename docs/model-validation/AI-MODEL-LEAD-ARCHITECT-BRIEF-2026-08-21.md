# Polaris AI Model Catalog — Lead and Architect Review Brief

**Prepared:** 21 August 2026  
**Environment directly verified:** Development  
**Published application:** Active and healthy, but the production model rows could not be independently read during this review  
**Scope:** Changes completed for the 13-model technical-validation rollout, the wider development catalog, retirement exposure, and production-readiness gaps

---

## Executive summary

### What is complete

- All 13 approved prompt-run models passed a real Polaris prompt-run smoke test and a clean shared 10-prompt corpus run.
- Existing AI model row IDs were **not changed**. Historical prompt runs, answers, reports, and saved model selections continue to reference the same database IDs.
- The popup display order changed only at render time: OpenAI → Anthropic → Google → Perplexity, then current/newer models first within each vendor.
- Core was changed to exactly one flagship per generation vendor:
  - GPT-5.6 Terra
  - Claude Sonnet 5
  - Gemini 3.7 Flash
- The remaining validated models are Additional.
- Provider-specific request handling was updated for GPT-5.6, Claude 5, and Gemini 3.x reasoning behavior.
- Prompt-run submissions now reject unknown, disabled, paused-vendor, internal-only, and foreign-client selections on the server.
- Old model rows are retained for historical joins rather than deleted.

### Important limitations and risks

- The development database contains **25 model rows**, not only the validated 13.
- Four extra OpenAI rows are currently enabled and public even though they were not part of this 13-model validation:
  - GPT-4o Mini
  - GPT-5 Mini
  - GPT-5.1
  - GPT-5.4 Nano
- Three Perplexity rows are enabled at row level but currently hidden and blocked because the Perplexity vendor is paused.
- The seed catalog can enable some models outside the approved 13 on a fresh database. The runtime catalog policy and validation-report scope therefore do not yet fully match.
- Deprecated models are disabled when first inserted, but retirement is not irreversibly enforced on every restart because administrators are allowed to re-enable rows.
- The production catalog state was not independently confirmed. A production canary and provider-cost reconciliation were explicitly deferred.
- Perplexity Sonar Chat Completions has a firm migration deadline: **27 September 2026**.
- Claude Sonnet 4.5 is active, but Anthropic lists tentative retirement as **not sooner than 29 September 2026**.

### Architect verdict

The request-compatibility, history-preservation, and authorization changes are sound, but catalog governance is not yet release-complete. Polaris should distinguish:

1. **Validated for prompt-run use**
2. **Used only by internal Polaris functions**
3. **Paused**
4. **Retired/history-only**
5. **Candidate/internal validation**

At present, those categories are not consistently enforced by one authoritative policy.

---

# Task 1 — Change inventory, root causes, reasons, and testing

## 1. Popup catalog ordering

### Previous behavior / root cause

- The popup depended on general/alphabetical behavior.
- An older “latest display-name version only” heuristic could collapse model-family versions and hide explicitly approved alternatives such as GPT-5.4, GPT-5.2, and GPT-4.1.
- Alphabetical sorting is not a reliable proxy for model recency or product priority.

### Change

- Added a client-side model comparator.
- Vendor order:
  1. OpenAI
  2. Anthropic
  3. Google
  4. Perplexity
- Within each vendor, known model IDs have an explicit priority.
- Unknown future models fall back to display-name sorting.

### Data impact

- No database display-order column was added.
- No model IDs were changed.
- No historical records were rewritten.
- This is a presentation-only sort.

### Existing-client impact

- Existing selections remain valid because selections reference immutable `ai_models.id` values.
- Clients only see a different visual order and different Core/Additional grouping.

---

## 2. Core versus Additional catalog policy

### Previous behavior / root cause

- More than one model per vendor/generation could appear as Core.
- This made the recommended/default set larger and reduced clarity.

### Change

Core is now exactly:

- OpenAI: GPT-5.6 Terra
- Anthropic: Claude Sonnet 5
- Google: Gemini 3.7 Flash

Every other model row is categorized as Additional by the one-time catalog cutover.

### Rationale

- Core is a concise cross-vendor default, not a statement that every other model is inferior.
- Additional retains choice for cost, latency, comparison, continuity, and customer-specific evaluation.
- The Core choice was an owner-approved catalog policy. It was not derived from a formal Polaris cost/latency/quality optimization study.

---

## 3. GPT-5.6 compatibility

### Failure observed

- GPT-5.6 rejected a non-default `temperature` with HTTP 400.
- A 4,000 completion-token budget could be consumed by reasoning, producing `finish_reason=length` and no visible answer.

### Change

- Omit `temperature` for `gpt-5.6*`.
- Use `max_completion_tokens=8000`.
- Empty answers are treated as errors instead of successful zero-score answers.

### Why it matters to Polaris

- Prevents technically successful HTTP responses from becoming empty stored answers and false low visibility/position scores.

---

## 4. Claude 5 compatibility

### Failure observed

- Claude 5 may return a thinking block before the text block.
- The previous code assumed `content[0]` was text.
- A 2,000-token limit could be exhausted during reasoning, resulting in no user-facing text.

### Change

- Find the first `text` block rather than reading only `content[0]`.
- Give Claude 5 models an 8,000-token budget.
- Treat an empty text result as a provider error.

### Why it matters to Polaris

- Prevents empty answers being stored and scored as if the model had genuinely omitted the client/brand.

---

## 5. Gemini reasoning-model compatibility

### Failure observed

- Gemini 3.x was not included in the reasoning-model token-budget branch.
- Reasoning could consume the available output budget.

### Change

- Gemini 2.5 and 3.x receive a 16,000-token maximum.
- Empty output is treated as an error.

### Why it matters to Polaris

- Preserves attributable, scoreable answer content across newer Gemini generations.

---

## 6. Server-side prompt-run validation

### Previous risk / root cause

Hiding a model in the popup is not an authorization or billing boundary. A modified request could submit:

- an unknown model ID;
- a disabled model;
- a model from a paused vendor;
- an internal candidate model;
- repeated IDs that multiply provider calls and cost;
- prompts belonging to another client.

### Change

`POST /api/v1/prompt-runs` now:

- rejects unknown model IDs;
- rejects disabled models;
- rejects paused-vendor models;
- rejects internal-only models unless the user is an admin for the current client;
- rejects prompts not owned by the submitted client;
- de-duplicates prompt and model IDs before creating run items.

### Security correction made during review

- An initial implementation trusted a session-wide/global admin hint.
- That could let an admin of one organization access internal models for another organization where they were only a member.
- The final implementation resolves the current database role for the selected client and stores `currentClientRole` for the request.
- Cross-organization admin status and stale session metadata no longer grant internal-model access.

---

## 7. Internal-only candidate visibility

### Root cause

- New candidates needed to be enabled temporarily for recorded validation without exposing them to ordinary client users.

### Change

- Added `ai_models.internal_only`.
- Consumer catalog hides internal-only models from non-admins.
- Prompt-run submission enforces the same rule server-side.

### Current state

- The 13 validated models are now public, so none of them remains internal-only.
- The field remains available for future candidate-validation windows.

---

## 8. Existing-database catalog cutover

### Root cause

- Normal seed behavior inserts missing models but intentionally does not overwrite existing rows.
- Therefore changing seed defaults alone would not enable existing model rows or update Core/Additional in an already-running database.

### Change

- Added a one-time database transaction that:
  - enables and makes public the validated 13;
  - clears prior disable metadata for those 13;
  - sets the three approved Core rows;
  - sets every other row to Additional;
  - writes an audit marker.
- PostgreSQL advisory locking prevents two app instances applying the cutover concurrently.
- The audit marker prevents later restarts from overwriting administrator decisions.

### Deployment behavior

- Replit Publish is expected to apply the schema diff, including `internal_only`.
- Startup then performs the one-time data cutover.
- This avoids unsupported startup DDL or production `db:push`.

### Risk

- The SQL companion migration is not itself proof that production received the schema/data state.
- Production verification remains required.

---

## 9. Model IDs and historical data

### What did not change

- No `ai_models.id` values were changed.
- No existing model rows were replaced.
- No prompt-run items, answers, scores, reports, or saved client selections were remapped.

### What was added or changed

- Missing canonical model rows were inserted.
- Existing rows were updated by canonical `model` string only for the approved one-time cutover.
- Category, enabled/public status, and disable metadata changed for the validated cohort.

### Remaining data-model concern

- The canonical `model` string does not have a database uniqueness constraint.
- Duplicate canonical rows are therefore theoretically possible.
- A duplicate-remediation check should precede adding uniqueness.

---

## 10. Retirement of old models

### Design

- Retired/deprecated rows are retained so historical runs continue to render.
- They should be disabled for new selections, not deleted.

### Current implementation

- Fresh insertion disables:
  - `claude-3-5-haiku-20241022`
  - `gemini-1.5-pro`
- Development currently also has Claude Opus 4.1 disabled.
- The recurring startup retirement sweep is intentionally not called because it would override later admin choices.

### Governance gap

- “Deprecated in code” is not an irreversible policy.
- An administrator can re-enable an expired model.
- The migration/cutover does not force all retired existing rows off.
- Development is currently safe for the known retired rows, but a consistent audited retirement policy is still needed.

---

## 11. Exact AI-model test protocol

### Stage A — Provider entitlement reconciliation

- Verified the 13 canonical IDs against the configured provider accounts.
- This was model-list/entitlement checking and did not require paid generation calls.
- Claude Sonnet 4.5 resolved through its alias to snapshot `claude-sonnet-4-5-20250929`.

### Stage B — Control-plane tests

No-provider-call route tests covered:

- unknown model rejection;
- disabled model rejection;
- internal-only rejection for normal users;
- cross-organization/global-admin rejection;
- current-client admin acceptance;
- vendor-pause rejection;
- foreign-client prompt rejection;
- empty selection rejection;
- duplicate-ID de-duplication;
- valid submission.

### Stage C — Three-prompt live smoke

- Three deterministic prompts per model.
- Executed through the real Start Prompt Run path rather than isolated direct provider calls.
- 13/13 models passed after provider wiring fixes.
- Final successful screening: 39 items.
- Including superseded pre-fix attempts: 48 logical smoke items.
- Observed wall time per three-prompt run: approximately 16–81 seconds.

### Stage D — Shared 10-prompt corpus

Each model ran the same categories:

1. factual;
2. brand;
3. comparison;
4. ranking;
5. recommendation;
6. citation/source;
7. long-form;
8. multilingual;
9. refusal;
10. safety.

Acceptance criteria:

- terminal run status `done`;
- 10/10 items completed;
- 10/10 non-empty answers;
- answer attributed to the selected model;
- downstream scoring/benchmarking completed;
- no silent fallback.

Result:

- 13/13 passed.
- Clean serial reruns resolved ambiguous earlier runs for:
  - GPT-5.6 Terra;
  - Claude Sonnet 4.5;
  - Gemini 3.5 Flash-Lite;
  - Gemini 3.7 Flash.
- Approximately 3,000–8,800 characters average answer length, depending on model.
- No observed auth/entitlement failures, 429s, misattribution, or silent fallbacks.

### Stage E — Blind quality review

- Two independent blind reviewers examined stored corpus answers.
- Five models met the initial strict draft quality floor:
  - GPT-5.6 Terra
  - GPT-5.6 Luna
  - GPT-5.4
  - GPT-5.2
  - GPT-4.1
- Eight models produced more actionable e-bike speed-limiter-removal guidance than the draft policy allowed.
- This was classified as an answer-policy/safety finding, not a provider integration failure.
- The owner approved keeping technically working models enabled and deferred answer-quality safeguards.
- The related follow-up task was later cancelled, so this risk currently has no active remediation task.

### Stage F — Resilience and capacity

- Nine models completed:
  - one successful three-prompt run;
  - one intentionally cancelled two-prompt run.
- Remaining extended resilience work was stopped by owner decision.
- This stage is partial and should not be represented as completed resilience certification.

### Stage G — Rollback rehearsal

- Six candidate models were disabled through the real admin endpoint.
- Verified:
  - immediate removal from consumer catalog;
  - new submission rejected with `model_disabled`;
  - in-flight tails cancelled with explicit errors;
  - historical runs and answers preserved.

### Stage H — History integrity

- No model row or validation answer was deleted.
- Runs continued to resolve their original model relationship even when a model became disabled.

### Live-call accounting

- 48 smoke items;
- 170 corpus items, including 40 clean rerun items;
- 1 Terra retry;
- 45 resilience items;
- total: 264 logical live items.

### Explicitly not completed

- Provider-dashboard cost reconciliation;
- exact retry-amplification accounting;
- full resilience matrix for all 13;
- production canary;
- multi-day production observation;
- enforceable answer-quality guardrails.

---

## 12. Automated verification

Completed targeted coverage:

- prompt-run control-plane tests: 10;
- client-scoped internal-model authorization tests: 3;
- database-backed catalog cutover/idempotency test: 1;
- catalog ordering test: 1;
- total targeted checks: 15 passed.

Other checks:

- Application production build passed.
- Workflow restarted and served successfully.
- Startup logs were clean.
- `npm run check` remains blocked by pre-existing `devtools-protocol` declaration parsing errors.
- The wider legacy RBAC suite passed 9/10 checks; its remaining assertion expects direct response writing while the middleware forwards an error to Express. This did not invalidate the new client-scoped authorization tests.

---

# Task 2 — Complete AI model catalog, enablement rationale, Polaris fit, and lifecycle

## How to read the table

- **Enabled** is the row-level development database state.
- **Paused** means the vendor-level switch blocks and hides the model even if its row is enabled.
- **Validated cohort** means it completed the 13-model test protocol above.
- **Not in cohort** does not automatically mean technically broken; it means this validation evidence does not cover it.

| Vendor | Display name / canonical model ID | Dev state | Catalog position | 13-model validation | Polaris rationale / fit | Lifecycle as of 21 Aug 2026 |
|---|---|---:|---|---|---|---|
| OpenAI | GPT-5.6 Terra / `gpt-5.6-terra` | Enabled, public | **Core** | Passed | Owner-selected OpenAI flagship and recommended default; strongest intended quality tier | No API shutdown date found on OpenAI deprecations page |
| OpenAI | GPT-5.6 Luna / `gpt-5.6-luna` | Enabled, public | Additional | Passed | Lower-cost GPT-5.6 alternative; useful for cost/quality comparison | No API shutdown date found |
| OpenAI | GPT-5.4 / `gpt-5.4` | Enabled, public | Additional | Passed | Validated continuity/baseline model and quality comparator | No API shutdown date found |
| OpenAI | GPT-5.2 / `gpt-5.2` | Enabled, public | Additional | Passed | Validated older-generation comparison and continuity | No API shutdown date found |
| OpenAI | GPT-4.1 / `gpt-4.1` | Enabled, public | Additional | Passed | Legacy comparison baseline; API remained available when ChatGPT retired GPT-4.1 | No API shutdown announced; ChatGPT retirement did not apply to API |
| OpenAI | GPT-5.4 Nano / `gpt-5.4-nano` | Enabled, public | Additional | **Not in cohort** | Potential low-cost/high-volume fit, but not covered by this validation | No shutdown date found; policy gap because public but unvalidated here |
| OpenAI | GPT-5.1 / `gpt-5.1` | Enabled, public | Additional | **Not in cohort** | Existing comparison/internal-function continuity; consumer fit not established by this work | No shutdown date found |
| OpenAI | GPT-5 Mini / `gpt-5-mini` | Enabled, public | Additional | **Not in cohort** | Existing lower-cost reasoning option; consumer fit not established by this work | No shutdown date found |
| OpenAI | GPT-4o Mini / `gpt-4o-mini` | Enabled, public | Additional | **Not in cohort** | Existing economical/internal scoring usage; should be classified as internal or separately validated | No relevant API shutdown date confirmed |
| OpenAI | GPT-5.4 Mini / `gpt-5.4-mini` | Disabled | Additional | Not in cohort | Could be a lower-cost tier, but currently disabled | Disabled reason is an old E2E test reason, not provider retirement; requires policy review |
| Anthropic | Claude Sonnet 5 / `claude-sonnet-5` | Enabled, public | **Core** | Passed | Owner-selected current Anthropic flagship/default | Active; tentative retirement **not sooner than 30 Jun 2027** |
| Anthropic | Claude Opus 5 / `claude-opus-5` | Enabled, public | Additional | Passed | Premium/deeper-analysis alternative; kept Additional to preserve one Core per vendor | Active; tentative retirement **not sooner than 24 Jul 2027** |
| Anthropic | Claude Sonnet 4.5 / `claude-sonnet-4-5` | Enabled, public | Additional | Passed | Continuity and comparison against Sonnet 5 | Active; tentative retirement **not sooner than 29 Sep 2026** — migration planning is urgent |
| Anthropic | Claude Opus 4.1 / `claude-opus-4-1` | Disabled | Additional | Not in cohort | History-only; should not be offered for new runs | Anthropic retired snapshot `claude-opus-4-1-20250805` on **5 Aug 2026** |
| Anthropic | Claude 3.5 Haiku / `claude-3-5-haiku-20241022` | Disabled | Additional | Not in cohort | History-only | Retired **19 Feb 2026** |
| Google | Gemini 3.7 Flash / `gemini-3.7-flash` | Enabled, public | **Core** | Passed | Owner-selected current Google default; intended high-throughput flagship | No shutdown date announced |
| Google | Gemini 3.5 Flash-Lite / `gemini-3.5-flash-lite` | Enabled, public | Additional | Passed | Cost/latency-oriented Google option | No shutdown date announced |
| Google | Gemini 2.5 Pro / `gemini-2.5-pro` | Enabled, public | Additional | Passed | Higher-capability older stable comparison/continuity | No shutdown date announced |
| Google | Gemini 2.5 Flash / `gemini-2.5-flash` | Enabled, public | Additional | Passed | Balanced speed/cost comparison option | No shutdown date announced |
| Google | Gemini 2.5 Flash-Lite / `gemini-2.5-flash-lite` | Enabled, public | Additional | Passed | Lowest-cost/high-volume validated Google tier | No shutdown date announced |
| Google | Gemini 3 Pro / `gemini-3-pro-preview` | Disabled | Additional | Not in cohort | Preview/history row; not approved for new runs | Preview lifecycle; no current supported mapping verified in this review |
| Google | Gemini 1.5 Pro / `gemini-1.5-pro` | Disabled | Additional | Not in cohort | History-only | Legacy/retired; current Google deprecation page no longer lists it as a live model |
| Perplexity | Sonar / `sonar` | Row enabled; **vendor paused** | Additional | Not called | Web-grounded visibility/search fit, but not part of the 13-model test | Sonar Chat Completions supported only until **27 Sep 2026** |
| Perplexity | Sonar Pro / `sonar-pro` | Row enabled; **vendor paused** | Additional | Not called | Deeper web-grounded answer option; currently unavailable to clients due pause | Sonar Chat Completions supported only until **27 Sep 2026** |
| Perplexity | Sonar Reasoning / `sonar-reasoning` | Row enabled; **vendor paused** | Additional | Not called | Historical reasoning/search option; should not be treated as current without migration/revalidation | Model has been deprecated; Sonar interface deadline **27 Sep 2026** |

---

## Why the validated 13 were enabled

They were enabled because each demonstrated:

- provider-account entitlement;
- successful execution through the real Polaris run path;
- a passed deterministic three-prompt smoke;
- a clean 10/10 shared corpus run;
- non-empty attributable answers;
- completed downstream processing;
- no observed entitlement, rate-limit, misattribution, or fallback failure.

They were **not** enabled based on:

- proven lowest cost;
- proven best latency;
- completed production canaries;
- provider invoice reconciliation;
- completion of the full resilience program;
- universal satisfaction of the draft answer-safety floor.

---

## Why models are disabled or blocked

There are four distinct reasons, which should not be conflated:

1. **Provider-retired/history-only**
   - Claude 3.5 Haiku
   - Claude Opus 4.1
   - Gemini 1.5 Pro

2. **Operational/test disable without a final catalog rationale**
   - GPT-5.4 Mini
   - Gemini 3 Pro Preview

3. **Vendor paused**
   - All Perplexity rows
   - Rows remain enabled so unpausing restores their prior state, but the consumer API hides them and run submission rejects them.

4. **Future candidate/internal validation**
   - Supported by `internal_only`, although no current validated-cohort row remains internal-only.

---

## Polaris fitment assessment

### Strong fit

- Multi-provider comparative prompt execution is central to Polaris visibility analysis.
- Keeping multiple generations supports longitudinal comparison and client continuity.
- Preserving historical rows protects trend and report integrity.
- One Core model per major generation vendor provides a manageable default set.
- Additional cost/capability tiers let operators adjust breadth without schema changes.

### Conditional fit

- Lower-cost Mini/Nano/Lite models can improve run economics, but should be validated against Polaris scoring stability, answer completeness, and client requirements before public exposure.
- Older stable models may be valuable for continuity, but should have explicit sunset ownership.
- Web-grounded Perplexity models fit citation/discovery use cases, but the current Sonar integration is near retirement.

### Poor fit / history-only

- Provider-retired models should never be available for new runs.
- Preview models without a monitored migration path are inappropriate as business-critical defaults.
- Models used solely for internal scoring/summarization should not automatically appear in the client prompt-run picker.

---

## Lifecycle actions and deadlines

| Priority | Deadline | Action |
|---|---:|---|
| Critical | Before **27 Sep 2026** | Migrate Perplexity from Sonar Chat Completions to Agent API, or keep Perplexity paused and remove it from client commitments |
| High | Before **29 Sep 2026** | Validate replacement for Claude Sonnet 4.5 and prepare migration; Anthropic says retirement is not sooner than this date |
| High | Before next publish approval | Reconcile consumer-visible catalog to the approved validated policy |
| High | Immediately after publish | Verify production schema, catalog rows, audit marker, and exact three-Core state |
| Medium | Next catalog governance cycle | Add canonical model uniqueness after duplicate audit |
| Medium | Ongoing | Monitor OpenAI, Anthropic, Google, and Perplexity official lifecycle pages and record owner/replacement/deadline in Polaris |

---

## Architecture recommendations

### 1. Make catalog policy explicit

Add a first-class purpose/lifecycle classification rather than inferring behavior from combinations of `enabled`, `category`, and `internal_only`:

- consumer;
- internal function;
- candidate;
- paused;
- deprecated;
- retired/history-only.

### 2. Separate model lifecycle from operator enablement

- `enabled` should represent operator availability.
- Provider lifecycle should have its own status and retirement date.
- A retired provider model should be impossible to re-enable accidentally without a documented override.

### 3. Add expiry ownership

For each model/provider integration, track:

- lifecycle status;
- announced retirement date;
- replacement;
- migration owner;
- last entitlement check;
- last successful canary;
- evidence link.

### 4. Preserve IDs through migrations

Continue the current good practice:

- never replace historical database IDs;
- update executor mapping or provider endpoint behind the same Polaris row only when semantics remain equivalent;
- create a new row when a replacement materially changes the model identity.

### 5. Complete production evidence

Before calling the rollout production-certified:

- verify production model rows;
- verify `internal_only`;
- verify the one-time cutover marker;
- run a bounded production canary;
- export run IDs/evidence;
- reconcile provider usage and retry costs.

---

## Proposed follow-up work

- Prevent unvalidated or retired models from appearing in client runs.
- Keep Perplexity runs working after the 27 September retirement.
- Prove the production catalog matches the approved model policy.

---

## Sources

### Polaris repository

- `docs/model-validation/TASK-25-VALIDATION-REPORT.md`
- `server/seed.ts`
- `server/services/ai-executor.ts`
- `server/routes/prompt-runs.ts`
- `server/routes/ai-models.ts`
- `server/auth.ts`
- `server/utils/internal-model-access.ts`
- `client/src/lib/model-catalog-order.ts`
- `migrations/0013_finalize_ai_model_catalog.sql`
- targeted test files under `server/tests/`

### Provider lifecycle documentation checked on 21 August 2026

- OpenAI API deprecations: <https://developers.openai.com/api/docs/deprecations>
- Anthropic model deprecations: <https://platform.claude.com/docs/en/about-claude/model-deprecations>
- Google Gemini deprecations: <https://ai.google.dev/gemini-api/docs/deprecations>
- Perplexity Sonar migration notice: <https://docs.perplexity.ai/docs/sonar/quickstart>
