export type PositionScoringVersion = 'v1' | 'v2';

export const POSITION_SCORING_VERSION: PositionScoringVersion = 
  (process.env.POSITION_SCORING_VERSION as PositionScoringVersion) || 'v1';

export function getPositionScoringVersion(): PositionScoringVersion {
  return (process.env.POSITION_SCORING_VERSION as PositionScoringVersion) || 'v1';
}

console.log(`[Position Config] Version: ${POSITION_SCORING_VERSION}`);
if (POSITION_SCORING_VERSION === 'v2') {
  console.log('[Position Config] Using V2: relevance-tagged groups, average aggregation');
} else {
  console.log('[Position Config] Using V1: MAX across all groups (legacy)');
}
