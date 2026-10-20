import { AEO_MODE, AEO_CONFIG } from '../config/aeo';
import type { EntitySentiment } from '../types/aeo';
import {
  positionScoreFromRankings,
  sentimentScoreFromABSA,
  composeOverall,
} from './composer';
import { normalizeBrandToken } from './mention-detector';

export interface SentimentScoreResult {
  sentimentScore: number; // 0-100 scale
  positiveMentions: number;
  neutralMentions: number;
  negativeMentions: number;
  totalMentions: number;
}

export interface PositionScoreResult {
  positionScore: number; // 0-100 scale
  bestPosition: number | null;
  totalRankings: number;
  averagePosition: number | null;
}

/**
 * Calculate sentiment score from mentions
 * - Positive mention = +1
 * - Neutral mention = 0
 * - Negative mention = -1
 * - Average and scale to 0-100
 */
export function calculateSentimentScore(mentions: Array<{ sentiment: 'positive' | 'neutral' | 'negative' }>): SentimentScoreResult {
  return calculateSentimentScoreHeuristic(mentions);
}

export interface SentimentScoreAsyncParams {
  mentions: Array<{ sentiment: 'positive' | 'neutral' | 'negative' }>;
  doc?: { text: string };
  entityMentions?: Array<{ span: string; start: number; end: number; canonicalId: string; surfaceType: 'direct' | 'alias'; confidence: number }>;
  // Fallback parameters for when entityMentions is empty
  brandName?: string;
  aliases?: string[];
}

export async function calculateSentimentScoreAsync(
  mentions: Array<{ sentiment: 'positive' | 'neutral' | 'negative' }>,
  doc?: { text: string },
  entityMentions?: Array<{ span: string; start: number; end: number; canonicalId: string; surfaceType: 'direct' | 'alias'; confidence: number }>,
  brandName?: string,
  aliases?: string[]
): Promise<SentimentScoreResult> {
  // LLM mode with valid entityMentions
  if ((AEO_MODE === 'llm' || AEO_MODE === 'hybrid') && doc && entityMentions && entityMentions.length > 0) {
    if (process.env.DEBUG_AEO) {
      console.log(`[Scoring] Using LLM sentiment analysis (AEO_MODE=${AEO_MODE})`);
    }
    return calculateSentimentScoreWithLLM(doc, entityMentions);
  }

  // Fallback: If entityMentions is empty but we have brandName/aliases/rawResponse,
  // use LLM to directly find mentions and analyze sentiment (with anti-hallucination validation)
  if (doc && brandName && (!entityMentions || entityMentions.length === 0)) {
    console.log(`[Scoring] entityMentions empty, falling back to direct LLM sentiment analysis`);
    try {
      const { analyzeDirectSentiment } = await import('./sentimentAbsa.llm.js');
      const directResult = await analyzeDirectSentiment(doc.text, brandName, aliases || []);
      
      if (directResult.mentionCount > 0) {
        console.log(`[Scoring] Direct LLM fallback found ${directResult.mentionCount} validated mentions, score: ${directResult.score}`);
        return {
          sentimentScore: directResult.score,
          positiveMentions: directResult.positiveMentions,
          neutralMentions: directResult.neutralMentions,
          negativeMentions: directResult.negativeMentions,
          totalMentions: directResult.mentionCount
        };
      }
    } catch (error) {
      console.error('[Scoring] Direct LLM sentiment fallback failed:', error);
      // Fall through to heuristic fallback
    }
    
    // Final fallback: heuristic regex-based sentiment if LLM fails
    const fallbackMentions = findMentionsWithSentiment(doc.text, brandName, aliases || []);
    if (fallbackMentions.length > 0) {
      console.log(`[Scoring] Heuristic fallback found ${fallbackMentions.length} mentions via regex`);
      return calculateSentimentScoreHeuristic(fallbackMentions);
    }
  }

  if (process.env.DEBUG_AEO) {
    console.log(`[Scoring] Using heuristic sentiment analysis (AEO_MODE=${AEO_MODE})`);
  }
  return calculateSentimentScoreHeuristic(mentions);
}

/**
 * Fallback: Find mentions in raw text using regex and analyze sentiment
 * Used when LLM mention extraction fails or returns empty results
 * 
 * Includes punctuation normalization to handle typographic quotes (Ajio's → Ajio's)
 */
function findMentionsWithSentiment(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Array<{ sentiment: 'positive' | 'neutral' | 'negative' }> {
  const mentions: Array<{ sentiment: 'positive' | 'neutral' | 'negative' }> = [];
  const allTerms = [brandName, ...aliases];
  
  // Use comprehensive Unicode normalizer (handles diacritics, hyphens, apostrophes, full-width, etc.)
  const normalizedResponse = normalizeBrandToken(rawResponse);
  
  const positiveTerms = [
    'excellent', 'outstanding', 'best', 'top', 'leading', 'innovative',
    'superior', 'remarkable', 'impressive', 'successful', 'popular',
    'recommended', 'preferred', 'award', 'winner', 'great', 'good',
    'reliable', 'trusted', 'quality', 'premium', 'favorite', 'loved'
  ];
  
  const negativeTerms = [
    'poor', 'bad', 'worst', 'terrible', 'awful', 'failed', 'failing',
    'disappointing', 'problematic', 'issues', 'concerns', 'criticized',
    'controversy', 'scandal', 'lawsuit', 'decline', 'struggling',
    'expensive', 'overpriced', 'slow', 'unreliable', 'avoid'
  ];
  
  for (const term of allTerms) {
    // Normalize the search term as well (including diacritics, hyphens, apostrophes, etc.)
    const normalizedTerm = normalizeBrandToken(term);
    const regex = new RegExp(`\\b${escapeRegexForSentiment(normalizedTerm)}\\b`, 'gi');
    let match;
    
    while ((match = regex.exec(normalizedResponse)) !== null) {
      // Get context around the mention (100 chars before and after)
      const contextStart = Math.max(0, match.index - 100);
      const contextEnd = Math.min(normalizedResponse.length, match.index + normalizedTerm.length + 100);
      const context = normalizedResponse.slice(contextStart, contextEnd).toLowerCase();
      
      // Count positive and negative terms in context
      const positiveCount = positiveTerms.filter(t => context.includes(t)).length;
      const negativeCount = negativeTerms.filter(t => context.includes(t)).length;
      
      let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
      if (positiveCount > negativeCount) sentiment = 'positive';
      else if (negativeCount > positiveCount) sentiment = 'negative';
      
      mentions.push({ sentiment });
    }
  }
  
  return mentions;
}

function escapeRegexForSentiment(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateSentimentScoreHeuristic(mentions: Array<{ sentiment: 'positive' | 'neutral' | 'negative' }>): SentimentScoreResult {
  if (mentions.length === 0) {
    return {
      sentimentScore: 0, // No mentions = 0 score (not neutral 50)
      positiveMentions: 0,
      neutralMentions: 0,
      negativeMentions: 0,
      totalMentions: 0
    };
  }

  let positiveMentions = 0;
  let neutralMentions = 0;
  let negativeMentions = 0;

  for (const mention of mentions) {
    if (mention.sentiment === 'positive') positiveMentions++;
    else if (mention.sentiment === 'neutral') neutralMentions++;
    else if (mention.sentiment === 'negative') negativeMentions++;
  }

  // Calculate raw sentiment: -1 to +1
  const rawSentiment = (positiveMentions - negativeMentions) / mentions.length;
  
  // Scale to 0-100
  const sentimentScore = Math.round((rawSentiment + 1) * 50 * 100) / 100;

  return {
    sentimentScore,
    positiveMentions,
    neutralMentions,
    negativeMentions,
    totalMentions: mentions.length
  };
}

async function calculateSentimentScoreWithLLM(
  doc: { text: string },
  entityMentions: Array<{ span: string; start: number; end: number; canonicalId: string; surfaceType: 'direct' | 'alias'; confidence: number }>
): Promise<SentimentScoreResult> {
  // If no entity mentions, return 0 score (brand not mentioned)
  if (entityMentions.length === 0) {
    return {
      sentimentScore: 0,
      positiveMentions: 0,
      neutralMentions: 0,
      negativeMentions: 0,
      totalMentions: 0,
    };
  }

  try {
    const { analyzeSentimentABSA, mapAbsaToScore } = await import('./sentimentAbsa.llm.js');
    
    const sentiments = await analyzeSentimentABSA(doc, entityMentions);
    
    const sentimentScore = mapAbsaToScore(sentiments);

    let positiveMentions = 0;
    let neutralMentions = 0;
    let negativeMentions = 0;

    for (const sentiment of sentiments) {
      const maxProb = Math.max(sentiment.pPos, sentiment.pNeu, sentiment.pNeg);
      if (sentiment.pPos === maxProb) positiveMentions++;
      else if (sentiment.pNeg === maxProb) negativeMentions++;
      else neutralMentions++;
    }

    return {
      sentimentScore,
      positiveMentions,
      neutralMentions,
      negativeMentions,
      totalMentions: sentiments.length || entityMentions.length,
    };
  } catch (error) {
    console.error('[Scoring] LLM sentiment analysis failed, falling back to heuristic:', error);
    const heuristicMentions = entityMentions.map(() => ({ sentiment: 'neutral' as const }));
    return calculateSentimentScoreHeuristic(heuristicMentions);
  }
}

/**
 * Calculate position score from rankings
 * - Position 1 = 100 points
 * - Position 2 = 95 points
 * - Position 3 = 90 points
 * - Exponential decay for lower positions
 * - Average if multiple rankings found
 */
export function calculatePositionScore(rankings: Array<{ position: number }>): PositionScoreResult {
  if (AEO_MODE !== 'heuristic') {
    if (process.env.DEBUG_AEO) {
      console.log(`[Scoring] Using nDCG position scoring (AEO_MODE=${AEO_MODE})`);
    }
    const score = positionScoreFromRankings(rankings);
    
    if (rankings.length === 0) {
      return {
        positionScore: 0,
        bestPosition: null,
        totalRankings: 0,
        averagePosition: null,
      };
    }

    const positions = rankings.map(r => r.position);
    const bestPosition = Math.min(...positions);
    const averagePosition = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;

    return {
      positionScore: score,
      bestPosition,
      totalRankings: rankings.length,
      averagePosition: Math.round(averagePosition * 100) / 100,
    };
  }

  if (process.env.DEBUG_AEO) {
    console.log(`[Scoring] Using heuristic position scoring (AEO_MODE=${AEO_MODE})`);
  }
  return calculatePositionScoreHeuristic(rankings);
}

function calculatePositionScoreHeuristic(rankings: Array<{ position: number }>): PositionScoreResult {
  if (rankings.length === 0) {
    return {
      positionScore: 0, // No rankings = 0 score
      bestPosition: null,
      totalRankings: 0,
      averagePosition: null
    };
  }

  const positions = rankings.map(r => r.position);
  const bestPosition = Math.min(...positions);
  const averagePosition = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;

  // Calculate score for each position and average
  const scores = positions.map(position => {
    if (position === 1) return 100;
    if (position === 2) return 95;
    if (position === 3) return 90;
    if (position === 4) return 85;
    if (position === 5) return 80;
    
    // Exponential decay for positions 6+
    // Formula: 80 * e^(-0.2 * (position - 5))
    return Math.max(0, 80 * Math.exp(-0.2 * (position - 5)));
  });

  const positionScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 100) / 100;

  return {
    positionScore,
    bestPosition,
    totalRankings: rankings.length,
    averagePosition: Math.round(averagePosition * 100) / 100
  };
}

/**
 * Calculate overall ranking score combining visibility, sentiment, and position
 * - Visibility: 50% weight (brand presence)
 * - Sentiment: 30% weight (brand perception)
 * - Position: 20% weight (brand ranking)
 */
export function calculateOverallScore(
  visibilityScore: number,
  sentimentScore: number,
  positionScore: number
): number {
  if (AEO_MODE !== 'heuristic') {
    if (process.env.DEBUG_AEO) {
      console.log(`[Scoring] Using composer overall scoring (AEO_MODE=${AEO_MODE})`);
    }
    return composeOverall(visibilityScore, sentimentScore, positionScore, AEO_CONFIG.composerWeights);
  }

  if (process.env.DEBUG_AEO) {
    console.log(`[Scoring] Using heuristic overall scoring (AEO_MODE=${AEO_MODE})`);
  }
  const overall = (visibilityScore * 0.5) + (sentimentScore * 0.3) + (positionScore * 0.2);
  return Math.round(overall * 100) / 100;
}

export function calculateSentimentScoreFromABSA(sentiments: EntitySentiment[]): number {
  return sentimentScoreFromABSA(sentiments);
}
