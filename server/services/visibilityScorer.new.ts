import type { EntityMention, VisibilityDetails } from '../types/aeo';

interface VisibilityScoreResult {
  score: number;
  details: VisibilityDetails;
}

export function calculateVisibilityAdvanced(
  text: string,
  mentions: EntityMention[]
): VisibilityScoreResult {
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

  const mentionRate = mentions.length > 0 ? (mentions.length / roughTokenCount) * 100 : 0;

  const firstMention = mentions.length > 0
    ? mentions.reduce((earliest, m) => earliest === null || m.start < earliest.start ? m : earliest)
    : null;
  const firstPos = firstMention ? 1 - Math.min(1, firstMention.start / textLen) : 0;

  const headingHits = countHeadingListHits(text, mentions);
  const coverage = calculateCoverage(text, mentions);

  const rawScore =
    0.9 * mentionRate +
    0.6 * firstPos +
    0.4 * Math.min(1, headingHits / 5) +
    0.5 * coverage;

  // Use shifted sigmoid: maps sigmoid(0) → 0 instead of 0.5
  const score = Math.round(100 * visibilitySigmoid(rawScore));

  return {
    score,
    details: {
      rate: mentionRate,
      firstPos: firstMention?.start ?? null,
      headingHits,
      coverage,
      rawScore,
    },
  };
}

function estimateTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

function countHeadingListHits(text: string, mentions: EntityMention[]): number {
  const headingPatterns = [
    /^#{1,6}\s+.*$/gm,
    /^[A-Z][^\n]*:$/gm,
    /^[-*•]\s+/gm,
    /^\d+\.\s+/gm,
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
        break;
      }
    }
  }

  return hits;
}

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

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Shifted sigmoid that maps sigmoid(0) → 0 instead of 0.5
 * This ensures no mentions = 0% score, with smooth scaling for mentions > 0
 * Formula: 2 * (sigmoid(x) - 0.5), clamped to [0, 1]
 * 
 * Properties:
 * - visibilitySigmoid(0) = 0 (no mentions = 0%)
 * - visibilitySigmoid(∞) = 1 (high mentions = 100%)
 * - Smooth, continuous, differentiable everywhere
 * - Research-backed approach for AEO/IR scoring
 */
function visibilitySigmoid(rawScore: number): number {
  const sig = sigmoid(rawScore);
  // Shift and scale: sigmoid(0) = 0.5 → 0, sigmoid(∞) = 1 → 1
  return Math.max(0, 2 * (sig - 0.5));
}
