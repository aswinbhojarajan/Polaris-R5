import type { EntitySentiment, RankingItem } from '../types/aeo';
import { AEO_CONFIG } from '../config/aeo';

export interface ComposerWeights {
  visibility: number;
  sentiment: number;
  position: number;
}

export function positionScoreFromRankings(
  rankings: Array<{ position: number }>
): number {
  if (rankings.length === 0) {
    return 0;
  }

  // Calculate DCG (Discounted Cumulative Gain) for actual positions
  let dcgSum = 0;
  for (const ranking of rankings) {
    const pos = ranking.position;
    const relevance = 1;
    const dcg = relevance / Math.log2(1 + pos);
    dcgSum += dcg;
  }

  // Calculate Ideal DCG: sum of DCG values if items were at positions 1, 2, 3, ..., N
  // This is the correct nDCG formula used in information retrieval
  let idealDcgSum = 0;
  for (let i = 1; i <= rankings.length; i++) {
    idealDcgSum += 1 / Math.log2(1 + i);
  }

  // Normalized DCG: actual / ideal
  const ndcg = dcgSum / idealDcgSum;

  const score = Math.round(ndcg * 100);

  return Math.min(100, Math.max(0, score));
}

export function sentimentScoreFromABSA(
  sentiments: EntitySentiment[]
): number {
  if (sentiments.length === 0) {
    return 0; // No sentiments = 0 score (brand not mentioned)
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const sentiment of sentiments) {
    const rawSentiment = sentiment.pPos - sentiment.pNeg;
    
    const base = (rawSentiment + 1) * 50;
    
    const shrinkage = 1 - (1 - sentiment.confidence);
    const shrunken = 50 + (base - 50) * shrinkage;
    
    weightedSum += shrunken * sentiment.confidence;
    totalWeight += sentiment.confidence;
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 50;

  return Math.round(score * 100) / 100;
}

export function composeOverall(
  visibilityScore: number,
  sentimentScore: number,
  positionScore: number,
  weights?: ComposerWeights
): number {
  const w = weights || AEO_CONFIG.composerWeights;

  const totalWeight = w.visibility + w.sentiment + w.position;
  
  const overall = 
    (visibilityScore * w.visibility +
     sentimentScore * w.sentiment +
     positionScore * w.position) / totalWeight;

  return Math.round(overall * 100) / 100;
}

export function computePositionScoreAdvanced(
  rankings: RankingItem[],
  brandName: string,
  aliases: string[]
): number {
  const brandRankings = rankings.filter(r => {
    const itemLower = r.item.toLowerCase();
    const nameLower = brandName.toLowerCase();
    
    if (itemLower.includes(nameLower)) return true;
    
    for (const alias of aliases) {
      if (itemLower.includes(alias.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  });

  return positionScoreFromRankings(brandRankings);
}

export type GroupRelevance = 'relevant' | 'partial' | 'irrelevant';

export interface GroupedRanking {
  position: number;
  rankingGroup?: string;
  groupRelevance?: GroupRelevance | null;
  item?: string;
}

export interface PositionScoreV2Result {
  score: number;
  groupBreakdown: Array<{
    group: string;
    relevance: GroupRelevance;
    brandPresent: boolean;
    groupSize: number;
    nDCGScore: number;
    contributes: boolean;
  }>;
}

export function calculatePositionScoreV2(
  brandRankings: GroupedRanking[],
  allRankings: GroupedRanking[]
): PositionScoreV2Result {
  if (brandRankings.length === 0) {
    return { score: 0, groupBreakdown: [] };
  }
  // Brand IS present in at least one group — absence penalty applies to relevant groups where brand is missing

  const allGroups = Array.from(new Set(allRankings.map(r => r.rankingGroup || 'General')));
  const groupBreakdown: PositionScoreV2Result['groupBreakdown'] = [];
  const contributingScores: number[] = [];

  for (const group of allGroups) {
    const rankingsInGroup = allRankings.filter(r => (r.rankingGroup || 'General') === group);
    const brandInGroup = brandRankings.filter(r => (r.rankingGroup || 'General') === group);
    const groupSize = rankingsInGroup.length;

    const relevance = resolveGroupRelevance(rankingsInGroup);

    let nDCGScore = 0;
    let brandPresent = false;

    if (brandInGroup.length > 0) {
      brandPresent = true;
      nDCGScore = positionScoreFromRankings(brandInGroup);
    } else if (relevance === 'relevant') {
      nDCGScore = positionScoreFromRankings([{ position: groupSize + 1 }]);
    }

    const contributes =
      relevance === 'relevant' ||
      (relevance === 'partial' && brandPresent);

    groupBreakdown.push({
      group,
      relevance,
      brandPresent,
      groupSize,
      nDCGScore,
      contributes,
    });

    if (contributes) {
      contributingScores.push(nDCGScore);
    }
  }

  const score = contributingScores.length > 0
    ? Math.round(contributingScores.reduce((sum, s) => sum + s, 0) / contributingScores.length)
    : 0;

  return { score, groupBreakdown };
}

function resolveGroupRelevance(
  rankingsInGroup: GroupedRanking[]
): GroupRelevance {
  const tagged = rankingsInGroup.find(r => r.groupRelevance);
  if (tagged?.groupRelevance) {
    return tagged.groupRelevance;
  }
  return 'relevant';
}
