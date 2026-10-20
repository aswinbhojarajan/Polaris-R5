export interface TopicMatch {
  topic: string;
  score: number;
  matches: number;
}

/**
 * Map content to focus areas/topics with relevance scoring
 */
export function mapTopics(text: string, focusAreas: string[]): TopicMatch[] {
  if (!text || !focusAreas || focusAreas.length === 0) {
    return [];
  }

  const topics: TopicMatch[] = [];
  const textLower = text.toLowerCase();
  const words = textLower.split(/\s+/);
  const totalWords = words.length;

  for (const focusArea of focusAreas) {
    const focusAreaLower = focusArea.toLowerCase();
    const keywords = extractKeywords(focusAreaLower);
    
    let matchCount = 0;
    let totalScore = 0;

    // Count exact phrase matches (higher weight)
    const phraseMatches = countOccurrences(textLower, focusAreaLower);
    matchCount += phraseMatches;
    totalScore += phraseMatches * 10; // Exact phrase worth 10 points

    // Count individual keyword matches
    for (const keyword of keywords) {
      const keywordMatches = countOccurrences(textLower, keyword);
      matchCount += keywordMatches;
      totalScore += keywordMatches * 2; // Each keyword worth 2 points
    }

    // Calculate relevance score (0-100)
    // Factor in both match frequency and text length
    let score = 0;
    if (matchCount > 0) {
      // Base score from total points
      const baseScore = Math.min(totalScore * 2, 80);
      
      // Density bonus (how concentrated the matches are)
      const density = (matchCount / totalWords) * 100;
      const densityBonus = Math.min(density * 20, 20);
      
      score = Math.min(Math.round(baseScore + densityBonus), 100);
    }

    if (score > 0) {
      topics.push({
        topic: focusArea,
        score,
        matches: matchCount
      });
    }
  }

  // Sort by score descending
  topics.sort((a, b) => b.score - a.score);

  return topics.slice(0, 20); // Return top 20 topics
}

/**
 * Extract keywords from a topic/focus area
 */
function extractKeywords(topic: string): string[] {
  const keywords: string[] = [];
  
  // Remove common words
  const stopWords = new Set([
    'a', 'an', 'and', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
  ]);

  // Split into words
  const words = topic.split(/[\s\-_,;]+/);
  
  for (const word of words) {
    const cleanWord = word.trim().toLowerCase();
    if (cleanWord.length > 2 && !stopWords.has(cleanWord)) {
      keywords.push(cleanWord);
    }
  }

  return keywords;
}

/**
 * Count occurrences of a substring in text (case-insensitive)
 */
function countOccurrences(text: string, substring: string): number {
  if (!substring || substring.length === 0) {
    return 0;
  }

  const regex = new RegExp(escapeRegex(substring), 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Score content against a list of topics and return matches above threshold
 */
export function scoreTopics(
  text: string,
  topics: string[],
  minScore: number = 10
): TopicMatch[] {
  const matches = mapTopics(text, topics);
  return matches.filter(m => m.score >= minScore);
}

/**
 * Combine topic matches from multiple sources
 */
export function combineTopicMatches(
  ...matchSets: TopicMatch[][]
): TopicMatch[] {
  const combined = new Map<string, TopicMatch>();

  for (const matches of matchSets) {
    for (const match of matches) {
      const existing = combined.get(match.topic);
      if (existing) {
        // Average the scores and sum the matches
        existing.score = Math.round((existing.score + match.score) / 2);
        existing.matches += match.matches;
      } else {
        combined.set(match.topic, { ...match });
      }
    }
  }

  const result = Array.from(combined.values());
  result.sort((a, b) => b.score - a.score);
  
  return result;
}
