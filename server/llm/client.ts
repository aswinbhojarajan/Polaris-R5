import { z } from 'zod';
import { AEO_CONFIG } from '../config/aeo';

export const JSON_SYSTEM_PROMPT = `You are a precise data extraction assistant. You must respond with valid JSON only.
- Return ONLY valid JSON objects or arrays
- Do not include markdown fences, explanations, or any text outside the JSON
- Ensure all JSON is properly formatted and parseable
- Follow the schema requirements exactly`;

export interface LLMGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMGenerationResult<T> {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
  tokensUsed?: number;
  repairAttempted: boolean;
}

export interface LLMClient {
  readonly provider: string;
  readonly model: string;
  
  generateJson<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: LLMGenerationOptions
  ): Promise<LLMGenerationResult<T>>;
}

export async function generateJsonWithRepair<T>(
  client: LLMClient,
  prompt: string,
  schema: z.ZodSchema<T>,
  options?: LLMGenerationOptions
): Promise<LLMGenerationResult<T>> {
  const startTime = Date.now();
  let repairAttempted = false;

  try {
    const result = await client.generateJson(prompt, schema, options);
    return result;
  } catch (firstError) {
    console.log(`[LLM] First attempt failed with ${client.provider}, attempting repair...`);
    console.log(`[LLM] Error: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
    
    repairAttempted = true;
    
    const repairPrompt = `${prompt}

IMPORTANT: Your previous response had validation errors. Please fix and return valid JSON that matches the schema exactly.
Error details: ${firstError instanceof Error ? firstError.message : String(firstError)}`;

    try {
      const result = await client.generateJson(repairPrompt, schema, options);
      return {
        ...result,
        repairAttempted: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (secondError) {
      console.error(`[LLM] Repair attempt failed after ${Date.now() - startTime}ms`);
      throw new Error(
        `Failed to generate valid JSON after repair attempt: ${secondError instanceof Error ? secondError.message : String(secondError)}`
      );
    }
  }
}

export async function getClient(provider?: string, model?: string): Promise<LLMClient> {
  const selectedProvider = provider || AEO_CONFIG.llmProvider;
  
  if (selectedProvider === 'anthropic') {
    const { AnthropicClient } = await import('./anthropic.js');
    const anthropicModel = model || (AEO_CONFIG.llmModel.startsWith('gpt-') ? 'claude-sonnet-4-5' : AEO_CONFIG.llmModel);
    return new AnthropicClient(anthropicModel);
  }
  
  const { OpenAIClient } = await import('./openai.js');
  const openaiModel = model || AEO_CONFIG.llmModel;
  return new OpenAIClient(openaiModel);
}
