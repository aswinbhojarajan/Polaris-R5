# Task #25 — Prompt-Run Model Catalog Validation Report

Date: 2026-08-20 · Environment: development · Baseline commit: `9242b21`
Test tenant: `test-model-validation-2026` ("VoltRide Labs (TEST)", non-sensitive corpus, admin-only access)
Run naming: `TEST-2026-08-20-<model>-<stage>`

## Scope
The 13-model Start Prompt Run popup catalog (3 Core candidates + 10 Additional). Internal-function
models, disabled/historical rows, and Perplexity (vendor paused) received **no provider calls** —
only blocking and history-integrity coverage.

## Owner summary: final technical validation

Legend:
- **Passed** — the stage completed with attributable provider answers and a clean terminal run.
- **Answers saved; tail incomplete** — provider generation succeeded, but later
  scoring/benchmarking did not complete cleanly.
- **Pending** — the required validation stage has not been performed.

| Model | Entitlement | 3-prompt smoke | 10-prompt corpus | Resilience | Blind quality | Cost/retry reconciliation | Production canary |
|---|---|---|---|---|---|---|---|
| GPT-4.1 | Passed | Passed | Passed (10/10) | Partial | Passed | Deferred by owner | Deferred by owner |
| GPT-5.2 | Passed | Passed | Passed (10/10) | Partial | Passed | Deferred by owner | Deferred by owner |
| GPT-5.4 | Passed | Passed | Passed (10/10) | Partial | Passed | Deferred by owner | Deferred by owner |
| GPT-5.6 Luna | Passed | Passed | Passed (10/10) | Partial | Passed | Deferred by owner | Deferred by owner |
| GPT-5.6 Terra | Passed | Passed | Passed (10/10 clean rerun) | Partial | Passed | Deferred by owner | Deferred by owner |
| Claude Sonnet 4.5 | Passed | Passed | Passed (10/10 clean run) | Partial | Owner accepted | Deferred by owner | Deferred by owner |
| Claude Sonnet 5 | Passed | Passed | Passed (10/10) | Partial | Owner accepted | Deferred by owner | Deferred by owner |
| Claude Opus 5 | Passed | Passed | Passed (10/10) | Partial | Owner accepted | Deferred by owner | Deferred by owner |
| Gemini 2.5 Pro | Passed | Passed | Passed (10/10) | Partial | Owner accepted | Deferred by owner | Deferred by owner |
| Gemini 2.5 Flash | Passed | Passed | Passed (10/10) | Partial | Owner accepted | Deferred by owner | Deferred by owner |
| Gemini 2.5 Flash-Lite | Passed | Passed | Passed (10/10) | Not run | Owner accepted | Deferred by owner | Deferred by owner |
| Gemini 3.5 Flash-Lite | Passed | Passed | Passed (10/10 clean rerun) | Not run | Owner accepted | Deferred by owner | Deferred by owner |
| Gemini 3.7 Flash | Passed | Passed | Passed (10/10 clean rerun) | Not run | Owner accepted | Deferred by owner | Deferred by owner |

**Bottom line:** all 13 models passed technical validation through the real prompt-run path.
Each has a clean terminal 10-prompt corpus run with 10/10 attributable, non-empty answers and
completed downstream processing. The owner explicitly chose to defer stricter answer-quality
rules, provider-dashboard cost reconciliation, production canaries, and extended observation.

## Stage results

### 1. Entitlement reconciliation (model-list only, zero paid calls) — PASS
All 13 canonical IDs are present on the current provider accounts:
- OpenAI: `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.2`, `gpt-5.4`, `gpt-4.1`
- Anthropic: `claude-sonnet-5`, `claude-opus-5` (`claude-sonnet-4-5` resolves via alias → snapshot `claude-sonnet-4-5-20250929`; confirmed live in smoke)
- Google: `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

### 2. Control-plane hardening (no provider calls) — PASS
- New server-side validation on `POST /api/v1/prompt-runs`: unknown (`unknown_model`), disabled
  (`model_disabled`), vendor-paused (`vendor_paused`) model IDs and foreign-tenant prompts
  (`unknown_prompt`) are rejected; duplicate prompt/model IDs are de-duplicated (4 items, not 9,
  for a 3×3 tampered payload).
- Automated suite: `server/tests/prompt-run-model-validation.test.ts` — 10/10 pass,
  including cross-organization and stale-session internal-model authorization.
- The popup's "latest display-name version only" collapse was removed: the approved catalog
  deliberately retains multiple versions per family (GPT-5.4 + GPT-5.2 + GPT-4.1), which the old
  heuristic silently hid.
- The internal-only gate remains available for future unvalidated candidates. The validated
  cohort is no longer seeded as candidate-only.

### 3. Live smoke (3 deterministic prompts/model, real Start Prompt Run path) — 13/13 PASS
All models 3/3 valid, correctly attributed completions after wiring fixes (below).
Wall time per 3-prompt run: 16–81 s.

### 4. Shared 10-prompt corpus (factual/brand/comparison/ranking/recommendation/citation/long-form/multilingual/refusal/safety) — 13/13 PASS
- Every model has one clean `done` corpus run with all ten items complete and all ten answers
  non-empty. Clean serial reruns resolved the four previously ambiguous cases: GPT-5.6 Terra,
  Claude Sonnet 4.5, Gemini 3.5 Flash-Lite, and Gemini 3.7 Flash.
- Avg answer length among generated answers is approximately 3.0k–8.8k characters. Run wall time
  is not a clean provider-latency measure because it includes scoring/benchmarking work.
- No misattribution, no silent fallback, no auth/entitlement errors, no 429s observed.

### 5. Blind quality review and owner decision
Two independent blind reviewers scored the stored corpus. Five models met the initially proposed
strict floor: GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.4, GPT-5.2, and GPT-4.1. The other eight gave more
actionable speed-limiter-removal detail than that draft floor allowed. This was an answer-policy
finding, not a technical or provider failure. After reviewing the finding, the owner explicitly
approved enabling all technically validated models and deferred answer-quality rules to later work.

### 6. Resilience and capacity — STOPPED BY OWNER AS NON-BLOCKING
Nine models completed a successful three-prompt run plus an intentionally cancelled two-prompt run.
Those cancellations were deliberate control tests, not provider errors. The owner stopped the
remaining expanded program because technical validation was already conclusive. No production
canary or provider-dashboard cost reconciliation is claimed.

### 7. Wiring defects found and fixed (server/services/ai-executor.ts)
1. GPT-5.6 generation rejects non-default `temperature` (400) → temperature omitted for `gpt-5.6*`.
2. GPT-5.6 generation exhausts 4000 completion tokens on reasoning (`finish_reason: length`, empty
   text) → budget raised to 8000.
3. Claude 5 generation emits a thinking block before the text block; old code read `content[0]`
   only → silent-empty answers stored as success. Now finds the first text block, and empty
   Anthropic/Gemini responses are recorded as errors (parity with the OpenAI path).
4. Claude 5 generation starves at `max_tokens: 2000` (`stop_reason: max_tokens`) → 8000 for that
   generation.
5. Gemini 3.x generation added to the reasoning-model token-budget branch (16000).

### 8. Rollback rehearsal — PASS (0.6 s, target ≤ 15 min)
All six candidates disabled through the real admin endpoint: removed from the consumer catalog
instantly, submissions rejected with `model_disabled`, in-flight benchmarking tails cancelled by
the cascade with explicit per-item audit errors, historical runs/answers fully intact. The current
UI labels these administrative post-answer cancellations as `error`; this is operationally
misleading but does not mean the provider answers failed.

### 9. History integrity — PASS
No model rows deleted; all TEST runs and answers render with their original model joins, including
runs whose models are now disabled.

## Live-call accounting
Logical live items created: 48 smoke (39 final successful-screening items plus 9 items in superseded
pre-fix runs), 170 corpus items (including 40 clean rerun items), 1 Terra retry, and 45 resilience
items (27 successful-run items plus 18 intentionally cancelled-run items) = **264**. This is within
the owner-approved expanded ceiling of 314. The app does not durably persist raw provider attempts
or provider token usage/cost for generic runs; provider-dashboard reconciliation was deferred and
exact retry amplification cannot be claimed from the database.

## Final catalog decision
- **Core (exactly one current flagship per generation vendor):** GPT-5.6 Terra, Claude Sonnet 5,
  Gemini 3.7 Flash.
- **Additional:** every other enabled model, including GPT-5.6 Luna.
- GPT-5.6 Terra and GPT-5.6 Luna are enabled and visible to normal users; their earlier disabled
  state was only a temporary candidate-validation safeguard.
- The popup sorts Core and Additional models by vendor (OpenAI, Anthropic, Google, Perplexity),
  then newest/current model first within each vendor.
- Historical and deprecated model rows remain preserved; no validation evidence was deleted.
