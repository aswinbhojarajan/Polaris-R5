import type { IStorage } from '../storage';
import { discoverCompetitors, type DiscoveredCompetitor } from './competitor-discovery';
import { calculateVisibilityScoreAsync } from './visibility-scoring';
import { detectMentions, detectMentionsAsync, generateSpacingVariations, normalizeDiacritics, type Mention } from './mention-detector';
import { parseRankingsAsync } from './ranking-parser';
import { calculateSentimentScoreAsync } from './scoring';
import { positionScoreFromRankings, calculatePositionScoreV2 } from './composer';
import { getPositionScoringVersion } from '../config/position-scoring';
import { extractCitations } from './citation-extractor';
import { AEO_MODE, AEO_CONFIG } from '../config/aeo';
import type { EntityMention } from '../types/aeo';
import { performanceLogger } from './performance-logger';

// Concurrency limit for parallel competitor scoring
const COMPETITOR_BATCH_SIZE = 3;

// Result from scoring a single competitor
interface CompetitorScoreResult {
  name: string;
  competitorId: string | null;
  visibilityScore: number;
  sentimentScore: number;
  positionScore: number;
  overallScore: number;
  duration: number;
}

/**
 * Score a single competitor against all answers for a prompt
 */
async function scoreCompetitorForPrompt(
  comp: DiscoveredCompetitor,
  answersForPrompt: Array<{ item: any; answer: any }>,
  promptText: string,
  existingCompetitors: Array<{ id: string; name: string }>,
  w: { visibility: number; sentiment: number; position: number }
): Promise<CompetitorScoreResult> {
  const startTime = Date.now();
  const existing = existingCompetitors.find(e => e.name === comp.name);
  
  console.log(`[CompetitorScoring] Scoring "${comp.name}" with aliases: [${comp.aliases.join(', ')}] (count: ${comp.aliases.length})`);
  
  
  const competitorUrls: string[] = [];
  if (comp.website) {
    competitorUrls.push(comp.website);
  }
  
  let totalVisibilityScore = 0;
  let visibilityCount = 0;
  let allMentions: Mention[] = [];
  let allRankings: any[] = [];
  let allResponseRankings: any[] = [];
  let totalSentimentScore = 0;
  let sentimentCount = 0;

  // Analyze each answer for this competitor
  for (const { answer } of answersForPrompt) {
    const citations = extractCitations(answer.rawResponse, competitorUrls);
    const selfCitationCount = citations.filter(c => c.isSelfCitation).length;
    
    // Phase 1.1: Wrap detectMentionsAsync in try/catch with heuristic fallback (parity with client)
    let mentionDetectionResult: { mentions: Mention[]; entityMentions?: EntityMention[] };
    try {
      mentionDetectionResult = await detectMentionsAsync(answer.rawResponse, comp.name, comp.aliases);
    } catch (error) {
      console.warn(`[CompetitorScoring] detectMentionsAsync failed for "${comp.name}", using heuristic fallback:`, error);
      // Use synchronous heuristic detector as fallback (matches client behavior)
      // IMPORTANT: Leave entityMentions as undefined (not empty array) so visibility/sentiment
      // scoring can synthesize from heuristic mentions - mirrors client's heuristic path
      mentionDetectionResult = { 
        mentions: detectMentions(answer.rawResponse, comp.name, comp.aliases)
      };
    }
    
    // Conditionally include entityMentions only when available (parity with client heuristic path)
    // When entityMentions is undefined, visibility scoring falls back to heuristic-based calculations
    const visibilityInput = {
      brandName: comp.name,
      aliases: comp.aliases,
      rawResponse: answer.rawResponse,
      selfCitationCount,
      ...(mentionDetectionResult.entityMentions && {
        entityMentions: mentionDetectionResult.entityMentions,
      }),
    };
    const visibilityResult = await calculateVisibilityScoreAsync(visibilityInput);
    
    totalVisibilityScore += visibilityResult.score;
    visibilityCount++;
    
    if (AEO_MODE === 'llm' || AEO_MODE === 'hybrid') {
      // Phase 1.2: Wrap sentiment LLM call in try/catch with neutral fallback (parity with client)
      try {
        const answerSentimentResult = await calculateSentimentScoreAsync(
          mentionDetectionResult.mentions,
          { text: answer.rawResponse },
          mentionDetectionResult.entityMentions,
          comp.name,
          comp.aliases
        );
        // Phase 2.1: Use SIMPLE AVERAGE (parity with client)
        // Every answer contributes equally - even answers with 0 mentions get their sentiment score included
        // This matches client behavior where each answer stores its sentiment score directly
        totalSentimentScore += answerSentimentResult.sentimentScore;
        sentimentCount += 1;
      } catch (error) {
        console.warn(`[CompetitorScoring] Sentiment scoring failed for "${comp.name}", using neutral fallback:`, error);
        // Neutral fallback: add neutral score (0) with weight 1 so answer is still counted
        totalSentimentScore += 0;
        sentimentCount += 1;
      }
    } else {
      allMentions.push(...mentionDetectionResult.mentions);
    }

    const rankings = await parseRankingsAsync(answer.rawResponse, comp.name, comp.aliases, promptText);
    
    // Phase 1.3: Generate spacing variations for BOTH name AND aliases (parity with client)
    // Client includes: [name, aliases, spacingVariations(name), spacingVariations(aliases)]
    const nameSpacingVariations = generateSpacingVariations(comp.name);
    const aliasSpacingVariations = comp.aliases.flatMap(alias => generateSpacingVariations(alias));
    const allCompetitorTerms = [comp.name, ...comp.aliases, ...nameSpacingVariations, ...aliasSpacingVariations];
    
    // Helper to normalize all Unicode hyphen variants to regular hyphen
    const normalizeHyphens = (str: string): string => str.replace(/[–—‑−]/g, '-');
    
    // Helper to escape regex special characters
    const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const competitorRankings = rankings.filter(r => {
      const itemLower = r.item.toLowerCase();
      // Normalize both hyphens AND diacritics (e.g., "Espolòn" → "Espolon")
      const normalizedItem = normalizeDiacritics(normalizeHyphens(itemLower));
      
      const matchedTerm = allCompetitorTerms.find(term => {
        const termLower = term.toLowerCase();
        const normalizedTerm = normalizeDiacritics(normalizeHyphens(termLower));
        
        // For short terms (< 4 chars like "AD", "AI"), require strict word boundary
        // This prevents "AD" from matching "ADOBE", "PAID", "ROAD", etc.
        if (termLower.length < 4) {
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
          if (wordBoundaryRegex.test(itemLower)) {
            return true;
          }
          const normalizedRegex = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, 'i');
          return normalizedRegex.test(normalizedItem);
        }
        
        // For longer terms, use word boundary regex instead of includes()
        const termWordRegex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
        if (termWordRegex.test(itemLower)) {
          return true;
        }
        
        const normalizedTermRegex = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, 'i');
        if (normalizedTermRegex.test(normalizedItem)) {
          return true;
        }
        
        // Check if item is a complete substring of term (for partial brand names)
        const itemWordRegex = new RegExp(`\\b${escapeRegex(itemLower)}\\b`, 'i');
        if (itemWordRegex.test(termLower)) {
          return true;
        }
        
        return normalizedItem === normalizedTerm;
      });
      
      if (matchedTerm) {
        console.log(`[CompetitorScoring] "${comp.name}" matched ranking "${r.item}" (position ${r.position}, group: ${r.rankingGroup || 'General'}) via term "${matchedTerm}"`);
      }
      
      return !!matchedTerm;
    });
    
    allRankings.push(...competitorRankings);
    allResponseRankings.push(...rankings);
    
    if (competitorRankings.length > 0) {
      console.log(`[CompetitorScoring] "${comp.name}" found ${competitorRankings.length} rankings in this response`);
    }
  }

  const avgVisibility = visibilityCount > 0 ? Math.round((totalVisibilityScore / visibilityCount) * 10) / 10 : 0;
  
  let avgSentiment: number;
  if (AEO_MODE === 'llm' || AEO_MODE === 'hybrid') {
    avgSentiment = sentimentCount > 0 ? Math.round((totalSentimentScore / sentimentCount) * 10) / 10 : 0;
  } else {
    const sentimentResult = await calculateSentimentScoreAsync(allMentions);
    avgSentiment = Math.round(sentimentResult.sentimentScore * 10) / 10;
  }
  
  let positionScore = 0;
  const positionVersion = getPositionScoringVersion();
  
  if (allRankings.length > 0) {
    if (positionVersion === 'v2') {
      const v2Result = calculatePositionScoreV2(allRankings, allResponseRankings);
      positionScore = v2Result.score;
    } else {
      const competitorGroups = Array.from(new Set(allRankings.map(r => r.rankingGroup || 'General')));
      const groupScores: number[] = [];
      
      for (const group of competitorGroups) {
        const competitorRankingsInGroup = allRankings.filter(r => (r.rankingGroup || 'General') === group);
        const groupScore = positionScoreFromRankings(competitorRankingsInGroup);
        groupScores.push(groupScore);
      }
      
      positionScore = Math.max(...groupScores);
    }
  }
  
  positionScore = Math.round(positionScore * 10) / 10;
  const overallScore = Math.round((
    (avgVisibility * w.visibility) +
    (avgSentiment * w.sentiment) +
    (positionScore * w.position)
  ) * 10) / 10;

  return {
    name: comp.name,
    competitorId: existing?.id || null,
    visibilityScore: avgVisibility,
    sentimentScore: avgSentiment,
    positionScore,
    overallScore,
    duration: Date.now() - startTime
  };
}

interface CompetitorAnalysis {
  name: string;
  competitorId: string | null;
  isClient: boolean;
  mentions: number;
  visibilityScore: number;
  sentimentScore: number;
  positionScore: number;
  overallScore: number;
}

/**
 * Callback called when a prompt's competitor scoring starts.
 * Receives the promptId and the item IDs for that prompt so they can be marked as 'benchmarking'.
 */
export type OnPromptScoringStart = (promptId: string, itemIds: string[]) => Promise<void>;

/**
 * Callback called after each prompt's competitor scoring completes.
 * Receives the promptId and the item IDs for that prompt so they can be marked as 'done'.
 */
export type OnPromptScoringComplete = (promptId: string, itemIds: string[]) => Promise<void>;

/**
 * Callback called periodically during long-running scoring to prove job is alive.
 */
export type OnHeartbeat = () => Promise<void>;

/**
 * Analyzes all answers in a prompt run to calculate scores for competitors at PROMPT LEVEL.
 * Client scores are taken directly from the prompt run's answer data.
 * This should be called after a prompt run completes.
 * NEW: Stores one score record per {competitor, prompt} pair for benchmark analysis.
 * 
 * @param onPromptStart - Optional callback invoked when each prompt's scoring begins,
 *                        allowing per-prompt status updates (queued_for_benchmarking → benchmarking)
 * @param onPromptComplete - Optional callback invoked after each prompt's scoring finishes,
 *                           allowing per-prompt status updates (benchmarking → done)
 * @param onHeartbeat - Optional callback to send heartbeat during long operations (Phase 1 scaling)
 */
export async function calculateCompetitorScores(
  storage: IStorage,
  promptRunId: string,
  onPromptStart?: OnPromptScoringStart,
  onPromptComplete?: OnPromptScoringComplete,
  onHeartbeat?: OnHeartbeat
): Promise<void> {
  console.log(`Starting prompt-level competitor scoring for run: ${promptRunId}`);

  // Get the prompt run
  const promptRun = await storage.getPromptRun(promptRunId);
  if (!promptRun) {
    throw new Error('Prompt run not found');
  }

  // Get client details
  const client = await storage.getClient(promptRun.clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  // Get existing competitors
  const existingCompetitors = await storage.getCompetitors(client.id);

  // Discover competitors (up to 5 total including existing)
  const discoveredCompetitors = await discoverCompetitors(client, existingCompetitors);
  console.log(`Analyzing ${discoveredCompetitors.length} competitors at prompt level`);
  
  // Update performance logger with competitor count
  performanceLogger.updateCompetitorCount(promptRunId, discoveredCompetitors.length);

  // Get all prompt run items with their answers
  const items = await storage.getPromptRunItems(promptRunId);
  const itemsWithAnswers = await Promise.all(
    items.map(async item => ({
      item,
      answer: await storage.getAnswerByPromptRunItem(item.id)
    }))
  );

  // Group by promptId
  const promptGroups = new Map<string, Array<{ item: any; answer: any }>>();
  for (const { item, answer } of itemsWithAnswers) {
    if (!answer) continue;
    
    if (!promptGroups.has(item.promptId)) {
      promptGroups.set(item.promptId, []);
    }
    promptGroups.get(item.promptId)!.push({ item, answer });
  }

  if (promptGroups.size === 0) {
    console.log('No answers found for prompt run');
    return;
  }

  // Delete existing competitor scores for this run (ensures idempotency)
  try {
    const existingScores = await storage.getCompetitorScoresByRun(promptRunId);
    for (const score of existingScores) {
      await storage.deleteCompetitorScore(score.id);
    }
    if (existingScores.length > 0) {
      console.log(`Deleted ${existingScores.length} existing competitor scores for run ${promptRunId}`);
    }
  } catch (error) {
    console.error('Error deleting existing competitor scores:', error);
  }

  // Process each prompt separately
  let totalScoresSaved = 0;
  const promptGroupsArray = Array.from(promptGroups.entries());
  const totalPrompts = promptGroupsArray.length;
  
  for (let promptIndex = 0; promptIndex < promptGroupsArray.length; promptIndex++) {
    const [promptId, answersForPrompt] = promptGroupsArray[promptIndex];
    const promptStartTime = Date.now();
    console.log(`\n[Prompt ${promptIndex + 1}/${totalPrompts}] Processing ${answersForPrompt.length} answers`);
    
    // Mark items as 'benchmarking' when scoring starts for this prompt
    if (onPromptStart) {
      const itemIds = answersForPrompt.map(({ item }) => item.id);
      await onPromptStart(promptId, itemIds);
    }
    
    // Get the prompt text for context-aware ranking detection
    const prompt = await storage.getPrompt(promptId);
    const promptText = prompt?.text || '';
    
    // Calculate client scores for this prompt (average across models)
    let clientVisibilitySum = 0;
    let clientVisibilityCount = 0;
    let clientSentimentSum = 0;
    let clientSentimentCount = 0;
    let clientPositionSum = 0;
    let clientPositionCount = 0;

    for (const { answer } of answersForPrompt) {
      if (answer.visibilityScore !== null && answer.visibilityScore !== undefined) {
        clientVisibilitySum += Number(answer.visibilityScore);
        clientVisibilityCount++;
      }
      if (answer.sentimentScore !== null && answer.sentimentScore !== undefined) {
        clientSentimentSum += Number(answer.sentimentScore);
        clientSentimentCount++;
      }
      if (answer.positionScore !== null && answer.positionScore !== undefined) {
        clientPositionSum += Number(answer.positionScore);
        clientPositionCount++;
      }
    }

    const clientVisibility = clientVisibilityCount > 0 ? Math.round((clientVisibilitySum / clientVisibilityCount) * 10) / 10 : 0;
    const clientSentiment = clientSentimentCount > 0 ? Math.round((clientSentimentSum / clientSentimentCount) * 10) / 10 : 0;
    const clientPosition = clientPositionCount > 0 ? Math.round((clientPositionSum / clientPositionCount) * 10) / 10 : 0;

    const w = AEO_CONFIG.composerWeights;
    const clientOverallScore = Math.round((
      (clientVisibility * w.visibility) +
      (clientSentiment * w.sentiment) +
      (clientPosition * w.position)
    ) * 10) / 10;

    console.log(`  Client "${client.name}": V=${clientVisibility.toFixed(1)}, S=${clientSentiment.toFixed(1)}, P=${clientPosition.toFixed(1)}, Overall=${clientOverallScore.toFixed(1)}`);

    // Save client score for this prompt
    await storage.createCompetitorScore({
      promptRunId: promptRun.id,
      promptId: promptId,
      competitorId: null,
      competitorName: client.name,
      isClient: true,
      visibilityScore: clientVisibility.toString(),
      sentimentScore: clientSentiment.toString(),
      positionScore: clientPosition.toString(),
      overallScore: clientOverallScore.toString()
    });
    totalScoresSaved++;

    // === PHASE 2: PARALLEL COMPETITOR SCORING ===
    // Process competitors in batches with bounded concurrency
    const batchErrors: Array<{ competitorName: string; error: any }> = [];
    
    console.log(`  [ParallelScoring] Processing ${discoveredCompetitors.length} competitors in batches of ${COMPETITOR_BATCH_SIZE}`);
    
    for (let batchStart = 0; batchStart < discoveredCompetitors.length; batchStart += COMPETITOR_BATCH_SIZE) {
      const batch = discoveredCompetitors.slice(batchStart, batchStart + COMPETITOR_BATCH_SIZE);
      const batchNum = Math.floor(batchStart / COMPETITOR_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(discoveredCompetitors.length / COMPETITOR_BATCH_SIZE);
      const batchStartTime = Date.now();
      
      // Score all competitors in this batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(comp => scoreCompetitorForPrompt(
          comp,
          answersForPrompt,
          promptText,
          existingCompetitors,
          w
        ))
      );
      
      // Process batch results
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const comp = batch[i];
        
        if (result.status === 'fulfilled') {
          const scoreResult = result.value;
          
          console.log(`  Competitor "${scoreResult.name}": V=${scoreResult.visibilityScore.toFixed(1)}, S=${scoreResult.sentimentScore.toFixed(1)}, P=${scoreResult.positionScore.toFixed(1)}, Overall=${scoreResult.overallScore.toFixed(1)}`);
          
          // Save competitor score for this prompt
          await storage.createCompetitorScore({
            promptRunId: promptRun.id,
            promptId: promptId,
            competitorId: scoreResult.competitorId,
            competitorName: scoreResult.name,
            isClient: false,
            visibilityScore: scoreResult.visibilityScore.toString(),
            sentimentScore: scoreResult.sentimentScore.toString(),
            positionScore: scoreResult.positionScore.toString(),
            overallScore: scoreResult.overallScore.toString()
          });
          totalScoresSaved++;
          
          // Log timing for this competitor (only if > 500ms)
          if (scoreResult.duration > 500) {
            console.log(`[PERF] Competitor "${scoreResult.name}": ${(scoreResult.duration / 1000).toFixed(2)}s`);
          }
        } else {
          console.error(`  Error scoring competitor "${comp.name}":`, result.reason);
          batchErrors.push({ competitorName: comp.name, error: result.reason });
        }
      }
      
      const batchDuration = Date.now() - batchStartTime;
      console.log(`  [ParallelScoring] Batch ${batchNum}/${totalBatches}: ${batch.length} competitors in ${(batchDuration / 1000).toFixed(2)}s`);
      
      // Phase 1: Send heartbeat after each batch to prove job is alive during long scoring
      if (onHeartbeat) {
        await onHeartbeat();
      }
    }
    
    // Fail the prompt scoring if any competitors failed (preserve data integrity)
    if (batchErrors.length > 0) {
      const failedNames = batchErrors.map(e => e.competitorName).join(', ');
      throw new Error(`Competitor scoring failed for: ${failedNames}. ${batchErrors.length} of ${discoveredCompetitors.length} competitors failed.`);
    }

    // After all competitors are scored for this prompt, notify caller to mark items as done
    if (onPromptComplete) {
      const itemIds = answersForPrompt.map(({ item }) => item.id);
      await onPromptComplete(promptId, itemIds);
    }
    
    // Log timing for this prompt
    const promptDuration = Date.now() - promptStartTime;
    console.log(`[PERF] Prompt ${promptIndex + 1}/${totalPrompts} competitor scoring: ${(promptDuration / 1000).toFixed(2)}s (${discoveredCompetitors.length} competitors)`);
    performanceLogger.logStage(promptRunId, 'competitor_scoring_per_prompt', promptDuration, {
      promptIndex: promptIndex + 1,
      totalPrompts,
      competitorCount: discoveredCompetitors.length
    });
  }

  console.log(`\nPrompt-level competitor scoring completed for run: ${promptRunId}`);
  console.log(`Saved ${totalScoresSaved} score records across ${promptGroups.size} prompts for ${discoveredCompetitors.length + 1} entities`);
}
