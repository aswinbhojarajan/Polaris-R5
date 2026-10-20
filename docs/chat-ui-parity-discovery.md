# Chat UI Parity Mode - Phase 0 Discovery Document

**Date:** December 2025  
**Status:** Discovery Complete  
**Author:** AI Assistant

---

## Executive Summary

This document catalogs the API capabilities, costs, rate limits, and implementation requirements for enabling "Chat UI Parity Mode" - making Polaris API responses match each vendor's chat UI behavior through web search grounding.

---

## 1. OpenAI - Responses API with Web Search

### API Endpoint
- **New API:** Responses API (`/v1/responses`) - Released March 2025
- **Tool:** `web_search` (built-in)

### Implementation

```typescript
// Using OpenAI SDK
const response = await openai.responses.create({
  model: "gpt-5.1",
  input: promptText,
  instructions: systemPrompt,  // replaces system message
  temperature: 0.7,
  tools: [{ type: "web_search" }]
});

// Access response
const rawResponse = response.output_text;
```

### Response Structure Changes
| Chat Completions | Responses API |
|-----------------|---------------|
| `response.choices[0].message.content` | `response.output_text` |
| `messages[]` array | `input` (string or messages) |
| System message | `instructions` parameter |

### Pricing
- Standard token pricing (same as chat completions)
- Web search: Included with model usage (no separate fee documented)
- **40-80% cache hit improvement** → potentially lower costs

### Rate Limits
- Same as Chat Completions API
- Model-specific limits apply

### SDK Requirements
- Requires `openai` package version with Responses API support
- Current SDK should support it

### Risks & Considerations
- ⚠️ Different response structure requires adapter
- ⚠️ May need to upgrade OpenAI SDK
- ✅ Automatic tool execution (no manual loop needed)

---

## 2. Anthropic Claude - Web Search Tool

### API Endpoint
- **Existing API:** Messages API (`/v1/messages`)
- **Tool:** `web_search_20250305` (server-side tool)

### Implementation

```typescript
// Using Anthropic SDK
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 2000,
  system: systemPrompt,
  messages: [{ role: 'user', content: promptText }],
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5,  // Optional: limit searches per request
    // Optional domain filtering:
    // allowed_domains: ["example.com"],
    // blocked_domains: ["untrusted.com"]
  }]
});
```

### Response Structure
- Same `response.content[0].text` structure
- Additional `usage.server_tool_use.web_search_requests` for tracking

### Pricing
- **$10 per 1,000 searches** + standard token costs
- Example: 100 prompts × 2 searches each = $2.00 search cost

### Rate Limits
- Standard Claude rate limits apply
- Search provider: Brave Search (managed by Anthropic)

### Supported Models
- Claude 3.7 Sonnet ✅
- Claude 3.5 Sonnet (upgraded) ✅
- Claude 3.5 Haiku ✅
- Claude Sonnet 4.5 ✅ (current)

### Prerequisites
- Organization admin must enable in Anthropic Console (Settings → Privacy/Tool Usage)

### Risks & Considerations
- ⚠️ **$10/1k searches is significant cost** - need budget controls
- ⚠️ Claude autonomously decides when to search (no manual trigger)
- ⚠️ Requires org admin to enable feature first
- ✅ Same response format - minimal adapter needed

---

## 3. Google Gemini - Google Search Grounding

### API Endpoint
- **Current API:** Gemini Developer API / Vertex AI
- **Tool:** `google_search`

### Implementation

```typescript
// Using Google Generative AI SDK
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const response = await model.generateContent({
  contents: [{ parts: [{ text: promptText }] }],
  tools: [{ google_search: {} }],
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 2000
  }
});
```

### ⚠️ NOT Compatible with OpenAI-Compatible Endpoint
The current implementation uses:
```typescript
const gemini = new OpenAI({
  apiKey: process.env.GOOGLE_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
});
```

**This OpenAI-compatible endpoint does NOT support `google_search` tool.**
Must use native Gemini SDK for grounding.

### Response Structure
- Different from current implementation
- Includes `groundingMetadata` with:
  - `webSearchQueries` - queries executed
  - `groundingChunks` - source URLs, titles, domains
  - `groundingSupports` - text segments with confidence scores
  - `searchEntryPoint` - **REQUIRED** UI element (Google ToS)

### ⚠️ Display Requirements (Legal)
Google Terms of Service REQUIRE displaying:
1. "Search Suggestions" HTML from `searchEntryPoint.renderedContent`
2. Citations linking text to sources

### Pricing
- **$14 per 1,000 search queries** (Gemini 3+)
- Per query executed (not per prompt)
- If model runs 3 searches for 1 prompt → billed for 3 queries
- **Billing starts January 5, 2026 for Gemini 3**
- Currently free in Google AI Studio for testing

### Rate Limits
- Gemini free tier: ~2 req/min (Pro), ~15 req/min (Flash)
- **Already hitting rate limits** in current implementation
- Need billing enabled for production use

### Risks & Considerations
- 🚨 **Major refactor required** - cannot use OpenAI-compatible endpoint
- 🚨 **Legal requirement** to display Search Suggestions UI
- ⚠️ **Rate limits** are restrictive on free tier
- ⚠️ **SDK change** - need `@google/generative-ai` package
- ⚠️ **Different response format** - needs adapter

---

## 4. Perplexity - Built-in Web Search

### API Endpoint
- **Current API:** Chat Completions (OpenAI-compatible)
- **Tool:** Built-in with online models

### Implementation
```typescript
// Current implementation already works!
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai'
});

const response = await perplexity.chat.completions.create({
  model: "sonar",  // or sonar-pro, sonar-reasoning
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: promptText }
  ],
  temperature: 0.7,
  // Optional: filter search recency
  // search_recency_filter: "month"  // day, week, month, year
});
```

### Model Options for Parity Mode
| Model | Best For | Web Search |
|-------|----------|------------|
| `sonar` | Standard queries | ✅ Built-in |
| `sonar-pro` | Complex queries, 200K context | ✅ Built-in |
| `sonar-reasoning` | Analysis with citations | ✅ Built-in |
| `sonar-deep-research` | Deep Research mode (like UI) | ✅ Built-in |

### Pricing
| Model | Input | Output | Request Fee |
|-------|-------|--------|-------------|
| Sonar | $1/M | $1/M | $5-12/1K requests |
| Sonar Pro | $3/M | $15/M | $6-14/1K requests |
| Sonar Reasoning | $1/M | $5/M | $5-12/1K requests |
| Sonar Deep Research | $2/M | $8/M | $5/1K + $3/M reasoning |

### Rate Limits
| Tier | Cumulative Spend | RPM |
|------|-----------------|-----|
| Tier 0 | New | Most restricted |
| Tier 1 | $5+ | Improved |
| Tier 2 | $50+ | Higher |
| Tier 3 | $500+ | Significantly increased |
| Tier 4+ | $1,000+ | Enterprise level |

- Standard: ~50 requests/min
- Uses leaky bucket algorithm

### Risks & Considerations
- ✅ **Already works!** Current implementation uses sonar models
- ✅ **No code changes needed** for basic parity
- ⚠️ Request fees add to cost
- ⚠️ Rate limits need monitoring at scale

---

## 5. Cost Comparison Summary

| Provider | Web Search Cost | Notes |
|----------|----------------|-------|
| **OpenAI** | Included | No separate search fee |
| **Anthropic** | $10/1K searches | Significant for high volume |
| **Gemini** | $14/1K queries | Free until Jan 2026 |
| **Perplexity** | $5-14/1K requests | Request fee always applies |

### Cost Estimate for 1,000 Prompts (assuming 1.5 searches/prompt avg)

| Provider | Token Cost (~2K tokens) | Search Cost | Total |
|----------|------------------------|-------------|-------|
| OpenAI | ~$3.00 | ~$0 | ~$3.00 |
| Anthropic | ~$4.50 | ~$15.00 | ~$19.50 |
| Gemini | ~$1.50 | ~$21.00 | ~$22.50 |
| Perplexity | ~$2.00 | ~$7.50 | ~$9.50 |

---

## 6. Implementation Complexity Matrix

| Provider | SDK Change | API Change | Response Adapter | Legal Req | Complexity |
|----------|-----------|------------|------------------|-----------|------------|
| **OpenAI** | Maybe | Responses API | Yes (minor) | No | Medium |
| **Anthropic** | No | Add tool | Yes (minor) | No | Low |
| **Gemini** | Yes (new SDK) | Complete rewrite | Yes (major) | Yes | High |
| **Perplexity** | No | None | No | No | None |

---

## 7. Recommended Implementation Order

Based on complexity and impact:

1. **Perplexity** - Already working, just need model selection logic
2. **Anthropic** - Low complexity, same SDK, just add tool
3. **OpenAI** - Medium complexity, new API but same SDK
4. **Gemini** - High complexity, requires SDK change and legal compliance

---

## 8. Architecture Recommendation

### Option A: Adapter Pattern (Recommended)

```typescript
interface ParityModeAdapter {
  executeWithWebSearch(prompt: string, model: string): Promise<AIExecutionResult>;
}

// Create adapters per vendor
class OpenAIParityAdapter implements ParityModeAdapter { ... }
class AnthropicParityAdapter implements ParityModeAdapter { ... }
class GeminiParityAdapter implements ParityModeAdapter { ... }
class PerplexityParityAdapter implements ParityModeAdapter { ... }
```

### Option B: Flag-Based Branching (Simpler)

```typescript
async function executePrompt(
  promptText: string,
  vendor: string,
  model: string,
  options: { parityMode?: boolean } = {}
): Promise<AIExecutionResult> {
  if (options.parityMode) {
    switch (vendor.toLowerCase()) {
      case 'openai': return executeOpenAIParity(promptText, model);
      case 'anthropic': return executeAnthropicParity(promptText, model);
      // ...
    }
  }
  // Existing implementation
}
```

**Recommendation:** Start with Option B for Phase 1-2, refactor to Option A if complexity grows.

---

## 9. Configuration Schema Proposal

### Database Schema Addition

```sql
-- Add to prompt_runs table
ALTER TABLE prompt_runs 
ADD COLUMN execution_mode VARCHAR(20) DEFAULT 'standard';
-- Values: 'standard', 'chat_parity'

-- Optional: Add to ai_models table
ALTER TABLE ai_models
ADD COLUMN supports_web_search BOOLEAN DEFAULT false;
```

### Environment Variables

```bash
# Feature flag (global kill switch)
ENABLE_CHAT_PARITY_MODE=false

# Provider-specific enables (optional granularity)
ENABLE_OPENAI_PARITY=true
ENABLE_ANTHROPIC_PARITY=true
ENABLE_GEMINI_PARITY=false  # Due to complexity
ENABLE_PERPLEXITY_PARITY=true
```

---

## 10. Open Questions

1. **Gemini Legal Compliance:** How do we display "Search Suggestions" in our UI? Is this a blocker?

2. **Cost Controls:** Should we implement per-client budget limits for web search usage?

3. **A/B Testing:** Do we need to compare parity vs standard results before full rollout?

4. **SDK Updates:** What's the current OpenAI SDK version? Does it support Responses API?

5. **Anthropic Admin:** Is web search enabled in the Anthropic Console for this org?

---

## 11. Next Steps

### Phase 1 Readiness Checklist

- [ ] Confirm OpenAI SDK version supports Responses API
- [ ] Verify Anthropic Console has web search enabled
- [ ] Decide on Gemini approach (implement now vs defer)
- [ ] Review cost projections with stakeholders
- [ ] Create feature flag in environment
- [ ] Design Start Run dialog toggle

---

## Appendix: API Documentation Links

| Provider | Documentation |
|----------|--------------|
| OpenAI Responses API | https://platform.openai.com/docs/api-reference/responses |
| Anthropic Web Search | https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool |
| Gemini Grounding | https://ai.google.dev/gemini-api/docs/google-search |
| Perplexity Pricing | https://docs.perplexity.ai/getting-started/pricing |
