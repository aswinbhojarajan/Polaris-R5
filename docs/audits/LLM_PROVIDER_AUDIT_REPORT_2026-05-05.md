# LLM Provider Audit Report — 2026-05-05

Audit performed as part of Task #38 (replicate the 30-Mar-2026 LLM uplift in
the Polaris repo). Inventories every internal call site that talks to an LLM
provider so the team has a single, auditable view of which model each
function uses and how it can be overridden.

## Resolution flow

```
LLM_<FUNCTION>_MODEL  →  REPORT_AI_MODEL / LLM_MODEL (legacy)  →  LLM_FUNCTION_DEFAULTS
```

`server/config/llm-functions.ts` is the single source of truth. It logs the
resolved table at boot under `[LLM Functions] Resolved model configuration:`.

## Function inventory

| Function key            | Default          | Env override                          | Call sites |
|-------------------------|------------------|---------------------------------------|------------|
| `metadata`              | `gpt-5.4`        | `LLM_METADATA_MODEL`                  | `server/openai-service.ts` (3× metadata generation) |
| `topics`                | `gpt-5.4`        | `LLM_TOPICS_MODEL`                    | reserved for topic extraction; currently shares `metadata` paths |
| `prompts`               | `gpt-5.4`        | `LLM_PROMPTS_MODEL`                   | reserved for prompt generation pipeline |
| `competitorDiscovery`   | `gpt-5.4`        | `LLM_COMPETITOR_DISCOVERY_MODEL`      | `server/services/competitor-discovery.ts` |
| `promptClassifier`      | `gpt-5.4-nano`   | `LLM_PROMPT_CLASSIFIER_MODEL`         | `server/services/prompt-classifier.ts` |
| `responseSummarizer`    | `gpt-5.4-mini`   | `LLM_RESPONSE_SUMMARIZER_MODEL`       | `server/services/response-summarizer.ts` |
| `xrayAnalyzer`          | `gpt-5.4-mini`   | `LLM_XRAY_ANALYZER_MODEL`             | `server/services/xray-content-analyzer.ts` |
| `xrayBatch`             | `gpt-5.4-mini`   | `LLM_XRAY_BATCH_MODEL`                | `server/services/xray-content-analyzer.ts` (batch path) |
| `contentRecommendation` | `gpt-5.4-mini`   | `LLM_CONTENT_RECOMMENDATION_MODEL`    | `server/services/content-recommendation-analyzer.ts` |
| `recommendations`       | `gpt-5.4`        | `LLM_RECOMMENDATIONS_MODEL`           | `server/openai-service.ts` (`generateRecommendations`) |
| `optimizedContent`      | `gpt-5.4`        | `LLM_OPTIMIZED_CONTENT_MODEL`         | `server/openai-service.ts` (`generateOptimizedContent`) |
| `narrativeReport`       | `gpt-5.4`        | `LLM_NARRATIVE_REPORT_MODEL` (also `REPORT_AI_MODEL` for back-compat) | `server/config/reporting.ts`, `server/services/narrative-generator.ts` |
| `aeoScoring`            | `gpt-5.4-mini`   | `LLM_AEO_SCORING_MODEL` (also `LLM_MODEL` for back-compat) | `server/config/aeo.ts` (OpenAI provider) |
| `aeoScoringAnthropic`   | `claude-sonnet-4-5` | `LLM_AEO_SCORING_ANTHROPIC_MODEL` | `server/config/aeo.ts` (Anthropic provider) |

## Provider call sites (raw model strings)

| File | Provider | Model source |
|---|---|---|
| `server/services/ai-executor.ts` | OpenAI / Anthropic / Gemini / Perplexity | dynamic — model id passed in from `ai_models` row |
| `server/llm/openai.ts` | OpenAI | constructor default `gpt-5.4-nano` (overridable per call) |
| `server/llm/anthropic.ts` | Anthropic | constructor default `claude-sonnet-4-5` |
| `server/llm/client.ts` | Anthropic fallback | `claude-sonnet-4-5` when AEO model is `gpt-*` |

## ai_models seed catalog

`server/seed.ts` exports `CORE_MODEL_IDS` and `DEPRECATED_MODEL_IDS` and runs
three idempotent passes on every boot:

1. `upsertMissingModels()` — inserts any model from `MODEL_CATALOG` not
   already present (matched by `model` column). Deprecated rows are
   inserted as `enabled = false` so a fresh DB still has them on disk and
   historical run references resolve.
2. `syncModelCategories()` — backfills `category` (`core` / `additional`).
3. `disableDeprecatedModels()` — defensively flips `enabled = false` on
   `claude-3-5-haiku-20241022` and `gemini-1.5-pro` without deleting the rows
   so historical runs continue to render even if an operator had re-enabled
   one manually.

## Retry policy

`server/services/ai-executor.ts` now treats HTTP 503 the same as 429 across
all four provider executors — the request is marked `isRateLimited` so the
job queue retry logic applies the same exponential backoff.

## Stale-score polling fix

Run-detail surfaces (`run-details-section.tsx`, `run-details-drawer.tsx`)
now poll the per-run results endpoint every 5s while the run status is in
{queued, running, scoring, queued_for_benchmarking, benchmarking}, and
freeze polling when the status hits {done, failed, stopped, cancelled,
error}. `prompts-tracker.tsx` invalidates the per-run results cache on any
active→terminal transition so already-open detail views refresh immediately.

## Out of scope

- Schema migration (the `category` column already exists, so no migration
  was required).
- Changes to AEO scoring algorithm or weights.
- Anything in Task #37 (security headers).
