import type { EntityMention, VisibilityDetails } from '../types/aeo';
import { VISIBILITY_WEIGHTS_V2, validateWeights } from '../config/visibility-weights';

interface VisibilityScoreResult {
  score: number;
  details: VisibilityDetails;
}

/**
 * V2 Visibility Scoring with normalized weights (sum to 1.0)
 * 
 * Key Improvements over V1:
 * - Weights sum to 1.0 (mathematically correct)
 * - Each weight represents % contribution to score
 * - Better score distribution across 0-100 range
 * - More interpretable and tunable
 * 
 * Formula:
 * rawScore = 
 *   0.40 × mentionRate +      // 40% weight: frequency of mentions
 *   0.30 × firstPos +          // 30% weight: early appearance
 *   0.15 × headingBonus +      // 15% weight: structural emphasis
 *   0.15 × coverage            // 15% weight: distribution throughout text
 * 
 * finalScore = visibilitySigmoid(rawScore) × 100
 */
export function calculateVisibilityAdvancedV2(
  text: string,
  mentions: EntityMention[]
): VisibilityScoreResult {
  // Validate weights at runtime (fail fast if misconfigured)
  if (!validateWeights(VISIBILITY_WEIGHTS_V2, 1.0)) {
    console.error('[VisibilityV2] CRITICAL: Weights do not sum to 1.0!', VISIBILITY_WEIGHTS_V2);
    throw new Error('Invalid visibility weights configuration');
  }

  if (!text || text.length === 0) {
    return {
      score: 0,
      details: {
        rate: 0,
        firstPos: null,
        headingHits: 0,
        coverage: 0,
        rawScore: 0,
      },
    };
  }

  const textLen = text.length;
  const roughTokenCount = estimateTokenCount(text);

  // Factor 1: Mention Rate (0-100 scale, normalized by token count)
  // Higher rate = brand mentioned more frequently relative to text length
  const mentionRate = mentions.length > 0 ? (mentions.length / roughTokenCount) * 100 : 0;

  // Factor 2: First Position (0-1 scale, earlier = higher)
  // Measures how early in the response the brand appears
  // firstPos = 1.0 means mentioned at start (char 0)
  // firstPos = 0.0 means mentioned at end
  const firstMention = mentions.length > 0
    ? mentions.reduce((earliest, m) => earliest === null || m.start < earliest.start ? m : earliest)
    : null;
  const firstPos = firstMention ? 1 - Math.min(1, firstMention.start / textLen) : 0;

  // Factor 3: Heading Hits (0-1 scale, capped at 5 headings)
  // Counts how many times brand appears in structured elements:
  // - Markdown headers (# ## ###)
  // - Numbered lists (1. 2. 3.)
  // - Bullet points (- * •)
  // - Title case with colon (Emirates:)
  const headingHits = countHeadingListHits(text, mentions);
  const headingScore = Math.min(1, headingHits / 5);

  // Factor 4: Coverage (0-1 scale, bins covered / 10)
  // Divides text into 10 equal bins, counts how many contain mentions
  // 0.0 = brand only in 1 section, 1.0 = brand throughout entire response
  const coverageScore = calculateCoverage(text, mentions);

  // Calculate raw score using V2 weights (sum to 1.0)
  const rawScore =
    VISIBILITY_WEIGHTS_V2.mentionRate * mentionRate +
    VISIBILITY_WEIGHTS_V2.firstPosition * firstPos +
    VISIBILITY_WEIGHTS_V2.headingBonus * headingScore +
    VISIBILITY_WEIGHTS_V2.coverage * coverageScore;

  // Use shifted sigmoid: maps sigmoid(0) → 0 instead of 0.5
  // This ensures: no mentions = 0% score, high mentions = ~100% score
  const score = Math.round(100 * visibilitySigmoid(rawScore));

  // Debug logging (enable with DEBUG_VISIBILITY=true in .env)
  if (process.env.DEBUG_VISIBILITY === 'true') {
    console.log('[VisibilityV2] Scoring breakdown:', {
      mentions: mentions.length,
      tokens: roughTokenCount,
      factors: {
        mentionRate: mentionRate.toFixed(2),
        firstPos: firstPos.toFixed(2),
        headingScore: headingScore.toFixed(2),
        coverage: coverageScore.toFixed(2),
      },
      weightedContributions: {
        mentionRate: `${(VISIBILITY_WEIGHTS_V2.mentionRate * mentionRate).toFixed(2)} (${(VISIBILITY_WEIGHTS_V2.mentionRate * 100).toFixed(0)}% weight)`,
        firstPos: `${(VISIBILITY_WEIGHTS_V2.firstPosition * firstPos).toFixed(2)} (${(VISIBILITY_WEIGHTS_V2.firstPosition * 100).toFixed(0)}% weight)`,
        headingBonus: `${(VISIBILITY_WEIGHTS_V2.headingBonus * headingScore).toFixed(2)} (${(VISIBILITY_WEIGHTS_V2.headingBonus * 100).toFixed(0)}% weight)`,
        coverage: `${(VISIBILITY_WEIGHTS_V2.coverage * coverageScore).toFixed(2)} (${(VISIBILITY_WEIGHTS_V2.coverage * 100).toFixed(0)}% weight)`,
      },
      rawScore: rawScore.toFixed(4),
      finalScore: score,
    });
  }

  return {
    score,
    details: {
      rate: mentionRate,
      firstPos: firstMention?.start ?? null,
      headingHits,
      coverage: coverageScore,
      rawScore,
    },
  };
}

/**
 * Estimate token count from text
 * Rule of thumb: 1 token ≈ 0.75 words (or 1.3 tokens per word)
 */
function estimateTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

/**
 * Count how many times mentions appear in headings/lists
 * 
 * Detects:
 * - Markdown headers: # Emirates, ## Emirates
 * - Numbered lists: 1. Emirates, 2. Emirates
 * - Bullet points: - Emirates, * Emirates, • Emirates
 * - Title case: Emirates Airlines:
 */
function countHeadingListHits(text: string, mentions: EntityMention[]): number {
  const headingPatterns = [
    /^#{1,6}\s+.*$/gm,           // Markdown headers
    /^[A-Z][^\n]*:$/gm,          // Title case with colon
    /^[-*•]\s+/gm,                // Bullet points
    /^\d+\.\s+/gm,                // Numbered lists
  ];

  const headingRanges: Array<{ start: number; end: number }> = [];
  
  for (const pattern of headingPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      headingRanges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  let hits = 0;
  for (const mention of mentions) {
    for (const range of headingRanges) {
      if (mention.start >= range.start && mention.start < range.end) {
        hits++;
        break; // Count each mention only once
      }
    }
  }

  return hits;
}

/**
 * Calculate coverage: how distributed mentions are throughout the text
 * 
 * Divides text into 10 equal bins by character position
 * Returns ratio of bins that contain at least one mention
 * 
 * Examples:
 * - All mentions at start: coverage = 0.1 (1 bin)
 * - Mentions evenly distributed: coverage = 1.0 (10 bins)
 * - Mentions in first and last section: coverage = 0.2 (2 bins)
 */
function calculateCoverage(text: string, mentions: EntityMention[]): number {
  const binCount = 10;
  const binSize = Math.ceil(text.length / binCount);
  const binsWithMentions = new Set<number>();

  for (const mention of mentions) {
    const binIndex = Math.floor(mention.start / binSize);
    binsWithMentions.add(binIndex);
  }

  return binsWithMentions.size / binCount;
}

/**
 * Standard sigmoid function
 * Maps (-∞, +∞) → (0, 1)
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Shifted sigmoid that maps sigmoid(0) → 0 instead of 0.5
 * 
 * This ensures:
 * - visibilitySigmoid(0) = 0 (no mentions = 0% score)
 * - visibilitySigmoid(∞) = 1 (high mentions = 100% score)
 * - Smooth, continuous, differentiable everywhere
 * 
 * Formula: 2 * (sigmoid(x) - 0.5), clamped to [0, 1]
 * 
 * Research-backed approach for AEO/IR scoring:
 * Prevents artificial 50% baseline for zero mentions
 */
function visibilitySigmoid(rawScore: number): number {
  const sig = sigmoid(rawScore);
  // Shift and scale: sigmoid(0) = 0.5 → 0, sigmoid(∞) = 1 → 1
  return Math.max(0, 2 * (sig - 0.5));
}
