import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { performanceLogger } from './performance-logger';
import { ensureVendorPauseLoaded, isVendorPaused } from '../config/vendor-pause';
import { withVendorRetry } from '../llm/retry';

export interface AIExecutionResult {
  rawResponse: string;
  error?: string;
  durationMs?: number;
  provider?: string;
  isRateLimited?: boolean;
  statusCode?: number;
}

export async function executePrompt(
  promptText: string,
  vendor: string,
  model: string,
  runId?: string
): Promise<AIExecutionResult> {
  const startTime = Date.now();
  const providerName = vendor.toLowerCase();

  // Task #78 — Vendor kill switch. Refuse to dispatch if the admin has
  // paused this vendor (e.g. provider outage, budget cap). We block on
  // the first cache load so a freshly-paused vendor takes effect on the
  // very next executePrompt call without a restart.
  await ensureVendorPauseLoaded();
  if (isVendorPaused(vendor)) {
    const durationMs = Date.now() - startTime;
    if (runId) {
      performanceLogger.logApiCall(runId, providerName, durationMs, 503, true);
    }
    console.log(`[AI-Executor] ${providerName}/${model}: BLOCKED (vendor paused)`);
    return {
      rawResponse: '',
      error: `Vendor "${vendor}" is paused by an admin.`,
      durationMs,
      provider: providerName,
      isRateLimited: false,
      statusCode: 503,
    };
  }

  try {
    let result: AIExecutionResult;
    
    switch (providerName) {
      case 'openai':
        result = await executeOpenAI(promptText, model);
        break;
      case 'anthropic':
        result = await executeAnthropic(promptText, model);
        break;
      case 'google':
        result = await executeGemini(promptText, model);
        break;
      case 'perplexity':
        result = await executePerplexity(promptText, model);
        break;
      default:
        throw new Error(`Unsupported AI vendor: ${vendor}`);
    }
    
    const durationMs = Date.now() - startTime;
    result.durationMs = durationMs;
    result.provider = providerName;
    
    // Log performance metrics using actual status codes from provider responses
    if (runId) {
      const statusCode = result.statusCode ?? 200;
      performanceLogger.logApiCall(runId, providerName, durationMs, statusCode, !!result.error);
    }
    
    console.log(`[AI-Executor] ${providerName}/${model}: ${(durationMs / 1000).toFixed(2)}s${result.error ? ` (ERROR: ${result.error})` : ''}`);
    
    return result;
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    // Extract actual HTTP status code from SDK error objects
    const statusCode = error?.status || error?.response?.status || 500;
    const isRateLimited = statusCode === 429 || statusCode === 503;
    
    if (runId) {
      performanceLogger.logApiCall(runId, providerName, durationMs, statusCode, true);
    }
    
    console.log(`[AI-Executor] ${providerName}/${model}: ${(durationMs / 1000).toFixed(2)}s (EXCEPTION: ${errorMsg}, status=${statusCode})`);
    
    return {
      rawResponse: '',
      error: errorMsg,
      durationMs,
      provider: providerName,
      isRateLimited,
      statusCode
    };
  }
}

async function executeOpenAI(promptText: string, model: string): Promise<AIExecutionResult> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const systemPrompt = `You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order`;

  // GPT-5.x models have different API requirements
  const isGpt5Model = model.startsWith('gpt-5');
  const isGpt5Mini = model === 'gpt-5-mini';
  
  const requestParams: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptText }
    ],
  };
  
  // GPT-5-mini is a reasoning model - doesn't support custom temperature
  // and needs higher token limit to account for reasoning tokens.
  // Task #25 — the GPT-5.6 generation (terra/luna/sol) rejects any
  // non-default temperature with a 400, so omit it there too.
  const isGpt56 = model.startsWith('gpt-5.6');
  if (!isGpt5Mini && !isGpt56) {
    requestParams.temperature = 0.7;
  }
  
  // Use correct token parameter based on model
  if (isGpt5Mini) {
    // GPT-5-mini is a reasoning model that uses tokens for internal "thinking"
    // Need higher limit: ~1000 for reasoning + ~2000 for output
    requestParams.max_completion_tokens = 8000;
  } else if (isGpt56) {
    // Task #25 — the GPT-5.6 generation reasons before answering; 4000
    // tokens can be fully consumed by reasoning (finish_reason=length with
    // empty text). Give it the same headroom as gpt-5-mini.
    requestParams.max_completion_tokens = 8000;
  } else if (isGpt5Model) {
    // GPT-5.x models need higher token limits to avoid truncation
    requestParams.max_completion_tokens = 4000;
  } else {
    requestParams.max_tokens = 2000;
  }

  try {
    // Task #115 — retry transient 429/5xx/network failures with jitter.
    const response = await withVendorRetry('OpenAI', () =>
      openai.chat.completions.create(requestParams),
    );
    const rawResponse = response.choices[0]?.message?.content || '';
    
    // Check for content filter or empty response (possible content moderation)
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === 'content_filter') {
      console.warn(`[AI-Executor] OpenAI/${model}: Content filtered by moderation policy`);
      return { 
        rawResponse: '', 
        error: 'Content filtered by OpenAI moderation policy',
        statusCode: 200 
      };
    }
    
    // Treat empty response as an error to prevent saving zero scores
    if (!rawResponse || rawResponse.trim() === '') {
      console.warn(`[AI-Executor] OpenAI/${model}: Empty response received. Finish reason: ${finishReason}. Treating as error.`);
      return { 
        rawResponse: '', 
        error: `Empty response from OpenAI (finish_reason: ${finishReason || 'unknown'})`,
        statusCode: 200 
      };
    }
    
    return { rawResponse, statusCode: 200 };
  } catch (error: any) {
    const statusCode = error?.status || error?.response?.status || 500;
    const isRateLimited = statusCode === 429 || statusCode === 503;
    return { 
      rawResponse: '', 
      error: error?.message || 'OpenAI API error',
      statusCode,
      isRateLimited
    };
  }
}

async function executeAnthropic(promptText: string, model: string): Promise<AIExecutionResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const systemPrompt = `You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order`;

  // Task #25 — the Claude 5 generation (claude-sonnet-5, claude-opus-5,
  // claude-fable-5) spends output budget on internal reasoning before the
  // text block; 2000 tokens starves longer answers into empty text with
  // stop_reason=max_tokens. Give that generation the same headroom as the
  // other reasoning models.
  const isClaude5Generation = /^claude-[a-z]+-5/.test(model);
  const maxTokens = isClaude5Generation ? 8000 : 2000;

  try {
    // Task #115 — retry transient 429/5xx/network failures with jitter.
    const response = await withVendorRetry('Anthropic', () =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: promptText }],
      }),
    );

    // Task #25 — reasoning-capable Claude models (e.g. Opus 5) can emit a
    // thinking block before the text block, so find the first text block
    // rather than assuming content[0]. An empty result is an error: silently
    // storing an empty answer would record zero scores against the brand.
    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    );
    const rawResponse = textBlock?.text || '';
    if (!rawResponse.trim()) {
      console.warn(`[AI-Executor] Anthropic/${model}: Empty response received (stop_reason: ${response.stop_reason ?? 'unknown'}). Treating as error.`);
      return {
        rawResponse: '',
        error: `Empty response from Anthropic (stop_reason: ${response.stop_reason ?? 'unknown'})`,
        statusCode: 200,
      };
    }

    return { rawResponse, statusCode: 200 };
  } catch (error: any) {
    const statusCode = error?.status || 500;
    const isRateLimited = statusCode === 429 || statusCode === 503;
    return { 
      rawResponse: '', 
      error: error?.message || 'Anthropic API error',
      statusCode,
      isRateLimited
    };
  }
}

async function executeGemini(promptText: string, model: string): Promise<AIExecutionResult> {
  const gemini = new OpenAI({
    apiKey: process.env.GOOGLE_API_KEY,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
  });

  const systemPrompt = `You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order`;

  // Gemini 2.5+ models are reasoning/thinking models that need higher token limits
  // (use tokens for internal reasoning like GPT-5-mini)
  // Includes: gemini-2.5-pro, gemini-2.5-flash, gemini-3-pro, and the
  // Gemini 3.x generation (gemini-3.5-flash-lite, gemini-3.7-flash, …).
  const isReasoningModel =
    model.includes('2.5') || model.includes('3-pro') || /gemini-3\./.test(model);
  const maxTokens = isReasoningModel ? 16000 : 4000;

  try {
    // Task #115 — retry transient 429/5xx/network failures with jitter.
    const response = await withVendorRetry('Google', () =>
      gemini.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: promptText },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    );

    const rawResponse = response.choices[0]?.message?.content || '';
    // Task #25 — never store a silent-empty answer as success.
    if (!rawResponse.trim()) {
      const finishReason = response.choices[0]?.finish_reason;
      console.warn(`[AI-Executor] Google/${model}: Empty response received (finish_reason: ${finishReason || 'unknown'}). Treating as error.`);
      return {
        rawResponse: '',
        error: `Empty response from Gemini (finish_reason: ${finishReason || 'unknown'})`,
        statusCode: 200,
      };
    }
    return { rawResponse, statusCode: 200 };
  } catch (error: any) {
    const statusCode = error?.status || error?.response?.status || 500;
    const isRateLimited = statusCode === 429 || statusCode === 503;
    return { 
      rawResponse: '', 
      error: error?.message || 'Gemini API error',
      statusCode,
      isRateLimited
    };
  }
}

async function executePerplexity(promptText: string, model: string): Promise<AIExecutionResult> {
  const perplexity = new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: 'https://api.perplexity.ai'
  });

  const systemPrompt = `You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order`;

  try {
    // Task #115 — retry transient 429/5xx/network failures with jitter.
    const response = await withVendorRetry('Perplexity', () =>
      perplexity.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: promptText },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    );

    const rawResponse = response.choices[0]?.message?.content || '';
    return { rawResponse, statusCode: 200 };
  } catch (error: any) {
    const statusCode = error?.status || error?.response?.status || 500;
    const isRateLimited = statusCode === 429 || statusCode === 503;
    return { 
      rawResponse: '', 
      error: error?.message || 'Perplexity API error',
      statusCode,
      isRateLimited
    };
  }
}
