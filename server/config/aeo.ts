import { LLM_FUNCTIONS } from './llm-functions';

export type AEOMode = 'heuristic' | 'llm' | 'hybrid';
export type LLMProvider = 'openai' | 'anthropic';

export interface AEOConfig {
  mode: AEOMode;
  llmProvider: LLMProvider;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  retries: number;
  thresholds: {
    mentionMinConfidence: number;
    sentimentMinConfidence: number;
    rankingMinConfidence: number;
  };
  composerWeights: {
    visibility: number;
    sentiment: number;
    position: number;
  };
}

function validateApiKeys(requestedMode: AEOMode, provider: LLMProvider): AEOMode {
  if (requestedMode === 'heuristic') {
    return 'heuristic';
  }

  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  if (provider === 'openai' && !hasOpenAIKey) {
    console.warn(
      `[AEO Config] ⚠️  AEO_MODE='${requestedMode}' requested with LLM_PROVIDER='openai', ` +
      `but OPENAI_API_KEY is missing. Falling back to 'heuristic' mode.`
    );
    return 'heuristic';
  }

  if (provider === 'anthropic' && !hasAnthropicKey) {
    console.warn(
      `[AEO Config] ⚠️  AEO_MODE='${requestedMode}' requested with LLM_PROVIDER='anthropic', ` +
      `but ANTHROPIC_API_KEY is missing. Falling back to 'heuristic' mode.`
    );
    return 'heuristic';
  }

  return requestedMode;
}

function getAEOMode(): AEOMode {
  const rawMode = process.env.AEO_MODE?.toLowerCase();
  
  if (!rawMode) {
    return 'heuristic';
  }

  if (rawMode !== 'heuristic' && rawMode !== 'llm' && rawMode !== 'hybrid') {
    console.error(
      `[AEO Config] ❌ Invalid AEO_MODE='${rawMode}'. ` +
      `Valid values: 'heuristic', 'llm', 'hybrid'. Defaulting to 'heuristic'.`
    );
    return 'heuristic';
  }

  const requestedMode = rawMode as AEOMode;
  const provider = getLLMProvider();

  return validateApiKeys(requestedMode, provider);
}

function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER?.toLowerCase();
  
  if (provider === 'anthropic') {
    return 'anthropic';
  }
  
  if (provider && provider !== 'openai') {
    console.warn(
      `[AEO Config] ⚠️  Unknown LLM_PROVIDER='${provider}'. ` +
      `Valid values: 'openai', 'anthropic'. Defaulting to 'openai'.`
    );
  }
  
  return 'openai';
}

function getLLMModel(): string {
  // Task #77 — Resolve strictly through `LLM_FUNCTIONS`, which already
  // applies the DB-override > env > default precedence inside its own
  // resolver. The previous env-first short-circuit here meant any
  // `LLM_AEO_SCORING_MODEL` / `LLM_MODEL` env var would shadow a fresh
  // admin DB override, breaking the task contract.
  const provider = getLLMProvider();
  return provider === 'anthropic'
    ? LLM_FUNCTIONS.aeoScoringAnthropic
    : LLM_FUNCTIONS.aeoScoring;
}

function getMaxTokens(model: string): number {
  const envMaxTokens = process.env.LLM_MAX_TOKENS;
  if (envMaxTokens) {
    const parsed = parseInt(envMaxTokens, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  
  if (model.includes('gpt-4o-mini') || model.includes('gpt-5.4-nano')) {
    return 4096;
  }
  if (
    model.includes('gpt-4o') ||
    model.includes('gpt-4.1') ||
    model.includes('gpt-5')
  ) {
    return 16384;
  }
  if (model.includes('claude')) {
    return 8192;
  }
  
  return 8192;
}

// Task #77 — `llmModel` and the `maxTokens` that depends on it are exposed
// as getters so AEO scoring picks up DB overrides on the next read. The
// `mode` / `llmProvider` / `composerWeights` are still env-driven and
// unchanged. `mentionExtractor.llm.ts` and `sentimentAbsa.llm.ts` read
// `AEO_CONFIG.maxTokens` per call, so the getter makes the override live
// without restarting the prompt-run executor.
const STATIC_MODE = getAEOMode();
const STATIC_PROVIDER = getLLMProvider();

export const AEO_CONFIG: AEOConfig = Object.freeze({
  mode: STATIC_MODE,
  llmProvider: STATIC_PROVIDER,
  get llmModel(): string {
    return getLLMModel();
  },
  temperature: 0,
  get maxTokens(): number {
    return getMaxTokens(getLLMModel());
  },
  timeoutMs: 30000,
  retries: 3,
  thresholds: Object.freeze({
    mentionMinConfidence: 0.7,
    sentimentMinConfidence: 0.6,
    rankingMinConfidence: 0.5,
  }),
  composerWeights: Object.freeze({
    visibility: 0.5,
    sentiment: 0.3,
    position: 0.2,
  }),
}) as AEOConfig;

export const AEO_MODE = AEO_CONFIG.mode;
export const LLM_PROVIDER = AEO_CONFIG.llmProvider;
// Backward-compat named export — old call sites that destructured this at
// import time keep working off the env baseline; new code should read
// `AEO_CONFIG.llmModel` to pick up runtime overrides.
export const LLM_MODEL = getLLMModel();

console.log('[AEO Config] Initialized with configuration:');
console.log(`  Mode:         ${AEO_CONFIG.mode}`);
console.log(`  Provider:     ${AEO_CONFIG.llmProvider}`);
console.log(`  Model:        ${AEO_CONFIG.llmModel}  (resolved per-call via LLM_FUNCTIONS)`);
console.log(`  Temperature:  ${AEO_CONFIG.temperature}`);
console.log(`  Max Tokens:   ${AEO_CONFIG.maxTokens}`);
console.log(`  Thresholds:   mention=${AEO_CONFIG.thresholds.mentionMinConfidence}, sentiment=${AEO_CONFIG.thresholds.sentimentMinConfidence}, ranking=${AEO_CONFIG.thresholds.rankingMinConfidence}`);
console.log(`  Weights:      vis=${AEO_CONFIG.composerWeights.visibility}, sent=${AEO_CONFIG.composerWeights.sentiment}, pos=${AEO_CONFIG.composerWeights.position}`);
