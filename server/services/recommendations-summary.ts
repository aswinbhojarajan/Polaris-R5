import { db } from '../db';
import { recommendations } from '@shared/schema';
import { sql, and, eq, ilike, desc, asc } from 'drizzle-orm';
import { mapToHighLevelCategory, type HighLevelCategory } from '../config/category-mapping';

export interface SummaryOptions {
  page: number;
  pageSize: number;
  sortBy: 'title' | 'category' | 'severity' | 'createdAt' | 'source';
  sortDir: 'asc' | 'desc';
  search?: string;
  category?: string;
  highLevelCategory?: string;
  severity?: string;
  source?: string;
  promptRunId?: string;
}

export interface RecommendationSummary {
  id: string;
  title: string;
  category: string;
  highLevelCategory: string;
  subCategory: string;
  severity: string;
  source: string;
  duplicateCount: number;
  promptRunId: string | null;
  createdAt: string;
  examplesCount: number;
}

export interface SummaryResponse {
  items: RecommendationSummary[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    search?: string;
    category?: string;
    severity?: string;
    source?: string;
  };
}

// Priority rank for severity (used in deduplication winner selection)
const SEVERITY_RANK = {
  high: 3,
  medium: 2,
  low: 1
} as const;

export async function getRecommendationsSummary(
  clientId: string,
  options: SummaryOptions
): Promise<SummaryResponse> {
  const { page, pageSize, sortBy, sortDir, search, category, highLevelCategory, severity, source, promptRunId } = options;
  
  // Build WHERE conditions for filtering
  const whereConditions = [eq(recommendations.clientId, clientId)];
  
  // Filter by promptRunId if provided
  if (promptRunId !== undefined) {
    if (promptRunId === 'historical') {
      whereConditions.push(sql`${recommendations.promptRunId} IS NULL`);
    } else if (promptRunId) {
      whereConditions.push(eq(recommendations.promptRunId, promptRunId));
    }
  }
  
  if (search) {
    whereConditions.push(
      sql`(LOWER(${recommendations.title}) LIKE ${`%${search.toLowerCase()}%`} OR LOWER(${recommendations.description}) LIKE ${`%${search.toLowerCase()}%`})`
    );
  }
  
  if (category) {
    whereConditions.push(eq(recommendations.category, category));
  }
  
  // FIX: Apply high-level category filter BEFORE pagination
  // Map high-level category to its sub-categories and filter in WHERE clause
  if (highLevelCategory) {
    const { getSubCategories } = await import('../config/category-mapping');
    const subCategories = getSubCategories(highLevelCategory as any);
    
    if (subCategories.length > 0) {
      // Create OR condition for all sub-categories
      const categoryConditions = subCategories.map(subCat => 
        sql`${recommendations.category} = ${subCat}`
      );
      whereConditions.push(sql`(${sql.join(categoryConditions, sql` OR `)})`);
    }
  }
  
  if (severity) {
    whereConditions.push(eq(recommendations.severity, severity));
  }
  
  if (source) {
    whereConditions.push(sql`${recommendations.source} = ${source}`);
  }

  // Deduplication logic using CTE with ROW_NUMBER()
  // Dedupe key: LOWER(TRIM(title)) + '|' + LOWER(TRIM(category))
  // Winner selection: highest severity → latest updatedAt → smallest id
  const deduplicatedQuery = db.$with('deduplicated').as(
    db.select({
      id: recommendations.id,
      title: recommendations.title,
      category: recommendations.category,
      severity: recommendations.severity,
      source: recommendations.source,
      promptRunId: recommendations.promptRunId,
      createdAt: recommendations.createdAt,
      updatedAt: recommendations.updatedAt,
      examples: recommendations.examples,
      dedupeKey: sql<string>`LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))`.as('dedupe_key'),
      severityRank: sql<number>`CASE 
        WHEN ${recommendations.severity} = 'high' THEN 3
        WHEN ${recommendations.severity} = 'medium' THEN 2
        ELSE 1
      END`.as('severity_rank'),
      rowNum: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))
        ORDER BY 
          CASE 
            WHEN ${recommendations.severity} = 'high' THEN 3
            WHEN ${recommendations.severity} = 'medium' THEN 2
            ELSE 1
          END DESC,
          ${recommendations.updatedAt} DESC,
          ${recommendations.id} ASC
      )`.as('row_num')
    })
    .from(recommendations)
    .where(and(...whereConditions))
  );

  // Count duplicates for each dedupe key
  const duplicateCountsQuery = db.$with('duplicate_counts').as(
    db.select({
      dedupeKey: sql<string>`LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))`.as('dedupe_key'),
      count: sql<number>`COUNT(*)`.as('count')
    })
    .from(recommendations)
    .where(and(...whereConditions))
    .groupBy(sql`LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))`)
  );

  // Get winners only (row_num = 1)
  const winnersQuery = db
    .with(deduplicatedQuery, duplicateCountsQuery)
    .select({
      id: deduplicatedQuery.id,
      title: deduplicatedQuery.title,
      category: deduplicatedQuery.category,
      severity: deduplicatedQuery.severity,
      source: deduplicatedQuery.source,
      promptRunId: deduplicatedQuery.promptRunId,
      createdAt: deduplicatedQuery.createdAt,
      updatedAt: deduplicatedQuery.updatedAt,
      examples: deduplicatedQuery.examples,
      duplicateCount: duplicateCountsQuery.count
    })
    .from(deduplicatedQuery)
    .leftJoin(
      duplicateCountsQuery,
      sql`deduplicated.dedupe_key = duplicate_counts.dedupe_key`
    )
    .where(sql`${deduplicatedQuery.rowNum} = 1`);

  // Apply sorting
  let sortedQuery;
  if (sortBy === 'severity') {
    // Use severity rank (high=3, medium=2, low=1) for correct ordering
    const severityRank = sql<number>`CASE 
      WHEN ${deduplicatedQuery.severity} = 'high' THEN 3
      WHEN ${deduplicatedQuery.severity} = 'medium' THEN 2
      ELSE 1
    END`;
    sortedQuery = sortDir === 'asc' 
      ? winnersQuery.orderBy(asc(severityRank))
      : winnersQuery.orderBy(desc(severityRank));
  } else {
    const sortColumn = {
      title: deduplicatedQuery.title,
      category: deduplicatedQuery.category,
      createdAt: deduplicatedQuery.createdAt,
      source: deduplicatedQuery.source
    }[sortBy];
    sortedQuery = sortDir === 'asc' 
      ? winnersQuery.orderBy(asc(sortColumn))
      : winnersQuery.orderBy(desc(sortColumn));
  }

  // Get total count (before pagination)
  const totalResults = await sortedQuery;
  const total = totalResults.length;

  // Apply pagination
  const offset = (page - 1) * pageSize;
  const paginatedResults = totalResults.slice(offset, offset + pageSize);

  // Transform to summary format with high-level category mapping
  const items: RecommendationSummary[] = paginatedResults.map(row => {
    // Count examples if they exist
    const examplesArray = Array.isArray(row.examples) ? row.examples : [];
    const examplesCount = examplesArray.length;

    // Map to high-level category
    const categoryMapping = mapToHighLevelCategory(row.category);

    return {
      id: row.id,
      title: row.title,
      category: row.category,
      highLevelCategory: categoryMapping.highLevelCategory,
      subCategory: categoryMapping.subCategory,
      severity: row.severity,
      source: row.source,
      duplicateCount: Number(row.duplicateCount) || 1,
      promptRunId: row.promptRunId,
      createdAt: row.createdAt.toISOString(),
      examplesCount
    };
  });

  // FIX: No need for post-query filtering - already filtered in WHERE clause!
  // The high-level category filter is now applied before pagination (lines 76-87)

  return {
    items,
    total, // Now correctly reflects the filtered count
    page,
    pageSize,
    filters: {
      search,
      category,
      severity,
      source
    }
  };
}

/**
 * Get category statistics for dashboard tiles
 * Uses deduplication to match the summary table counts
 */
export async function getCategoryStats(clientId: string, promptRunId?: string) {
  // Build WHERE conditions for filtering
  const whereConditions = [eq(recommendations.clientId, clientId)];
  
  // Filter by promptRunId if provided
  if (promptRunId !== undefined) {
    if (promptRunId === 'historical') {
      whereConditions.push(sql`${recommendations.promptRunId} IS NULL`);
    } else if (promptRunId) {
      whereConditions.push(eq(recommendations.promptRunId, promptRunId));
    }
  }
  
  // Deduplicate recommendations using the same logic as summary table
  // Dedupe key: LOWER(TRIM(title)) + '|' + LOWER(TRIM(category))
  // Winner: highest severity → latest updatedAt → smallest id
  const deduplicatedQuery = db.$with('deduplicated').as(
    db.select({
      category: recommendations.category,
      severity: recommendations.severity,
      dedupeKey: sql<string>`LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))`.as('dedupe_key'),
      rowNum: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(${recommendations.title})) || '|' || LOWER(TRIM(${recommendations.category}))
        ORDER BY 
          CASE 
            WHEN ${recommendations.severity} = 'high' THEN 3
            WHEN ${recommendations.severity} = 'medium' THEN 2
            ELSE 1
          END DESC,
          ${recommendations.updatedAt} DESC,
          ${recommendations.id} ASC
      )`.as('row_num')
    })
    .from(recommendations)
    .where(and(...whereConditions))
  );

  // Get only winners (row_num = 1)
  const uniqueRecommendations = await db
    .with(deduplicatedQuery)
    .select({
      category: deduplicatedQuery.category,
      severity: deduplicatedQuery.severity
    })
    .from(deduplicatedQuery)
    .where(sql`${deduplicatedQuery.rowNum} = 1`);

  // Group by high-level category and count by severity
  const stats = new Map<string, { total: number; high: number; medium: number; low: number }>();

  for (const rec of uniqueRecommendations) {
    const { highLevelCategory } = mapToHighLevelCategory(rec.category);
    
    if (!stats.has(highLevelCategory)) {
      stats.set(highLevelCategory, { total: 0, high: 0, medium: 0, low: 0 });
    }

    const categoryStats = stats.get(highLevelCategory)!;
    categoryStats.total++;

    if (rec.severity === 'high') categoryStats.high++;
    else if (rec.severity === 'medium') categoryStats.medium++;
    else if (rec.severity === 'low') categoryStats.low++;
  }

  return Array.from(stats.entries()).map(([category, counts]) => ({
    category,
    ...counts
  }));
}

// Default options
export const SUMMARY_DEFAULTS: Partial<SummaryOptions> = {
  page: 1,
  pageSize: 20,
  sortBy: 'severity',
  sortDir: 'desc'
};
