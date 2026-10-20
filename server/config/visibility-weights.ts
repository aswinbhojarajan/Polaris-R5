export interface VisibilityWeights {
  mentionRate: number;
  firstPosition: number;
  headingBonus: number;
  coverage: number;
}

// V1 Weights (legacy - sum to 2.4)
// These weights were used in the original implementation
// Kept for backward compatibility
export const VISIBILITY_WEIGHTS_V1: VisibilityWeights = {
  mentionRate: 0.9,
  firstPosition: 0.6,
  headingBonus: 0.4,
  coverage: 0.5,
};

// V2 Weights (normalized - sum to 1.0)
// Mathematically correct: each weight represents % contribution to final score
// - Mention Rate (40%): Frequency is the strongest signal of visibility
// - First Position (30%): Early mentions indicate prominence
// - Heading Bonus (15%): Structural placement matters but less than frequency
// - Coverage (15%): Distribution is useful but secondary to absolute mentions
export const VISIBILITY_WEIGHTS_V2: VisibilityWeights = {
  mentionRate: 0.40,
  firstPosition: 0.30,
  headingBonus: 0.15,
  coverage: 0.15,
};

// Validate weights sum to expected value
export function validateWeights(weights: VisibilityWeights, expectedSum: number = 1.0): boolean {
  const actualSum = weights.mentionRate + weights.firstPosition + 
                    weights.headingBonus + weights.coverage;
  const tolerance = 0.001;
  const isValid = Math.abs(actualSum - expectedSum) < tolerance;
  
  if (!isValid) {
    console.error(`[Visibility Weights] Validation failed: sum=${actualSum.toFixed(3)}, expected=${expectedSum}`);
  }
  
  return isValid;
}

// Get active weight configuration based on environment variable
export function getVisibilityWeights(): VisibilityWeights {
  const version = process.env.VISIBILITY_SCORING_VERSION || 'v1';
  
  if (version === 'v2') {
    if (!validateWeights(VISIBILITY_WEIGHTS_V2, 1.0)) {
      console.error('[Visibility Config] V2 weights invalid, falling back to V1');
      return VISIBILITY_WEIGHTS_V1;
    }
    return VISIBILITY_WEIGHTS_V2;
  }
  
  return VISIBILITY_WEIGHTS_V1;
}

export const VISIBILITY_SCORING_VERSION = process.env.VISIBILITY_SCORING_VERSION || 'v1';

// Log configuration on module load
console.log(`[Visibility Config] Version: ${VISIBILITY_SCORING_VERSION}`);
if (VISIBILITY_SCORING_VERSION === 'v2') {
  console.log('[Visibility Config] Using V2 weights (normalized to 1.0):');
  console.log(`  - Mention Rate:   ${VISIBILITY_WEIGHTS_V2.mentionRate} (40%)`);
  console.log(`  - First Position: ${VISIBILITY_WEIGHTS_V2.firstPosition} (30%)`);
  console.log(`  - Heading Bonus:  ${VISIBILITY_WEIGHTS_V2.headingBonus} (15%)`);
  console.log(`  - Coverage:       ${VISIBILITY_WEIGHTS_V2.coverage} (15%)`);
} else {
  console.log('[Visibility Config] Using V1 weights (legacy, sum=2.4)');
}
