import { z } from 'zod';
import type { DocumentInput, BrandRecord, EntityMention } from '../types/aeo';
import { llmMentionResponseSchema } from '../schemas/aeo';
import { getClient, generateJsonWithRepair } from '../llm/client';
import { AEO_CONFIG } from '../config/aeo';

const MENTION_EXTRACTION_PROMPT = `You are a precise entity mention detector. Your task is to find mentions that match the specified brand name OR one of its listed aliases.

For each mention found, you must:
1. Extract the EXACT span text as it appears in the document
2. Provide precise character offsets [start, end) where start is inclusive and end is exclusive
3. Link to the canonical brand ID
4. Classify as 'direct' (exact brand name match) or 'alias' (matches one of the listed aliases)
5. Provide a confidence score (0.0-1.0)

MATCHING RULES:
- Match the brand name or aliases as COMPLETE WORDS (not substrings of other words)
- Include product variants: "Bulleit Bourbon" matches alias "Bulleit", "iPhone 15" matches "iPhone"
- Include possessive forms: "Apple's" matches "Apple"
- Be case-insensitive but preserve original case in spans
- A mention is 'direct' if it contains the brand name as a complete word
- A mention is 'alias' if it contains one of the listed aliases as a complete word

EXCLUSION RULES:
- DO NOT include competitor brands or other unrelated companies
- DO NOT assume brands are related just because they are in the same industry
- If the text mentions "Pepsi" but you are looking for "Coca-Cola", do NOT include Pepsi
- The alias must appear as a COMPLETE WORD, not as a substring (e.g., "AI" should NOT match "PAID")

Return your response as a JSON object with a "mentions" array. If no mentions match, return {"mentions": []}.`;

interface MentionExtractionContext {
  text: string;
  brands: Array<{
    id: string;
    name: string;
    aliases: string[];
  }>;
}

function buildExtractionPrompt(doc: DocumentInput, brands: BrandRecord[]): string {
  const brandsInfo = brands.map(b => ({
    id: b.id,
    name: b.name,
    aliases: b.aliases,
  }));

  const context: MentionExtractionContext = {
    text: doc.text,
    brands: brandsInfo,
  };

  return `${MENTION_EXTRACTION_PROMPT}

TEXT TO ANALYZE:
"""
${doc.text}
"""

BRANDS TO DETECT:
${JSON.stringify(brandsInfo, null, 2)}

Return a JSON object in this exact format:
{
  "mentions": [
    {
      "span": "exact text from document",
      "start": 0,
      "end": 10,
      "canonical_id": "brand-id",
      "surface_type": "direct" | "alias",
      "confidence": 0.95
    }
  ]
}`;
}

export async function extractMentionsLLM(
  doc: DocumentInput,
  brands: BrandRecord[]
): Promise<EntityMention[]> {
  if (!brands.length) {
    return [];
  }

  try {
    console.log(`[MentionExtractor] Extracting mentions for ${brands.length} brands using LLM`);
    
    const client = await getClient();
    const prompt = buildExtractionPrompt(doc, brands);
    
    const result = await generateJsonWithRepair(
      client,
      prompt,
      llmMentionResponseSchema,
      {
        temperature: AEO_CONFIG.temperature,
        maxTokens: AEO_CONFIG.maxTokens,
      }
    );

    console.log(`[MentionExtractor] LLM returned ${result.data.mentions.length} mentions in ${result.latencyMs}ms`);

    const validMentions = result.data.mentions
      .filter(m => (m.confidence ?? 1.0) >= AEO_CONFIG.thresholds.mentionMinConfidence)
      .map(m => ({
        span: m.span,
        start: m.start,
        end: m.end,
        canonicalId: m.canonical_id,
        surfaceType: m.surface_type,
        confidence: m.confidence ?? 1.0,
      }));

    const dedupedMentions = deduplicateMentions(validMentions);

    console.log(`[MentionExtractor] After filtering (confidence >= ${AEO_CONFIG.thresholds.mentionMinConfidence}) and deduplication: ${dedupedMentions.length} mentions`);

    return dedupedMentions;
  } catch (error) {
    console.error('[MentionExtractor] LLM extraction failed:', error);
    console.error('[MentionExtractor] Returning empty array (fail-closed)');
    return [];
  }
}

function deduplicateMentions(mentions: EntityMention[]): EntityMention[] {
  const seen = new Map<string, EntityMention>();

  for (const mention of mentions) {
    const key = `${mention.start}-${mention.end}-${mention.canonicalId}`;
    
    if (!seen.has(key) || (seen.get(key)!.confidence < mention.confidence)) {
      seen.set(key, mention);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.start - b.start);
}
