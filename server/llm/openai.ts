import OpenAI from 'openai';
import { z } from 'zod';
import type { LLMClient, LLMGenerationOptions, LLMGenerationResult } from './client';
import { JSON_SYSTEM_PROMPT } from './client';
import { AEO_CONFIG } from '../config/aeo';
import { extractJson, validateJson } from '../utils/json';
import { assertVendorNotPaused, ensureVendorPauseLoaded } from '../config/vendor-pause';
import { withVendorRetry } from './retry';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  // Task #78 — Refuse to construct / hand out the SDK if an admin paused
  // OpenAI. The cache is kept warm by the admin endpoints + executePrompt;
  // see `assertVendorNotPaused` for the cold-cache caveat.
  assertVendorNotPaused('OpenAI');

  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

export class OpenAIClient implements LLMClient {
  public readonly provider = 'openai';
  public readonly model: string;

  constructor(model: string = 'gpt-5.4-nano') {
    this.model = model;
  }

  async generateJson<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMGenerationOptions
  ): Promise<LLMGenerationResult<T>> {
    const startTime = Date.now();
    await ensureVendorPauseLoaded();
    const client = getOpenAIClient();

    const systemPrompt = options?.systemPrompt || JSON_SYSTEM_PROMPT;
    const temperature = options?.temperature ?? AEO_CONFIG.temperature;
    const maxTokens = options?.maxTokens ?? AEO_CONFIG.maxTokens;

    console.log(`[OpenAI] Generating JSON with model: ${this.model}, temperature: ${temperature}`);

    try {
      const { buildOpenAIRequestParams } = await import('../utils/openai-compat');
      
      const requestParams = buildOpenAIRequestParams(this.model, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature,
        maxTokens,
        responseFormat: { type: 'json_object' },
      });

      // Task #115 — jittered retry on 429/5xx/network. Vendor-paused
      // throws skip the retry inside withVendorRetry.
      const completion = await withVendorRetry('OpenAI', () =>
        client.chat.completions.create(requestParams),
      );

      const latencyMs = Date.now() - startTime;
      const content = completion.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      console.log(`[OpenAI] Received response in ${latencyMs}ms`);

      const extraction = extractJson(content);
      if (!extraction.success) {
        throw new Error(`Failed to extract JSON: ${extraction.error}`);
      }

      const validation = validateJson(extraction.data, schema);
      if (!validation.success) {
        throw new Error(`Schema validation failed: ${validation.error}`);
      }

      return {
        data: validation.data as T,
        provider: this.provider,
        model: this.model,
        latencyMs,
        tokensUsed: completion.usage?.total_tokens,
        repairAttempted: false,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      console.error(`[OpenAI] Error after ${latencyMs}ms:`, error);
      throw error;
    }
  }
}
