/**
 * CSV Export Service
 * Converts snapshot data into CSV format for Excel/analysis
 */

import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { SnapshotData } from './report-snapshot';

interface CSVRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ClientInfo {
  id: string;
  name: string;
  industry: string | null;
  geography: string | null;
  website: string | null;
  urls: any | null;
  focusAreas: any | null;
  aliases: any | null;
  brandAliases: any | null;
  selectedAiModelIds: any | null;
  onboardingStatus: string | null;
}

export interface CompetitorInfo {
  id: string;
  name: string;
  clientId: string;
  website: string | null;
  aliases: any | null;
}

export interface NarrativeSectionInfo {
  sectionName: string;
  sectionContent: string;
  sectionOrder: number;
  createdAt: string;
}

/**
 * Escape CSV field values to handle commas, quotes, newlines, arrays, and objects
 */
function escapeCsvField(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  let strValue: string;
  
  // Handle arrays and objects by JSON stringifying them
  if (Array.isArray(value)) {
    // For simple arrays of primitives, join with semicolon for readability
    if (value.length === 0) {
      strValue = '';
    } else if (value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      strValue = value.join('; ');
    } else {
      // For complex arrays (arrays of objects, nested arrays), use JSON
      strValue = JSON.stringify(value);
    }
  } else if (typeof value === 'object' && value !== null) {
    // For objects, always use JSON representation
    strValue = JSON.stringify(value);
  } else {
    // For primitives (string, number, boolean)
    strValue = String(value);
  }
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  
  return strValue;
}

/**
 * Convert array of objects to CSV string with explicit headers
 */
function arrayToCSV(rows: CSVRow[], headers: string[]): string {
  // Always emit header row, even if no data
  const csvLines = [headers.join(',')];
  
  // Add data rows if any exist
  if (rows.length > 0) {
    rows.forEach(row => {
      csvLines.push(
        headers.map(header => escapeCsvField(row[header])).join(',')
      );
    });
  }
  
  return csvLines.join('\n');
}

/**
 * Generate per-prompt competitor scores CSV (configured competitors only)
 * NOTE: Scores are per-prompt (aggregated across all models), not per-model
 */
function generatePromptCompetitorScoresCSV(
  snapshot: SnapshotData,
  competitors: CompetitorInfo[]
): string {
  const rows: CSVRow[] = [];
  
  // Create lookup maps
  const promptMap = new Map(snapshot.prompts.map(p => [p.id, p]));
  
  // Process competitor scores (these are per-prompt, aggregated across models)
  let discoveredWithScoresCount = 0;
  
  for (const score of snapshot.competitorScores) {
    // FIX 1: Use isClient flag from database instead of comparing names
    const isConfigured = score.competitorId !== null;
    const isClient = Boolean(score.isClient);
    
    if (!isConfigured && !isClient) {
      // VALIDATION: Discovered competitors should not have scores in the database
      if (score.visibilityScore || score.sentimentScore || score.positionScore) {
        discoveredWithScoresCount++;
        console.warn(`⚠️  Data integrity warning: Discovered competitor "${score.competitorName}" has scores but no competitorId`);
      }
      continue; // Skip discovered competitors
    }
    
    const prompt = score.promptId ? promptMap.get(score.promptId) : null;
    
    rows.push({
      prompt_id: score.promptId || '',
      prompt_text: prompt?.text || '',
      prompt_source: prompt?.source || '',
      competitor_id: score.competitorId || '',
      competitor_name: score.competitorName,
      competitor_type: isClient ? 'client' : 'configured',
      visibility_score: score.visibilityScore,
      sentiment_score: score.sentimentScore,
      position_score: score.positionScore,
    });
  }
  
  // VALIDATION: Log summary
  if (discoveredWithScoresCount > 0) {
    console.warn(`⚠️  VALIDATION: Found ${discoveredWithScoresCount} discovered competitors with scores (should be 0)`);
  }
  console.log(`✅ CSV Export - Competitor Scores: ${rows.length} rows (configured competitors only, per-prompt aggregated)`);
  
  return arrayToCSV(rows, [
    'prompt_id', 'prompt_text', 'prompt_source',
    'competitor_id', 'competitor_name', 'competitor_type',
    'visibility_score', 'sentiment_score', 'position_score'
  ]);
}

/**
 * Generate per-prompt AI rankings CSV (all entities - configured + discovered)
 */
function generatePromptAIRankingsCSV(
  snapshot: SnapshotData,
  client: ClientInfo,
  competitors: CompetitorInfo[]
): string {
  const rows: CSVRow[] = [];
  
  // Create lookup maps
  const promptMap = new Map(snapshot.prompts.map(p => [p.id, p]));
  const modelMap = new Map(snapshot.models.map(m => [m.id, m]));
  const competitorMap = new Map(competitors.map(c => [c.name.toLowerCase(), c]));
  const answerToResponseMap = new Map(snapshot.responses.map(r => [r.answerId, r]));
  
  // Process rankings - these are raw AI rankings
  for (const ranking of snapshot.rankings) {
    // Filter out non-competitor ranking groups (features, factors, reasons, etc.)
    const rankingGroupLower = (ranking.rankingGroup || '').toLowerCase();
    
    // Skip groups that are clearly not competitors
    const nonCompetitorGroups = ['features', 'factors', 'reasons', 'benefits', 'considerations', 'steps', 'options'];
    if (nonCompetitorGroups.some(ng => rankingGroupLower.includes(ng))) {
      continue;
    }
    
    const response = answerToResponseMap.get(ranking.answerId);
    if (!response) continue;
    
    const prompt = promptMap.get(response.promptId);
    const model = modelMap.get(response.modelId);
    
    // Determine entity type
    let entityType: string;
    if (ranking.isClientBrand) {
      entityType = 'client';
    } else {
      // Check if this is a configured competitor
      const itemLower = ranking.item.toLowerCase();
      const isConfigured = competitors.some(c => 
        c.name.toLowerCase() === itemLower || 
        itemLower.includes(c.name.toLowerCase())
      );
      entityType = isConfigured ? 'configured' : 'discovered';
    }
    
    rows.push({
      prompt_id: response.promptId,
      prompt_text: prompt?.text || '',
      prompt_source: prompt?.source || '',
      model_id: response.modelId,
      model_name: model?.displayName || '',
      ranking_group: ranking.rankingGroup || '',
      group_relevance: ranking.groupRelevance || '',
      relevance_reason: ranking.relevanceReason || '',
      position: ranking.position,
      entity_name: ranking.item,
      entity_type: entityType,
    });
  }
  
  // VALIDATION: Count entities by type
  const configuredCount = rows.filter(r => r.entity_type === 'configured').length;
  const discoveredCount = rows.filter(r => r.entity_type === 'discovered').length;
  const clientCount = rows.filter(r => r.entity_type === 'client').length;
  
  console.log(`✅ CSV Export - AI Rankings: ${rows.length} total rankings`);
  console.log(`   - Client: ${clientCount} | Configured: ${configuredCount} | Discovered: ${discoveredCount}`);
  
  return arrayToCSV(rows, [
    'prompt_id', 'prompt_text', 'prompt_source', 'model_id', 'model_name',
    'ranking_group', 'group_relevance', 'relevance_reason', 'position', 'entity_name', 'entity_type'
  ]);
}

/**
 * Generate per-prompt citations CSV
 */
function generatePromptCitationsCSV(snapshot: SnapshotData): string {
  const rows: CSVRow[] = [];
  
  // Create lookup maps
  const promptMap = new Map(snapshot.prompts.map(p => [p.id, p]));
  const modelMap = new Map(snapshot.models.map(m => [m.id, m]));
  const answerToResponseMap = new Map(snapshot.responses.map(r => [r.answerId, r]));
  
  // Process citations
  for (const citation of snapshot.citations) {
    const response = answerToResponseMap.get(citation.answerId);
    if (!response) continue;
    
    const prompt = promptMap.get(response.promptId);
    const model = modelMap.get(response.modelId);
    
    rows.push({
      prompt_id: response.promptId,
      prompt_text: prompt?.text || '',
      prompt_source: prompt?.source || '',
      model_id: response.modelId,
      model_name: model?.displayName || '',
      answer_id: citation.answerId,
      citation_url: citation.url,
      citation_domain: citation.domain,
      citation_text: citation.displayText,
      position: citation.position,
      type: citation.type,
    });
  }
  
  console.log(`✅ CSV Export - Citations: ${rows.length} citations per prompt/model`);
  
  return arrayToCSV(rows, [
    'prompt_id', 'prompt_text', 'prompt_source', 'model_id', 'model_name', 'answer_id',
    'citation_url', 'citation_domain', 'citation_text', 'position', 'type'
  ]);
}

/**
 * Task #105 (P3) — Streaming CSV writers for the three largest exports.
 *
 * For projects with thousands of answers (e.g. 18 prompts × 5 models ×
 * 30 runs = 2700 rows) the in-memory `responses.csv`, `citations.csv`,
 * and `mentions.csv` strings can hit 5-50MB each. We now stream those
 * three to disk row-by-row via a `Readable` -> `WriteStream` pipeline
 * so peak RSS during export stays bounded.
 *
 * Smaller CSVs (metadata, models, prompts, etc.) keep the in-memory
 * `arrayToCSV` path because the row counts are tiny and the code is
 * simpler.
 */
function rowsToCsvLineIterator(
  rows: Iterable<CSVRow>,
  headers: string[],
): Generator<string, void, void> {
  return (function* () {
    yield headers.join(',') + '\n';
    for (const row of rows) {
      yield headers.map((h) => escapeCsvField(row[h])).join(',') + '\n';
    }
  })();
}

async function streamCsvToFile(
  rows: Iterable<CSVRow>,
  headers: string[],
  filePath: string,
): Promise<void> {
  await pipeline(
    Readable.from(rowsToCsvLineIterator(rows, headers)),
    createWriteStream(filePath, { encoding: 'utf8' }),
  );
}

/**
 * Stream `responses.csv` to disk. The full untruncated answer text is
 * the dominant per-row cost (~1-5KB each); generator yields one line
 * at a time so we never hold all rows in memory simultaneously.
 */
export async function streamResponsesCsvToFile(
  snapshot: SnapshotData,
  filePath: string,
): Promise<void> {
  const promptMap = new Map(snapshot.prompts.map((p) => [p.id, p]));
  const modelMap = new Map(snapshot.models.map((m) => [m.id, m]));
  const headers = [
    'prompt_run_item_id', 'answer_id', 'prompt_id', 'prompt_text', 'prompt_source',
    'model_id', 'model_name', 'model_vendor', 'answer', 'citation_count', 'mention_count', 'ranking_count',
    'visibility_score', 'sentiment_score', 'position_score', 'first_mention_pos',
  ];
  function* rowGen(): Generator<CSVRow, void, void> {
    for (const resp of snapshot.responses) {
      const prompt = promptMap.get(resp.promptId);
      const model = modelMap.get(resp.modelId);
      yield {
        prompt_run_item_id: resp.promptRunItemId,
        answer_id: resp.answerId,
        prompt_id: resp.promptId,
        prompt_text: prompt?.text || '',
        prompt_source: prompt?.source || '',
        model_id: resp.modelId,
        model_name: model?.displayName || '',
        model_vendor: model?.vendor || '',
        answer: resp.answer,
        citation_count: resp.citationCount,
        mention_count: resp.mentionCount,
        ranking_count: resp.rankingCount,
        visibility_score: resp.visibilityScore ?? '',
        sentiment_score: resp.sentimentScore ?? '',
        position_score: resp.positionScore ?? '',
        first_mention_pos: resp.firstMentionPos ?? '',
      };
    }
  }
  await streamCsvToFile(rowGen(), headers, filePath);
}

/** Stream `citations.csv` to disk. */
export async function streamCitationsCsvToFile(
  snapshot: SnapshotData,
  filePath: string,
): Promise<void> {
  const headers = ['answer_id', 'url', 'domain', 'display_text', 'position', 'type'];
  function* rowGen(): Generator<CSVRow, void, void> {
    for (const citation of snapshot.citations) {
      yield {
        answer_id: citation.answerId,
        url: citation.url,
        domain: citation.domain,
        display_text: citation.displayText,
        position: citation.position,
        type: citation.type,
      };
    }
  }
  await streamCsvToFile(rowGen(), headers, filePath);
}

/** Stream `mentions.csv` to disk. */
export async function streamMentionsCsvToFile(
  snapshot: SnapshotData,
  filePath: string,
): Promise<void> {
  const headers = ['answer_id', 'span', 'sentiment', 'is_alias'];
  function* rowGen(): Generator<CSVRow, void, void> {
    for (const mention of snapshot.mentions) {
      yield {
        answer_id: mention.answerId,
        span: mention.span,
        sentiment: mention.sentiment,
        is_alias: mention.isAlias,
      };
    }
  }
  await streamCsvToFile(rowGen(), headers, filePath);
}

/**
 * Generate all CSV files from snapshot data
 */
export function generateCSVExports(
  snapshot: SnapshotData,
  client: ClientInfo,
  competitors: CompetitorInfo[],
  narrativeSections: NarrativeSectionInfo[] = [],
  // Task #105 (P3) — Callers that stream the largest CSVs to disk
  // (zip-exporter) pass {responses,citations,mentions}.csv here so we
  // skip materializing those strings in memory entirely. Skipping at
  // the build site (not just the consume site) is the actual memory
  // win — see the streamed writers above.
  options: { excludeFilenames?: ReadonlySet<string> } = {},
): Record<string, string> {
  const exclude = options.excludeFilenames ?? new Set<string>();
  const skip = (name: string): boolean => exclude.has(name);
  const csvFiles: Record<string, string> = {};
  
  // 1. Metadata CSV
  csvFiles['metadata.csv'] = arrayToCSV(
    [{
      generated_at: snapshot.metadata.generatedAt,
      client_id: snapshot.metadata.clientId,
      project_id: snapshot.metadata.projectId,
      run_ids: snapshot.metadata.runIds.join('; '),
      total_prompts: snapshot.prompts.length,
      total_models: snapshot.models.length,
      total_responses: snapshot.responses.length,
      total_citations: snapshot.citations.length,
      total_mentions: snapshot.mentions.length,
      total_rankings: snapshot.rankings.length,
      total_recommendations: snapshot.recommendations.length,
      unique_competitors: new Set(snapshot.competitorScores.map((cs) => cs.competitorId)).size,
      date_range_earliest: snapshot.metadata.dateRange.earliest,
      date_range_latest: snapshot.metadata.dateRange.latest,
    }],
    ['generated_at', 'client_id', 'project_id', 'run_ids', 'total_prompts', 'total_models', 
     'total_responses', 'total_citations', 'total_mentions', 'total_rankings', 'total_recommendations',
     'unique_competitors', 'date_range_earliest', 'date_range_latest']
  );
  
  // 2. Client CSV (with all configuration fields properly serialized)
  csvFiles['client.csv'] = arrayToCSV(
    [{
      id: client.id,
      name: client.name,
      industry: client.industry,
      geography: client.geography,
      website: client.website,
      urls: client.urls,
      focus_areas: client.focusAreas,
      aliases: client.aliases,
      brand_aliases: client.brandAliases,
      selected_ai_model_ids: client.selectedAiModelIds,
      onboarding_status: client.onboardingStatus,
    }],
    ['id', 'name', 'industry', 'geography', 'website', 'urls', 'focus_areas', 'aliases', 'brand_aliases', 'selected_ai_model_ids', 'onboarding_status']
  );
  
  // 3. Competitors CSV (with website and aliases)
  csvFiles['competitors.csv'] = arrayToCSV(
    competitors.map((comp) => ({
      id: comp.id,
      name: comp.name,
      client_id: comp.clientId,
      website: comp.website,
      aliases: comp.aliases,
    })),
    ['id', 'name', 'client_id', 'website', 'aliases']
  );
  
  // 4. Prompts CSV (with category info and metadata)
  csvFiles['prompts.csv'] = arrayToCSV(
    snapshot.prompts.map((prompt: any) => ({
      id: prompt.id,
      text: prompt.text,
      source: prompt.source,
      category_id: prompt.categoryId || '',
      category_name: prompt.categoryName || '',
      accepted: prompt.accepted === null || prompt.accepted === undefined ? '' : (prompt.accepted ? 'true' : 'false'),
      created_at: prompt.createdAt || '',
    })),
    ['id', 'text', 'source', 'category_id', 'category_name', 'accepted', 'created_at']
  );
  
  // 5. Models CSV
  csvFiles['models.csv'] = arrayToCSV(
    snapshot.models.map((model) => ({
      id: model.id,
      vendor: model.vendor,
      model: model.model,
      display_name: model.displayName,
      max_tpm: model.maxTpm ?? '',
      max_rpm: model.maxRpm ?? '',
      cost_per_1k_input: model.costPer1kInput ?? '',
      cost_per_1k_output: model.costPer1kOutput ?? '',
      enabled: model.enabled,
    })),
    ['id', 'vendor', 'model', 'display_name', 'max_tpm', 'max_rpm', 'cost_per_1k_input', 'cost_per_1k_output', 'enabled']
  );
  
  // 6. Responses CSV (COMPLETE with full answer text and scoring)
  if (!skip('responses.csv')) csvFiles['responses.csv'] = arrayToCSV(
    snapshot.responses.map((resp) => {
      const prompt = snapshot.prompts.find((p) => p.id === resp.promptId);
      const model = snapshot.models.find((m) => m.id === resp.modelId);
      
      return {
        prompt_run_item_id: resp.promptRunItemId,
        answer_id: resp.answerId,
        prompt_id: resp.promptId,
        prompt_text: prompt?.text || '',
        prompt_source: prompt?.source || '',
        model_id: resp.modelId,
        model_name: model?.displayName || '',
        model_vendor: model?.vendor || '',
        answer: resp.answer, // FULL untruncated answer text
        citation_count: resp.citationCount,
        mention_count: resp.mentionCount,
        ranking_count: resp.rankingCount,
        visibility_score: resp.visibilityScore ?? '',
        sentiment_score: resp.sentimentScore ?? '',
        position_score: resp.positionScore ?? '',
        first_mention_pos: resp.firstMentionPos ?? '',
      };
    }),
    ['prompt_run_item_id', 'answer_id', 'prompt_id', 'prompt_text', 'prompt_source', 
     'model_id', 'model_name', 'model_vendor', 'answer', 'citation_count', 'mention_count', 'ranking_count',
     'visibility_score', 'sentiment_score', 'position_score', 'first_mention_pos']
  );
  
  // 7. Citations CSV
  if (!skip('citations.csv')) csvFiles['citations.csv'] = arrayToCSV(
    snapshot.citations.map((citation) => ({
      answer_id: citation.answerId,
      url: citation.url,
      domain: citation.domain,
      display_text: citation.displayText,
      position: citation.position,
      type: citation.type,
    })),
    ['answer_id', 'url', 'domain', 'display_text', 'position', 'type']
  );
  
  // 8. Mentions CSV
  if (!skip('mentions.csv')) csvFiles['mentions.csv'] = arrayToCSV(
    snapshot.mentions.map((mention) => ({
      answer_id: mention.answerId,
      span: mention.span,
      sentiment: mention.sentiment,
      is_alias: mention.isAlias,
    })),
    ['answer_id', 'span', 'sentiment', 'is_alias']
  );
  
  // 9. Rankings CSV
  csvFiles['rankings.csv'] = arrayToCSV(
    snapshot.rankings.map((ranking) => ({
      answer_id: ranking.answerId,
      item: ranking.item,
      position: ranking.position,
      is_client_brand: ranking.isClientBrand,
      ranking_group: ranking.rankingGroup,
    })),
    ['answer_id', 'item', 'position', 'is_client_brand', 'ranking_group']
  );
  
  // 10. Recommendations CSV (with examples, actionItems, and timestamps)
  csvFiles['recommendations.csv'] = arrayToCSV(
    snapshot.recommendations.map((rec: any) => ({
      id: rec.id,
      title: rec.title,
      category: rec.category,
      severity: rec.severity,
      description: rec.description,
      source: rec.source,
      examples: rec.examples,
      action_items: rec.actionItems,
      prompt_run_id: rec.promptRunId || '',
      created_at: rec.createdAt || '',
      updated_at: rec.updatedAt || '',
    })),
    ['id', 'title', 'category', 'severity', 'description', 'source', 'examples', 'action_items', 'prompt_run_id', 'created_at', 'updated_at']
  );
  
  // 11. Competitor Scores CSV
  csvFiles['competitor_scores.csv'] = arrayToCSV(
    snapshot.competitorScores.map((score) => ({
      competitor_id: score.competitorId,
      competitor_name: score.competitorName,
      prompt_id: score.promptId,
      prompt_run_id: score.promptRunId,
      visibility_score: score.visibilityScore,
      position_score: score.positionScore,
      sentiment_score: score.sentimentScore,
    })),
    ['competitor_id', 'competitor_name', 'prompt_id', 'prompt_run_id', 
     'visibility_score', 'position_score', 'sentiment_score']
  );
  
  // 12. Topics CSV (client topics with keywords)
  csvFiles['topics.csv'] = arrayToCSV(
    (snapshot.topics || []).map((topic: any) => ({
      id: topic.id,
      label: topic.label,
      category: topic.category || '',
      keywords: topic.keywords,
      source: topic.source,
      accepted: topic.accepted ? 'true' : 'false',
      created_at: topic.createdAt || '',
    })),
    ['id', 'label', 'category', 'keywords', 'source', 'accepted', 'created_at']
  );
  
  // 13. Prompt Categories CSV (taxonomy)
  csvFiles['prompt_categories.csv'] = arrayToCSV(
    (snapshot.promptCategories || []).map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
      created_at: cat.createdAt || '',
    })),
    ['id', 'name', 'slug', 'description', 'created_at']
  );
  
  // ===== X-RAY DATA EXPORTS (Phase 3) =====
  
  // 14. X-Ray Sites CSV (site-level crawl data)
  csvFiles['xray_sites.csv'] = arrayToCSV(
    (snapshot.xraySites || []).map((site: any) => ({
      id: site.id,
      client_id: site.clientId,
      domain: site.domain,
      site_type: site.siteType,
      robots_txt_present: site.robotsTxtPresent ? 'true' : 'false',
      ai_txt_present: site.aiTxtPresent ? 'true' : 'false',
      crawl_access_status: site.crawlAccessStatus,
      robots_rules: site.robotsRules ? JSON.stringify(site.robotsRules) : '',
      ai_txt_content: site.aiTxtContent || '',
      health_probe_status: site.healthProbeStatus || '',
      last_probed_at: site.lastProbedAt || '',
      created_at: site.createdAt || '',
      updated_at: site.updatedAt || '',
    })),
    ['id', 'client_id', 'domain', 'site_type', 'robots_txt_present', 'ai_txt_present', 
     'crawl_access_status', 'robots_rules', 'ai_txt_content', 'health_probe_status',
     'last_probed_at', 'created_at', 'updated_at']
  );
  
  // 15. X-Ray Pages CSV (crawled pages with structure)
  csvFiles['xray_pages.csv'] = arrayToCSV(
    (snapshot.xrayPages || []).map((page: any) => ({
      id: page.id,
      site_id: page.siteId,
      url: page.url,
      title: page.title || '',
      page_type: page.pageType || '',
      status_code: page.statusCode || '',
      word_count: page.wordCount || 0,
      headings: page.headings ? JSON.stringify(page.headings) : '',
      entities: page.entities ? JSON.stringify(page.entities) : '',
      topics: page.topics ? JSON.stringify(page.topics) : '',
      sentiment_score: page.sentimentScore || '',
      created_at: page.createdAt || '',
      updated_at: page.updatedAt || '',
    })),
    ['id', 'site_id', 'url', 'title', 'page_type', 'status_code', 'word_count',
     'headings', 'entities', 'topics', 'sentiment_score', 'created_at', 'updated_at']
  );
  
  // 16. X-Ray Analysis CSV (AI analysis results)
  csvFiles['xray_analysis.csv'] = arrayToCSV(
    (snapshot.xrayAnalysis || []).map((analysis: any) => ({
      id: analysis.id,
      page_id: analysis.pageId,
      page_url: analysis.pageUrl || '',
      assessment: analysis.assessment || '',
      gaps: analysis.gaps ? JSON.stringify(analysis.gaps) : '',
      recommendations: analysis.recommendations ? JSON.stringify(analysis.recommendations) : '',
      actions: analysis.actions ? JSON.stringify(analysis.actions) : '',
      seo_issues: analysis.seoIssues ? JSON.stringify(analysis.seoIssues) : '',
      scores: analysis.scores ? JSON.stringify(analysis.scores) : '',
      created_at: analysis.createdAt || '',
      updated_at: analysis.updatedAt || '',
    })),
    ['id', 'page_id', 'page_url', 'assessment', 'gaps', 'recommendations',
     'actions', 'seo_issues', 'scores', 'created_at', 'updated_at']
  );
  
  // ===== AGGREGATED METRICS EXPORTS (Phase 4) =====
  
  // 17. Run Statistics CSV (per-run metrics)
  const promptRunMap = new Map<string, { 
    promptCount: number; 
    responseCount: number;
    citationCount: number;
    mentionCount: number;
  }>();
  
  // Count responses per run from competitorScores (which have promptRunId)
  for (const score of snapshot.competitorScores) {
    if (score.promptRunId) {
      const existing = promptRunMap.get(score.promptRunId) || { 
        promptCount: 0, responseCount: 0, citationCount: 0, mentionCount: 0 
      };
      existing.responseCount++;
      promptRunMap.set(score.promptRunId, existing);
    }
  }
  
  csvFiles['run_statistics.csv'] = arrayToCSV(
    (snapshot.promptRuns || []).map((run: any) => {
      const stats = promptRunMap.get(run.id) || { promptCount: 0, responseCount: 0, citationCount: 0, mentionCount: 0 };
      return {
        run_id: run.id,
        run_name: run.name || '',
        status: run.status,
        created_at: run.createdAt || '',
        total_prompts: run.totalPrompts || 0,
        response_count: stats.responseCount,
      };
    }),
    ['run_id', 'run_name', 'status', 'created_at', 'total_prompts', 'response_count']
  );
  
  // 18. Visibility by Model CSV (brand/competitor scores per AI model)
  const visibilityByModel = snapshot.aggregatedMetrics?.visibilityByModel || [];
  csvFiles['visibility_by_model.csv'] = arrayToCSV(
    visibilityByModel.map((entry) => ({
      brand_name: entry.brandName,
      is_client: entry.isClient ? 'true' : 'false',
      model_id: entry.modelId,
      model_name: entry.modelName,
      avg_visibility_score: entry.avgVisibilityScore,
      avg_position_score: entry.avgPositionScore,
      avg_sentiment_score: entry.avgSentimentScore,
      total_mentions: entry.totalMentions,
      response_count: entry.responseCount,
    })),
    ['brand_name', 'is_client', 'model_id', 'model_name', 'avg_visibility_score', 
     'avg_position_score', 'avg_sentiment_score', 'total_mentions', 'response_count']
  );
  
  // 19. Visibility by Category CSV (visibility scores by prompt category)
  const categoryScores = new Map<string, {
    categoryId: string;
    categoryName: string;
    totalResponses: number;
    avgVisibility: number;
    avgSentiment: number;
    avgPosition: number;
    scoreSum: { visibility: number; sentiment: number; position: number };
  }>();
  
  // Build prompt -> category map
  const promptCategoryMap = new Map<string, { id: string; name: string }>();
  for (const prompt of snapshot.prompts) {
    if (prompt.categoryId && prompt.categoryName) {
      promptCategoryMap.set(prompt.id, { id: prompt.categoryId, name: prompt.categoryName });
    }
  }
  
  // Aggregate client scores by category
  for (const score of snapshot.competitorScores) {
    if (!score.isClient || !score.promptId) continue;
    const category = promptCategoryMap.get(score.promptId);
    const catKey = category?.id || 'uncategorized';
    const catName = category?.name || 'Uncategorized';
    
    const existing = categoryScores.get(catKey) || {
      categoryId: catKey,
      categoryName: catName,
      totalResponses: 0,
      avgVisibility: 0,
      avgSentiment: 0,
      avgPosition: 0,
      scoreSum: { visibility: 0, sentiment: 0, position: 0 },
    };
    
    existing.totalResponses++;
    existing.scoreSum.visibility += score.visibilityScore || 0;
    existing.scoreSum.sentiment += score.sentimentScore || 0;
    existing.scoreSum.position += score.positionScore || 0;
    categoryScores.set(catKey, existing);
  }
  
  // Calculate averages
  const categoryRows: CSVRow[] = Array.from(categoryScores.entries()).map(([catId, data]) => {
    const count = data.totalResponses || 1;
    return {
      category_id: catId,
      category_name: data.categoryName,
      total_responses: data.totalResponses,
      avg_visibility_score: Math.round((data.scoreSum.visibility / count) * 10) / 10,
      avg_sentiment_score: Math.round((data.scoreSum.sentiment / count) * 10) / 10,
      avg_position_score: Math.round((data.scoreSum.position / count) * 10) / 10,
    };
  });
  csvFiles['visibility_by_category.csv'] = arrayToCSV(
    categoryRows,
    ['category_id', 'category_name', 'total_responses', 'avg_visibility_score', 'avg_sentiment_score', 'avg_position_score']
  );
  
  // 20. Mention Rates CSV (client and competitor mention rates)
  const mentionRates = snapshot.aggregatedMetrics?.mentionRates;
  const mentionRateRows: CSVRow[] = [];
  if (mentionRates) {
    mentionRateRows.push({
      entity_type: 'client',
      entity_name: client.name,
      total_responses: mentionRates.client.totalResponses,
      responses_with_mention: mentionRates.client.responsesWithMention,
      mention_rate: mentionRates.client.mentionRate,
    });
    for (const comp of mentionRates.competitors) {
      mentionRateRows.push({
        entity_type: 'competitor',
        entity_name: comp.name,
        total_responses: comp.totalResponses,
        responses_with_mention: comp.responsesWithMention,
        mention_rate: comp.mentionRate,
      });
    }
  }
  csvFiles['mention_rates.csv'] = arrayToCSV(
    mentionRateRows,
    ['entity_type', 'entity_name', 'total_responses', 'responses_with_mention', 'mention_rate']
  );
  
  // 19. Ranking Analysis CSV (client and competitor ranking positions)
  // Calculate competitor position distributions from raw rankings data
  const competitorDistributions = new Map<string, { position: number; count: number }[]>();
  for (const ranking of snapshot.rankings) {
    if (!ranking.isClientBrand && ranking.item) {
      const existing = competitorDistributions.get(ranking.item) || [];
      const posEntry = existing.find(e => e.position === ranking.position);
      if (posEntry) {
        posEntry.count++;
      } else {
        existing.push({ position: ranking.position, count: 1 });
      }
      competitorDistributions.set(ranking.item, existing);
    }
  }
  
  const rankingAnalysis = snapshot.aggregatedMetrics?.rankingAnalysis;
  const rankingRows: CSVRow[] = [];
  if (rankingAnalysis) {
    rankingRows.push({
      entity_type: 'client',
      entity_name: client.name,
      avg_position: rankingAnalysis.client.avgPosition,
      median_position: rankingAnalysis.client.medianPosition,
      total_rankings: rankingAnalysis.client.totalRankings,
      position_distribution: JSON.stringify(rankingAnalysis.client.positionDistribution),
    });
    for (const comp of rankingAnalysis.competitors) {
      const compDist = competitorDistributions.get(comp.name) || [];
      compDist.sort((a, b) => a.position - b.position);
      rankingRows.push({
        entity_type: 'competitor',
        entity_name: comp.name,
        avg_position: comp.avgPosition,
        median_position: comp.medianPosition,
        total_rankings: comp.totalRankings,
        position_distribution: compDist.length > 0 ? JSON.stringify(compDist) : '',
      });
    }
  }
  csvFiles['ranking_analysis.csv'] = arrayToCSV(
    rankingRows,
    ['entity_type', 'entity_name', 'avg_position', 'median_position', 'total_rankings', 'position_distribution']
  );
  
  // 20. Citation Analysis CSV (top domains and citation stats)
  const citationAnalysis = snapshot.aggregatedMetrics?.citationAnalysis;
  const citationAnalysisRows: CSVRow[] = [];
  if (citationAnalysis) {
    citationAnalysisRows.push({
      row_type: 'summary',
      domain: '',
      citation_count: citationAnalysis.totalCitations,
      unique_answers: 0,
      total_citations: citationAnalysis.totalCitations,
      unique_domains: citationAnalysis.uniqueDomains,
    });
    for (const domain of citationAnalysis.topDomains) {
      citationAnalysisRows.push({
        row_type: 'domain',
        domain: domain.domain,
        citation_count: domain.citationCount,
        unique_answers: domain.uniqueAnswers,
        total_citations: '',
        unique_domains: '',
      });
    }
  }
  csvFiles['citation_analysis.csv'] = arrayToCSV(
    citationAnalysisRows,
    ['row_type', 'domain', 'citation_count', 'unique_answers', 'total_citations', 'unique_domains']
  );
  
  // 21. Top Competitors CSV (competitor performance summary)
  const topCompetitors = snapshot.aggregatedMetrics?.topCompetitors || [];
  csvFiles['top_competitors.csv'] = arrayToCSV(
    topCompetitors.map((comp) => ({
      name: comp.name,
      avg_visibility_score: comp.avgVisibilityScore,
      total_mentions: comp.totalMentions,
      avg_ranking_position: comp.avgRankingPosition,
    })),
    ['name', 'avg_visibility_score', 'total_mentions', 'avg_ranking_position']
  );
  
  // ===== NEW PER-PROMPT EXPORTS (Phase 1) =====
  
  // 22. Per-Prompt Competitor Scores (Configured Only)
  csvFiles['prompt_competitor_scores.csv'] = generatePromptCompetitorScoresCSV(
    snapshot,
    competitors
  );
  
  // 23. Per-Prompt AI Rankings (All Entities)
  csvFiles['prompt_ai_rankings.csv'] = generatePromptAIRankingsCSV(
    snapshot,
    client,
    competitors
  );
  
  // 24. Per-Prompt Citations
  csvFiles['prompt_citations.csv'] = generatePromptCitationsCSV(snapshot);
  
  // ===== NARRATIVE SECTIONS EXPORT (Phase 5) =====
  
  // 25. Narrative Sections CSV (generated consulting narratives)
  csvFiles['narrative_sections.csv'] = arrayToCSV(
    narrativeSections.map((section) => ({
      section_name: section.sectionName,
      section_order: section.sectionOrder,
      section_content: section.sectionContent,
      word_count: section.sectionContent ? section.sectionContent.split(/\s+/).length : 0,
      created_at: section.createdAt || '',
    })),
    ['section_name', 'section_order', 'section_content', 'word_count', 'created_at']
  );
  
  return csvFiles;
}
