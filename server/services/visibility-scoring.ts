import type { EntityMention, VisibilityDetails } from '../types/aeo';
import { calculateVisibilityAdvanced } from './visibilityScorer.new';
import { calculateVisibilityAdvancedV2 } from './visibility-scoring-v2';
import { AEO_MODE } from '../config/aeo';
import { normalizeDiacritics } from './mention-detector';

export interface VisibilityScoreParams {
  brandName: string;
  aliases: string[];
  rawResponse: string;
  alpha?: number;  // direct mention weight
  beta?: number;   // alias mention weight  
  gamma?: number;  // top bonus weight
  delta?: number;  // self-citation bonus weight
  selfCitationCount?: number; // number of self-citations
}

export interface VisibilityScoreResult {
  score: number;
  firstMentionPos: number | null;
  directMentions: number;
  aliasMentions: number;
  hasTopBonus: boolean;
}

export interface VisibilityScoreWithMentionsParams {
  text: string;
  mentions: EntityMention[];
}

export interface AdvancedVisibilityResult {
  score: number;
  details: VisibilityDetails;
}

export function calculateVisibilityScore({
  brandName,
  aliases,
  rawResponse,
  alpha = 0.9,
  beta = 0.6,
  gamma = 0.5,
  delta = 0.4,
  selfCitationCount = 0
}: VisibilityScoreParams): VisibilityScoreResult {
  const words = rawResponse.split(/\s+/).length;
  const normalizer = Math.max(1, words / 100);

  // Normalize diacritics for matching (e.g., "Espolòn" → "Espolon")
  const normalizedResponse = normalizeDiacritics(rawResponse);
  const normalizedBrand = normalizeDiacritics(brandName);

  // Count direct brand mentions
  const brandRegex = new RegExp(`\\b${escapeRegex(normalizedBrand)}\\b`, 'gi');
  const directMatches = normalizedResponse.match(brandRegex) || [];
  const directMentions = directMatches.length;
  const directScore = directMentions / normalizer;

  // Count alias mentions
  let aliasMentions = 0;
  let firstMentionPos: number | null = null;

  for (const alias of aliases) {
    const normalizedAlias = normalizeDiacritics(alias);
    const aliasRegex = new RegExp(`\\b${escapeRegex(normalizedAlias)}\\b`, 'gi');
    const aliasMatches = normalizedResponse.match(aliasRegex) || [];
    aliasMentions += aliasMatches.length;

    // Track first mention position
    const match = aliasRegex.exec(normalizedResponse);
    if (match && (firstMentionPos === null || match.index < firstMentionPos)) {
      firstMentionPos = match.index;
    }
  }

  // Check for brand mentions to find first mention
  const brandMatch = brandRegex.exec(normalizedResponse);
  if (brandMatch && (firstMentionPos === null || brandMatch.index < firstMentionPos)) {
    firstMentionPos = brandMatch.index;
  }

  const aliasScore = aliasMentions / normalizer;

  // Top bonus if first mention appears within first 300 chars
  const hasTopBonus = firstMentionPos !== null && firstMentionPos <= 300;
  const topBonus = hasTopBonus ? 1 : 0;

  // Self-citation bonus: count of client's own website citations (normalized)
  const citationBonus = selfCitationCount > 0 ? Math.min(selfCitationCount, 3) / 3 : 0;

  // Calculate final score using shifted sigmoid function
  // Shifted sigmoid maps sigmoid(0) → 0 instead of 0.5, giving smooth 0-100% scaling
  const rawScore = alpha * directScore + beta * aliasScore + gamma * topBonus + delta * citationBonus;
  const score = Math.round(100 * visibilitySigmoid(rawScore) * 100) / 100;

  return {
    score,
    firstMentionPos,
    directMentions,
    aliasMentions,
    hasTopBonus
  };
}

export interface VisibilityScoreAsyncParams {
  brandName: string;
  aliases: string[];
  rawResponse: string;
  entityMentions?: EntityMention[];
  selfCitationCount?: number;
}

export async function calculateVisibilityScoreAsync({
  brandName,
  aliases,
  rawResponse,
  entityMentions,
  selfCitationCount = 0
}: VisibilityScoreAsyncParams): Promise<VisibilityScoreResult> {
  // Branch based on AEO_MODE
  if ((AEO_MODE === 'llm' || AEO_MODE === 'hybrid') && entityMentions && entityMentions.length > 0) {
    // LLM mode: Use advanced visibility scoring with entity mentions
    // ✅ CHANGED: Use versioned function to support V1/V2 routing
    const advancedResult = calculateVisibilityScoreWithMentionsVersioned({
      text: rawResponse,
      mentions: entityMentions
    });
    
    // Add self-citation bonus to LLM mode score (same weighting as heuristic mode)
    // advancedResult.score is already 0-100, so we need to add a proportional bonus
    const citationBonus = selfCitationCount > 0 ? Math.min(selfCitationCount, 3) / 3 : 0;
    const delta = 0.4; // self-citation bonus weight (same as heuristic alpha/beta/gamma weights)
    
    // Apply citation bonus as a percentage increase (max ~13% boost with 3 citations)
    // This mirrors the heuristic sigmoid approach where delta affects the raw score
    const bonusPercent = delta * citationBonus * 100 / 3; // Normalize to ~13% max
    const boostedScore = advancedResult.score + bonusPercent;
    
    // Convert advanced result to VisibilityScoreResult format
    return {
      score: Math.min(100, Math.round(boostedScore * 100) / 100), // Cap at 100
      firstMentionPos: advancedResult.details.firstPos ?? null,
      directMentions: entityMentions.filter(m => m.surfaceType === 'direct').length,
      aliasMentions: entityMentions.filter(m => m.surfaceType === 'alias').length,
      hasTopBonus: (advancedResult.details.firstPos ?? Infinity) <= 300
    };
  }
  
  // Heuristic mode: Use traditional regex-based scoring with self-citation bonus
  return calculateVisibilityScore({
    brandName,
    aliases,
    rawResponse,
    selfCitationCount
  });
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Shifted sigmoid that maps sigmoid(0) → 0 instead of 0.5
 * This ensures no mentions = 0% score, with smooth scaling for mentions > 0
 * Formula: 2 * (sigmoid(x) - 0.5), clamped to [0, 1]
 */
function visibilitySigmoid(rawScore: number): number {
  const sig = sigmoid(rawScore);
  // Shift and scale: sigmoid(0) = 0.5 → 0, sigmoid(∞) = 1 → 1
  return Math.max(0, 2 * (sig - 0.5));
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function calculateVisibilityScoreWithMentions({
  text,
  mentions,
}: VisibilityScoreWithMentionsParams): AdvancedVisibilityResult {
  if (AEO_MODE === 'heuristic') {
    const brandName = mentions.length > 0 ? mentions[0].canonicalId : '';
    const result = calculateVisibilityScoreFromMentions(text, mentions);
    
    return {
      score: result.score,
      details: {
        rate: 0,
        firstPos: result.firstMentionPos,
        headingHits: 0,
        coverage: 0,
        rawScore: 0,
      },
    };
  }

  const result = calculateVisibilityAdvanced(text, mentions);
  
  if (process.env.DEBUG_AEO) {
    console.log('[VisibilityScorer] Advanced scoring', {
      mode: AEO_MODE,
      mentionCount: mentions.length,
      score: result.score,
      details: result.details,
    });
  }

  return result;
}

/**
 * V2: Wrapper function that routes to V1 or V2 based on VISIBILITY_SCORING_VERSION
 * This allows safe A/B testing and gradual rollout of normalized weights
 * 
 * Set VISIBILITY_SCORING_VERSION=v2 in .env to enable new scoring
 * Default: v1 (existing implementation)
 */
export function calculateVisibilityScoreWithMentionsVersioned({
  text,
  mentions,
}: VisibilityScoreWithMentionsParams): AdvancedVisibilityResult {
  const version = process.env.VISIBILITY_SCORING_VERSION || 'v1';
  
  // Route to V2 if enabled
  if (version === 'v2') {
    return calculateVisibilityAdvancedV2(text, mentions);
  }
  
  // Default: use existing V1 implementation
  return calculateVisibilityScoreWithMentions({ text, mentions });
}

function calculateVisibilityScoreFromMentions(
  text: string,
  mentions: EntityMention[]
): { score: number; firstMentionPos: number | null } {
  const words = text.split(/\s+/).length;
  const normalizer = Math.max(1, words / 100);

  const directMentions = mentions.filter(m => m.surfaceType === 'direct').length;
  const aliasMentions = mentions.filter(m => m.surfaceType === 'alias').length;

  // Get first mention position (null if no mentions)
  const firstMention = mentions.length > 0 
    ? mentions.reduce((earliest, m) => earliest === null || m.start < earliest.start ? m : earliest)
    : null;
  const firstMentionPos = firstMention ? firstMention.start : null;

  const directScore = directMentions / normalizer;
  const aliasScore = aliasMentions / normalizer;

  const hasTopBonus = firstMentionPos !== null && firstMentionPos <= 300;
  const topBonus = hasTopBonus ? 1 : 0;

  const alpha = 0.9;
  const beta = 0.6;
  const gamma = 0.5;

  const rawScore = alpha * directScore + beta * aliasScore + gamma * topBonus;
  const score = Math.round(100 * visibilitySigmoid(rawScore) * 100) / 100;

  return { score, firstMentionPos };
}
