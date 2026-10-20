/**
 * OpenAI Model Compatibility Utilities
 * 
 * Newer OpenAI models (gpt-4o, o1, gpt-5, etc.) use `max_completion_tokens`
 * instead of `max_tokens`. This utility ensures compatibility across all models.
 * 
 * Configuration:
 * - OPENAI_REASONING_EFFORT: Controls reasoning effort for reasoning models (low/medium/high)
 *   Default: "medium"
 */

/**
 * Default reasoning effort level for reasoning models
 * Configurable via OPENAI_REASONING_EFFORT secret (low/medium/high)
 */
export const DEFAULT_REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || 'medium') as 'low' | 'medium' | 'high';

/**
 * Models that require max_completion_tokens instead of max_tokens
 * These are generally newer/reasoning models
 */
const COMPLETION_TOKEN_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o1-mini',
  'o1-preview',
  'o3',
  'o3-mini',
  'o4',
  'o4-mini',
  'gpt-5',
  'gpt-5.1',
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5-mini',
];

/**
 * Reasoning models that don't support custom temperature but support reasoning_effort
 */
const REASONING_MODELS = [
  'o1',
  'o1-mini',
  'o1-preview',
  'o3',
  'o3-mini',
  'o4',
  'o4-mini',
  'gpt-5-mini',
];

/**
 * Check if a model uses max_completion_tokens instead of max_tokens
 */
export function usesCompletionTokens(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return COMPLETION_TOKEN_MODELS.some(prefix => lowerModel.startsWith(prefix.toLowerCase()));
}

/**
 * Check if a model is a reasoning model (doesn't support custom temperature)
 */
export function isReasoningModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return REASONING_MODELS.some(prefix => lowerModel.startsWith(prefix.toLowerCase()));
}

/**
 * OpenAI Chat Completion request parameters (model-agnostic)
 */
export interface OpenAIRequestParams {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/**
 * Build OpenAI request parameters that are compatible with any model
 */
export function buildOpenAIRequestParams(
  model: string,
  options: {
    messages: Array<{ role: string; content: string }>;
    maxTokens?: number;
    temperature?: number;
    responseFormat?: { type: 'json_object' | 'text' };
    reasoningEffort?: 'low' | 'medium' | 'high';
  }
): OpenAIRequestParams {
  const params: OpenAIRequestParams = {
    model,
    messages: options.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  };

  // Add response format if specified
  if (options.responseFormat) {
    params.response_format = options.responseFormat;
  }

  // Handle reasoning models specially
  if (isReasoningModel(model)) {
    // Reasoning models don't support custom temperature, but support reasoning_effort
    const reasoningEffort = options.reasoningEffort || DEFAULT_REASONING_EFFORT;
    params.reasoning_effort = reasoningEffort;
  } else if (options.temperature !== undefined) {
    // Non-reasoning models can use custom temperature
    params.temperature = options.temperature;
  }

  // Handle token limits - use correct parameter based on model
  if (options.maxTokens) {
    if (usesCompletionTokens(model)) {
      params.max_completion_tokens = options.maxTokens;
    } else {
      params.max_tokens = options.maxTokens;
    }
  }

  return params;
}

/**
 * Get the appropriate token parameter name for a model
 */
export function getTokenParamName(model: string): 'max_completion_tokens' | 'max_tokens' {
  return usesCompletionTokens(model) ? 'max_completion_tokens' : 'max_tokens';
}
