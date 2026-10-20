# 13 — Prompt Library and Output Schemas

This is a curated index of the **LLM prompts** used in Polaris and the **Zod / inline schemas** they validate against. Prompt strings are reproduced abbreviated; full text lives in the cited source file.

## Onboarding (`server/services/onboarding-enrichment.ts`)

### URL enrichment
- **Function**: `OnboardingEnrichmentService.enrichUrls(clientName)`.
- **Schema**:
  ```ts
  const urlEnrichmentSchema = z.object({
    mainUrl: z.string().url(),
    otherUrls: z.array(z.string().url()).max(2),
    focusAreas: z.array(z.string()).min(3).max(8),
  });
  ```
- **Prompt** (excerpt): *"Given the company name `{clientName}`, suggest mainUrl, otherUrls (max 2), and 3–8 focus areas (business-specific, not page types)..."*
- **Params**: `temperature: 0.3` (passed inline).

### Profile enrichment
- **Schema**:
  ```ts
  const profileEnrichmentSchema = z.object({
    industry: z.string(),
    geography: z.array(z.string()).min(1).max(3),
    brandAliases: z.array(z.string()).min(1).max(10),
  });
  ```

### Competitor enrichment
- **Schema**:
  ```ts
  const competitorEnrichmentSchema = z.object({
    competitors: z.array(z.object({
      name: z.string(),
      url: z.string().url(),
      reason: z.string(),
      confidence: z.number().min(0).max(1),
      aliases: z.array(z.string()).max(10),
    })).max(10),
  });
  ```

## Metadata generation (`server/openai-service.ts`)

### `generateMetadataFromWebsite`
- **Model**: `gpt-4-turbo-preview`.
- **Inputs**: site URLs (string or string[]), companyName, optional `industry`, `geography`, `focusAreas`.
- **Pre-step**: each URL is crawled via `website-crawler.ts: crawlWebsite()` (Cheerio → Playwright fallback) and formatted via `formatCrawledContentForLLM`.
- **Output**: `GeneratedMetadata` (TypeScript interface; not Zod-validated):
  ```ts
  interface GeneratedMetadata {
    topics: { topic: string; category: string; keywords: string[] }[];
    topTopics: { category: string; topics: string[] }[];
    prompts: string[];
    crawlResults?: { sourceUrl: string; pages: any[]; totalPages: number; crawlMethod: string }[];
  }
  ```

### `generateAITopicsFromMetadata`
- **Model**: `gpt-4-turbo-preview`.
- **Purpose**: distill the curated client metadata into category-grouped topic lists.

### `generatePromptsFromTopics`
- **Model**: `gpt-4-turbo-preview`.
- **Purpose**: turn topic + keyword bundles into ~50 question-style prompts that resemble real user queries.

## Mention / sentiment / ranking extraction (LLM mode)

### Mention extraction
- **File**: `server/services/mentionExtractor.llm.ts`.
- **Output (Zod)**: list of `EntityMention { span, start, end, canonicalId, surfaceType, confidence }`.

### Sentiment ABSA
- **File**: `server/services/sentimentAbsa.llm.ts`.
- **Two callers**:
  - `analyzeSentimentABSA(doc, entityMentions)` — when mention set is known.
  - `analyzeDirectSentiment(text, brandName, aliases)` — when mentions empty (anti-hallucination validation included).
- **Output**: `EntitySentiment { canonicalId, pPos, pNeu, pNeg, confidence }[]`.

### Ranking extraction
- **File**: `server/services/rankingExtractor.llm.ts`.
- **Output (Zod)**: per-item `{ item, position, rankingGroup?, groupRelevance?, relevanceReason? }`. Group relevance is `'relevant' | 'partial' | 'irrelevant'`.

## User-prompt execution (the actual model call)

- **File**: `server/services/ai-executor.ts`.
- **System prompt** (shared across vendors): see `12-llm-models-prompts-and-orchestration.md`.
- **No JSON enforcement** — outputs are free-form text saved to `answers.rawResponse`.

## Per-page X-Ray analysis (`server/services/xray-content-analyzer.ts`)

- **Model**: `gpt-4o-mini` via `buildOpenAIRequestParams`.
- **Two paths**: per-page (`analyzePageContent`) and batched (`analyzePagesBatch`).
- **Output** (saved to `xray_page_analysis`): `{ assessment, gaps[], recommendations[], actions[], seoIssues[], freshnessData{}, consistencyData{}, complianceData{}, scores{} }`. Shape constructed in code, not declared as a Zod schema.

## Content recommendations (`server/services/content-recommendation-analyzer.ts`)

- **Model**: `gpt-4o-mini`.
- **Calling pattern**: `openai.chat.completions.create({ model, messages, response_format: { type: 'json_object' } })`.
- **Output**: array of `{ title, description, severity, category, examples?, actionItems? }` rows persisted into `recommendations`.

## Competitor discovery (`server/services/competitor-discovery.ts`)

- **Model**: `gpt-4-turbo-preview`.
- **Purpose**: enrich the competitor set beyond what onboarding produced.
- **Output**: list of competitors with reasons + confidence.

## Executive narrative (`server/services/narrative-generator.ts`)

- **Model**: `REPORTING_CONFIG.AI_MODEL` (default `gpt-5.1`).
- **Prompt**: large system+user prompt instructing the model to act as an "AEO/GEO Consulting Synthesizer" and emit a 12-section JSON object (see file lines ~40–200 for the legacy prompt and lines ~200+ for the active version). Section keys:
  ```
  executiveSummary
  diagnosticOverview
  competitiveLandscape
  visibilityPerformance
  criticalGaps
  patternAnalysis
  consultingInference
  strategicImplications
  leadershipConversations
  businessImpact
  actionPlan306090
  implementationRoadmap
  ```
- **Anti-duplication rules** are baked into the prompt to prevent repeated content across sections.
- **Two-pass flow**:
  1. *Response summarization* — `response-summarizer.ts` condenses raw answers into per-prompt `PromptResponseSummary` blocks before they enter the narrative prompt.
  2. *Narrative synthesis* — single GPT call that returns the JSON. Output is then split into `report_sections` rows keyed by `report_section_name_enum`.

## Prompt classification

- **File**: `server/services/prompt-classifier.ts`.
- **Purpose**: map a generated prompt into one of the 7 prompt categories.
- **Output**: a category slug stored on `prompts.categoryId` (FK to `prompt_categories`).

## Schema-validation pattern

All "structured output" callers use:

```ts
import { generateJsonWithRepair } from '../llm/client';
const result = await generateJsonWithRepair(client, prompt, schema, options);
```

Which:
1. Calls `client.generateJson(prompt, schema, options)` (provider-specific).
2. `extractJson(content)` strips fences if present (`server/utils/json.ts`).
3. `validateJson(data, schema)` runs Zod's `safeParse`.
4. On failure, the repaired prompt appends the validation error message and retries once.
5. Throws `Failed to generate valid JSON after repair attempt: ...` if repair also fails.

## Prompt categories

`prompt_categories` is a small lookup table seeded with category names (see `server/seed.ts` if seeded; otherwise inserted by manual setup). The frontend uses these categories to organize the prompt library.
