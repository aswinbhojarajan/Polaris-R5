import { getClient } from '../llm/client';
import { AEO_CONFIG } from '../config/aeo';
import { llmRankingResponseSchema, type RankingSchemaType } from '../schemas/aeo';
import type { BrandRecord, DocumentInput, RankingItem } from '../types/aeo';

interface RankingExtractionContext {
  doc: DocumentInput;
  brand: BrandRecord;
  minConfidence: number;
}

function buildRankingPrompt(context: RankingExtractionContext, promptText: string = ''): string {
  const { doc, brand } = context;

  return `You are a ranking extraction system. Extract ALL brands/companies/entities from structured lists in the AI response, AND identify which group/section each ranking belongs to.

EXTRACT FROM ALL STRUCTURAL ORDERING:
✅ Explicit numbers: "1. Emirates", "2. Qatar"  → Position 1, 2
✅ Section letters: "A. Emirates", "B. Qatar"  → A=1, B=2, C=3, D=4, etc.
✅ Roman numerals: "i. Emirates", "ii. Qatar"  → i=1, ii=2, iii=3, iv=4, etc.
✅ Bullet lists: "• Emirates", "• Qatar"  → First bullet=1, second=2, etc.
✅ Ordered mentions in paragraphs: First brand mentioned = position 1

IGNORE (Not brand rankings):
❌ Numbered features/topics: "1. Better Service", "2. Premium Dining" (these describe attributes, not entities)
❌ Measurements: "19.5 inches", "2024"
❌ Numbered steps/instructions

CONTEXT:
- Original Question: "${promptText || 'Not provided'}"
- We are tracking: ${brand.name}
${brand.aliases.length > 0 ? `- Aliases: ${brand.aliases.join(', ')}` : ''}
- Extract ALL brands/entities, not just the tracked brand

AI RESPONSE TO ANALYZE:
${doc.text}

POSITION ASSIGNMENT RULES:
- Explicit numbers (1, 2, 3): Use the number as position
- Section letters (A, B, C, D): A=1, B=2, C=3, D=4, E=5, etc.
- Roman numerals lowercase (i, ii, iii, iv): i=1, ii=2, iii=3, iv=4, v=5, etc.
- Roman numerals uppercase (I, II, III, IV): I=1, II=2, III=3, IV=4, V=5, etc.
- Bullets (-, •, *): First bullet=1, second=2, third=3, etc.
- Dash lists or ordered mentions: First=1, second=2, third=3, etc.

GROUP/SECTION DETECTION:
- Look for section headings, markdown headers, or context around the list
- If the response has multiple ranked lists, identify what category each list represents
- Examples: "Manufacturers", "Airlines", "Full-Service Carriers", "Low-Cost Carriers", "Technology Companies", etc.
- If no clear group is present, use "General" as the group name
- Use concise, descriptive group names (2-4 words)

GROUP RELEVANCE TAGGING:
For EACH group/section, assess how relevant it is for comparing the tracked brand (${brand.name}) against direct competitors:
- "relevant": The group directly compares entities in the same industry/category as ${brand.name}. The brand could reasonably appear here. Examples: "Carriers" for a shipping company, "Airlines" for an airline.
- "partial": The group is tangentially related — adjacent category or service that the brand might offer but isn't their core business. Examples: "Postal Services" for an express courier, "Traction Technologies" for a shoe brand.
- "irrelevant": The group lists entities from a completely different industry or category. The brand would never compete here. Examples: "E-commerce Marketplaces" for a shipping carrier, "Office Supply Stores" for a logistics company.

For each ranking, include:
- groupRelevance: one of "relevant", "partial", or "irrelevant"
- relevanceReason: a brief 5-15 word explanation of why this relevance level was chosen

CRITICAL RULES:
1. Extract brand/company/product NAMES only, not features or attributes
2. Extract from ANY structure that implies ordering
3. Extract ALL items from the structure, not just the tracked brand
4. Identify which section/category each ranking belongs to (rankingGroup)
5. Tag each group with relevance level (groupRelevance) and reason (relevanceReason)
6. When unsure if something is a brand vs feature → ask yourself: "Is this a named entity?" If yes, extract. If no, skip.

OUTPUT FORMAT (JSON):
{
  "rankings": [
    {
      "item": "exact brand/entity name",
      "position": 1,
      "rankingGroup": "category name",
      "groupRelevance": "relevant",
      "relevanceReason": "Direct competitor comparison in same industry",
      "confidence": 0.95,
      "evidence_span": {
        "text": "surrounding context showing the ranking",
        "start": 123,
        "end": 200
      }
    }
  ]
}

EXAMPLES:

Response: "## Manufacturers\nA. Airbus\nB. Boeing\n\n## Airlines\ni. Qatar Airways\nii. Singapore Airlines"
→ Extract (tracking: Qatar Airways): 
  - Airbus (pos=1, group="Manufacturers", relevance="partial", reason="Aircraft manufacturers, not airlines")
  - Boeing (pos=2, group="Manufacturers", relevance="partial", reason="Aircraft manufacturers, not airlines")
  - Qatar Airways (pos=1, group="Airlines", relevance="relevant", reason="Direct airline competitor comparison")
  - Singapore Airlines (pos=2, group="Airlines", relevance="relevant", reason="Direct airline competitor comparison")

Response: "### Full-Service Carriers\ni. Emirates\nii. Singapore Airlines\n\n### Low-Cost Carriers\ni. Ryanair\nii. AirAsia"
→ Extract (tracking: Emirates):
  - Emirates (pos=1, group="Full-Service Carriers", relevance="relevant", reason="Direct competitor group for full-service airline")
  - Singapore Airlines (pos=2, group="Full-Service Carriers", relevance="relevant", reason="Direct competitor group for full-service airline")
  - Ryanair (pos=1, group="Low-Cost Carriers", relevance="partial", reason="Same industry but different market segment")
  - AirAsia (pos=2, group="Low-Cost Carriers", relevance="partial", reason="Same industry but different market segment")

Response: "- Emirates  - Qatar Airways  - Etihad"
→ Extract:
  - Emirates (pos=1, group="General", relevance="relevant", reason="Direct competitor comparison")
  - Qatar Airways (pos=2, group="General", relevance="relevant", reason="Direct competitor comparison")
  - Etihad (pos=3, group="General", relevance="relevant", reason="Direct competitor comparison")

Response: "1. Wider Seats  2. Premium Dining"
→ Extract: [] (these are features, not brand names)

IMPORTANT:
- Confidence: explicit number/letter = 0.9-1.0, bullets/mentions = 0.7-0.9
- Evidence span: ±50 characters around the mention
- Ensure start < end in evidence spans
- Always include rankingGroup for each ranking
- Always include groupRelevance and relevanceReason for each ranking
- All items within the same group MUST have the same groupRelevance and relevanceReason
- Return empty array [] if no brands/entities found`;
}

/**
 * Apply tie-breaking logic to ensure unique positions within each group.
 * When multiple items have the same position in a group, use text appearance order as tie-breaker.
 */
function applyTieBreaking(rankings: RankingItem[]): RankingItem[] {
  // Group rankings by rankingGroup
  const groupedRankings = new Map<string, RankingItem[]>();
  
  for (const ranking of rankings) {
    const group = ranking.rankingGroup ?? 'General';
    if (!groupedRankings.has(group)) {
      groupedRankings.set(group, []);
    }
    groupedRankings.get(group)!.push(ranking);
  }

  const result: RankingItem[] = [];

  // Process each group separately
  for (const [group, items] of Array.from(groupedRankings.entries())) {
    // Sort by position first, then by text appearance (evidenceSpan.start)
    const sortedItems = items.sort((a: RankingItem, b: RankingItem) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      // Tie-breaker: use text position (earlier appearance wins)
      const aStart = a.evidenceSpan?.start ?? Infinity;
      const bStart = b.evidenceSpan?.start ?? Infinity;
      return aStart - bStart;
    });

    // Reassign positions sequentially to ensure uniqueness within group
    let currentPosition = 1;
    for (const item of sortedItems) {
      result.push({
        ...item,
        position: currentPosition++,
      });
    }
  }

  // Sort final result by group, then position
  return result.sort((a, b) => {
    const groupA = a.rankingGroup ?? 'General';
    const groupB = b.rankingGroup ?? 'General';
    if (groupA !== groupB) {
      return groupA.localeCompare(groupB);
    }
    return a.position - b.position;
  });
}

// Import comprehensive Unicode normalizer
import { normalizeBrandToken } from './mention-detector';

// Helper to normalize text for matching
function normalizeForMatching(str: string): string {
  return normalizeBrandToken(str)
    .toLowerCase()
    .replace(/[.,;:!?\)\]\}"']+$/, '') // Strip trailing punctuation
    .replace(/^[(\[{"']+/, '') // Strip leading punctuation;
}

// Helper to escape regex special characters
function escapeRegexChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function extractRankings(
  doc: DocumentInput,
  brand: BrandRecord,
  promptText: string = ''
): Promise<RankingItem[]> {
  // ANTI-HALLUCINATION: Early return if raw response is empty or too short
  if (!doc.text || doc.text.trim().length < 50) {
    console.log(`[RankingExtractor] Raw response is empty or too short (${doc.text?.length || 0} chars), returning empty rankings`);
    return [];
  }

  const context: RankingExtractionContext = {
    doc,
    brand,
    minConfidence: AEO_CONFIG.thresholds.rankingMinConfidence,
  };

  console.log(`[RankingExtractor] Extracting rankings for brand "${brand.name}" using context-aware LLM`);

  try {
    const client = await getClient();
    const prompt = buildRankingPrompt(context, promptText);

    const result = await client.generateJson(
      prompt,
      llmRankingResponseSchema,
      {
        temperature: 0, // Use temperature 0 for deterministic anti-hallucination
        maxTokens: AEO_CONFIG.maxTokens,
      }
    );

    console.log(`[RankingExtractor] LLM returned ${result.data.rankings.length} rankings in ${result.latencyMs}ms`);

    // Normalize raw response for text existence validation
    const normalizedRawResponse = normalizeForMatching(doc.text);

    // ANTI-HALLUCINATION VALIDATION: Verify each ranking item exists in raw response
    const validRankings = result.data.rankings
      .filter((r) => {
        // Check confidence threshold
        if ((r.confidence ?? 1.0) < context.minConfidence) {
          return false;
        }
        
        // CRITICAL: Verify the ranking item actually exists in the raw response
        const normalizedItem = normalizeForMatching(r.item);
        
        // Use word boundary regex to find the item in the text
        const escapedItem = escapeRegexChars(normalizedItem);
        const wordBoundaryRegex = new RegExp(`\\b${escapedItem}\\b`, 'i');
        
        if (!wordBoundaryRegex.test(normalizedRawResponse)) {
          // Fallback: check simple includes for compound names
          if (!normalizedRawResponse.includes(normalizedItem)) {
            console.log(`[RankingExtractor] HALLUCINATION: "${r.item}" not found in raw response, dropping`);
            return false;
          }
        }
        
        return true;
      })
      .map((r) => ({
        item: r.item,
        position: r.position,
        confidence: r.confidence ?? 1.0,
        rankingGroup: r.rankingGroup,
        groupRelevance: r.groupRelevance as 'relevant' | 'partial' | 'irrelevant' | undefined,
        relevanceReason: r.relevanceReason,
        evidenceSpan: r.evidence_span ? {
          text: r.evidence_span.text,
          start: r.evidence_span.start,
          end: r.evidence_span.end,
        } : undefined,
      }));

    console.log(`[RankingExtractor] After validation: ${validRankings.length} rankings (dropped ${result.data.rankings.length - validRankings.length} hallucinations)`);

    const sortedRankings = validRankings.sort((a, b) => a.position - b.position);

    // Apply tie-breaking logic: within each group, ensure unique positions
    const uniqueRankings = applyTieBreaking(sortedRankings);

    console.log(`[RankingExtractor] After tie-breaking: ${uniqueRankings.length} rankings`);

    return uniqueRankings;
  } catch (error) {
    console.error('[RankingExtractor] LLM extraction failed:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

export function detectHeuristicRankings(text: string): { items: Array<{ item: string; position: number }>; confidence: number; count: number } {
  const rankings: Array<{ item: string; position: number }> = [];

  const numberedListRegex = /(\d+)\.\s*([^\n\r]+)/g;
  let match;
  
  while ((match = numberedListRegex.exec(text)) !== null) {
    const position = parseInt(match[1]);
    const item = match[2].trim();
    
    if (position > 0 && position <= 20 && item.length > 2) {
      rankings.push({ item, position });
    }
  }

  const parenListRegex = /(\d+)\)\s*([^\n\r]+)/g;
  
  while ((match = parenListRegex.exec(text)) !== null) {
    const position = parseInt(match[1]);
    const item = match[2].trim();
    
    if (position > 0 && position <= 20 && item.length > 2) {
      rankings.push({ item, position });
    }
  }

  const bulletRegex = /^[-*•]\s*([^\n\r]+)/gm;
  let bulletPosition = 1;
  
  while ((match = bulletRegex.exec(text)) !== null) {
    const item = match[1].trim();
    if (item.length > 2) {
      rankings.push({ item, position: bulletPosition++ });
    }
  }

  const uniqueRankings = Array.from(
    new Map(rankings.map(r => [`${r.position}-${r.item}`, r])).values()
  );

  const confidence = uniqueRankings.length >= 3 ? 0.85 : 
                     uniqueRankings.length >= 2 ? 0.7 :
                     uniqueRankings.length >= 1 ? 0.5 : 0;

  return {
    items: uniqueRankings.sort((a, b) => a.position - b.position),
    confidence,
    count: uniqueRankings.length,
  };
}
