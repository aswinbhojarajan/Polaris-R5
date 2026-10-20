import { AEO_MODE } from '../config/aeo';

export interface Ranking {
  item: string;
  position: number;
  rankingGroup?: string;
  groupRelevance?: 'relevant' | 'partial' | 'irrelevant';
  relevanceReason?: string;
}

export function parseRankings(rawResponse: string): Ranking[] {
  return parseRankingsHeuristic(rawResponse);
}

export async function parseRankingsAsync(
  rawResponse: string,
  brandName: string,
  aliases: string[] = [],
  promptText: string = ''
): Promise<Ranking[]> {
  if (AEO_MODE === 'llm' || AEO_MODE === 'hybrid') {
    return parseRankingsWithLLM(rawResponse, brandName, aliases, promptText);
  }
  
  return parseRankingsHeuristic(rawResponse);
}

/**
 * Extract the core heading from a ranked item, removing descriptive examples.
 * e.g., "Coconut water (packaged): Tender Coconut Water, Paper Boat" → "Coconut water (packaged)"
 * This prevents embedded brand mentions from being treated as rankings.
 */
function extractRankingHeading(fullItem: string): string {
  let heading = fullItem;
  
  // Truncate at colon followed by content (indicates examples list)
  // But preserve colons that are part of times like "10:30 AM"
  const colonMatch = heading.match(/^([^:]+):\s*[A-Z*]/);
  if (colonMatch) {
    heading = colonMatch[1].trim();
  }
  
  // Truncate at em-dash or en-dash followed by description
  // e.g., "Sprite — lemon-lime flavored" → "Sprite"
  const dashMatch = heading.match(/^([^—–]+)[—–]\s+/);
  if (dashMatch) {
    heading = dashMatch[1].trim();
  }
  
  // Remove markdown bold markers
  heading = heading.replace(/\*\*/g, '');
  
  // Remove trailing punctuation
  heading = heading.replace(/[,:;]+$/, '').trim();
  
  return heading;
}

function parseRankingsHeuristic(rawResponse: string): Ranking[] {
  const rankings: Ranking[] = [];

  // Pattern 1: Numbered lists (e.g., "1. Emirates", "### 1. Qatar")
  // Matches at start of line, with optional markdown headers (###)
  // This filters out "19.5 inches" and "2024." false positives
  const numberedListRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(\d+)\.\s+([^\n\r]+)/gm;
  let match;
  
  while ((match = numberedListRegex.exec(rawResponse)) !== null) {
    const position = parseInt(match[1]);
    const fullItem = match[2].trim();
    const item = extractRankingHeading(fullItem);
    
    // Filter: Only accept positions 1-20 (realistic ranking range)
    // Minimum item length of 3 characters to avoid false positives
    if (position > 0 && position <= 20 && item.length >= 3) {
      rankings.push({ item, position });
    }
  }

  // Pattern 2: Parenthesis lists (e.g., "1) Emirates")
  const parenListRegex = /(?:^|\n)\s*(\d+)\)\s+([^\n\r]+)/g;
  
  while ((match = parenListRegex.exec(rawResponse)) !== null) {
    const position = parseInt(match[1]);
    const fullItem = match[2].trim();
    const item = extractRankingHeading(fullItem);
    
    if (position > 0 && position <= 20 && item.length > 2) {
      rankings.push({ item, position });
    }
  }

  // Pattern 3: Bullet lists (no position filtering needed)
  const bulletRegex = /^[-*•]\s*([^\n\r]+)/gm;
  let bulletPosition = 1;
  
  while ((match = bulletRegex.exec(rawResponse)) !== null) {
    const fullItem = match[1].trim();
    const item = extractRankingHeading(fullItem);
    if (item.length > 2) {
      rankings.push({ item, position: bulletPosition++ });
    }
  }

  // Pattern 4: Comparative statements (always position 1)
  const comparativeRegex = /\b(?:top|best|leading|first|#1|number one)\s+([^.!?]+)/gi;
  
  while ((match = comparativeRegex.exec(rawResponse)) !== null) {
    const fullItem = match[1].trim();
    const item = extractRankingHeading(fullItem);
    if (item.length > 2) {
      rankings.push({ item, position: 1 });
    }
  }

  // Remove duplicates
  const uniqueRankings = rankings.filter((ranking, index, self) => 
    self.findIndex(r => r.item === ranking.item && r.position === ranking.position) === index
  );

  // Sort by position (ascending)
  return uniqueRankings.sort((a, b) => a.position - b.position);
}

async function parseRankingsWithLLM(
  rawResponse: string,
  brandName: string,
  aliases: string[],
  promptText: string = ''
): Promise<Ranking[]> {
  const { extractRankings } = await import('./rankingExtractor.llm.js');
  
  console.log(`[RankingParser] Using context-aware LLM ranking detection`);
  
  try {
    const brandRecord = {
      id: brandName.toLowerCase().replace(/\s+/g, '-'),
      name: brandName,
      aliases,
    };
    
    const doc = { text: rawResponse };
    
    const rankingItems = await extractRankings(doc, brandRecord, promptText);
    
    console.log(`[RankingParser] LLM detected ${rankingItems.length} rankings`);
    
    return rankingItems.map(r => ({
      item: r.item,
      position: r.position,
      rankingGroup: r.rankingGroup,
      groupRelevance: r.groupRelevance,
      relevanceReason: r.relevanceReason,
    }));
  } catch (error) {
    console.error('[RankingParser] LLM extraction failed:', error);
    console.warn('[RankingParser] Returning empty array - no fallback to heuristics');
    return [];
  }
}
