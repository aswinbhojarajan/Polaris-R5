# 12 — LLM Models, Prompts, and Orchestration

This document enumerates every place the codebase calls a model, with provider, model, params, prompt structure, output schema, and downstream effect.

> **Update 2026-05-05 (Task #38)**: every internal call site now resolves its
> model via `server/config/llm-functions.ts`. Each function key has a default
> on the GPT-5.4 family and a per-key `LLM_<FUNCTION>_MODEL` env override.
> `REPORT_AI_MODEL` and `LLM_MODEL` are kept as backward-compat fallbacks for
> `narrativeReport` and `aeoScoring` respectively. The resolved table is
> printed at boot under `[LLM Functions] Resolved model configuration:`. See
> `docs/audits/LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md` for the full inventory and
> the env-var → function mapping.

## Provider abstraction layers

Polaris has **two parallel LLM stacks**:

1. **Provider-agnostic JSON-with-repair stack** — `server/llm/{client,openai,anthropic}.ts`. Used by **scoring, classification, mention/sentiment/ranking extraction, onboarding enrichment**. Forces JSON via system prompt + (OpenAI) `response_format: { type: 'json_object' }`. Single repair attempt on validation failure.
   - Default provider/model from `AEO_CONFIG` (env: `LLM_PROVIDER`, `LLM_MODEL`).
   - System prompt: `JSON_SYSTEM_PROMPT` (`llm/client.ts`).

2. **Direct multi-vendor execution stack** — `server/services/ai-executor.ts`. Used by **`prompt-run-executor.ts` to actually run user prompts against selected `aiModels`**. Calls OpenAI / Anthropic / Google (Gemini via OpenAI-compat) / Perplexity (OpenAI-compat).
   - Per-vendor `switch` in `executePrompt`.
   - Plain text outputs (no JSON enforcement).

3. **Top-level metadata stack** — `server/openai-service.ts`. Used by **onboarding metadata generation** (topics, prompts, content). Uses the OpenAI SDK directly with `LLM_FUNCTIONS.metadata` / `recommendations` / `optimizedContent` (defaults: GPT-5.4).

4. **Reporting stack** — `server/services/narrative-generator.ts`. Two-pass GPT generation for executive reports. Model from `REPORTING_CONFIG.AI_MODEL` which now reads `LLM_FUNCTIONS.narrativeReport` (default `gpt-5.4`; legacy `REPORT_AI_MODEL` still honored).

5. **X-Ray analysis stack** — `server/services/xray-content-analyzer.ts`. Per-page AI analysis using `LLM_FUNCTIONS.xrayAnalyzer` / `xrayBatch` (default `gpt-5.4-mini`) via `buildOpenAIRequestParams`.

6. **Recommendation stack** — `server/services/content-recommendation-analyzer.ts`. Uses `LLM_FUNCTIONS.contentRecommendation` (default `gpt-5.4-mini`).

## Consolidated model table

| Caller | Provider | Model | Temp | Max tokens | JSON mode | Schema | Source |
|--------|----------|-------|------|------------|-----------|--------|--------|
| `OpenAIClient.generateJson` | OpenAI | `LLM_FUNCTIONS.aeoScoring` (default `gpt-5.4-mini`; `LLM_AEO_SCORING_MODEL` or legacy `LLM_MODEL`) | `AEO_CONFIG.temperature = 0` | `AEO_CONFIG.maxTokens` (4096 for nano/mini, 16384 for gpt-4o/gpt-5) | `json_object` | per call (Zod) | `server/llm/openai.ts`. |
| `AnthropicClient.generateJson` | Anthropic | `LLM_FUNCTIONS.aeoScoringAnthropic` (default `claude-sonnet-4-5`; `LLM_AEO_SCORING_ANTHROPIC_MODEL` or legacy `LLM_MODEL`) | `0` | `AEO_CONFIG.maxTokens` (8192) | implicit (system prompt) | per call (Zod) | `server/llm/anthropic.ts`. |
| `executeOpenAI` (prompt-run) | OpenAI | per `aiModels.model` | `0.7` (skipped for `gpt-5-mini` reasoning) | `2000` (default), `4000` (`gpt-5*`), `8000` (`gpt-5-mini` reasoning) | none | n/a (free text) | `server/services/ai-executor.ts:78`. |
| `executeAnthropic` (prompt-run) | Anthropic | per `aiModels.model` | n/a | `2000` | none | n/a | `ai-executor.ts:155`. |
| `executeGemini` (prompt-run) | Google (OpenAI-compat) | per `aiModels.model` (e.g., `gemini-2.5-pro`) | `0.7` | `4000`, or `16000` if model includes `2.5`/`3-pro` (reasoning) | none | n/a | `ai-executor.ts:194`. |
| `executePerplexity` (prompt-run) | Perplexity (OpenAI-compat) | per `aiModels.model` | `0.7` | `2000` | none | n/a | `ai-executor.ts:240`. |
| `generateMetadataFromWebsite` | OpenAI | `gpt-4-turbo-preview` | (default) | (default) | none | parsed JSON | `server/openai-service.ts:167`. |
| `generateAITopicsFromMetadata` | OpenAI | `gpt-4-turbo-preview` | (default) | (default) | none | parsed JSON | `server/openai-service.ts:265`. |
| `generatePromptsFromTopics` | OpenAI | `gpt-4-turbo-preview` | (default) | (default) | none | parsed JSON | `server/openai-service.ts:342`. |
| `narrative-generator` (consulting synthesizer pass 1) | OpenAI | `REPORTING_CONFIG.AI_MODEL` (default `gpt-5.1`) | `REPORTING_CONFIG.AI_TEMPERATURE` (default `0.7`) | as built by `openai-compat.ts` | json_object (per `requestParams`) | 12-section JSON | `server/services/narrative-generator.ts:1856`. |
| `narrative-generator` (response summarization pass) | OpenAI | same | same | same | json_object | summary JSON | `narrative-generator.ts:2600`. |
| `xray-content-analyzer` | OpenAI | `gpt-4o-mini` | (per request) | per `buildOpenAIRequestParams` | implicit | per analyzer schema | `xray-content-analyzer.ts:75`. |
| `content-recommendation-analyzer` | OpenAI | `gpt-4o-mini` | (per request) | (per request) | n/a | parsed JSON | `content-recommendation-analyzer.ts:268`. |
| `competitor-discovery` (LLM enrichment) | OpenAI | `gpt-4-turbo-preview` | (default) | (default) | none | parsed JSON | `competitor-discovery.ts:91`. |
| `prompt-classifier` | OpenAI | (default model in classifier) | (default) | (default) | implicit | category | `prompt-classifier.ts`. |
| `OnboardingEnrichmentService.*` | via `getClient()` (provider-agnostic) | `LLM_MODEL` | `0.3` (per `enrichUrls`) | `AEO_CONFIG.maxTokens` | yes | Zod (`urlEnrichmentSchema`, `profileEnrichmentSchema`, `competitorEnrichmentSchema`) | `onboarding-enrichment.ts`. |
| `mentionExtractor.llm` | via `getClient()` | as configured | `0` | as configured | yes | Zod | `mentionExtractor.llm.ts`. |
| `sentimentAbsa.llm` | via `getClient()` | as configured | `0` | as configured | yes | Zod (ABSA scores) | `sentimentAbsa.llm.ts`. |
| `rankingExtractor.llm` | via `getClient()` | as configured | `0` | as configured | yes | Zod (group-aware rankings) | `rankingExtractor.llm.ts`. |

## OpenAI compatibility helper

`server/utils/openai-compat.ts` (`buildOpenAIRequestParams`):
- Maps `max_tokens` ↔ `max_completion_tokens` based on model family.
- Suppresses unsupported params for reasoning models (`gpt-5*`, `o1`, `gpt-5-mini`).
- Threads `OPENAI_REASONING_EFFORT` (default `medium`) into `reasoning_effort` when model supports it.

## Provider system prompts (run-time)

`ai-executor.ts` uses one shared system prompt for all four vendors when running user prompts:

```
You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order
```

This prompt is intentionally permissive — its job is to **maximize realistic ranking + citation behavior** so downstream extractors have signals to work with.

## Special cases / fallbacks

- **Empty / content-filtered responses** are treated as errors so they don't poison scoring (`ai-executor.ts:124`).
- **429 rate limits** propagate as `isRateLimited: true`, surfaced through `batch-executor.ts` to throttle.
- **JSON-parse errors** in any `getClient().generateJson()` call get one repair pass via `generateJsonWithRepair` (`server/llm/client.ts`).
- **Sentiment fallback chain** in `scoring.ts: calculateSentimentScoreAsync`:
  1. LLM ABSA (`sentimentAbsa.llm.ts`) if `entityMentions.length > 0`.
  2. Direct LLM sentiment via `analyzeDirectSentiment` if mentions empty but brand+text known.
  3. Heuristic regex (`findMentionsWithSentiment`).
  4. Heuristic on supplied mentions (`calculateSentimentScoreHeuristic`).

## Cost & telemetry

- `report_jobs.tokensUsed`, `report_jobs.costUsd` capture cost for each report run; computed by `narrative-generator.ts` (assumption: from token counts × model price; verify in code).
- `aiModels.costPer1kInput`, `costPer1kOutput` are seeded but no LLM-call-level cost log per prompt run is persisted today. **Gap**.

## Orchestration: per-prompt-run

`prompt-run-executor.ts` does:
1. Loads run, prompts, models, client, competitors.
2. Builds a `BatchItem[]` of (prompt × model) pairs.
3. `executeBatch` (`batch-executor.ts`) runs them with bounded concurrency, retries on 429.
4. For each item, `executePrompt(...)` returns `rawResponse`.
5. Citations extracted (`citation-extractor.ts`).
6. Mentions detected (heuristic or LLM, per `AEO_MODE`).
7. Rankings extracted (heuristic or LLM, per `AEO_MODE`).
8. Visibility / Sentiment / Position scored (see `15-`).
9. Score factors persisted (`score-explainability.ts`).
10. After all items: `competitor-scoring.ts` runs the same pipeline for each competitor.
11. Optional content-recommendation analysis runs per the post-scoring stage.
12. `prompt_runs.status` advances `running → scoring → queued_for_benchmarking → benchmarking → done`.

## Orchestration: report generation

`report-job-processor.ts` consumes a `report_jobs` row:
1. **Aggregate** (`report-snapshot.ts` → `report-aggregator.ts`) → `SnapshotData` JSON saved on `report_snapshots.snapshotData`.
2. **Summarize responses** (`response-summarizer.ts` + first GPT pass).
3. **Analyze / generate narrative** (`narrative-generator.ts` second GPT pass) producing 12-section JSON.
4. **Render** via `pdf-template.ts` + `pdf-renderer.ts` to two PDFs (Insights + Appendix).
5. Persist `report_files` rows with type `insights_pdf` / `appendix_pdf` / `pdf` / `json` / `csv_zip`.
6. Update `report_jobs.status = 'completed'`, `report_snapshots.status = 'ready'`.
