import type { IStorage } from '../storage';
import type { InsertScoreFactors, ScoreFactors } from '@shared/schema';

type ScoreCategory = 'Position' | 'Sentiment' | 'Visibility';

interface SavePositionFactorsParams {
  storage: IStorage;
  promptRunItemId: string;
  score: number;
  totalRankings: number;
  bestPosition: number | null;
}

interface SaveSentimentFactorsParams {
  storage: IStorage;
  promptRunItemId: string;
  score: number;
  positiveMentions: number;
  neutralMentions: number;
  negativeMentions: number;
}

interface SaveVisibilityFactorsParams {
  storage: IStorage;
  promptRunItemId: string;
  score: number;
  directMentions: number;
  aliasMentions: number;
  headingHits?: number;
}

/**
 * Save Position score factors for explainability
 * Maps to template placeholders: AA=totalRankings (relevance), BB=bestPosition
 */
export async function savePositionFactors({
  storage,
  promptRunItemId,
  score,
  totalRankings,
  bestPosition
}: SavePositionFactorsParams): Promise<void> {
  const factorData: InsertScoreFactors = {
    promptRunItemId,
    category: 'Position',
    score: score.toString(),
    relevanceValue: totalRankings.toString(), // AA in template
    positionValue: bestPosition !== null ? bestPosition.toString() : null, // BB in template (null when no rankings)
    positiveMentions: null,
    neutralMentions: null,
    negativeMentions: null,
    mentionsCount: null,
    headingHitsCount: null
  };

  await storage.createScoreFactors(factorData);
}

/**
 * Save Sentiment score factors for explainability
 * Maps to template placeholders: AA=positive, BB=neutral, CC=negative
 */
export async function saveSentimentFactors({
  storage,
  promptRunItemId,
  score,
  positiveMentions,
  neutralMentions,
  negativeMentions
}: SaveSentimentFactorsParams): Promise<void> {
  const factorData: InsertScoreFactors = {
    promptRunItemId,
    category: 'Sentiment',
    score: score.toString(),
    relevanceValue: null,
    positionValue: null,
    positiveMentions, // AA in template
    neutralMentions, // BB in template
    negativeMentions, // CC in template
    mentionsCount: null,
    headingHitsCount: null
  };

  await storage.createScoreFactors(factorData);
}

/**
 * Save Visibility score factors for explainability
 * Maps to template placeholders: AA=mentions, BB=headingHits
 */
export async function saveVisibilityFactors({
  storage,
  promptRunItemId,
  score,
  directMentions,
  aliasMentions,
  headingHits = 0
}: SaveVisibilityFactorsParams): Promise<void> {
  const mentionsCount = directMentions + aliasMentions;
  
  const factorData: InsertScoreFactors = {
    promptRunItemId,
    category: 'Visibility',
    score: score.toString(),
    relevanceValue: null,
    positionValue: null,
    positiveMentions: null,
    neutralMentions: null,
    negativeMentions: null,
    mentionsCount, // AA in template
    headingHitsCount: headingHits // BB in template (0 if not available)
  };

  await storage.createScoreFactors(factorData);
}

/**
 * Get score explanation with template replacement
 * Retrieves factors from ALL AI models for a prompt run, averages them, and replaces template placeholders
 */
export interface ScoreExplanationResult {
  score: number;
  interpretation: string;
  colorClass: string;
  colorHex: string;
  factors: {
    // Position
    totalRankings?: number;
    bestPosition?: number | null;
    averagePosition?: number | null;
    // Sentiment
    positiveMentions?: number;
    neutralMentions?: number;
    negativeMentions?: number;
    // Visibility
    mentionsCount?: number;
    headingHitsCount?: number;
  };
}

export async function getScoreExplanation(
  storage: IStorage,
  promptRunId: string,
  category: 'Visibility' | 'Sentiment' | 'Position',
  promptId?: string
): Promise<ScoreExplanationResult> {
  // Get all prompt run items for this prompt run
  let items = await storage.getPromptRunItems(promptRunId);
  
  if (items.length === 0) {
    throw new Error(`No prompt run items found for prompt run ${promptRunId}`);
  }

  // Filter to specific prompt if promptId provided
  if (promptId) {
    items = items.filter(item => item.promptId === promptId);
    if (items.length === 0) {
      throw new Error(`No prompt run items found for prompt ${promptId} in run ${promptRunId}`);
    }
  }

  // Get all score factors for this category across all AI models
  const allFactors: ScoreFactors[] = [];
  for (const item of items) {
    const factors = await storage.getScoreFactorsByPromptRunItem(item.id);
    const categoryFactors = factors.filter(f => f.category === category);
    allFactors.push(...categoryFactors);
  }

  if (allFactors.length === 0) {
    throw new Error(`No score factors found for category ${category} in prompt run ${promptRunId}`);
  }

  // Calculate average score
  const scores = allFactors.map(f => parseFloat(f.score));
  const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const roundedScore = Math.round(averageScore * 100) / 100;

  // Get interpretation template
  const interpretation = await storage.getScoreInterpretation(category, roundedScore);
  if (!interpretation) {
    throw new Error(`No interpretation template found for ${category} score ${roundedScore}`);
  }

  // Get color band
  const colorBand = await storage.getScoreColorBand(category, roundedScore);
  if (!colorBand) {
    throw new Error(`No color band found for ${category} score ${roundedScore}`);
  }

  // Calculate averaged factors based on category
  const factors: ScoreExplanationResult['factors'] = {};
  
  if (category === 'Position') {
    // Average totalRankings
    const totalRankingsValues = allFactors
      .map(f => f.relevanceValue ? parseInt(f.relevanceValue) : 0);
    factors.totalRankings = Math.round(
      totalRankingsValues.reduce((sum, v) => sum + v, 0) / totalRankingsValues.length
    );
    
    // Get best position (minimum across all, or null if all are null)
    const positionValues = allFactors
      .map(f => f.positionValue ? parseInt(f.positionValue) : null)
      .filter(v => v !== null) as number[];
    factors.bestPosition = positionValues.length > 0 ? Math.min(...positionValues) : null;
    
    // Calculate average position
    if (positionValues.length > 0) {
      factors.averagePosition = Math.round(
        (positionValues.reduce((sum, v) => sum + v, 0) / positionValues.length) * 100
      ) / 100;
    }
  } else if (category === 'Sentiment') {
    // Average sentiment counts
    factors.positiveMentions = Math.round(
      allFactors.reduce((sum, f) => sum + (f.positiveMentions ?? 0), 0) / allFactors.length
    );
    factors.neutralMentions = Math.round(
      allFactors.reduce((sum, f) => sum + (f.neutralMentions ?? 0), 0) / allFactors.length
    );
    factors.negativeMentions = Math.round(
      allFactors.reduce((sum, f) => sum + (f.negativeMentions ?? 0), 0) / allFactors.length
    );
  } else if (category === 'Visibility') {
    // Average visibility counts
    factors.mentionsCount = Math.round(
      allFactors.reduce((sum, f) => sum + (f.mentionsCount ?? 0), 0) / allFactors.length
    );
    factors.headingHitsCount = Math.round(
      allFactors.reduce((sum, f) => sum + (f.headingHitsCount ?? 0), 0) / allFactors.length
    );
  }

  // Replace template placeholders
  let explanation = interpretation.interpretation
    .replace(/X\.X/g, roundedScore.toString());

  // Category-specific placeholder replacement
  if (category === 'Position') {
    explanation = explanation
      .replace(/AA/g, factors.totalRankings?.toString() ?? '0')
      .replace(/BB/g, factors.bestPosition?.toString() ?? 'N/A');
  } else if (category === 'Sentiment') {
    explanation = explanation
      .replace(/AA/g, factors.positiveMentions?.toString() ?? '0')
      .replace(/BB/g, factors.neutralMentions?.toString() ?? '0')
      .replace(/CC/g, factors.negativeMentions?.toString() ?? '0');
  } else if (category === 'Visibility') {
    explanation = explanation
      .replace(/AA/g, factors.mentionsCount?.toString() ?? '0')
      .replace(/BB/g, factors.headingHitsCount?.toString() ?? '0');
  }

  return {
    score: roundedScore,
    interpretation: explanation,
    colorClass: '', // Legacy field, not used
    colorHex: colorBand.color,
    factors
  };
}
