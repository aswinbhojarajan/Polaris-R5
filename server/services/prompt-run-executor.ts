import type { IStorage } from '../storage';
import { executePrompt, type AIExecutionResult } from './ai-executor';
import { extractCitations } from './citation-extractor';
import { detectMentionsAsync, generateSpacingVariations, normalizeDiacritics } from './mention-detector';
import { parseRankingsAsync } from './ranking-parser';
import { calculateVisibilityScoreAsync } from './visibility-scoring';
import { calculateSentimentScoreAsync } from './scoring';
import { calculateCompetitorScores } from './competitor-scoring';
import { positionScoreFromRankings, calculatePositionScoreV2 } from './composer';
import { AEO_MODE } from '../config/aeo';
import { getPositionScoringVersion } from '../config/position-scoring';
import { openaiService } from '../openai-service';
import { savePositionFactors, saveSentimentFactors, saveVisibilityFactors } from './score-explainability';
import { performanceLogger } from './performance-logger';
import { executeBatch, type BatchItem, type BatchResult } from './batch-executor';
import { calculateJobTimeout, formatTimeout } from './job-timeout';
import { RunLogger } from './run-logger';
import { finalizePromptRunDeliverables } from './prompt-run-deliverables';

export interface PromptRunExecutorParams {
  storage: IStorage;
  promptRunId: string;
  onProgress?: (progress: number, message: string) => void;
  checkCancellation?: () => void;
  onHeartbeat?: () => Promise<void>;
}

// Helper interface for scoring context
interface ScoringContext {
  storage: IStorage;
  promptRunId: string;
  promptRunClientId: string;
  brandName: string;
  aliases: string[];
  clientUrls: string[];
  allBrandTerms: string[];
}

// Normalize all types of hyphens/dashes to spaces for consistent matching
// Covers: regular hyphen (-), en-dash (–), em-dash (—), non-breaking hyphen (‑), minus sign (−)
function normalizeHyphens(str: string): string {
  return str.replace(/[-–—‑−]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Helper to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to check if ranking contains client brand with word boundary protection
function isClientBrandRanking(rankingItem: string, allBrandTerms: string[]): boolean {
  const itemLower = rankingItem.toLowerCase().trim();
  // Normalize both hyphens AND diacritics (e.g., "Espolòn" → "Espolon")
  const normalizedItem = normalizeDiacritics(normalizeHyphens(itemLower));
  
  for (const term of allBrandTerms) {
    const termLower = term.toLowerCase().trim();
    const normalizedTerm = normalizeDiacritics(normalizeHyphens(termLower));
    
    // For short terms (< 4 chars like "AD", "AI"), require exact match or strict word boundary
    // This prevents "AD" from matching "ADOBE", "PAID", "ROAD", etc.
    if (termLower.length < 4) {
      // Use word boundary regex for short terms
      const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
      if (wordBoundaryRegex.test(itemLower)) {
        return true;
      }
      // Also check normalized version
      const normalizedRegex = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, 'i');
      if (normalizedRegex.test(normalizedItem)) {
        return true;
      }
      // Skip the includes() checks for short terms
      continue;
    }
    
    // For longer terms (>= 4 chars), use includes() but with word boundary awareness
    // Check if the term appears as a complete word/phrase in the item
    const termWordRegex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
    if (termWordRegex.test(itemLower)) {
      return true;
    }
    
    // Normalized comparison with word boundaries (handles "Coca-Cola" vs "Coca‑Cola" vs "Coca Cola")
    const normalizedTermRegex = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, 'i');
    if (normalizedTermRegex.test(normalizedItem)) {
      return true;
    }
    
    // Also check if item is a substring of the term (e.g., ranking says "Coca" and we're looking for "Coca Cola")
    // Only for terms >= 4 chars to prevent false positives
    const itemWordRegex = new RegExp(`\\b${escapeRegex(itemLower)}\\b`, 'i');
    if (itemWordRegex.test(termLower)) {
      return true;
    }
    
    // Exact normalized match
    if (normalizedItem === normalizedTerm) {
      return true;
    }
  }
  return false;
}

/**
 * Process scoring for a single completed AI response
 */
async function processItemScoring(
  ctx: ScoringContext,
  item: { id: string; promptId: string },
  prompt: { text: string },
  result: AIExecutionResult
): Promise<void> {
  const { storage, promptRunId, promptRunClientId, brandName, aliases, clientUrls, allBrandTerms } = ctx;
  
  // Mark as 'scoring' - AI response received, now analyzing
  await storage.updatePromptRunItem(item.id, { status: 'scoring' });

  // Create answer record
  const answer = await storage.createAnswer({
    promptRunItemId: item.id,
    rawResponse: result.rawResponse,
    visibilityScore: null,
    firstMentionPos: null,
    sentimentScore: null,
    positionScore: null,
    citationCount: null
  });

  // Extract citations with self-citation validation
  const citationStartTime = Date.now();
  const citations = extractCitations(result.rawResponse, clientUrls);
  for (const citation of citations) {
    await storage.createCitation({
      answerId: answer.id,
      url: citation.url ?? null,
      domain: citation.domain ?? null,
      displayText: citation.displayText ?? null,
      position: citation.position,
      type: citation.type,
      anchorText: citation.anchorText ?? null,
      isSelfCitation: citation.isSelfCitation ?? false
    });
  }
  performanceLogger.logStage(promptRunId, 'citation_extraction', Date.now() - citationStartTime);

  // Detect mentions (async to support LLM mode)
  const mentionStartTime = Date.now();
  const mentionDetectionResult = await detectMentionsAsync(result.rawResponse, brandName, aliases);
  const { mentions, entityMentions } = mentionDetectionResult;
  performanceLogger.logStage(promptRunId, 'mention_detection', Date.now() - mentionStartTime);
  
  for (const mention of mentions) {
    await storage.createMention({
      answerId: answer.id,
      ...mention
    });
  }

  // Parse rankings (async to support LLM mode)
  const rankingStartTime = Date.now();
  const rankings = await parseRankingsAsync(result.rawResponse, brandName, aliases, prompt.text);
  performanceLogger.logStage(promptRunId, 'ranking_parsing', Date.now() - rankingStartTime);
  
  // Save ALL rankings with isClientBrand marker and rankingGroup
  for (const ranking of rankings) {
    await storage.createRanking({
      answerId: answer.id,
      item: ranking.item,
      position: ranking.position,
      isClientBrand: isClientBrandRanking(ranking.item, allBrandTerms),
      rankingGroup: ranking.rankingGroup ?? null,
      groupRelevance: ranking.groupRelevance ?? null,
      relevanceReason: ranking.relevanceReason ?? null
    });
  }

  // Count self-citations for visibility bonus
  const selfCitationCount = citations.filter(c => c.isSelfCitation).length;

  // Calculate visibility score with self-citation bonus (async to support LLM mode)
  const scoringStartTime = Date.now();
  const visibilityResult = await calculateVisibilityScoreAsync({
    brandName,
    aliases,
    rawResponse: result.rawResponse,
    entityMentions,
    selfCitationCount
  });
  performanceLogger.logStage(promptRunId, 'visibility_scoring', Date.now() - scoringStartTime);

  // Calculate sentiment score from mentions (async to support LLM ABSA mode)
  // Pass brandName and aliases for fallback when entityMentions is empty
  const sentimentStartTime = Date.now();
  const sentimentResult = await calculateSentimentScoreAsync(
    mentions,
    { text: result.rawResponse },
    entityMentions,
    brandName,
    aliases
  );
  performanceLogger.logStage(promptRunId, 'sentiment_scoring', Date.now() - sentimentStartTime);

  // Calculate position score from brand rankings only
  const brandRankings = rankings.filter(r => isClientBrandRanking(r.item, allBrandTerms));
  
  let positionScore = 0;
  const positionVersion = getPositionScoringVersion();
  
  if (brandRankings.length > 0) {
    if (positionVersion === 'v2') {
      const v2Result = calculatePositionScoreV2(brandRankings, rankings);
      positionScore = v2Result.score;
      
      if (process.env.DEBUG_AEO) {
        const contributing = v2Result.groupBreakdown.filter(g => g.contributes);
        console.log(`[PositionV2] Score: ${positionScore} from ${contributing.length} contributing groups`);
        for (const g of v2Result.groupBreakdown) {
          console.log(`  [${g.relevance.toUpperCase()}] "${g.group}" — brand:${g.brandPresent ? 'yes' : 'no'}, nDCG:${g.nDCGScore}, contributes:${g.contributes}`);
        }
      }
    } else {
      const brandGroups = Array.from(new Set(brandRankings.map(r => r.rankingGroup || 'General')));
      const groupScores: number[] = [];
      
      for (const group of brandGroups) {
        const brandRankingsInGroup = brandRankings.filter(r => (r.rankingGroup || 'General') === group);
        const groupScore = positionScoreFromRankings(brandRankingsInGroup);
        groupScores.push(groupScore);
      }
      
      positionScore = Math.max(...groupScores);
    }
  }
  
  const positionResult = {
    positionScore,
    bestPosition: brandRankings.length > 0 ? Math.min(...brandRankings.map(r => r.position)) : null,
    totalRankings: brandRankings.length,
    averagePosition: brandRankings.length > 0 ? 
      Math.round((brandRankings.reduce((sum, r) => sum + r.position, 0) / brandRankings.length) * 100) / 100 : null
  };

  // Save score factors for explainability (async, in parallel)
  await Promise.all([
    savePositionFactors({
      storage,
      promptRunItemId: item.id,
      score: positionResult.positionScore,
      totalRankings: positionResult.totalRankings,
      bestPosition: positionResult.bestPosition
    }),
    saveSentimentFactors({
      storage,
      promptRunItemId: item.id,
      score: sentimentResult.sentimentScore,
      positiveMentions: sentimentResult.positiveMentions,
      neutralMentions: sentimentResult.neutralMentions,
      negativeMentions: sentimentResult.negativeMentions
    }),
    saveVisibilityFactors({
      storage,
      promptRunItemId: item.id,
      score: visibilityResult.score,
      directMentions: visibilityResult.directMentions,
      aliasMentions: visibilityResult.aliasMentions,
      headingHits: 0 // Note: headingHits only available in LLM mode from advanced scorer
    })
  ]);

  // Update answer with all scores
  await storage.updateAnswer(answer.id, {
    visibilityScore: visibilityResult.score.toString(),
    firstMentionPos: visibilityResult.firstMentionPos,
    sentimentScore: sentimentResult.sentimentScore.toString(),
    positionScore: positionResult.positionScore.toString(),
    citationCount: citations.length
  });

}

export async function executePromptRun({
  storage,
  promptRunId,
  onProgress,
  checkCancellation,
  onHeartbeat
}: PromptRunExecutorParams): Promise<void> {
  const logger = RunLogger.forRun(promptRunId);

  // Task #115 — Periodic heartbeat write so `reapStalePromptRuns` can
  // distinguish a healthy long run from a server crash. We stamp once
  // immediately so the row gets a fresh `heartbeat_at` before the first
  // 30s tick, then every 30s during the run. Cleared in `finally`.
  await storage.updatePromptRun(promptRunId, { heartbeatAt: new Date() }).catch(() => {});
  const heartbeatInterval = setInterval(() => {
    storage
      .updatePromptRun(promptRunId, { heartbeatAt: new Date() })
      .catch((err) => console.warn(`[PromptRunExecutor] heartbeat write failed for ${promptRunId}:`, err?.message ?? err));
  }, 30_000);
  heartbeatInterval.unref?.();

  try {
    // Update run status to running
    await storage.updatePromptRun(promptRunId, { status: 'running' });
    onProgress?.(10, 'Starting prompt run execution');
    
    await logger.info('Run started', { aeoMode: AEO_MODE });
    console.log(`[PromptRunExecutor] Starting execution with AEO_MODE=${AEO_MODE}`);

    // Get the prompt run details
    const promptRun = await storage.getPromptRun(promptRunId);
    if (!promptRun) {
      throw new Error('Prompt run not found');
    }

    // Get client details for brand name and aliases
    const client = await storage.getClient(promptRun.clientId);
    if (!client) {
      throw new Error('Client not found');
    }

    const brandName = client.name;
    // Handle various formats: string[], comma-separated string, or null
    let aliases: string[] = [];
    if (Array.isArray(client.brandAliases)) {
      aliases = client.brandAliases as string[];
    } else if (typeof client.brandAliases === 'string') {
      // Parse comma-separated string into array
      aliases = (client.brandAliases as string).split(',').map(a => a.trim()).filter(a => a.length > 0);
    }
    
    console.log(`[PromptRunExecutor] Client "${brandName}" - brandAliases raw:`, JSON.stringify(client.brandAliases));
    console.log(`[PromptRunExecutor] Client "${brandName}" - parsed aliases: [${aliases.join(', ')}] (count: ${aliases.length})`);
    
    // Extract and normalize all client URLs for citation validation
    const clientUrls: string[] = [];
    if (client.website) {
      clientUrls.push(client.website);
    }
    if (client.urls && Array.isArray(client.urls)) {
      for (const urlObj of client.urls) {
        if (urlObj && typeof urlObj === 'object' && urlObj.url && typeof urlObj.url === 'string') {
          clientUrls.push(urlObj.url);
        }
      }
    }
    
    console.log(`[PromptRunExecutor] Client URLs for citation validation: ${clientUrls.join(', ')}`);

    // Get all prompt run items
    const allItems = await storage.getPromptRunItems(promptRunId);
    const totalItems = allItems.length;
    
    // Count unique models and prompts for performance tracking
    const uniqueModelIds = Array.from(new Set(allItems.map(i => i.modelId)));
    const uniquePromptIds = Array.from(new Set(allItems.map(i => i.promptId)));
    
    // Start performance tracking with accurate counts
    performanceLogger.startRun(promptRunId, totalItems, uniquePromptIds, uniqueModelIds);
    
    // Phase 3: Get competitor count for timeout calculation
    const competitors = await storage.getCompetitors(promptRun.clientId);
    const competitorCount = competitors.length;
    
    // Phase 3: Check for existing checkpoint (resume scenario)
    let existingCheckpoint;
    let previouslyCompletedIds = new Set<string>();
    try {
      existingCheckpoint = await storage.getRunCheckpoint(promptRunId);
    } catch (e) {
      // Checkpoint methods may not exist in MemStorage
      console.log(`[PromptRunExecutor] Could not check for checkpoint: ${e}`);
    }
    
    if (existingCheckpoint) {
      // Resume scenario - skip already completed items
      previouslyCompletedIds = new Set(existingCheckpoint.completedItemIds || []);
      console.log(`[PromptRunExecutor] Resuming from checkpoint: ${previouslyCompletedIds.size} items already completed, stage: ${existingCheckpoint.currentStage}`);
      
      // If we're resuming from benchmarking stage, skip execution phase
      if (existingCheckpoint.currentStage === 'benchmarking') {
        console.log(`[PromptRunExecutor] Fast-forwarding to benchmarking stage`);
        // Items should already be in queued_for_benchmarking state from previous run
      }
    } else {
      // Fresh run - create new checkpoint
      const timeout = calculateJobTimeout({
        promptCount: uniquePromptIds.length,
        modelCount: uniqueModelIds.length,
        competitorCount
      });
      
      console.log(`[PromptRunExecutor] Creating checkpoint (${uniquePromptIds.length} prompts × ${uniqueModelIds.length} models × ${competitorCount} competitors, timeout: ${formatTimeout(timeout)})`);
      
      try {
        await storage.createRunCheckpoint({
          promptRunId,
          completedItemIds: [],
          currentStage: 'execution',
          promptCount: uniquePromptIds.length,
          modelCount: uniqueModelIds.length,
          competitorCount,
          timeoutMs: timeout
        });
      } catch (e) {
        console.log(`[PromptRunExecutor] Could not create checkpoint: ${e}`);
      }
    }
    
    // Filter out already completed items for execution
    const items = allItems.filter(item => !previouslyCompletedIds.has(item.id));
    console.log(`[PromptRunExecutor] ${items.length} items to process (${previouslyCompletedIds.size} already completed)`);
    
    // Track completed item IDs for checkpoint updates (include previously completed)
    const completedItemIds: string[] = Array.from(previouslyCompletedIds);
    
    onProgress?.(20, `Processing ${totalItems} prompt-model combinations`);

    // === PHASE 1: PARALLEL AI EXECUTION ===
    // Pre-fetch all prompts and models to avoid N DB calls
    const promptMap = new Map<string, { text: string }>();
    const modelMap = new Map<string, { vendor: string; model: string; displayName: string }>();
    
    // Fetch prompts in parallel
    await Promise.all(uniquePromptIds.map(async (promptId) => {
      const prompt = await storage.getPrompt(promptId);
      if (prompt) {
        promptMap.set(promptId, { text: prompt.text });
      }
    }));
    
    // Fetch models in parallel
    await Promise.all(uniqueModelIds.map(async (modelId) => {
      const model = await storage.getAiModel(modelId);
      if (model) {
        modelMap.set(modelId, { 
          vendor: model.vendor, 
          model: model.model, 
          displayName: model.displayName 
        });
      }
    }));
    
    console.log(`[PromptRunExecutor] Pre-fetched ${promptMap.size} prompts and ${modelMap.size} models`);
    
    await logger.info('Execution setup complete', {
      totalItems: items.length,
      prompts: promptMap.size,
      models: modelMap.size,
      competitors: competitorCount,
      resumedFrom: previouslyCompletedIds.size > 0 ? previouslyCompletedIds.size : undefined
    });
    
    // Build batch items, validating prompt/model exist
    const batchItems: BatchItem[] = [];
    const itemLookup = new Map<string, typeof items[0]>();
    
    for (const item of items) {
      const prompt = promptMap.get(item.promptId);
      const model = modelMap.get(item.modelId);
      
      if (!prompt) {
        await storage.updatePromptRunItem(item.id, { 
          status: 'error', 
          error: 'Prompt not found',
          finishedAt: new Date()
        });
        performanceLogger.incrementFailedItems(promptRunId);
        continue;
      }
      
      if (!model) {
        await storage.updatePromptRunItem(item.id, { 
          status: 'error', 
          error: 'AI model not found',
          finishedAt: new Date()
        });
        performanceLogger.incrementFailedItems(promptRunId);
        continue;
      }
      
      batchItems.push({
        id: item.id,
        promptId: item.promptId,
        promptText: prompt.text,
        modelId: item.modelId,
        vendor: model.vendor,
        model: model.model
      });
      itemLookup.set(item.id, item);
      
      // Mark item as running
      await storage.updatePromptRunItem(item.id, { 
        status: 'running',
        startedAt: new Date()
      });
    }
    
    console.log(`[PromptRunExecutor] Prepared ${batchItems.length} items for parallel execution`);
    
    // Build scoring context
    const spacingVariations = generateSpacingVariations(brandName);
    const allBrandTerms = [brandName, ...aliases, ...spacingVariations];
    
    const scoringContext: ScoringContext = {
      storage,
      promptRunId,
      promptRunClientId: promptRun.clientId,
      brandName,
      aliases,
      clientUrls,
      allBrandTerms
    };
    
    // Track items per prompt for benchmarking status transition
    const itemsPerPrompt = new Map<string, string[]>();
    for (const item of items) {
      const list = itemsPerPrompt.get(item.promptId) || [];
      list.push(item.id);
      itemsPerPrompt.set(item.promptId, list);
    }
    
    // Track completed items per prompt
    const completedByPrompt = new Map<string, Set<string>>();
    
    // Track successful completions per prompt (excludes errors)
    const successfulByPrompt = new Map<string, Set<string>>();
    
    // Execute batch with parallel AI calls
    let completedCount = 0;
    
    await executeBatch(batchItems, {
      runId: promptRunId,
      checkCancellation, // Pass cancellation checker to batch executor
      onProgress: (completed, total, message) => {
        const progress = 20 + Math.floor((completed / total) * 70);
        onProgress?.(progress, message);
      },
      onItemComplete: async (itemId, success, result, error) => {
        completedCount++;
        const item = itemLookup.get(itemId);
        const prompt = item ? promptMap.get(item.promptId) : undefined;
        
        // Phase 3: Track completed item for checkpoint (success or error)
        completedItemIds.push(itemId);

        // Task #139 — Persist the checkpoint incrementally so a pause (or a
        // crash) mid-execution resumes from the last completed item instead
        // of the start of the execution phase. Best-effort: MemStorage may
        // not implement checkpoints, and a single failed write here must not
        // abort the run.
        try {
          await storage.updateRunCheckpoint(promptRunId, {
            completedItemIds,
            currentStage: 'execution',
          });
        } catch (e) {
          // Non-fatal; the next item's update (or the benchmarking-stage
          // write) will catch up.
        }
        
        if (!success || !result || result.error) {
          await storage.updatePromptRunItem(itemId, { 
            status: 'error', 
            error: error || result?.error || 'Unknown error',
            finishedAt: new Date()
          });
          performanceLogger.incrementFailedItems(promptRunId);
          // Track as processed (but not successful) for benchmarking transition
          if (item) {
            const promptId = item.promptId;
            if (!completedByPrompt.has(promptId)) {
              completedByPrompt.set(promptId, new Set());
            }
            completedByPrompt.get(promptId)!.add(itemId);
            
            // Check if all items for this prompt are now processed
            const totalForPrompt = itemsPerPrompt.get(promptId)?.length || 0;
            const processedForPrompt = completedByPrompt.get(promptId)!.size;
            
            if (processedForPrompt >= totalForPrompt) {
              // All items processed - transition successful siblings to queued_for_benchmarking
              const currentItems = await storage.getPromptRunItems(promptRunId);
              const currentItemsForPrompt = currentItems.filter(it => it.promptId === promptId);
              for (const pItem of currentItemsForPrompt) {
                if (pItem.status === 'scoring') {
                  await storage.updatePromptRunItem(pItem.id, { 
                    status: 'queued_for_benchmarking'
                  });
                }
              }
              console.log(`[StatusFlow] All ${totalForPrompt} items for prompt ${promptId} processed (with errors)`);
            }
          }
          return;
        }
        
        if (!item || !prompt) {
          await storage.updatePromptRunItem(itemId, { 
            status: 'error', 
            error: 'Item or prompt not found',
            finishedAt: new Date()
          });
          performanceLogger.incrementFailedItems(promptRunId);
          return;
        }
        
        try {
          // Process scoring for this item
          await processItemScoring(scoringContext, item, prompt, result);
          
          // Track successful completion for benchmarking status transition
          const promptId = item.promptId;
          if (!successfulByPrompt.has(promptId)) {
            successfulByPrompt.set(promptId, new Set());
          }
          successfulByPrompt.get(promptId)!.add(itemId);
          
          // Check if all items for this prompt are processed (success or error)
          const totalForPrompt = itemsPerPrompt.get(promptId)?.length || 0;
          if (!completedByPrompt.has(promptId)) {
            completedByPrompt.set(promptId, new Set());
          }
          completedByPrompt.get(promptId)!.add(itemId);
          const processedForPrompt = completedByPrompt.get(promptId)!.size;
          
          if (processedForPrompt >= totalForPrompt) {
            // All items for this prompt finished - mark successful ones as queued_for_benchmarking
            const currentItems = await storage.getPromptRunItems(promptRunId);
            const currentItemsForPrompt = currentItems.filter(it => it.promptId === promptId);
            for (const pItem of currentItemsForPrompt) {
              if (pItem.status === 'scoring') {
                await storage.updatePromptRunItem(pItem.id, { 
                  status: 'queued_for_benchmarking'
                });
              }
            }
            const successCount = successfulByPrompt.get(promptId)?.size || 0;
            console.log(`[StatusFlow] All ${totalForPrompt} items for prompt ${promptId} processed (${successCount} successful, queued for benchmarking)`);
          }
        } catch (scoringError) {
          console.error(`Error scoring item ${itemId}:`, scoringError);
          await storage.updatePromptRunItem(itemId, { 
            status: 'error', 
            error: scoringError instanceof Error ? scoringError.message : 'Scoring error',
            finishedAt: new Date()
          });
          performanceLogger.incrementFailedItems(promptRunId);
          // Track as processed but not successful
          const promptId = item.promptId;
          if (!completedByPrompt.has(promptId)) {
            completedByPrompt.set(promptId, new Set());
          }
          completedByPrompt.get(promptId)!.add(itemId);
          
          // Check if all items for this prompt are now processed
          const totalForPrompt = itemsPerPrompt.get(promptId)?.length || 0;
          const processedForPrompt = completedByPrompt.get(promptId)!.size;
          
          if (processedForPrompt >= totalForPrompt) {
            // All items processed - transition successful siblings to queued_for_benchmarking
            const currentItems = await storage.getPromptRunItems(promptRunId);
            const currentItemsForPrompt = currentItems.filter(it => it.promptId === promptId);
            for (const pItem of currentItemsForPrompt) {
              if (pItem.status === 'scoring') {
                await storage.updatePromptRunItem(pItem.id, { 
                  status: 'queued_for_benchmarking'
                });
              }
            }
            console.log(`[StatusFlow] All ${totalForPrompt} items for prompt ${promptId} processed (scoring error in batch)`);
          }
        }
      }
    });
    
    console.log(`[PromptRunExecutor] Parallel execution complete: ${completedCount}/${batchItems.length} items processed`);

    // === COMPLETION GATE ===
    // Verify ALL items are in a terminal state before proceeding to scoring
    onProgress?.(92, 'Verifying all items completed');
    const finalItems = await storage.getPromptRunItems(promptRunId);
    // Items in 'queued_for_benchmarking' state are ready for competitor scoring
    const terminalStates = ['queued_for_benchmarking', 'benchmarking', 'done', 'error', 'cancelled'];
    const pendingItems = finalItems.filter(item => !terminalStates.includes(item.status));
    
    if (pendingItems.length > 0) {
      // Log which items are still pending
      console.error(`[CompletionGate] ${pendingItems.length} items still pending:`);
      for (const item of pendingItems) {
        console.error(`  - Item ${item.id}: status=${item.status}, promptId=${item.promptId}, modelId=${item.modelId}`);
      }
      
      // Mark pending items as error so they don't block future runs
      for (const item of pendingItems) {
        await storage.updatePromptRunItem(item.id, {
          status: 'error',
          error: 'Item did not complete within execution window',
          finishedAt: new Date()
        });
        performanceLogger.incrementFailedItems(promptRunId);
      }
      console.log(`[CompletionGate] Marked ${pendingItems.length} pending items as error`);
    }
    
    // Verify we have answers for items ready for benchmarking
    const benchmarkingItems = finalItems.filter(item => item.status === 'queued_for_benchmarking');
    const answersCheck = await Promise.all(
      benchmarkingItems.map(async item => ({
        itemId: item.id,
        hasAnswer: !!(await storage.getAnswerByPromptRunItem(item.id))
      }))
    );
    const missingAnswers = answersCheck.filter(check => !check.hasAnswer);
    if (missingAnswers.length > 0) {
      console.warn(`[CompletionGate] ${missingAnswers.length} benchmarking items missing answers:`, 
        missingAnswers.map(m => m.itemId).join(', '));
    }
    
    console.log(`[CompletionGate] Verified: ${benchmarkingItems.length} benchmarking, ${finalItems.filter(i => i.status === 'error').length} errors, ${pendingItems.length} were pending`);

    // Phase 3: Update checkpoint to 'benchmarking' stage
    try {
      await storage.updateRunCheckpoint(promptRunId, {
        completedItemIds,
        currentStage: 'benchmarking'
      });
      console.log(`[PromptRunExecutor] Checkpoint updated: ${completedItemIds.length} items completed, entering benchmarking stage`);
    } catch (e) {
      console.error('[PromptRunExecutor] Failed to update checkpoint:', e);
    }
    
    await logger.info('Stage transition: benchmarking', {
      completedItems: completedItemIds.length,
      benchmarkingItems: benchmarkingItems.length,
      errorItems: finalItems.filter(i => i.status === 'error').length
    });
    
    // Task #139 — Cooperative checkpoint at the phase boundary. Competitor
    // scoring is itself a paid LLM stage, so honor a pause/cancel/halt
    // requested during execution BEFORE we start paying for benchmarking.
    // checkCancellation throws "Job paused" / "Job cancelled" / "Run halted
    // by admin disable", which the top-level catch handles (paused preserves
    // the checkpoint so resume re-enters benchmarking).
    checkCancellation?.();

    // Calculate competitor scores - items are marked 'benchmarking' when they start, 'done' when they finish
    onProgress?.(95, 'Calculating competitor scores');
    const competitorScoringStartTime = Date.now();
    const scoringDoneItemIds = new Set<string>();
    try {
      await calculateCompetitorScores(
        storage, 
        promptRunId, 
        // onPromptStart: mark items as 'benchmarking' when competitor scoring starts
        async (promptId, itemIds) => {
          for (const itemId of itemIds) {
            await storage.updatePromptRunItem(itemId, { 
              status: 'benchmarking'
            });
          }
          console.log(`[CompletionGate] Marked ${itemIds.length} items as benchmarking for prompt ${promptId}`);
        },
        // onPromptComplete: mark items as 'done' when competitor scoring finishes
        async (promptId, itemIds) => {
          for (const itemId of itemIds) {
            await storage.updatePromptRunItem(itemId, { 
              status: 'done',
              finishedAt: new Date()
            });
            scoringDoneItemIds.add(itemId);
            performanceLogger.incrementSuccessfulItems(promptRunId);
          }
          console.log(`[CompletionGate] Marked ${itemIds.length} items as done for prompt ${promptId}`);
        },
        // onHeartbeat: Phase 1 scaling - send heartbeat during long competitor scoring
        onHeartbeat
      );
    } catch (error) {
      console.error('Error calculating competitor scores:', error);
      // Don't fail the entire run if competitor scoring fails
      // Mark any remaining benchmarking items as done to prevent them being stuck
      const remainingItems = benchmarkingItems.filter(item => !scoringDoneItemIds.has(item.id));
      for (const item of remainingItems) {
        await storage.updatePromptRunItem(item.id, { 
          status: 'done',
          finishedAt: new Date()
        });
        scoringDoneItemIds.add(item.id);
        performanceLogger.incrementSuccessfulItems(promptRunId);
      }
      if (remainingItems.length > 0) {
        console.log(`[CompletionGate] Marked ${remainingItems.length} remaining items as done after scoring error`);
      }
    }
    
    // Assert all benchmarking items reached terminal state
    const stillBenchmarking = benchmarkingItems.filter(item => !scoringDoneItemIds.has(item.id));
    if (stillBenchmarking.length > 0) {
      console.warn(`[CompletionGate] WARNING: ${stillBenchmarking.length} items still in benchmarking state:`, 
        stillBenchmarking.map(i => i.id).join(', '));
    }
    performanceLogger.logStage(promptRunId, 'competitor_scoring', Date.now() - competitorScoringStartTime);
    console.log(`[CompletionGate] Competitor scoring complete, ${scoringDoneItemIds.size} items marked done`);

    // Phase 3: Completion Gating - Validate before marking complete
    onProgress?.(98, 'Validating run completion');
    const validation = await storage.validateRunCompletion(promptRunId);
    
    if (!validation.isValid) {
      // Step 3.7: Mark run 'error' with reason if validation fails
      const errorReason = `Completion validation failed: ${validation.errors.join('; ')}`;
      console.error(`[CompletionGate] ${errorReason}`);
      await storage.updatePromptRun(promptRunId, { 
        status: 'error'
      });
      
      // Still delete checkpoint to avoid stale data
      try {
        await storage.deleteRunCheckpoint(promptRunId);
      } catch (e) {
        console.error('[PromptRunExecutor] Failed to delete checkpoint:', e);
      }
      
      throw new Error(errorReason);
    }
    
    // Phase 3B: Aggregate core prompt-run errors.
    const errorSummary = await storage.aggregateRunErrors(promptRunId);
    
    // Task #79 — Final-state guard. If the disable cascade (or a user
    // cancellation) marked this run 'error' / 'cancelled' while the
    // executor was mid-flight, do NOT overwrite that terminal state
    // back to 'done' / 'completed_with_errors'. Cooperative cancellation
    // catches most cases earlier, but a race on the very last item is
    // still possible.
    let guardRun = await storage.getPromptRun(promptRunId);
    if (guardRun && (guardRun.status === 'error' || guardRun.status === 'cancelled' || guardRun.status === 'paused')) {
      // Task #139 — 'paused' added: a pause requested late (after the
      // execution phase but before this gate) must NOT be steam-rolled into
      // a 'done' write, or the run would silently complete instead of
      // pausing. The checkpoint is preserved so resume is still possible.
      console.log(`[CompletionGate] Skipping completion write — run already in terminal/paused state '${guardRun.status}'`);
      await logger.warn('Run already terminal/paused at completion gate', { terminalStatus: guardRun.status });
    } else {
      // Recommendations and content drafts are part of the same visible run
      // lifecycle. The run remains non-terminal until this finalization step
      // settles, rather than launching detached work after completion.
      const deliverables = await finalizePromptRunDeliverables({
        storage,
        clientId: promptRun.clientId,
        promptRunId,
        onProgress,
        checkCancellation,
      });
      if (deliverables.status === 'needs_attention') {
        await logger.warn('Prompt run completed but some final deliverables failed', {
          errors: deliverables.errors,
          recommendationCount: deliverables.recommendationCount,
          contentCount: deliverables.contentCount,
        });
      } else {
        await logger.info('Final deliverables completed', {
          recommendationCount: deliverables.recommendationCount,
          contentCount: deliverables.contentCount,
        });
      }

      // Re-check after the paid finalization calls so a late pause/cancel is
      // never overwritten by the terminal run status.
      guardRun = await storage.getPromptRun(promptRunId);
      if (guardRun && (guardRun.status === 'error' || guardRun.status === 'cancelled' || guardRun.status === 'paused')) {
        console.log(`[CompletionGate] Skipping completion write after deliverables — run is '${guardRun.status}'`);
      } else if (errorSummary.errorCount > 0) {
      // Step 3B.6: Set run status to 'completed_with_errors' if any item has error
        onProgress?.(100, `Prompt run completed with ${errorSummary.errorCount} response errors`);
        await storage.updatePromptRun(promptRunId, {
          status: 'completed_with_errors',
          errorSummary: errorSummary.errorSummary
        });
        console.log(`[CompletionGate] Completed with core errors: ${errorSummary.errorSummary}`);
        await logger.warn('Run completed with core response errors', {
          errorCount: errorSummary.errorCount,
          errorSummary: errorSummary.errorSummary
        });
      } else {
        // A deliverable warning does not change the successful core run
        // outcome. The separate deliverablesStatus tells the UI what needs
        // attention.
        const message = deliverables.status === 'needs_attention'
          ? 'Prompt run completed; some final deliverables need attention'
          : 'Prompt run completed';
        onProgress?.(100, message);
        await storage.updatePromptRun(promptRunId, { status: 'done' });
        console.log(`[CompletionGate] Validation passed: items=${validation.actualAnswers}/${validation.expectedAnswers}, scores=${validation.actualCompetitorScores}/${validation.expectedCompetitorScores}, deliverables=${deliverables.status}`);
        await logger.info(message, {
          answers: validation.actualAnswers,
          competitorScores: validation.actualCompetitorScores,
          deliverablesStatus: deliverables.status,
        });
      }
    }
    
    // Phase 3: Delete checkpoint on successful completion - no longer needed
    try {
      await storage.deleteRunCheckpoint(promptRunId);
      console.log(`[PromptRunExecutor] Checkpoint deleted for completed run ${promptRunId}`);
    } catch (e) {
      console.error('[PromptRunExecutor] Failed to delete checkpoint:', e);
    }
    
    // End performance tracking and print summary
    performanceLogger.endRun(promptRunId);

  } catch (error) {
    // Task #79 — "Run halted by admin disable" is thrown by the JobQueue
    // poller when the disable cascade flipped this run/job to 'error'.
    // Honor that terminal state — do NOT downgrade to 'cancelled' or
    // overwrite the cascade's errorSummary.
    const isHalted =
      error instanceof Error && error.message === 'Run halted by admin disable';
    if (isHalted) {
      console.log(`[PromptRunExecutor] Run halted by admin disable: ${promptRunId} — preserving 'error' state`);
      await logger.warn('Run halted by admin disable — preserving terminal state');
      return;
    }

    // Task #139 — "Job paused" is thrown by the JobQueue poll when the user
    // pauses this run. Persist 'paused', but LEAVE items as-is and DO NOT
    // delete the checkpoint, so resume continues from the last completed
    // item without re-paying for completed work.
    const isPaused =
      error instanceof Error && error.message === 'Job paused';
    if (isPaused) {
      console.log(`[PromptRunExecutor] Run paused by user: ${promptRunId} — preserving checkpoint + items`);
      await logger.warn('Run paused by user — preserving checkpoint');
      await storage.updatePromptRun(promptRunId, { status: 'paused' });
      return;
    }

    // Check if this is a cancellation error
    const isCancelled = error instanceof Error && error.message === 'Job cancelled';
    
    if (isCancelled) {
      console.log('Prompt run cancelled:', promptRunId);
      await logger.warn('Run cancelled by user');
      
      // Mark prompt run as cancelled
      await storage.updatePromptRun(promptRunId, { 
        status: 'cancelled'
      });
      
      // Mark all non-completed items as cancelled. Task #139 — include
      // 'scoring' and 'queued_for_benchmarking' too; previously these
      // mid-pipeline states were skipped and left stuck after a stop.
      const items = await storage.getPromptRunItems(promptRunId);
      const nonTerminalItemStatuses = new Set([
        'queued',
        'running',
        'scoring',
        'queued_for_benchmarking',
        'benchmarking',
      ]);
      for (const item of items) {
        if (nonTerminalItemStatuses.has(item.status)) {
          await storage.updatePromptRunItem(item.id, { 
            status: 'cancelled',
            finishedAt: new Date()
          });
        }
      }
      
      // Don't re-throw cancellation errors
      return;
    }
    
    // For other errors, mark as error and re-throw
    console.error('Error executing prompt run:', error);
    await logger.error('Run failed with error', error instanceof Error ? error : { message: String(error) });
    await storage.updatePromptRun(promptRunId, { 
      status: 'error'
    });
    throw error;
  } finally {
    // Task #115 — Stop the periodic heartbeat write. Safe to clear even
    // if we threw before reaching the heartbeat ticker.
    clearInterval(heartbeatInterval);
  }
}
