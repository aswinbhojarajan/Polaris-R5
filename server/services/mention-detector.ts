import { AEO_MODE } from '../config/aeo';
import type { BrandRecord, DocumentInput, EntityMention } from '../types/aeo';
import { extractMentionsLLM } from './mentionExtractor.llm';

/**
 * Comprehensive Unicode normalization for brand/alias matching.
 * Handles ALL common Unicode variations:
 * - Diacritics: "Espolòn" → "Espolon", "José" → "Jose", "Martínez" → "Martinez"
 * - Full-width chars: "Ａｐｐｌｅ" → "Apple"
 * - Ligatures: "ﬁnd" → "find", "œuvre" → "oeuvre"
 * - Various hyphens: en-dash, em-dash, minus → regular hyphen
 * - Various apostrophes: curly quotes → straight quote
 * - Various spaces: non-breaking, thin, em → regular space
 * - Trademark symbols: strips ™, ®, ©
 * 
 * Uses NFKD (Compatibility Decomposition) which is more comprehensive than NFD.
 */
export function normalizeBrandToken(str: string): string {
  return str
    // NFKD handles: accents, full-width chars, ligatures, compatibility chars
    .normalize('NFKD')
    // Strip combining diacritical marks (accents)
    .replace(/[\u0300-\u036f]/g, '')
    // Normalize all types of hyphens/dashes to regular hyphen
    .replace(/[–—‑−‐]/g, '-')
    // Normalize all types of apostrophes/quotes to straight quote
    .replace(/[''′ʼ`]/g, "'")
    // Normalize all types of spaces to regular space
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    // Strip trademark/registered/copyright symbols
    .replace(/[™®©]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple diacritics normalization (legacy compatibility).
 * For new code, prefer normalizeBrandToken() which is more comprehensive.
 */
export function normalizeDiacritics(str: string): string {
  return normalizeBrandToken(str);
}

export interface Mention {
  span: string;
  isAlias: boolean;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export function detectMentions(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Mention[] {
  return detectMentionsHeuristic(rawResponse, brandName, aliases);
}

export interface MentionDetectionResult {
  mentions: Mention[];
  entityMentions?: EntityMention[]; // LLM mode returns this for ABSA sentiment analysis
}

export async function detectMentionsAsync(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Promise<MentionDetectionResult> {
  if (AEO_MODE === 'llm' || AEO_MODE === 'hybrid') {
    if (process.env.DEBUG_AEO) {
      console.log(`[MentionDetector] Using LLM mode (AEO_MODE=${AEO_MODE})`);
    }
    return detectMentionsWithLLM(rawResponse, brandName, aliases);
  }

  if (process.env.DEBUG_AEO) {
    console.log(`[MentionDetector] Using heuristic mode (AEO_MODE=${AEO_MODE})`);
  }
  return {
    mentions: detectMentionsHeuristic(rawResponse, brandName, aliases),
  };
}

function detectMentionsHeuristic(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Mention[] {
  const mentions: Mention[] = [];
  
  // Auto-generate spacing variations for the brand name
  const autoVariations = generateSpacingVariations(brandName);
  const allBrandTerms = [brandName, ...aliases, ...autoVariations];

  // Normalize diacritics in raw response for matching (e.g., "Espolòn" → "Espolon")
  const normalizedResponse = normalizeDiacritics(rawResponse);

  for (const term of allBrandTerms) {
    // Normalize term for matching too
    const normalizedTerm = normalizeDiacritics(term);
    const regex = new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`, 'gi');
    let match;

    while ((match = regex.exec(normalizedResponse)) !== null) {
      // Get the original span from the raw response at the same position
      const span = rawResponse.slice(match.index, match.index + match[0].length);
      const isAlias = term !== brandName;
      
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(rawResponse.length, match.index + span.length + 50);
      const context = rawResponse.slice(contextStart, contextEnd);
      
      const sentiment = analyzeSentiment(context, span);

      mentions.push({
        span,
        isAlias,
        sentiment
      });
    }
  }

  return mentions;
}

async function detectMentionsWithLLM(
  rawResponse: string,
  brandName: string,
  aliases: string[]
): Promise<MentionDetectionResult> {
  // Auto-generate spacing variations for the brand name
  const autoVariations = generateSpacingVariations(brandName);
  const allAliases = [...aliases, ...autoVariations];
  
  const brandRecord: BrandRecord = {
    id: brandName.toLowerCase().replace(/\s+/g, '-'),
    name: brandName,
    aliases: allAliases,
  };

  const doc: DocumentInput = {
    text: rawResponse,
  };

  try {
    const llmMentions = await extractMentionsLLM(doc, [brandRecord]);
    
    // CRITICAL: Deterministic post-filtering to prevent LLM hallucinations
    // Only retain mentions that actually match the brand name or configured aliases
    const validatedMentions = filterValidMentions(llmMentions, brandName, allAliases, rawResponse);
    
    if (validatedMentions.length < llmMentions.length) {
      const droppedCount = llmMentions.length - validatedMentions.length;
      console.log(`[MentionDetector] Filtered out ${droppedCount} invalid mention(s) that didn't match brand/aliases`);
    }
    
    const mentions = validatedMentions.map((mention: EntityMention) => ({
      span: mention.span,
      isAlias: mention.surfaceType === 'alias',
      sentiment: 'neutral' as const,
    }));

    // Return both mentions and entityMentions for ABSA sentiment analysis
    return {
      mentions,
      entityMentions: validatedMentions,
    };
  } catch (error) {
    console.error('[MentionDetector] LLM extraction failed, falling back to heuristic:', error);
    return {
      mentions: detectMentionsHeuristic(rawResponse, brandName, aliases),
    };
  }
}

/**
 * Normalize all types of hyphens/dashes to regular hyphen for consistent matching.
 * Covers: en-dash (–), em-dash (—), non-breaking hyphen (‑), minus sign (−)
 */
function normalizeHyphens(str: string): string {
  return str.replace(/[–—‑−]/g, '-');
}

/**
 * Normalize all types of apostrophes/quotes to straight ASCII apostrophe.
 * Covers: right single quote ('), left single quote ('), prime (′), modifier letter apostrophe (ʼ)
 */
function normalizeApostrophes(str: string): string {
  return str.replace(/[''′ʼ`]/g, "'");
}

/**
 * Strip leading/trailing punctuation, markdown formatting, list numbers, and possessive suffixes.
 * Handles: apostrophe-s ('s, 's), commas, periods, colons, semicolons, markdown headers, numbered lists, etc.
 */
function stripTrailingPunctuation(str: string): string {
  // First normalize apostrophes to straight ASCII
  let normalized = normalizeApostrophes(str);
  // Remove possessive suffix ('s)
  normalized = normalized.replace(/'s$/i, '');
  // Remove any trailing punctuation: . , : ; ! ? ) ] } " '
  normalized = normalized.replace(/[.,;:!?\)\]\}"']+$/, '');
  // Remove any leading punctuation: ( [ { " ' #
  normalized = normalized.replace(/^[(\[{"'#]+/, '');
  // Remove leading markdown header markers (### or ##)
  normalized = normalized.replace(/^#+\s*/, '');
  // Remove leading list numbers/bullets (1. 2. a. b. - * etc.)
  normalized = normalized.replace(/^[\d]+\.\s*/, '');
  normalized = normalized.replace(/^[a-z]\.\s*/i, '');
  normalized = normalized.replace(/^[-*•]\s*/, '');
  return normalized.trim();
}

/**
 * Deterministic filter to validate LLM-detected mentions against actual brand name and aliases.
 * Prevents the LLM from incorrectly including competitor brands or unrelated entities.
 * 
 * CRITICAL: Also verifies that each mention span ACTUALLY EXISTS in the raw response text
 * to prevent LLM hallucinations of configured aliases that don't appear in the response.
 */
function filterValidMentions(
  mentions: EntityMention[],
  brandName: string,
  aliases: string[],
  rawResponse: string
): EntityMention[] {
  // Build set of valid terms (case-insensitive, hyphen-normalized, diacritic-normalized)
  const validTerms = new Set<string>();
  const normalizedBrand = normalizeDiacritics(normalizeHyphens(brandName.toLowerCase().trim()));
  validTerms.add(normalizedBrand);
  for (const alias of aliases) {
    validTerms.add(normalizeDiacritics(normalizeHyphens(alias.toLowerCase().trim())));
  }
  
  // Also build array for substring checks
  const validTermsArray = Array.from(validTerms);
  
  // Normalize raw response for text existence checks (including diacritics)
  const normalizedRawResponse = normalizeDiacritics(normalizeHyphens(normalizeApostrophes(rawResponse.toLowerCase())));
  
  return mentions.filter(mention => {
    // Normalize the span: lowercase, trim, normalize hyphens, diacritics, strip punctuation
    let normalizedSpan = normalizeDiacritics(normalizeHyphens(mention.span.toLowerCase().trim()));
    normalizedSpan = stripTrailingPunctuation(normalizedSpan);
    
    // CRITICAL ANTI-HALLUCINATION CHECK: Verify span actually exists in raw response
    // This prevents LLM from returning configured aliases that don't appear in the text
    if (!normalizedRawResponse.includes(normalizedSpan)) {
      console.log(`[MentionDetector] HALLUCINATION: "${mention.span}" does not exist in raw response text, dropping`);
      return false;
    }
    
    // First check: exact match after normalization
    if (validTerms.has(normalizedSpan)) {
      return true;
    }
    
    // Second check: the normalized span contains a valid term as a token
    // This handles cases like "Ajio India" where LLM extracts more context
    for (const term of validTermsArray) {
      // Check if span exactly starts with the term followed by space/end
      if (normalizedSpan === term || 
          normalizedSpan.startsWith(term + ' ') ||
          normalizedSpan.endsWith(' ' + term) ||
          normalizedSpan.includes(' ' + term + ' ')) {
        return true;
      }
    }
    
    // Third check: a valid term contains the normalized span (for abbreviations)
    // But only if span is at least 3 chars to avoid false positives
    if (normalizedSpan.length >= 3) {
      for (const term of validTermsArray) {
        if (term.includes(normalizedSpan) || normalizedSpan.includes(term)) {
          return true;
        }
      }
    }
    
    console.log(`[MentionDetector] Dropping invalid mention "${mention.span}" (normalized: "${normalizedSpan}") - does not match brand "${brandName}" or aliases [${aliases.join(', ')}]`);
    
    return false;
  });
}

function analyzeSentiment(context: string, mention: string): 'positive' | 'neutral' | 'negative' {
  const lowerContext = context.toLowerCase();
  
  const positiveTerms = [
    'excellent', 'outstanding', 'best', 'top', 'leading', 'innovative',
    'superior', 'remarkable', 'impressive', 'successful', 'popular',
    'recommended', 'preferred', 'award', 'winner', 'great', 'good'
  ];
  
  const negativeTerms = [
    'poor', 'bad', 'worst', 'terrible', 'awful', 'failed', 'failing',
    'disappointing', 'problematic', 'issues', 'concerns', 'criticized',
    'controversy', 'scandal', 'lawsuit', 'decline', 'struggling'
  ];

  const positiveCount = positiveTerms.filter(term => lowerContext.includes(term)).length;
  const negativeCount = negativeTerms.filter(term => lowerContext.includes(term)).length;

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function generateSpacingVariations(brandName: string): string[] {
  const variations: string[] = [];
  const words = brandName.split(/\s+/);
  
  // For each word in the brand name, generate spacing variations
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordVariations: string[] = [];
    
    // Pattern 1: CamelCase spacing (AlRajhi → Al Rajhi)
    const camelSpaced = word.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (camelSpaced !== word) {
      wordVariations.push(camelSpaced);
    }
    
    // Pattern 2: Common 2-letter prefix split for capitalized words >5 chars
    // Handles: "Alrajhi" → "Al rajhi", "McDonalds" → "Mc Donalds"
    if (word.length > 5 && /^[A-Z]/.test(word)) {
      const twoCharVariation = word.slice(0, 2) + ' ' + word.slice(2);
      wordVariations.push(twoCharVariation);
      
      // Also add with proper casing: "Al rajhi" and "Al Rajhi"  
      const lowerRest = word.slice(0, 2) + ' ' + word.slice(2).toLowerCase();
      wordVariations.push(lowerRest);
      
      const capitalizeRest = word.slice(0, 2) + ' ' + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
      wordVariations.push(capitalizeRest);
    }
    
    // Rebuild full brand name with word variations
    if (wordVariations.length > 0) {
      for (const wordVar of wordVariations) {
        const otherWords = [...words.slice(0, i), wordVar, ...words.slice(i + 1)];
        const fullVariation = otherWords.join(' ');
        if (fullVariation !== brandName) {
          variations.push(fullVariation);
        }
      }
    }
  }
  
  // Remove duplicates
  return Array.from(new Set(variations));
}
