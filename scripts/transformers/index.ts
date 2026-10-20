import {
  parseTimestamp,
  parseJSONField,
  parseBoolean,
  parseNumeric,
  parseInteger,
} from '../utils';

// AI Models
export function transformAIModel(row: any) {
  return {
    id: row.id,
    vendor: row.vendor,
    model: row.model,
    displayName: row.display_name,
    maxTpm: parseInteger(row.max_tpm),
    maxRpm: parseInteger(row.max_rpm),
    costPer1kInput: parseNumeric(row.cost_per_1k_input),
    costPer1kOutput: parseNumeric(row.cost_per_1k_output),
    enabled: parseBoolean(row.enabled, true),
  };
}

// Score Interpretations
export function transformScoreInterpretation(row: any) {
  return {
    id: row.id,
    category: row.category,
    scoreMin: parseNumeric(row.score_min),
    scoreMax: parseNumeric(row.score_max),
    messageTemplate: row.message_template,
  };
}

// Score Color Bands
export function transformScoreColorBand(row: any) {
  return {
    id: row.id,
    category: row.category,
    bandName: row.band_name,
    colorHex: row.color_hex,
    scoreMin: parseNumeric(row.score_min),
    scoreMax: parseNumeric(row.score_max),
  };
}

// Organizations
export function transformOrganization(row: any) {
  return {
    id: row.id,
    name: row.name,
    createdAt: parseTimestamp(row.created_at),
  };
}

// Clients
export function transformClient(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    website: row.website || null,
    urls: parseJSONField(row.urls),
    focusAreas: parseJSONField(row.focus_areas),
    industry: row.industry || null,
    geography: row.geography || null,
    aliases: parseJSONField(row.aliases),
    brandAliases: parseJSONField(row.brand_aliases),
    selectedAiModelIds: parseJSONField(row.selected_ai_model_ids),
    onboardingStatus: row.onboarding_status || 'draft',
    isActive: parseBoolean(row.is_active, true),
    createdAt: parseTimestamp(row.created_at),
  };
}

// Competitors
export function transformCompetitor(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    website: row.website || null,
    aliases: parseJSONField(row.aliases),
  };
}

// Topics
export function transformTopic(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    label: row.label,
    category: row.category || null,
    keywords: parseJSONField(row.keywords),
    source: row.source,
    accepted: parseBoolean(row.accepted, false),
    createdAt: parseTimestamp(row.created_at),
  };
}

// Prompts
export function transformPrompt(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    text: row.text,
    source: row.source,
    accepted: parseBoolean(row.accepted, false),
    createdAt: parseTimestamp(row.created_at),
  };
}

// Prompt Runs
export function transformPromptRun(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    createdBy: row.created_by,
    totalPrompts: parseInteger(row.total_prompts) || 0,
    status: row.status,
    createdAt: parseTimestamp(row.created_at),
  };
}

// Prompt Run Items
export function transformPromptRunItem(row: any) {
  return {
    id: row.id,
    promptRunId: row.prompt_run_id,
    promptId: row.prompt_id,
    modelId: row.model_id,
    status: row.status,
    startedAt: parseTimestamp(row.started_at),
    finishedAt: parseTimestamp(row.finished_at),
    error: row.error || null,
  };
}

// Answers
export function transformAnswer(row: any) {
  return {
    id: row.id,
    promptRunItemId: row.prompt_run_item_id,
    rawResponse: row.raw_response,
    visibilityScore: parseNumeric(row.visibility_score),
    firstMentionPos: parseInteger(row.first_mention_pos),
    sentimentScore: parseNumeric(row.sentiment_score),
    positionScore: parseNumeric(row.position_score),
    citationCount: parseInteger(row.citation_count) || 0,
  };
}

// Citations
export function transformCitation(row: any) {
  return {
    id: row.id,
    answerId: row.answer_id,
    url: row.url || null,
    domain: row.domain || null,
    displayText: row.display_text || null,
    position: parseInteger(row.position) || 0,
    type: row.type,
    anchorText: row.anchor_text || null,
    isSelfCitation: parseBoolean(row.is_self_citation, false),
  };
}

// Mentions
export function transformMention(row: any) {
  return {
    id: row.id,
    answerId: row.answer_id,
    span: row.span,
    isAlias: parseBoolean(row.is_alias, false),
    sentiment: row.sentiment,
  };
}

// Rankings
export function transformRanking(row: any) {
  return {
    id: row.id,
    answerId: row.answer_id,
    item: row.item,
    position: parseInteger(row.position) || 0,
    isClientBrand: parseBoolean(row.is_client_brand, false),
    rankingGroup: row.ranking_group || null,
  };
}

// Competitor Scores
export function transformCompetitorScore(row: any) {
  return {
    id: row.id,
    promptRunId: row.prompt_run_id,
    promptId: row.prompt_id || null,
    competitorId: row.competitor_id || null,
    competitorName: row.competitor_name,
    isClient: parseBoolean(row.is_client, false),
    visibilityScore: parseNumeric(row.visibility_score),
    sentimentScore: parseNumeric(row.sentiment_score),
    positionScore: parseNumeric(row.position_score),
    overallScore: parseNumeric(row.overall_score),
    createdAt: parseTimestamp(row.created_at),
  };
}

// Jobs
export function transformJob(row: any) {
  return {
    id: row.id,
    type: row.type,
    payload: parseJSONField(row.payload) || {},
    status: row.status,
    progress: parseInteger(row.progress) || 0,
    createdAt: parseTimestamp(row.created_at),
    startedAt: parseTimestamp(row.started_at),
    finishedAt: parseTimestamp(row.finished_at),
    error: row.error || null,
  };
}

// Recommendations
export function transformRecommendation(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    promptRunId: row.prompt_run_id || null,
    title: row.title,
    description: row.description,
    severity: row.severity,
    category: row.category,
    examples: parseJSONField(row.examples),
    actionItems: parseJSONField(row.action_items),
    source: row.source,
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

// Generated Contents
export function transformGeneratedContent(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    promptRunId: row.prompt_run_id || null,
    sourceUrl: row.source_url || null,
    sourceDomain: row.source_domain || null,
    title: row.title,
    content: row.content,
    targetKeywords: parseJSONField(row.target_keywords),
    createdAt: parseTimestamp(row.created_at),
  };
}

// XRay Sites
export function transformXraySite(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    domain: row.domain,
    siteType: row.site_type,
    robotsTxtPresent: parseBoolean(row.robots_txt_present, false),
    aiTxtPresent: parseBoolean(row.ai_txt_present, false),
    crawlAccessStatus: row.crawl_access_status || 'ok',
    robotsRules: parseJSONField(row.robots_rules),
    aiTxtContent: row.ai_txt_content || null,
    crawlEvidence: parseJSONField(row.crawl_evidence),
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

// XRay Pages
export function transformXrayPage(row: any) {
  return {
    id: row.id,
    siteId: row.site_id,
    url: row.url,
    title: row.title || null,
    pageType: row.page_type || null,
    statusCode: parseInteger(row.status_code),
    wordCount: parseInteger(row.word_count) || 0,
    rawHtml: row.raw_html || null,
    rawText: row.raw_text || null,
    lastModified: parseTimestamp(row.last_modified),
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

// XRay Page Structure
export function transformXrayPageStructure(row: any) {
  return {
    id: row.id,
    pageId: row.page_id,
    headings: parseJSONField(row.headings),
    paragraphs: parseJSONField(row.paragraphs),
    lists: parseJSONField(row.lists),
    tables: parseJSONField(row.tables),
    entities: parseJSONField(row.entities),
    focusAreas: parseJSONField(row.focus_areas),
    topics: parseJSONField(row.topics),
    sentimentScore: parseNumeric(row.sentiment_score),
    linkCounts: parseJSONField(row.link_counts),
    createdAt: parseTimestamp(row.created_at),
  };
}

// XRay Page Analysis
export function transformXrayPageAnalysis(row: any) {
  return {
    id: row.id,
    pageId: row.page_id,
    assessment: row.assessment || null,
    gaps: parseJSONField(row.gaps),
    recommendations: parseJSONField(row.recommendations),
    actions: parseJSONField(row.actions),
    seoIssues: parseJSONField(row.seo_issues),
    freshnessData: parseJSONField(row.freshness_data),
    consistencyData: parseJSONField(row.consistency_data),
    complianceData: parseJSONField(row.compliance_data),
    scores: parseJSONField(row.scores),
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

// Score Factors
export function transformScoreFactor(row: any) {
  return {
    id: row.id,
    promptRunItemId: row.prompt_run_item_id,
    category: row.category,
    score: parseNumeric(row.score) || '0',
    relevanceValue: parseNumeric(row.relevance_value),
    positionValue: parseNumeric(row.position_value),
    positiveMentions: parseInteger(row.positive_mentions),
    neutralMentions: parseInteger(row.neutral_mentions),
    negativeMentions: parseInteger(row.negative_mentions),
    mentionsCount: parseInteger(row.mentions_count),
    headingHitsCount: parseInteger(row.heading_hits_count),
    createdAt: parseTimestamp(row.created_at),
  };
}
