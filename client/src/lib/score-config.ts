// Score range configuration for color coding
// This configuration determines the color coding for visibility, sentiment, and position scores

export const SCORE_RANGES = {
  low: {
    min: 0,
    max: 30,
    color: 'text-red-600',
    bgColor: 'bg-red-600',
    label: 'Low'
  },
  medium: {
    min: 31,
    max: 70,
    color: 'text-amber-600',
    bgColor: 'bg-amber-600',
    label: 'Medium'
  },
  high: {
    min: 71,
    max: 100,
    color: 'text-green-600',
    bgColor: 'bg-green-600',
    label: 'High'
  }
} as const;

/**
 * Get the color class for a score based on configured ranges
 * @param score - The score value (0-100)
 * @returns The color class (e.g., 'text-red-600', 'text-amber-600', 'text-green-600')
 */
export function getScoreColor(score: number): string {
  if (score >= SCORE_RANGES.high.min && score <= SCORE_RANGES.high.max) {
    return SCORE_RANGES.high.color;
  } else if (score >= SCORE_RANGES.medium.min && score <= SCORE_RANGES.medium.max) {
    return SCORE_RANGES.medium.color;
  } else {
    return SCORE_RANGES.low.color;
  }
}

/**
 * Get the background color class for a score based on configured ranges
 * @param score - The score value (0-100)
 * @returns The background color class (e.g., 'bg-red-600', 'bg-amber-600', 'bg-green-600')
 */
export function getScoreBgColor(score: number): string {
  if (score >= SCORE_RANGES.high.min && score <= SCORE_RANGES.high.max) {
    return SCORE_RANGES.high.bgColor;
  } else if (score >= SCORE_RANGES.medium.min && score <= SCORE_RANGES.medium.max) {
    return SCORE_RANGES.medium.bgColor;
  } else {
    return SCORE_RANGES.low.bgColor;
  }
}

/**
 * Get the score range label
 * @param score - The score value (0-100)
 * @returns The range label (e.g., 'Low', 'Medium', 'High')
 */
export function getScoreLabel(score: number): string {
  if (score >= SCORE_RANGES.high.min && score <= SCORE_RANGES.high.max) {
    return SCORE_RANGES.high.label;
  } else if (score >= SCORE_RANGES.medium.min && score <= SCORE_RANGES.medium.max) {
    return SCORE_RANGES.medium.label;
  } else {
    return SCORE_RANGES.low.label;
  }
}
