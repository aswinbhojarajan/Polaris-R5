import type {
  BrandRecord,
  DocumentInput,
  EngineOutput,
  EntityMention,
  EntitySentiment,
  RankingItem,
  VisibilityDetails,
} from '../types/aeo';
import { AEO_MODE, type AEOMode } from '../config/aeo';
import { extractMentionsLLM } from './mentionExtractor.llm';
import { detectMentions } from './mention-detector';
import { analyzeSentimentABSA } from './sentimentAbsa.llm';
import { parseRankingsAsync } from './ranking-parser';
import { calculateVisibilityScoreWithMentions } from './visibility-scoring';
import {
  calculatePositionScore,
  calculateSentimentScoreFromABSA,
  calculateOverallScore,
} from './scoring';

export async function runAEO(
  doc: DocumentInput,
  brand: BrandRecord,
  mode?: AEOMode
): Promise<EngineOutput> {
  const effectiveMode = mode || AEO_MODE;
  const startTime = Date.now();

  console.log(`[AEO Engine] Starting pipeline for brand "${brand.name}" in ${effectiveMode} mode`);

  try {
    const mentions = await extractMentions(doc, brand, effectiveMode);
    console.log(`[AEO Engine] ✓ Step 1/5: Extracted ${mentions.length} mentions (${Date.now() - startTime}ms)`);

    const sentiments = await analyzeSentiments(doc, mentions, brand, effectiveMode);
    console.log(`[AEO Engine] ✓ Step 2/5: Analyzed ${sentiments.length} sentiments (${Date.now() - startTime}ms)`);

    const rankings = await extractRankings(doc, brand, effectiveMode);
    console.log(`[AEO Engine] ✓ Step 3/5: Extracted ${rankings.length} rankings (${Date.now() - startTime}ms)`);

    const visibilityResult = calculateVisibility(doc, mentions, effectiveMode);
    console.log(`[AEO Engine] ✓ Step 4/5: Calculated visibility score: ${visibilityResult.score}/100 (${Date.now() - startTime}ms)`);

    const scores = computeScores(
      visibilityResult.score,
      sentiments,
      rankings,
      brand
    );
    console.log(`[AEO Engine] ✓ Step 5/5: Computed final scores (${Date.now() - startTime}ms)`);

    const output: EngineOutput = {
      mentions,
      sentiment: sentiments,
      rankings: rankings.map(r => ({
        item: r.item,
        position: r.position,
        confidence: 1.0,
      })),
      visibility: visibilityResult.details,
      scores: {
        visibilityScore: visibilityResult.score,
        sentimentScore: scores.sentimentScore,
        positionScore: scores.positionScore,
        overallScore: scores.overallScore,
      },
    };

    console.log(`[AEO Engine] ✅ Pipeline complete in ${Date.now() - startTime}ms`);
    console.log(`[AEO Engine] Overall score: ${output.scores.overallScore.toFixed(1)}/100`);

    return output;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[AEO Engine] ❌ Pipeline failed after ${elapsed}ms:`, error);
    throw new Error(
      `AEO pipeline failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function extractMentions(
  doc: DocumentInput,
  brand: BrandRecord,
  mode: AEOMode
): Promise<EntityMention[]> {
  try {
    if (mode === 'heuristic') {
      const heuristicMentions = detectMentions(
        doc.text,
        brand.name,
        brand.aliases
      );

      return heuristicMentions.map((m, index) => ({
        span: m.span,
        start: doc.text.indexOf(m.span),
        end: doc.text.indexOf(m.span) + m.span.length,
        canonicalId: brand.id,
        surfaceType: m.isAlias ? 'alias' as const : 'direct' as const,
        confidence: 0.9,
      }));
    }

    return await extractMentionsLLM(doc, [brand]);
  } catch (error) {
    console.error('[AEO Engine] Mention extraction failed:', error);
    return [];
  }
}

async function analyzeSentiments(
  doc: DocumentInput,
  mentions: EntityMention[],
  brand: BrandRecord,
  mode: AEOMode
): Promise<EntitySentiment[]> {
  if (mentions.length === 0) {
    return [];
  }

  try {
    if (mode === 'heuristic') {
      return [{
        entityId: brand.id,
        pPos: 0.33,
        pNeu: 0.34,
        pNeg: 0.33,
        confidence: 0.5,
        supportSpans: [],
      }];
    }

    return await analyzeSentimentABSA(doc, mentions);
  } catch (error) {
    console.error('[AEO Engine] Sentiment analysis failed:', error);
    return [{
      entityId: brand.id,
      pPos: 0.33,
      pNeu: 0.34,
      pNeg: 0.33,
      confidence: 0.5,
      supportSpans: [],
    }];
  }
}

async function extractRankings(
  doc: DocumentInput,
  brand: BrandRecord,
  mode: AEOMode
): Promise<Array<{ item: string; position: number }>> {
  try {
    return await parseRankingsAsync(doc.text, brand.name, brand.aliases);
  } catch (error) {
    console.error('[AEO Engine] Ranking extraction failed:', error);
    return [];
  }
}

function calculateVisibility(
  doc: DocumentInput,
  mentions: EntityMention[],
  mode: AEOMode
): { score: number; details: VisibilityDetails } {
  try {
    const result = calculateVisibilityScoreWithMentions({
      text: doc.text,
      mentions,
    });

    return {
      score: result.score,
      details: result.details,
    };
  } catch (error) {
    console.error('[AEO Engine] Visibility calculation failed:', error);
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
}

function computeScores(
  visibilityScore: number,
  sentiments: EntitySentiment[],
  rankings: Array<{ item: string; position: number }>,
  brand: BrandRecord
): {
  sentimentScore: number;
  positionScore: number;
  overallScore: number;
} {
  try {
    const sentimentScore = sentiments.length > 0
      ? calculateSentimentScoreFromABSA(sentiments)
      : 50;

    const brandRankings = rankings.filter(r =>
      r.item.toLowerCase().includes(brand.name.toLowerCase()) ||
      brand.aliases.some(a => r.item.toLowerCase().includes(a.toLowerCase()))
    );

    const positionResult = calculatePositionScore(brandRankings);
    const positionScore = positionResult.positionScore;

    const overallScore = calculateOverallScore(
      visibilityScore,
      sentimentScore,
      positionScore
    );

    return {
      sentimentScore,
      positionScore,
      overallScore,
    };
  } catch (error) {
    console.error('[AEO Engine] Score computation failed:', error);
    return {
      sentimentScore: 50,
      positionScore: 0,
      overallScore: visibilityScore * 0.5 + 50 * 0.3,
    };
  }
}
