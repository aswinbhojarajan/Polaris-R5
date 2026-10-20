import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { LLMClient, LLMGenerationOptions, LLMGenerationResult } from './client';
import { JSON_SYSTEM_PROMPT } from './client';
import { AEO_CONFIG } from '../config/aeo';
import { extractJson, validateJson } from '../utils/json';
import { assertVendorNotPaused, ensureVendorPauseLoaded } from '../config/vendor-pause';
import { withVendorRetry } from './retry';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  // Task #78 — Refuse to construct / hand out the SDK if an admin paused
  // Anthropic. See `assertVendorNotPaused` for the cold-cache caveat.
  assertVendorNotPaused('Anthropic');

  if (anthropicClient) {
    return anthropicClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

export class AnthropicClient implements LLMClient {
  public readonly provider = 'anthropic';
  public readonly model: string;

  constructor(model: string = 'claude-sonnet-4-5') {
    this.model = model;
  }

  async generateJson<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMGenerationOptions
  ): Promise<LLMGenerationResult<T>> {
    const startTime = Date.now();
    await ensureVendorPauseLoaded();
    const client = getAnthropicClient();

    const systemPrompt = options?.systemPrompt || JSON_SYSTEM_PROMPT;
    const temperature = options?.temperature ?? AEO_CONFIG.temperature;
    const maxTokens = options?.maxTokens ?? AEO_CONFIG.maxTokens;

    console.log(`[Anthropic] Generating JSON with model: ${this.model}, temperature: ${temperature}`);

    try {
      // Task #115 — jittered retry on 429/5xx/network.
      const message = await withVendorRetry('Anthropic', () =>
        client.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
      );

      const latencyMs = Date.now() - startTime;

      const textContent = message.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('\n');

      if (!textContent) {
        throw new Error('No text content in Anthropic response');
      }

      console.log(`[Anthropic] Received response in ${latencyMs}ms`);

      const extraction = extractJson(textContent);
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
        tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        repairAttempted: false,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      console.error(`[Anthropic] Error after ${latencyMs}ms:`, error);
      throw error;
    }
  }
}
