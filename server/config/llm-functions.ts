/**
 * Centralized LLM Function Configuration
 *
 * Single source of truth for which model each internal AI call uses.
 * Resolution order (highest precedence first):
 *   1. DB override row in `llm_function_overrides` (Task #77 — admin UI)
 *   2. `LLM_<FUNCTION>_MODEL` env var (or legacy `REPORT_AI_MODEL` /
 *      `LLM_MODEL` for `narrativeReport` / `aeoScoring`)
 *   3. `LLM_FUNCTION_DEFAULTS` (GPT-5.4 family + claude-sonnet-4-5 for the
 *      Anthropic AEO provider)
 *
 * The `LLM_FUNCTIONS` export is a Proxy so existing call sites
 * (`LLM_FUNCTIONS.metadata`, etc.) transparently see DB overrides without
 * code changes. The override layer is loaded lazily on first read and
 * refreshed on a short TTL so admin changes go live within seconds across
 * the cluster without a reboot.
 */

export interface LLMFunctionConfig {
  metadata: string;
  topics: string;
  prompts: string;
  competitorDiscovery: string;
  promptClassifier: string;
  responseSummarizer: string;
  xrayAnalyzer: string;
  xrayBatch: string;
  contentRecommendation: string;
  recommendations: string;
  optimizedContent: string;
  narrativeReport: string;
  aeoScoring: string;
  aeoScoringAnthropic: string;
}

export type LLMFunctionKey = keyof LLMFunctionConfig;

export const LLM_FUNCTION_DEFAULTS: LLMFunctionConfig = {
  metadata: 'gpt-5.4',
  topics: 'gpt-5.4',
  prompts: 'gpt-5.4',
  competitorDiscovery: 'gpt-5.4',
  promptClassifier: 'gpt-5.4-nano',
  responseSummarizer: 'gpt-5.4-mini',
  xrayAnalyzer: 'gpt-5.4-mini',
  xrayBatch: 'gpt-5.4-mini',
  contentRecommendation: 'gpt-5.4-mini',
  recommendations: 'gpt-5.4',
  optimizedContent: 'gpt-5.4',
  narrativeReport: 'gpt-5.4',
  aeoScoring: 'gpt-5.4-mini',
  aeoScoringAnthropic: 'claude-sonnet-4-5',
};

export const ENV_VAR_MAP: Record<LLMFunctionKey, string> = {
  metadata: 'LLM_METADATA_MODEL',
  topics: 'LLM_TOPICS_MODEL',
  prompts: 'LLM_PROMPTS_MODEL',
  competitorDiscovery: 'LLM_COMPETITOR_DISCOVERY_MODEL',
  promptClassifier: 'LLM_PROMPT_CLASSIFIER_MODEL',
  responseSummarizer: 'LLM_RESPONSE_SUMMARIZER_MODEL',
  xrayAnalyzer: 'LLM_XRAY_ANALYZER_MODEL',
  xrayBatch: 'LLM_XRAY_BATCH_MODEL',
  contentRecommendation: 'LLM_CONTENT_RECOMMENDATION_MODEL',
  recommendations: 'LLM_RECOMMENDATIONS_MODEL',
  optimizedContent: 'LLM_OPTIMIZED_CONTENT_MODEL',
  narrativeReport: 'LLM_NARRATIVE_REPORT_MODEL',
  aeoScoring: 'LLM_AEO_SCORING_MODEL',
  aeoScoringAnthropic: 'LLM_AEO_SCORING_ANTHROPIC_MODEL',
};

// Task #77 — Vendor allowlist per function. The 13 OpenAI-side call sites
// invoke `openai.chat.completions.create(...)` directly, so picking an
// Anthropic / Google / Perplexity model would crash at runtime. Only the
// `aeoScoringAnthropic` slot is wired to the Anthropic SDK. Vendor names
// match the seed: 'OpenAI', 'Anthropic', 'Google', 'Perplexity'.
export const LLM_FUNCTION_ALLOWED_VENDORS: Record<LLMFunctionKey, readonly string[]> = {
  metadata: ['OpenAI'],
  topics: ['OpenAI'],
  prompts: ['OpenAI'],
  competitorDiscovery: ['OpenAI'],
  promptClassifier: ['OpenAI'],
  responseSummarizer: ['OpenAI'],
  xrayAnalyzer: ['OpenAI'],
  xrayBatch: ['OpenAI'],
  contentRecommendation: ['OpenAI'],
  recommendations: ['OpenAI'],
  optimizedContent: ['OpenAI'],
  narrativeReport: ['OpenAI'],
  aeoScoring: ['OpenAI'],
  aeoScoringAnthropic: ['Anthropic'],
};

export function isVendorAllowedForFunction(
  fn: LLMFunctionKey,
  vendor: string,
): boolean {
  const allowed = LLM_FUNCTION_ALLOWED_VENDORS[fn];
  return allowed.some((v) => v.toLowerCase() === vendor.toLowerCase());
}

// Human-readable purpose for each function — surfaced on the admin
// "Functions" tab so operators know what they're flipping.
export const LLM_FUNCTION_DESCRIPTIONS: Record<LLMFunctionKey, string> = {
  metadata: 'Generates project metadata (industry, geography, focus areas) from the website crawl.',
  topics: 'Generates the seed topic list from project metadata during onboarding.',
  prompts: 'Generates test prompts from accepted topics during onboarding.',
  competitorDiscovery: 'Discovers competitor candidates from web search + LLM enrichment.',
  promptClassifier: 'Tags each prompt with its category in the 7-category taxonomy.',
  responseSummarizer: 'Condenses raw model responses into the snippets shown in reports.',
  xrayAnalyzer: 'Per-page Site X-Ray content analysis (assessment, gaps, recs).',
  xrayBatch: 'Batched Site X-Ray analysis for multi-page passes.',
  contentRecommendation: 'Generates content opportunities from prompt-run results.',
  recommendations: 'Generates the actionable recommendations list shown on the Recommendations page.',
  optimizedContent: 'Drafts the SEO/AEO-optimized content snippets in the Content Generator.',
  narrativeReport: 'Two-pass executive narrative generation for PDF reports.',
  aeoScoring: 'OpenAI-side AEO scoring (visibility / position / sentiment).',
  aeoScoringAnthropic: 'Anthropic-side AEO scoring (alternate provider for cross-validation).',
};

interface ResolvedEnvEntry {
  model: string;
  envVar: string;
  envOverridden: boolean;
}

function resolveEnvBaseline(): Record<LLMFunctionKey, ResolvedEnvEntry> {
  const out = {} as Record<LLMFunctionKey, ResolvedEnvEntry>;
  (Object.keys(LLM_FUNCTION_DEFAULTS) as LLMFunctionKey[]).forEach((key) => {
    const envVar = ENV_VAR_MAP[key];
    const explicit = process.env[envVar];
    let model = LLM_FUNCTION_DEFAULTS[key];
    let envOverridden = false;

    if (explicit && explicit.trim()) {
      model = explicit.trim();
      envOverridden = true;
    } else if (key === 'narrativeReport' && process.env.REPORT_AI_MODEL && process.env.REPORT_AI_MODEL.trim()) {
      model = process.env.REPORT_AI_MODEL.trim();
      envOverridden = true;
    } else if (key === 'aeoScoring' && process.env.LLM_MODEL && process.env.LLM_MODEL.trim()) {
      model = process.env.LLM_MODEL.trim();
      envOverridden = true;
    }

    out[key] = { model, envVar, envOverridden };
  });
  return out;
}

const envBaseline = resolveEnvBaseline();

// ---------------------------------------------------------------------------
// DB override cache (Task #77)
// ---------------------------------------------------------------------------

export interface ResolvedFunctionEntry {
  functionKey: LLMFunctionKey;
  description: string;
  resolvedModel: string;
  /** Where the resolved model came from. */
  source: 'override' | 'env' | 'default';
  envVar: string;
  defaultModel: string;
  envModel: string | null;
  /** Vendor names compatible with this function (used to filter the picker). */
  allowedVendors: readonly string[];
  /** Set when an override row exists, regardless of whether the model is enabled. */
  overrideModelId: string | null;
  overrideModelDisplayName: string | null;
  overrideModel: string | null;
  /** True only when an override row exists AND the referenced ai_models row is enabled. */
  overrideActive: boolean;
  overrideUpdatedAt: Date | null;
  overrideUpdatedBy: string | null;
}

interface OverrideCacheEntry {
  modelId: string;
  model: string;
  displayName: string;
  enabled: boolean;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}

let overrideCache: Partial<Record<LLMFunctionKey, OverrideCacheEntry>> = {};
let lastLoadedAt = 0;
let inflightLoad: Promise<void> | null = null;
// Bumped every time `invalidateLlmFunctionCache()` is called. A load that
// started under a stale generation will discard its result instead of
// repopulating the cache, which closes the PATCH→read race the architect
// flagged: a pre-mutation `loadOverrideCache()` already in flight no
// longer overwrites the freshly invalidated cache.
let cacheGeneration = 0;
const CACHE_TTL_MS = 30_000;

async function loadOverrideCache(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SESSION_STORE === 'memory') {
    // Tests / in-memory mode never touch the DB resolver.
    overrideCache = {};
    lastLoadedAt = Date.now();
    return;
  }
  const startedGeneration = cacheGeneration;
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import('../db'),
      import('@shared/schema'),
      import('drizzle-orm'),
    ]);
    const { llmFunctionOverrides, aiModels, users } = schema;
    const { eq } = drizzle;
    const rows = await db
      .select({
        functionKey: llmFunctionOverrides.functionKey,
        modelId: aiModels.id,
        model: aiModels.model,
        displayName: aiModels.displayName,
        enabled: aiModels.enabled,
        updatedAt: llmFunctionOverrides.updatedAt,
        updatedByEmail: users.email,
      })
      .from(llmFunctionOverrides)
      .innerJoin(aiModels, eq(aiModels.id, llmFunctionOverrides.modelId))
      .leftJoin(users, eq(users.id, llmFunctionOverrides.updatedByUserId));

    // Race guard (Task #77 architect review): if the cache was invalidated
    // while we were querying, a newer load has been or is about to be
    // started — discard our stale snapshot.
    if (startedGeneration !== cacheGeneration) return;

    const next: Partial<Record<LLMFunctionKey, OverrideCacheEntry>> = {};
    for (const r of rows) {
      if (!(r.functionKey in LLM_FUNCTION_DEFAULTS)) continue;
      next[r.functionKey as LLMFunctionKey] = {
        modelId: r.modelId,
        model: r.model,
        displayName: r.displayName,
        enabled: r.enabled,
        updatedAt: r.updatedAt,
        updatedByEmail: r.updatedByEmail ?? null,
      };
    }
    overrideCache = next;
    lastLoadedAt = Date.now();
  } catch (err) {
    // DB not ready (cold boot, connection error). Leave cache as-is and
    // fall back to env baseline so call sites keep working.
    if (lastLoadedAt === 0) {
      // Keep retrying — tag the load as "tried" so we don't hammer.
      lastLoadedAt = Date.now() - CACHE_TTL_MS + 5_000;
    }
  }
}

function maybeRefresh(): void {
  if (Date.now() - lastLoadedAt < CACHE_TTL_MS) return;
  if (inflightLoad) return;
  inflightLoad = loadOverrideCache().finally(() => {
    inflightLoad = null;
  });
}

/**
 * Force the cache to reload on the next read. Call after admin mutations.
 * Bumps the generation token so any in-flight load started under the old
 * generation will throw away its result instead of overwriting the
 * freshly invalidated cache.
 */
export function invalidateLlmFunctionCache(): void {
  cacheGeneration += 1;
  lastLoadedAt = 0;
}

/**
 * Block until the cache is hot. Useful for boot logging and for the PATCH
 * route's "return the resolved row" response. Always starts a fresh load
 * if `lastLoadedAt === 0` — even when an older load is in flight — so the
 * PATCH path can guarantee post-mutation freshness.
 */
export async function ensureLlmFunctionCacheLoaded(): Promise<void> {
  if (lastLoadedAt > 0 && Date.now() - lastLoadedAt < CACHE_TTL_MS) return;
  // Always start a new load when the cache is invalidated (lastLoadedAt
  // === 0). This keeps PATCH responses correct even if a pre-mutation
  // load was already in flight when invalidate was called. We compare
  // against the wrapped promise (`tracked`) — comparing against `myLoad`
  // would never match, leaving `inflightLoad` permanently non-null and
  // silently disabling TTL-based background refresh.
  const myLoad = loadOverrideCache();
  const tracked: Promise<void> = myLoad.finally(() => {
    if (inflightLoad === tracked) inflightLoad = null;
  });
  inflightLoad = tracked;
  await myLoad;
}

export function getLlmModelForFunction(fn: LLMFunctionKey): string {
  maybeRefresh();
  const override = overrideCache[fn];
  if (override && override.enabled) return override.model;
  // Task #77 acceptance: an override pinned to a now-disabled model must
  // fall back to the **default**, not the env value, so the operator
  // sees a clear "go fix this" state instead of silently masking the
  // problem with whatever the env happens to say.
  if (override && !override.enabled) return LLM_FUNCTION_DEFAULTS[fn];
  return envBaseline[fn].model;
}

/**
 * Snapshot of the resolved configuration for the admin UI.
 * Reads the cache (refreshing in the background if stale) and pairs each
 * function with its source attribution.
 */
export function getResolvedLlmFunctionTable(): ResolvedFunctionEntry[] {
  maybeRefresh();
  return (Object.keys(LLM_FUNCTION_DEFAULTS) as LLMFunctionKey[]).map((key) => {
    const env = envBaseline[key];
    const override = overrideCache[key];
    const overrideActive = !!(override && override.enabled);
    const overrideStale = !!(override && !override.enabled);
    let resolvedModel: string;
    let source: 'override' | 'env' | 'default';
    if (overrideActive) {
      resolvedModel = override!.model;
      source = 'override';
    } else if (overrideStale) {
      // Mirrors `getLlmModelForFunction`: a disabled override falls back
      // to the default (not env) so the UI flags the problem clearly.
      resolvedModel = LLM_FUNCTION_DEFAULTS[key];
      source = 'default';
    } else if (env.envOverridden) {
      resolvedModel = env.model;
      source = 'env';
    } else {
      resolvedModel = env.model;
      source = 'default';
    }
    return {
      functionKey: key,
      description: LLM_FUNCTION_DESCRIPTIONS[key],
      resolvedModel,
      source,
      envVar: env.envVar,
      defaultModel: LLM_FUNCTION_DEFAULTS[key],
      envModel: env.envOverridden ? env.model : null,
      allowedVendors: LLM_FUNCTION_ALLOWED_VENDORS[key],
      overrideModelId: override ? override.modelId : null,
      overrideModelDisplayName: override ? override.displayName : null,
      overrideModel: override ? override.model : null,
      overrideActive,
      overrideUpdatedAt: override ? override.updatedAt : null,
      overrideUpdatedBy: override ? override.updatedByEmail : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Public consumer-facing API
// ---------------------------------------------------------------------------

// `LLM_FUNCTIONS.metadata` etc. — Proxy that transparently routes to the
// resolver so a DB override is picked up on the next call without code
// changes at the 14 call sites.
export const LLM_FUNCTIONS: LLMFunctionConfig = new Proxy(
  {} as LLMFunctionConfig,
  {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'string' && prop in LLM_FUNCTION_DEFAULTS) {
        return getLlmModelForFunction(prop as LLMFunctionKey);
      }
      return undefined;
    },
    has(_target, prop) {
      return typeof prop === 'string' && prop in LLM_FUNCTION_DEFAULTS;
    },
    ownKeys() {
      return Object.keys(LLM_FUNCTION_DEFAULTS);
    },
    getOwnPropertyDescriptor(_target, prop: string | symbol) {
      if (typeof prop === 'string' && prop in LLM_FUNCTION_DEFAULTS) {
        return {
          enumerable: true,
          configurable: true,
          value: getLlmModelForFunction(prop as LLMFunctionKey),
        };
      }
      return undefined;
    },
  },
);

// ---------------------------------------------------------------------------
// Boot logging (kept compatible with the Task #38 format).
// ---------------------------------------------------------------------------

let alreadyLogged = false;
export function logLLMFunctionConfig(): void {
  if (alreadyLogged) return;
  alreadyLogged = true;
  console.log('[LLM Functions] Resolved model configuration:');
  const keys = Object.keys(envBaseline) as LLMFunctionKey[];
  const maxKey = Math.max(...keys.map((k) => k.length));
  const maxModel = Math.max(...keys.map((k) => envBaseline[k].model.length));
  for (const key of keys) {
    const entry = envBaseline[key];
    const flag = entry.envOverridden ? ' (env override)' : '';
    console.log(
      `  ${key.padEnd(maxKey)}  ${entry.model.padEnd(maxModel)}  [${entry.envVar}]${flag}`,
    );
  }
  console.log('[LLM Functions] DB overrides resolve at runtime via llm_function_overrides.');
}

// Log immediately on import so the table appears in boot logs.
logLLMFunctionConfig();
