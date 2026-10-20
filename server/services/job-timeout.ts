/**
 * Phase 2: Extended Timeout Ceiling (Support 4+ Hour Runs)
 * 
 * Calculates appropriate timeouts based on workload size to prevent
 * premature job cancellation for large prompt runs.
 * 
 * New Formula:
 *   timeout = BASE + (prompts × models × PER_PROMPT_MODEL) + (competitors × prompts × models × PER_COMPETITOR)
 *   Capped at MAX_TIMEOUT (configurable via JOB_MAX_TIMEOUT_HOURS, default 8 hours)
 * 
 * Example: 20 prompts × 4 models × 10 competitors
 *   15 min + (80 × 2 min) + (10 × 80 × 30s) = 15 + 160 + 400 = 575 min ≈ 9.5 hours
 *   Capped at 8 hours (default MAX_TIMEOUT)
 */

export interface WorkloadMetrics {
  promptCount: number;
  modelCount: number;
  competitorCount?: number;
}

// Configuration constants - Phase 2 updated values
const BASE_TIMEOUT_MS = 15 * 60 * 1000;           // 15 minutes base
const PER_PROMPT_MODEL_MS = 2 * 60 * 1000;        // 2 minutes per prompt×model combination
const PER_COMPETITOR_MS = 30 * 1000;              // 30 seconds per competitor per item
const MIN_TIMEOUT_MS = 10 * 60 * 1000;            // Min 10 minutes

// Phase 2: Configurable max timeout via environment variable (default: 8 hours)
function getMaxTimeoutMs(): number {
  const hours = parseInt(process.env.JOB_MAX_TIMEOUT_HOURS || '8', 10);
  return hours * 60 * 60 * 1000;
}

/**
 * Calculate dynamic timeout based on workload size.
 * 
 * Phase 2 Formula:
 *   timeout = BASE + (items × PER_PROMPT_MODEL) + (competitors × items × PER_COMPETITOR)
 * 
 * Where items = promptCount × modelCount
 * 
 * Examples:
 *   - 2 prompts × 2 models × 5 competitors = 4 items
 *     → 15 min + (4 × 2 min) + (5 × 4 × 30s) = 15 + 8 + 10 = 33 minutes
 *   
 *   - 10 prompts × 3 models × 8 competitors = 30 items
 *     → 15 min + (30 × 2 min) + (8 × 30 × 30s) = 15 + 60 + 120 = 195 minutes (3.25 hours)
 *   
 *   - 20 prompts × 4 models × 10 competitors = 80 items
 *     → 15 min + (80 × 2 min) + (10 × 80 × 30s) = 15 + 160 + 400 = 575 minutes (9.5 hours)
 *     → Capped at MAX_TIMEOUT (8 hours default)
 */
export function calculateJobTimeout(metrics: WorkloadMetrics): number {
  const { promptCount, modelCount, competitorCount = 5 } = metrics;
  const maxTimeoutMs = getMaxTimeoutMs();
  
  // Calculate item count (prompt × model combinations)
  const itemCount = promptCount * modelCount;
  
  // Phase 2: New formula with proper per-item and per-competitor timing
  // Time for AI queries: 2 minutes per prompt×model
  const aiQueryTime = itemCount * PER_PROMPT_MODEL_MS;
  
  // Time for competitor scoring: 30 seconds per competitor per item
  const competitorTime = competitorCount * itemCount * PER_COMPETITOR_MS;
  
  // Total calculated timeout
  const calculatedTimeout = BASE_TIMEOUT_MS + aiQueryTime + competitorTime;
  
  // Apply bounds (min 10 minutes, max from env variable)
  const boundedTimeout = Math.min(Math.max(calculatedTimeout, MIN_TIMEOUT_MS), maxTimeoutMs);
  
  // Phase 2.4: Log calculated timeout
  const calculatedMinutes = Math.round(calculatedTimeout / 1000 / 60);
  const boundedMinutes = Math.round(boundedTimeout / 1000 / 60);
  const maxHours = Math.round(maxTimeoutMs / 1000 / 60 / 60);
  
  console.log(`[JobTimeout] Phase 2: Calculated ${calculatedMinutes} min (${formatTimeout(calculatedTimeout)}) for ${promptCount} prompts × ${modelCount} models × ${competitorCount} competitors`);
  console.log(`[JobTimeout] Phase 2: Applied bounds → ${formatTimeout(boundedTimeout)} (max: ${maxHours}h)`);
  
  return boundedTimeout;
}

/**
 * Calculate remaining timeout for a resumed job.
 * 
 * @param originalTimeoutMs - The original timeout calculated at job start
 * @param elapsedMs - Time already spent on the job
 * @param completedItems - Number of items already completed
 * @param totalItems - Total number of items to process
 * @returns Remaining timeout in milliseconds (minimum 5 minutes)
 */
export function calculateRemainingTimeout(
  originalTimeoutMs: number,
  elapsedMs: number,
  completedItems: number,
  totalItems: number
): number {
  // Calculate progress-based remaining time
  const progressRatio = totalItems > 0 ? completedItems / totalItems : 0;
  const expectedUsedTime = originalTimeoutMs * progressRatio;
  
  // Use the more generous estimate: either time-based or progress-based
  const timeBasedRemaining = originalTimeoutMs - elapsedMs;
  const progressBasedRemaining = originalTimeoutMs - expectedUsedTime;
  
  const remainingTimeout = Math.max(
    Math.max(timeBasedRemaining, progressBasedRemaining),
    5 * 60 * 1000 // Minimum 5 minutes for resumed jobs
  );
  
  console.log(`[JobTimeout] Remaining timeout: ${formatTimeout(remainingTimeout)} (${completedItems}/${totalItems} completed, ${Math.round(elapsedMs / 1000)}s elapsed)`);
  
  return remainingTimeout;
}

/**
 * Format timeout for display.
 */
export function formatTimeout(timeoutMs: number): string {
  const totalMinutes = Math.round(timeoutMs / 1000 / 60);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${totalMinutes}m`;
}
