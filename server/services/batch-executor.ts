/**
 * BatchExecutor - Phase 1 Parallel Execution
 * Executes prompt-model combinations in parallel with per-provider rate limiting
 */

import { executePrompt, type AIExecutionResult } from './ai-executor';
import { performanceLogger } from './performance-logger';

// Per-provider concurrency limits to avoid rate limiting
const PROVIDER_CONCURRENCY: Record<string, number> = {
  openai: 5,      // Can handle higher concurrency
  anthropic: 3,   // Moderate rate limits
  perplexity: 3,  // Moderate rate limits
  google: 1       // Gemini 3 Pro has very strict rate limits - run sequentially
};

// Retry configuration
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 2000;

// Models with extra-strict rate limits that need longer delays
const STRICT_RATE_LIMIT_MODELS = ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const STRICT_MODEL_DELAY_MS = 5000; // 5 second delay between requests for these models

interface BatchItem {
  id: string;
  promptId: string;
  promptText: string;
  modelId: string;
  vendor: string;
  model: string;
}

interface BatchResult {
  itemId: string;
  success: boolean;
  result?: AIExecutionResult;
  error?: string;
  retries: number;
}

/**
 * Executes a single prompt with retry logic and exponential backoff
 */
async function executeWithRetry(
  item: BatchItem,
  runId: string,
  maxRetries: number = MAX_RETRIES
): Promise<BatchResult> {
  let lastError: string | undefined;
  let retries = 0;
  
  // Check if this is a model with strict rate limits
  const isStrictModel = STRICT_RATE_LIMIT_MODELS.some(m => item.model.includes(m));
  const baseDelay = isStrictModel ? STRICT_MODEL_DELAY_MS : BASE_RETRY_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executePrompt(item.promptText, item.vendor, item.model, runId);
      
      // Check for rate limit - should retry
      if (result.isRateLimited && attempt < maxRetries) {
        // For strict models, use longer delays with more aggressive backoff
        const delay = isStrictModel 
          ? baseDelay * Math.pow(2, attempt) // 5s, 10s, 20s, 40s, 80s
          : baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
        console.log(`[BatchExecutor] Rate limited on ${item.vendor}/${item.model}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        retries++;
        continue;
      }
      
      // Success or non-retryable error
      return {
        itemId: item.id,
        success: !result.error,
        result,
        error: result.error,
        retries
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[BatchExecutor] Error on ${item.vendor}/${item.model}, retrying in ${delay}ms: ${lastError}`);
        await sleep(delay);
        retries++;
      }
    }
  }

  return {
    itemId: item.id,
    success: false,
    error: lastError || 'Max retries exceeded',
    retries
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Groups items by provider for rate limit management
 */
function groupByProvider(items: BatchItem[]): Map<string, BatchItem[]> {
  const groups = new Map<string, BatchItem[]>();
  
  for (const item of items) {
    const provider = item.vendor.toLowerCase();
    if (!groups.has(provider)) {
      groups.set(provider, []);
    }
    groups.get(provider)!.push(item);
  }
  
  return groups;
}

/**
 * Executes items for a single provider with concurrency limit
 */
async function executeProviderBatch(
  provider: string,
  items: BatchItem[],
  runId: string,
  onItemComplete: (result: BatchResult) => Promise<void>,
  checkCancellation?: () => void
): Promise<BatchResult[]> {
  const concurrency = PROVIDER_CONCURRENCY[provider] || 2;
  const results: BatchResult[] = [];
  
  console.log(`[BatchExecutor] Processing ${items.length} items for ${provider} (concurrency: ${concurrency})`);
  
  // Process in chunks based on concurrency limit
  for (let i = 0; i < items.length; i += concurrency) {
    // Check for cancellation before each batch
    checkCancellation?.();
    
    const batch = items.slice(i, i + concurrency);
    const batchStart = Date.now();
    
    const batchResults = await Promise.allSettled(
      batch.map(item => executeWithRetry(item, runId))
    );
    
    // Process results and await scoring for each item sequentially
    for (let j = 0; j < batchResults.length; j++) {
      const settledResult = batchResults[j];
      
      // Check for cancellation before processing each result
      checkCancellation?.();
      
      if (settledResult.status === 'fulfilled') {
        results.push(settledResult.value);
        // Await the scoring callback to ensure proper sequencing
        await onItemComplete(settledResult.value);
      } else {
        // Promise rejected - shouldn't happen with our retry logic
        const errorResult: BatchResult = {
          itemId: batch[j]?.id || 'unknown',
          success: false,
          error: settledResult.reason?.message || 'Promise rejected',
          retries: 0
        };
        results.push(errorResult);
        await onItemComplete(errorResult);
      }
    }
    
    const batchDuration = Date.now() - batchStart;
    console.log(`[BatchExecutor] ${provider} batch ${Math.floor(i / concurrency) + 1}: ${batch.length} items in ${(batchDuration / 1000).toFixed(2)}s`);
  }
  
  return results;
}

export interface BatchExecutorOptions {
  runId: string;
  onProgress?: (completed: number, total: number, message: string) => void;
  onItemComplete?: (itemId: string, success: boolean, result?: AIExecutionResult, error?: string) => Promise<void>;
  checkCancellation?: () => void;
}

/**
 * Main batch executor - processes all items in parallel by provider
 * Note: Providers execute sequentially to allow proper cancellation propagation,
 * but items within each provider execute in parallel respecting concurrency limits.
 */
export async function executeBatch(
  items: BatchItem[],
  options: BatchExecutorOptions
): Promise<BatchResult[]> {
  const { runId, onProgress, onItemComplete, checkCancellation } = options;
  const startTime = Date.now();
  
  console.log(`[BatchExecutor] Starting parallel execution of ${items.length} items`);
  
  // Group items by provider
  const providerGroups = groupByProvider(items);
  console.log(`[BatchExecutor] Grouped into ${providerGroups.size} providers: ${Array.from(providerGroups.keys()).join(', ')}`);
  
  let completedCount = 0;
  const allResults: BatchResult[] = [];
  
  const handleItemComplete = async (result: BatchResult): Promise<void> => {
    completedCount++;
    onProgress?.(completedCount, items.length, `Completed ${completedCount}/${items.length} prompts`);
    
    if (onItemComplete) {
      await onItemComplete(result.itemId, result.success, result.result, result.error);
    }
  };
  
  // Execute providers sequentially to allow proper cancellation propagation
  // (within each provider, items execute in parallel up to concurrency limit)
  for (const [provider, providerItems] of providerGroups.entries()) {
    // Check for cancellation before starting each provider
    checkCancellation?.();
    
    try {
      const providerResults = await executeProviderBatch(
        provider, 
        providerItems, 
        runId, 
        handleItemComplete,
        checkCancellation
      );
      allResults.push(...providerResults);
    } catch (error) {
      // Re-throw control-flow signals so they propagate to the executor's
      // top-level catch instead of being swallowed here. Task #139 adds
      // "Job paused"; "Run halted by admin disable" (Task #79) must also
      // unwind the whole run rather than just skipping one provider.
      if (
        error instanceof Error &&
        (error.message === 'Job cancelled' ||
          error.message === 'Job paused' ||
          error.message === 'Run halted by admin disable')
      ) {
        throw error;
      }
      // Log other errors but continue with other providers
      console.error(`[BatchExecutor] Error processing provider ${provider}:`, error);
    }
  }
  
  const totalDuration = Date.now() - startTime;
  const successCount = allResults.filter(r => r.success).length;
  const totalRetries = allResults.reduce((sum, r) => sum + r.retries, 0);
  
  console.log(`[BatchExecutor] Completed ${items.length} items in ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`[BatchExecutor] Success: ${successCount}/${items.length}, Total retries: ${totalRetries}`);
  
  performanceLogger.logStage(runId, 'parallel_batch_execution', totalDuration, {
    totalItems: items.length,
    successCount,
    failCount: items.length - successCount,
    totalRetries,
    providerCount: providerGroups.size
  });
  
  return allResults;
}

export type { BatchItem, BatchResult };
