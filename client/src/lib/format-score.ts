/**
 * Consistently format scores to 1 decimal place throughout the app
 */
export function formatScore(score: number | string | null | undefined): string {
  if (score === null || score === undefined) return '0.0';
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (isNaN(numScore)) return '0.0';
  return numScore.toFixed(1);
}

/**
 * Round a score to 1 decimal place as a number (for calculations/comparisons)
 */
export function roundScore(score: number | string | null | undefined): number {
  if (score === null || score === undefined) return 0;
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (isNaN(numScore)) return 0;
  return Math.round(numScore * 10) / 10;
}
