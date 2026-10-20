/**
 * Category Mapping Configuration
 * Maps detailed sub-categories to high-level user-friendly categories
 */

export const HIGH_LEVEL_CATEGORIES = [
  'AI Crawling',
  'Content Availability',
  'Content Eligibility',
  'Content Relevance',
  'Content Visibility'
] as const;

export type HighLevelCategory = typeof HIGH_LEVEL_CATEGORIES[number];

export interface CategoryMapping {
  highLevelCategory: HighLevelCategory;
  subCategory: string;
}

/**
 * Maps sub-categories to their high-level category
 */
const CATEGORY_MAP: Record<string, HighLevelCategory> = {
  // AI Crawling - Technical accessibility and structure
  'structure': 'AI Crawling',
  'crawlability': 'AI Crawling',
  'Crawlability': 'AI Crawling',
  'technical': 'AI Crawling',
  'navigation': 'AI Crawling',
  
  // Content Availability - What content exists
  'content gaps': 'Content Availability',
  'missing content': 'Content Availability',
  'content coverage': 'Content Availability',
  
  // Content Eligibility - Quality standards for AI
  'Content Accessibility': 'Content Eligibility',
  'LLM Readiness': 'Content Eligibility',
  'content quality': 'Content Eligibility',
  'readability': 'Content Eligibility',
  
  // Content Relevance - Topic and keyword alignment
  'content': 'Content Relevance',
  'seo': 'Content Relevance',
  'keywords': 'Content Relevance',
  'topics': 'Content Relevance',
  'relevance': 'Content Relevance',
  'brand': 'Content Relevance',
  
  // Content Visibility - AI model awareness
  'prompt analysis': 'Content Visibility',
  'Prompt Response Analysis': 'Content Visibility',
  'AI visibility': 'Content Visibility',
  'mentions': 'Content Visibility',
  'citations': 'Content Visibility'
};

/**
 * Maps a sub-category to its high-level category
 * Returns a default category if no mapping exists
 */
export function mapToHighLevelCategory(subCategory: string): CategoryMapping {
  const highLevelCategory = CATEGORY_MAP[subCategory] || 'Content Relevance';
  
  return {
    highLevelCategory,
    subCategory
  };
}

/**
 * Get all unique high-level categories
 */
export function getHighLevelCategories(): HighLevelCategory[] {
  return [...HIGH_LEVEL_CATEGORIES];
}

/**
 * Get sub-categories for a specific high-level category
 */
export function getSubCategories(highLevelCategory: HighLevelCategory): string[] {
  return Object.entries(CATEGORY_MAP)
    .filter(([_, hlc]) => hlc === highLevelCategory)
    .map(([subCat, _]) => subCat);
}
