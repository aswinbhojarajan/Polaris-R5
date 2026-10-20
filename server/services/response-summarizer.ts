import OpenAI from 'openai';
// Task #105 (P2) — static import so the dependency is resolved at boot
// (cold install / esbuild bundling) instead of on first call.
import pLimit from 'p-limit';
import { REPORTING_CONFIG } from '../config/reporting';
import { LLM_FUNCTIONS } from '../config/llm-functions';
import { assertVendorNotPaused, ensureVendorPauseLoaded } from '../config/vendor-pause';

export interface PromptResponseSummary {
  promptText: string;
  modelName: string;
  summary: string;
  keyPatterns: string[];
  citationCount: number;
  mentionCount: number;
  rankingCount: number;
  originalTokens: number;
  summaryTokens: number;
}

export interface BatchSummaryResult {
  summaries: PromptResponseSummary[];
  totalOriginalTokens: number;
  totalSummaryTokens: number;
  compressionRatio: number;
}

const SUMMARIZATION_PROMPT = `You are analyzing an AI model's response to a prompt for brand visibility analysis.

Your task:
1. Identify the KEY PATTERNS in how this AI model discusses the brand/topic
2. Extract the MOST IMPORTANT details about citations, mentions, and rankings
3. Condense to 100-150 words while preserving analytical value

Focus on:
- How the brand is positioned (leader, competitor, niche player, etc.)
- Citation quality and authority
- Sentiment and tone
- Ranking placement if mentioned
- Notable omissions or gaps

Output format:
{
  "summary": "2-3 sentence condensed response preserving key patterns",
  "keyPatterns": ["pattern1", "pattern2", "pattern3"]
}

Prompt: {prompt}
Model: {model}
Response: {response}

Citations: {citationCount}
Mentions: {mentionCount}
Rankings: {rankingCount}`;

export async function summarizeResponse(
  promptText: string,
  modelName: string,
  response: string,
  citationCount: number,
  mentionCount: number,
  rankingCount: number,
  openaiApiKey: string
): Promise<PromptResponseSummary> {
  // Task #78 — vendor kill switch
  await ensureVendorPauseLoaded();
  assertVendorNotPaused('OpenAI');
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const prompt = SUMMARIZATION_PROMPT
    .replace('{prompt}', promptText)
    .replace('{model}', modelName)
    .replace('{response}', response.substring(0, 4000))
    .replace('{citationCount}', citationCount.toString())
    .replace('{mentionCount}', mentionCount.toString())
    .replace('{rankingCount}', rankingCount.toString());

  const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
  const model = LLM_FUNCTIONS.responseSummarizer;
  
  const requestParams = buildOpenAIRequestParams(model, {
    messages: [
      {
        role: 'system',
        content: 'You are an expert brand visibility analyst. Provide concise, analytical summaries in JSON format.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    responseFormat: { type: 'json_object' },
    temperature: 0.3,
    maxTokens: 300,
  });

  const completion = await openai.chat.completions.create(requestParams);

  const rawResponse = completion.choices[0].message.content || '{}';
  const result = JSON.parse(rawResponse);
  
  if (!result.summary || result.summary.length < 50) {
    console.warn(`[Summarizer] Warning: Summary is too short (${result.summary?.length || 0} chars) for prompt "${promptText.substring(0, 50)}..."`);
  }
  
  const originalTokens = completion.usage?.prompt_tokens || 0;
  const summaryTokens = completion.usage?.completion_tokens || 0;

  return {
    promptText,
    modelName,
    summary: result.summary || '',
    keyPatterns: result.keyPatterns || [],
    citationCount,
    mentionCount,
    rankingCount,
    originalTokens,
    summaryTokens,
  };
}

/**
 * Task #105 (P2) — Concurrency-controlled summarizer.
 *
 * The previous implementation issued batches of 5 in parallel and
 * `setTimeout(1000)` between batches "to be nice to OpenAI". For a
 * 200-response project that's ~40s of literal sleep. We replace it with
 * `p-limit` so we keep N requests in flight at all times and trust the
 * existing OpenAI-side retry/backoff for actual rate-limit handling.
 *
 * Concurrency is configurable via `LLM_SUMMARIZER_CONCURRENCY` (default 8).
 */
export async function summarizeResponsesBatch(
  responses: Array<{
    promptText: string;
    modelName: string;
    answer: string;
    citationCount: number;
    mentionCount: number;
    rankingCount: number;
  }>,
  openaiApiKey: string,
  concurrency?: number,
): Promise<BatchSummaryResult> {
  if (!openaiApiKey) {
    throw new Error('OpenAI API key is required for summarization');
  }

  const limit = pLimit(
    concurrency ??
      parseInt(process.env.LLM_SUMMARIZER_CONCURRENCY || '8', 10),
  );

  let totalOriginalChars = 0;

  const tasks = responses.map((r) =>
    limit(async () => {
      if (!r.promptText || r.promptText.trim().length === 0) {
        throw new Error('Cannot summarize response with empty prompt text');
      }
      if (!r.modelName || r.modelName.trim().length === 0 || r.modelName === 'Unknown') {
        throw new Error('Cannot summarize response with missing or unknown model name');
      }
      if (!r.answer || r.answer.trim().length === 0) {
        throw new Error('Cannot summarize response with empty answer text');
      }
      totalOriginalChars += r.answer.length;
      return summarizeResponse(
        r.promptText,
        r.modelName,
        r.answer,
        r.citationCount,
        r.mentionCount,
        r.rankingCount,
        openaiApiKey,
      );
    }),
  );

  const summaries = await Promise.all(tasks);
  const totalSummaryChars = summaries.reduce(
    (sum, s) => sum + s.summary.length,
    0,
  );
  const compressionRatio =
    totalOriginalChars > 0 && totalSummaryChars > 0
      ? totalOriginalChars / totalSummaryChars
      : 1;

  return {
    summaries,
    totalOriginalTokens: totalOriginalChars,
    totalSummaryTokens: totalSummaryChars,
    compressionRatio,
  };
}
