import { z } from 'zod';
import type { DocumentInput, EntityMention, EntitySentiment } from '../types/aeo';
import { llmSentimentResponseSchema } from '../schemas/aeo';
import { getClient, generateJsonWithRepair } from '../llm/client';
import { AEO_CONFIG } from '../config/aeo';

const ABSA_SENTIMENT_PROMPT = `You are an expert at Aspect-Based Sentiment Analysis (ABSA). Your task is to analyze sentiment expressed about specific entities/brands mentioned in text.

For each entity mention, determine:
1. **p_pos** (0.0-1.0): Probability the sentiment is positive
2. **p_neu** (0.0-1.0): Probability the sentiment is neutral
3. **p_neg** (0.0-1.0): Probability the sentiment is negative
4. **confidence** (0.0-1.0): How confident you are in this assessment
5. **support_spans**: Text spans that support your sentiment assessment

Important rules:
- The three probabilities (p_pos, p_neu, p_neg) MUST sum to approximately 1.0
- Only analyze sentiment directly expressed about the entity, not general context
- If no clear sentiment is expressed about the entity, use neutral (high p_neu)
- Be conservative: default to neutral when sentiment is ambiguous
- Support spans should be relevant phrases with accurate character offsets
- Consider the immediate context around each mention (±100 characters)

Return your analysis as JSON.`;

interface ContextWindow {
  entityId: string;
  span: string;
  contextText: string;
  contextStart: number;
  mentionStart: number;
  mentionEnd: number;
}

function buildContextWindows(
  doc: DocumentInput,
  mentions: EntityMention[],
  windowSize: number = 100
): ContextWindow[] {
  const windows: ContextWindow[] = [];
  const text = doc.text;

  for (const mention of mentions) {
    const contextStart = Math.max(0, mention.start - windowSize);
    const contextEnd = Math.min(text.length, mention.end + windowSize);
    const contextText = text.slice(contextStart, contextEnd);

    windows.push({
      entityId: mention.canonicalId,
      span: mention.span,
      contextText,
      contextStart,
      mentionStart: mention.start,
      mentionEnd: mention.end,
    });
  }

  return windows;
}

function buildAbsaPrompt(doc: DocumentInput, mentions: EntityMention[]): string {
  const windows = buildContextWindows(doc, mentions);
  
  const mentionsInfo = windows.map((w, idx) => ({
    index: idx,
    entity_id: w.entityId,
    mention_span: w.span,
    context: w.contextText,
    mention_position: {
      start: w.mentionStart,
      end: w.mentionEnd,
    },
  }));

  return `${ABSA_SENTIMENT_PROMPT}

ENTITY MENTIONS TO ANALYZE:
${JSON.stringify(mentionsInfo, null, 2)}

FULL TEXT FOR REFERENCE:
"""
${doc.text}
"""

Return a JSON object in this exact format:
{
  "sentiments": [
    {
      "entity_id": "entity-id-from-input",
      "p_pos": 0.1,
      "p_neu": 0.8,
      "p_neg": 0.1,
      "confidence": 0.9,
      "support_spans": [
        {
          "text": "relevant phrase showing sentiment",
          "start": 123,
          "end": 145
        }
      ]
    }
  ]
}

IMPORTANT: Probabilities p_pos + p_neu + p_neg must sum to 1.0 (±0.01)`;
}

export async function analyzeSentimentABSA(
  doc: DocumentInput,
  mentions: EntityMention[]
): Promise<EntitySentiment[]> {
  if (!mentions.length) {
    return [];
  }

  try {
    console.log(`[SentimentABSA] Analyzing sentiment for ${mentions.length} entity mentions using LLM`);
    
    const client = await getClient();
    const prompt = buildAbsaPrompt(doc, mentions);
    
    const result = await generateJsonWithRepair(
      client,
      prompt,
      llmSentimentResponseSchema,
      {
        temperature: AEO_CONFIG.temperature,
        maxTokens: AEO_CONFIG.maxTokens,
      }
    );

    console.log(`[SentimentABSA] LLM returned ${result.data.sentiments.length} sentiment analyses in ${result.latencyMs}ms`);

    const validSentiments = result.data.sentiments
      .filter(s => (s.confidence ?? 1.0) >= AEO_CONFIG.thresholds.sentimentMinConfidence)
      .map(s => ({
        entityId: s.entity_id,
        pPos: s.p_pos,
        pNeu: s.p_neu,
        pNeg: s.p_neg,
        confidence: s.confidence ?? 1.0,
        supportSpans: (s.support_spans || []).map(span => ({
          text: span.text,
          start: span.start,
          end: span.end,
        })),
      }));

    console.log(`[SentimentABSA] After filtering (confidence >= ${AEO_CONFIG.thresholds.sentimentMinConfidence}): ${validSentiments.length} sentiments`);

    return validSentiments;
  } catch (error) {
    console.error('[SentimentABSA] LLM analysis failed:', error);
    console.error('[SentimentABSA] Returning empty array (fail-closed)');
    return [];
  }
}

const DIRECT_SENTIMENT_PROMPT = `You are an expert at brand sentiment analysis. Your task is to find ALL mentions of a specific brand in the text and analyze the sentiment expressed about it.

BRAND TO FIND: "{brandName}"
ALSO KNOWN AS (aliases): {aliases}

CRITICAL ANTI-HALLUCINATION RULES:
1. ONLY report mentions that EXACTLY appear in the text (case-insensitive matching is OK)
2. Do NOT invent or imagine mentions that don't exist
3. If the brand is not mentioned at all, return an empty mentions array
4. Each mention must have accurate character positions (start/end) that match the text

For each mention found, determine:
1. **span**: The exact text of the mention as it appears
2. **start/end**: Character positions in the text (0-indexed)
3. **p_pos** (0.0-1.0): Probability the sentiment is positive
4. **p_neu** (0.0-1.0): Probability the sentiment is neutral  
5. **p_neg** (0.0-1.0): Probability the sentiment is negative
6. **context**: The surrounding sentence or phrase

Rules for sentiment:
- The three probabilities (p_pos, p_neu, p_neg) MUST sum to 1.0
- Only analyze sentiment directly expressed about the brand
- If no clear sentiment, use neutral (high p_neu)
- Consider immediate context around each mention

Return JSON in this exact format:
{
  "mentions": [
    {
      "span": "exact brand text as it appears",
      "start": 123,
      "end": 128,
      "p_pos": 0.2,
      "p_neu": 0.7,
      "p_neg": 0.1,
      "context": "surrounding sentence"
    }
  ]
}`;

const directSentimentSchema = z.object({
  mentions: z.array(z.object({
    span: z.string(),
    start: z.number(),
    end: z.number(),
    p_pos: z.number().min(0).max(1),
    p_neu: z.number().min(0).max(1),
    p_neg: z.number().min(0).max(1),
    context: z.string().optional()
  }))
});

export async function analyzeDirectSentiment(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Promise<{ score: number; mentionCount: number; positiveMentions: number; neutralMentions: number; negativeMentions: number }> {
  try {
    console.log(`[SentimentDirect] Analyzing sentiment for "${brandName}" directly from raw text`);
    
    const client = await getClient();
    const aliasesStr = aliases.length > 0 ? aliases.join(', ') : 'none';
    
    const prompt = DIRECT_SENTIMENT_PROMPT
      .replace('{brandName}', brandName)
      .replace('{aliases}', aliasesStr) + 
      `\n\nTEXT TO ANALYZE:\n"""\n${rawResponse}\n"""`;
    
    const result = await generateJsonWithRepair(
      client,
      prompt,
      directSentimentSchema,
      {
        temperature: 0, // Deterministic for anti-hallucination
        maxTokens: AEO_CONFIG.maxTokens,
      }
    );

    console.log(`[SentimentDirect] LLM found ${result.data.mentions.length} mentions in ${result.latencyMs}ms`);

    // Import comprehensive Unicode normalizer from mention-detector
    const { normalizeBrandToken } = await import('./mention-detector.js');
    // Normalize text using shared function (handles diacritics, hyphens, apostrophes, full-width, etc.)
    const normalizeText = (str: string): string => normalizeBrandToken(str).toLowerCase();
    const stripPunctuation = (str: string): string => {
      let s = str.replace(/[''′ʼ`]/g, "'"); // Normalize apostrophes first
      s = s.replace(/'s$/i, ''); // Remove possessive
      s = s.replace(/[.,;:!?\)\]\}"']+$/, ''); // Trailing punctuation
      s = s.replace(/^[(\[{"']+/, ''); // Leading punctuation
      return s.trim();
    };
    
    // Normalize raw response for text existence checks
    const normalizedRawResponse = normalizeText(rawResponse);
    
    // ANTI-HALLUCINATION VALIDATION: Verify each mention actually exists in text
    const validatedMentions = result.data.mentions.filter(mention => {
      // Normalize the span
      let normalizedSpan = normalizeText(mention.span.trim());
      normalizedSpan = stripPunctuation(normalizedSpan);
      
      // Check 1: Verify start/end offsets are valid (if provided)
      if (mention.start !== undefined && mention.end !== undefined) {
        if (mention.start < 0 || mention.end > rawResponse.length || mention.start >= mention.end) {
          console.log(`[SentimentDirect] HALLUCINATION: Invalid offsets for "${mention.span}" (start=${mention.start}, end=${mention.end}), dropping`);
          return false;
        }
      }
      
      // Check 2: Verify span exists in normalized text with word boundary awareness
      // Use word boundary regex to prevent "AI" matching inside "paid"
      const escapedSpan = normalizedSpan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordBoundaryRegex = new RegExp(`\\b${escapedSpan}\\b`, 'i');
      
      if (!wordBoundaryRegex.test(normalizedRawResponse)) {
        // Fallback: check without word boundaries for compound terms
        if (!normalizedRawResponse.includes(normalizedSpan)) {
          console.log(`[SentimentDirect] HALLUCINATION: "${mention.span}" not found in text, dropping`);
          return false;
        }
      }
      
      // Check 3: Verify the span matches brand or aliases
      const allTerms = [brandName, ...aliases].map(t => normalizeText(t.trim()));
      const spanMatchesBrand = allTerms.some(term => {
        // Use word boundary check for short terms (< 4 chars) to prevent false matches
        if (term.length < 4) {
          const termRegex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          return termRegex.test(normalizedSpan) || normalizedSpan === term;
        }
        return normalizedSpan.includes(term) || term.includes(normalizedSpan);
      });
      
      if (!spanMatchesBrand) {
        console.log(`[SentimentDirect] HALLUCINATION: "${mention.span}" doesn't match brand/aliases, dropping`);
        return false;
      }
      
      return true;
    });

    console.log(`[SentimentDirect] After validation: ${validatedMentions.length} mentions (dropped ${result.data.mentions.length - validatedMentions.length} hallucinations)`);

    if (validatedMentions.length === 0) {
      return { score: 0, mentionCount: 0, positiveMentions: 0, neutralMentions: 0, negativeMentions: 0 };
    }

    // Calculate sentiment score from validated mentions
    let totalWeightedSentiment = 0;
    let positiveMentions = 0;
    let neutralMentions = 0;
    let negativeMentions = 0;

    for (const mention of validatedMentions) {
      const rawSentiment = mention.p_pos - mention.p_neg;
      totalWeightedSentiment += rawSentiment;
      
      // Categorize by dominant sentiment
      const maxProb = Math.max(mention.p_pos, mention.p_neu, mention.p_neg);
      if (mention.p_pos === maxProb) positiveMentions++;
      else if (mention.p_neg === maxProb) negativeMentions++;
      else neutralMentions++;
    }

    const avgSentiment = totalWeightedSentiment / validatedMentions.length;
    const score = Math.round((avgSentiment + 1) * 50 * 100) / 100; // Scale -1..+1 to 0..100

    console.log(`[SentimentDirect] Final score: ${score} (pos: ${positiveMentions}, neu: ${neutralMentions}, neg: ${negativeMentions})`);

    return {
      score: Math.max(0, Math.min(100, score)),
      mentionCount: validatedMentions.length,
      positiveMentions,
      neutralMentions,
      negativeMentions
    };
  } catch (error) {
    console.error('[SentimentDirect] LLM analysis failed:', error);
    return { score: 0, mentionCount: 0, positiveMentions: 0, neutralMentions: 0, negativeMentions: 0 };
  }
}

export function mapAbsaToScore(sentiments: EntitySentiment[]): number {
  if (!sentiments.length) {
    return 50;
  }

  let totalWeightedSentiment = 0;
  let totalConfidence = 0;

  for (const sentiment of sentiments) {
    const rawSentiment = sentiment.pPos - sentiment.pNeg;
    
    const confidenceWeightedSentiment = rawSentiment * sentiment.confidence;
    
    totalWeightedSentiment += confidenceWeightedSentiment;
    totalConfidence += sentiment.confidence;
  }

  if (totalConfidence === 0) {
    return 50;
  }

  const avgSentiment = totalWeightedSentiment / totalConfidence;
  
  const score = (avgSentiment + 1) * 50;
  
  const shrinkage = 1 - (totalConfidence / sentiments.length);
  const finalScore = score * (1 - shrinkage * 0.5) + 50 * shrinkage * 0.5;

  return Math.round(Math.max(0, Math.min(100, finalScore)) * 100) / 100;
}
