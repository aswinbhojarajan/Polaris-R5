import { db } from '../db';
import { 
  promptRuns,
  clients, 
  promptRunItems, 
  answers, 
  citations, 
  mentions, 
  rankings, 
  competitorScores,
  recommendations,
  prompts,
  promptCategories,
  aiModels,
  topics,
  xraySites,
  xrayPages,
  xrayPageStructure,
  xrayPageAnalysis
} from '@shared/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { ReportAggregator } from './report-aggregator';
import { NativeSearchStore } from './native-web-search/store';
import { validateGeneration, type SearchEvidence } from '../../shared/native-web-search';
import { sql } from 'drizzle-orm';

export { ReportAggregator };

// ===== AGGREGATION HELPER FUNCTIONS =====

interface RawResponseData {
  promptRunItemId: string;
  answerId: string;
  promptId: string;
  modelId: string;
  citationCount: number;
  mentionCount: number;
  rankingCount: number;
}

interface RawCompetitorScore {
  competitorId: string | null;
  competitorName: string;
  promptId: string | null;
  promptRunId: string;
  isClient: boolean;
  positionScore: number;
  sentimentScore: number;
  visibilityScore: number;
}

interface RawMention {
  answerId: string;
  span: string;
  sentiment: string;
  isAlias: boolean;
}

interface RawRanking {
  answerId: string;
  item: string;
  position: number;
  isClientBrand: boolean;
  rankingGroup: string | null;
  groupRelevance: string | null;
  relevanceReason: string | null;
}

interface RawCitation {
  answerId: string;
  url: string | null;
  domain: string | null;
  displayText: string | null;
  position: number;
  type: string;
}

interface ModelInfo {
  id: string;
  vendor: string;
  model: string;
  displayName: string;
  maxTpm: number | null;
  maxRpm: number | null;
  costPer1kInput: string | null;
  costPer1kOutput: string | null;
  enabled: boolean;
}

function calculateVisibilityByModel(
  competitorScores: RawCompetitorScore[],
  responses: RawResponseData[],
  mentions: RawMention[],
  models: ModelInfo[]
): Array<{
  brandName: string;
  isClient: boolean;
  modelId: string;
  modelName: string;
  avgVisibilityScore: number;
  avgPositionScore: number;
  avgSentimentScore: number;
  totalMentions: number;
  responseCount: number;
}> {
  // Build O(1) lookup maps
  const modelMap = new Map(models.map(m => [m.id, m]));
  const responsesByPromptId = new Map<string, RawResponseData[]>();
  const responseByAnswerId = new Map<string, RawResponseData>();
  
  responses.forEach(r => {
    // Map promptId to all responses for that prompt (one per model)
    if (!responsesByPromptId.has(r.promptId)) {
      responsesByPromptId.set(r.promptId, []);
    }
    responsesByPromptId.get(r.promptId)!.push(r);
    
    // Map answerId to response for mention lookup
    responseByAnswerId.set(r.answerId, r);
  });

  // Group data by (brandName, modelId)
  const brandModelGroups = new Map<string, {
    brandName: string;
    isClient: boolean;
    modelId: string;
    visibilityScores: number[];
    positionScores: number[];
    sentimentScores: number[];
    mentionCount: number;
    responseCount: number;
  }>();

  // Process each competitor score - attribute to correct model via responses
  competitorScores.forEach(cs => {
    if (!cs.promptId) return;
    
    // Find responses for this prompt (each response is from a specific model)
    const promptResponses = responsesByPromptId.get(cs.promptId) || [];
    
    promptResponses.forEach(response => {
      const key = `${cs.competitorName}|${response.modelId}`;
      
      if (!brandModelGroups.has(key)) {
        brandModelGroups.set(key, {
          brandName: cs.competitorName,
          isClient: cs.isClient,
          modelId: response.modelId,
          visibilityScores: [],
          positionScores: [],
          sentimentScores: [],
          mentionCount: 0,
          responseCount: 0,
        });
      }
      
      const group = brandModelGroups.get(key)!;
      group.visibilityScores.push(cs.visibilityScore);
      group.positionScores.push(cs.positionScore);
      group.sentimentScores.push(cs.sentimentScore);
      group.responseCount++;
    });
  });

  // Build brand name set for mention matching (case-insensitive)
  const brandNamesLower = new Map<string, string>();
  brandModelGroups.forEach((group) => {
    brandNamesLower.set(group.brandName.toLowerCase(), group.brandName);
  });

  // Count mentions per brand per model
  mentions.forEach(m => {
    const response = responseByAnswerId.get(m.answerId);
    if (!response) return;
    
    const spanLower = m.span.toLowerCase();
    brandNamesLower.forEach((originalName) => {
      if (spanLower.includes(originalName.toLowerCase())) {
        const key = `${originalName}|${response.modelId}`;
        const group = brandModelGroups.get(key);
        if (group) {
          group.mentionCount++;
        }
      }
    });
  });

  // Calculate averages and return results
  return Array.from(brandModelGroups.values())
    .filter(g => g.visibilityScores.length > 0)
    .map(g => {
      const model = modelMap.get(g.modelId);
      const count = g.visibilityScores.length;
      
      const avgVisibility = count > 0 
        ? Math.round((g.visibilityScores.reduce((sum, s) => sum + s, 0) / count) * 10) / 10 
        : 0;
      const avgPosition = count > 0 
        ? Math.round((g.positionScores.reduce((sum, s) => sum + s, 0) / count) * 10) / 10 
        : 0;
      const avgSentiment = count > 0 
        ? Math.round((g.sentimentScores.reduce((sum, s) => sum + s, 0) / count) * 10) / 10 
        : 0;

      return {
        brandName: g.brandName,
        isClient: g.isClient,
        modelId: g.modelId,
        modelName: model?.displayName || model?.vendor || g.modelId,
        avgVisibilityScore: avgVisibility,
        avgPositionScore: avgPosition,
        avgSentimentScore: avgSentiment,
        totalMentions: g.mentionCount,
        responseCount: g.responseCount,
      };
    })
    .sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore);
}

function calculateMentionRates(
  responses: RawResponseData[],
  mentions: RawMention[],
  competitorScores: RawCompetitorScore[]
): {
  client: {
    totalResponses: number;
    responsesWithMention: number;
    mentionRate: number;
  };
  competitors: Array<{
    name: string;
    totalResponses: number;
    responsesWithMention: number;
    mentionRate: number;
  }>;
} {
  const totalResponses = responses.length;
  const answerIdsWithMentions = new Set(mentions.map(m => m.answerId));
  
  const clientScores = competitorScores.filter(cs => cs.isClient);
  const clientName = clientScores.length > 0 ? clientScores[0].competitorName : '';
  
  const clientMentions = mentions.filter(m => 
    m.span.toLowerCase().includes(clientName.toLowerCase())
  );
  const clientAnswerIds = new Set(clientMentions.map(m => m.answerId));
  const clientResponsesWithMention = responses.filter(r => clientAnswerIds.has(r.answerId)).length;

  const competitorNames = Array.from(new Set(
    competitorScores
      .filter(cs => !cs.isClient)
      .map(cs => cs.competitorName)
  ));

  const competitorMentionRates = competitorNames.map(name => {
    const compMentions = mentions.filter(m => 
      m.span.toLowerCase().includes(name.toLowerCase())
    );
    const compAnswerIds = new Set(compMentions.map(m => m.answerId));
    const responsesWithMention = responses.filter(r => compAnswerIds.has(r.answerId)).length;

    return {
      name,
      totalResponses,
      responsesWithMention,
      mentionRate: totalResponses > 0 
        ? Math.round((responsesWithMention / totalResponses) * 1000) / 10 
        : 0,
    };
  }).sort((a, b) => b.mentionRate - a.mentionRate);

  return {
    client: {
      totalResponses,
      responsesWithMention: clientResponsesWithMention,
      mentionRate: totalResponses > 0 
        ? Math.round((clientResponsesWithMention / totalResponses) * 1000) / 10 
        : 0,
    },
    competitors: competitorMentionRates,
  };
}

function calculateRankingAnalysis(
  rankings: RawRanking[],
  competitorScores: RawCompetitorScore[]
): {
  client: {
    avgPosition: number | null;
    medianPosition: number | null;
    positionDistribution: { position: number; count: number }[];
    totalRankings: number;
  };
  competitors: Array<{
    name: string;
    avgPosition: number | null;
    medianPosition: number | null;
    totalRankings: number;
  }>;
} {
  const clientRankings = rankings.filter(r => r.isClientBrand);
  const clientPositions = clientRankings.map(r => r.position).sort((a, b) => a - b);
  
  const positionCounts = new Map<number, number>();
  clientPositions.forEach(pos => {
    positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
  });
  const positionDistribution = Array.from(positionCounts.entries())
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => a.position - b.position);

  const clientAvg = clientPositions.length > 0 
    ? Math.round((clientPositions.reduce((a, b) => a + b, 0) / clientPositions.length) * 10) / 10 
    : null;
  const clientMedian = clientPositions.length > 0 
    ? clientPositions[Math.floor(clientPositions.length / 2)] 
    : null;

  const competitorNames = Array.from(new Set(
    competitorScores
      .filter(cs => !cs.isClient)
      .map(cs => cs.competitorName)
  ));

  const competitorRankingAnalysis = competitorNames.map(name => {
    const compRankings = rankings.filter(r => 
      !r.isClientBrand && r.item.toLowerCase().includes(name.toLowerCase())
    );
    const positions = compRankings.map(r => r.position).sort((a, b) => a - b);

    return {
      name,
      avgPosition: positions.length > 0 
        ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 
        : null,
      medianPosition: positions.length > 0 
        ? positions[Math.floor(positions.length / 2)] 
        : null,
      totalRankings: compRankings.length,
    };
  }).sort((a, b) => (a.avgPosition || 999) - (b.avgPosition || 999));

  return {
    client: {
      avgPosition: clientAvg,
      medianPosition: clientMedian,
      positionDistribution,
      totalRankings: clientRankings.length,
    },
    competitors: competitorRankingAnalysis,
  };
}

function calculateCitationAnalysis(
  citations: RawCitation[]
): {
  topDomains: Array<{
    domain: string;
    citationCount: number;
    uniqueAnswers: number;
  }>;
  totalCitations: number;
  uniqueDomains: number;
} {
  const domainStats = new Map<string, { count: number; answerIds: Set<string> }>();

  citations.forEach(c => {
    if (c.domain) {
      if (!domainStats.has(c.domain)) {
        domainStats.set(c.domain, { count: 0, answerIds: new Set() });
      }
      const stats = domainStats.get(c.domain)!;
      stats.count++;
      stats.answerIds.add(c.answerId);
    }
  });

  const topDomains = Array.from(domainStats.entries())
    .map(([domain, stats]) => ({
      domain,
      citationCount: stats.count,
      uniqueAnswers: stats.answerIds.size,
    }))
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 20);

  return {
    topDomains,
    totalCitations: citations.length,
    uniqueDomains: domainStats.size,
  };
}

function calculateTopCompetitors(
  competitorScores: RawCompetitorScore[],
  mentions: RawMention[],
  rankings: RawRanking[]
): Array<{
  name: string;
  avgVisibilityScore: number;
  totalMentions: number;
  avgRankingPosition: number | null;
}> {
  const competitorStats = new Map<string, {
    name: string;
    isClient: boolean;
    visibilityScores: number[];
    mentionCount: number;
    positions: number[];
  }>();

  competitorScores.forEach(cs => {
    if (!competitorStats.has(cs.competitorName)) {
      competitorStats.set(cs.competitorName, {
        name: cs.competitorName,
        isClient: cs.isClient,
        visibilityScores: [],
        mentionCount: 0,
        positions: [],
      });
    }
    competitorStats.get(cs.competitorName)!.visibilityScores.push(cs.visibilityScore);
  });

  mentions.forEach(m => {
    competitorStats.forEach((stats, name) => {
      if (m.span.toLowerCase().includes(name.toLowerCase())) {
        stats.mentionCount++;
      }
    });
  });

  rankings.forEach(r => {
    competitorStats.forEach((stats, name) => {
      if (r.item.toLowerCase().includes(name.toLowerCase())) {
        stats.positions.push(r.position);
      }
    });
  });

  return Array.from(competitorStats.values())
    .map(stats => ({
      name: stats.name,
      avgVisibilityScore: stats.visibilityScores.length > 0 
        ? Math.round((stats.visibilityScores.reduce((a, b) => a + b, 0) / stats.visibilityScores.length) * 10) / 10 
        : 0,
      totalMentions: stats.mentionCount,
      avgRankingPosition: stats.positions.length > 0 
        ? Math.round((stats.positions.reduce((a, b) => a + b, 0) / stats.positions.length) * 10) / 10 
        : null,
    }))
    .sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore)
    .slice(0, 15);
}

// ===== END AGGREGATION HELPER FUNCTIONS =====

export interface SnapshotData {
  metadata: {
    clientId: string;
    projectId: string;
    runIds: string[];
    generatedAt: string;
    totalPrompts: number;
    totalModels: number;
    dateRange: {
      earliest: string;
      latest: string;
    };
  };
  promptRuns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    totalPrompts: number;
  }>;
  prompts: Array<{
    id: string;
    text: string;
    source: string;
    categoryId: string | null;
    categoryName: string | null;
    accepted: boolean | null;
    createdAt: string | null;
  }>;
  models: Array<{
    id: string;
    vendor: string;
    model: string;
    displayName: string;
    maxTpm: number | null;
    maxRpm: number | null;
    costPer1kInput: string | null;
    costPer1kOutput: string | null;
    enabled: boolean;
  }>;
  responses: Array<{
    promptRunItemId: string;
    answerId: string;
    promptId: string;
    modelId: string;
    answer: string;
    nativeSearchEvidence?: SearchEvidence;
    // Task #105 (R2) — cached summary from a prior run, if any. The
    // report processor reads this in Step 3 and skips re-summarizing
    // already-summarized answers.
    summary: string | null;
    citationCount: number;
    mentionCount: number;
    rankingCount: number;
    visibilityScore: number | null;
    sentimentScore: number | null;
    positionScore: number | null;
    firstMentionPos: number | null;
  }>;
  citations: Array<{
    answerId: string;
    url: string | null;
    domain: string | null;
    displayText: string | null;
    position: number;
    type: string;
  }>;
  mentions: Array<{
    answerId: string;
    span: string;
    sentiment: string;
    isAlias: boolean;
  }>;
  rankings: Array<{
    answerId: string;
    item: string;
    position: number;
    isClientBrand: boolean;
    rankingGroup: string | null;
    groupRelevance: string | null;
    relevanceReason: string | null;
  }>;
  competitorScores: Array<{
    competitorId: string | null;
    competitorName: string;
    promptId: string | null;
    promptRunId: string;
    isClient: boolean;
    positionScore: number;
    sentimentScore: number;
    visibilityScore: number;
  }>;
  recommendations: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    description: string | null;
    source: string;
    examples: any | null;
    actionItems: any | null;
    promptRunId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  // ===== PHASE 1: STRUCTURED METRICS FOR DATA-BACKED REPORTS =====
  aggregatedMetrics: {
    // Brand/Competitor visibility by model
    visibilityByModel: Array<{
      brandName: string;
      isClient: boolean;
      modelId: string;
      modelName: string;
      avgVisibilityScore: number;
      avgPositionScore: number;
      avgSentimentScore: number;
      totalMentions: number;
      responseCount: number;
    }>;
    // Mention rate analysis
    mentionRates: {
      client: {
        totalResponses: number;
        responsesWithMention: number;
        mentionRate: number;
      };
      competitors: Array<{
        name: string;
        totalResponses: number;
        responsesWithMention: number;
        mentionRate: number;
      }>;
    };
    // Ranking position analysis
    rankingAnalysis: {
      client: {
        avgPosition: number | null;
        medianPosition: number | null;
        positionDistribution: { position: number; count: number }[];
        totalRankings: number;
      };
      competitors: Array<{
        name: string;
        avgPosition: number | null;
        medianPosition: number | null;
        totalRankings: number;
      }>;
    };
    // Citation authority metrics
    citationAnalysis: {
      topDomains: Array<{
        domain: string;
        citationCount: number;
        uniqueAnswers: number;
      }>;
      totalCitations: number;
      uniqueDomains: number;
    };
    // Top performers
    topCompetitors: Array<{
      name: string;
      avgVisibilityScore: number;
      totalMentions: number;
      avgRankingPosition: number | null;
    }>;
  };
  // Topics associated with the client
  topics: Array<{
    id: string;
    label: string;
    category: string | null;
    keywords: any | null;
    source: string;
    accepted: boolean;
    createdAt: string;
  }>;
  // Prompt categories taxonomy
  promptCategories: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    createdAt: string;
  }>;
  // X-Ray site crawl data
  xraySites: Array<{
    id: string;
    clientId: string;
    domain: string;
    siteType: string;
    robotsTxtPresent: boolean;
    aiTxtPresent: boolean;
    crawlAccessStatus: string;
    robotsRules: any | null;
    aiTxtContent: string | null;
    healthProbeStatus: string | null;
    lastProbedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  // X-Ray crawled pages with structure
  xrayPages: Array<{
    id: string;
    siteId: string;
    url: string;
    title: string | null;
    pageType: string | null;
    statusCode: number | null;
    wordCount: number;
    headings: any | null;
    entities: any | null;
    topics: any | null;
    sentimentScore: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  // X-Ray AI analysis results
  xrayAnalysis: Array<{
    id: string;
    pageId: string;
    pageUrl: string;
    assessment: string | null;
    gaps: any | null;
    recommendations: any | null;
    actions: any | null;
    seoIssues: any | null;
    scores: any | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

// ===== PHASE 2: CONSULTING DATA PACKET FOR NARRATIVE ENHANCEMENT =====

export interface ConsultingBenchmarks {
  visibility: {
    excellent: number;
    good: number;
    average: number;
    poor: number;
  };
  mentionRate: {
    high: number;
    moderate: number;
    low: number;
  };
  rankingPosition: {
    top: number;
    middle: number;
    bottom: number;
  };
}

const DEFAULT_BENCHMARKS: ConsultingBenchmarks = {
  visibility: { excellent: 80, good: 60, average: 40, poor: 20 },
  mentionRate: { high: 60, moderate: 30, low: 10 },
  rankingPosition: { top: 3, middle: 7, bottom: 10 },
};

export interface ConsultingDataPacket {
  clientName: string;
  snapshotDate: string;
  benchmarks: ConsultingBenchmarks;
  
  clientPerformance: {
    overallVisibility: number;
    visibilityInterpretation: string;
    mentionRate: number;
    mentionRateInterpretation: string;
    avgRankingPosition: number | null;
    positionInterpretation: string;
    totalRankings: number;
  };
  
  competitiveContext: {
    clientRank: number;
    totalCompetitors: number;
    topCompetitor: { name: string; visibilityScore: number } | null;
    visibilityGapToLeader: number | null;
    clientVsAverage: string;
  };
  
  modelBreakdown: Array<{
    modelName: string;
    clientVisibility: number;
    interpretation: string;
    strongestCompetitor: string | null;
    competitorVisibility: number | null;
  }>;
  
  keyInsights: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  
  citationAuthority: {
    totalCitations: number;
    topDomains: Array<{ domain: string; count: number; interpretation: string }>;
    domainDiversity: string;
  };
}

function interpretVisibility(score: number, benchmarks: ConsultingBenchmarks): string {
  if (score >= benchmarks.visibility.excellent) {
    return `EXCELLENT (${score.toFixed(1)}) - Strong AI visibility positioning`;
  } else if (score >= benchmarks.visibility.good) {
    return `GOOD (${score.toFixed(1)}) - Solid visibility with improvement opportunities`;
  } else if (score >= benchmarks.visibility.average) {
    return `AVERAGE (${score.toFixed(1)}) - Moderate visibility, competitive gaps exist`;
  } else if (score >= benchmarks.visibility.poor) {
    return `BELOW AVERAGE (${score.toFixed(1)}) - Significant visibility challenges`;
  } else {
    return `POOR (${score.toFixed(1)}) - Critical visibility deficit requiring immediate attention`;
  }
}

function interpretMentionRate(rate: number, benchmarks: ConsultingBenchmarks): string {
  if (rate >= benchmarks.mentionRate.high) {
    return `HIGH (${rate.toFixed(1)}%) - Frequently mentioned in AI responses`;
  } else if (rate >= benchmarks.mentionRate.moderate) {
    return `MODERATE (${rate.toFixed(1)}%) - Occasional mentions, room for growth`;
  } else if (rate >= benchmarks.mentionRate.low) {
    return `LOW (${rate.toFixed(1)}%) - Rarely mentioned, limited AI awareness`;
  } else {
    return `MINIMAL (${rate.toFixed(1)}%) - Negligible AI presence`;
  }
}

function interpretPosition(position: number | null, benchmarks: ConsultingBenchmarks): string {
  if (position === null) {
    return 'NOT RANKED - Brand does not appear in AI rankings';
  }
  if (position <= benchmarks.rankingPosition.top) {
    return `TOP TIER (Position ${position.toFixed(1)}) - Prominent AI recommendation`;
  } else if (position <= benchmarks.rankingPosition.middle) {
    return `MID TIER (Position ${position.toFixed(1)}) - Secondary recommendation`;
  } else {
    return `LOWER TIER (Position ${position.toFixed(1)}) - Buried in recommendations`;
  }
}

function interpretDomainDiversity(uniqueDomains: number): string {
  if (uniqueDomains >= 20) {
    return 'HIGH DIVERSITY - Broad citation authority across many sources';
  } else if (uniqueDomains >= 10) {
    return 'MODERATE DIVERSITY - Reasonable citation spread';
  } else if (uniqueDomains >= 5) {
    return 'LIMITED DIVERSITY - Concentrated citation sources';
  } else {
    return 'LOW DIVERSITY - Very few citation sources';
  }
}

export function buildConsultingDataPacket(
  snapshot: SnapshotData,
  clientName: string,
  benchmarks: ConsultingBenchmarks = DEFAULT_BENCHMARKS
): ConsultingDataPacket {
  const { aggregatedMetrics } = snapshot;
  
  // Client visibility metrics
  const clientScores = aggregatedMetrics.visibilityByModel.filter(v => v.isClient);
  const overallClientVisibility = clientScores.length > 0
    ? clientScores.reduce((sum, v) => sum + v.avgVisibilityScore, 0) / clientScores.length
    : 0;
  
  // Competitive context
  const allCompetitors = aggregatedMetrics.topCompetitors;
  const clientInTopCompetitors = allCompetitors.find(c => 
    c.name.toLowerCase() === clientName.toLowerCase()
  );
  const clientRankInCompetitors = allCompetitors.findIndex(c => 
    c.name.toLowerCase() === clientName.toLowerCase()
  );
  const topCompetitor = allCompetitors.filter(c => 
    c.name.toLowerCase() !== clientName.toLowerCase()
  )[0] || null;
  
  const visibilityGapToLeader = topCompetitor && clientInTopCompetitors
    ? topCompetitor.avgVisibilityScore - clientInTopCompetitors.avgVisibilityScore
    : null;
  
  // Calculate average competitor visibility
  const competitorVisibilities = allCompetitors
    .filter(c => c.name.toLowerCase() !== clientName.toLowerCase())
    .map(c => c.avgVisibilityScore);
  const avgCompetitorVisibility = competitorVisibilities.length > 0
    ? competitorVisibilities.reduce((a, b) => a + b, 0) / competitorVisibilities.length
    : 0;
  
  const clientVsAverage = overallClientVisibility > avgCompetitorVisibility
    ? `OUTPERFORMING average by ${(overallClientVisibility - avgCompetitorVisibility).toFixed(1)} points`
    : overallClientVisibility < avgCompetitorVisibility
    ? `UNDERPERFORMING average by ${(avgCompetitorVisibility - overallClientVisibility).toFixed(1)} points`
    : 'MATCHING competitive average';
  
  // Model breakdown with interpretations
  const modelBreakdown = snapshot.models.map(model => {
    const clientForModel = clientScores.find(c => c.modelId === model.id);
    const competitorsForModel = aggregatedMetrics.visibilityByModel
      .filter(v => !v.isClient && v.modelId === model.id)
      .sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore);
    
    const strongestComp = competitorsForModel[0] || null;
    
    return {
      modelName: model.displayName || model.vendor,
      clientVisibility: clientForModel?.avgVisibilityScore || 0,
      interpretation: interpretVisibility(clientForModel?.avgVisibilityScore || 0, benchmarks),
      strongestCompetitor: strongestComp?.brandName || null,
      competitorVisibility: strongestComp?.avgVisibilityScore || null,
    };
  });
  
  // Generate SWOT-style insights
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const threats: string[] = [];
  
  // Analyze visibility
  if (overallClientVisibility >= benchmarks.visibility.good) {
    strengths.push(`Strong overall visibility score (${overallClientVisibility.toFixed(1)})`);
  } else if (overallClientVisibility < benchmarks.visibility.average) {
    weaknesses.push(`Low visibility score (${overallClientVisibility.toFixed(1)}) needs improvement`);
  }
  
  // Analyze mention rate
  const { mentionRates } = aggregatedMetrics;
  if (mentionRates.client.mentionRate >= benchmarks.mentionRate.high) {
    strengths.push(`High mention rate (${mentionRates.client.mentionRate.toFixed(1)}%) in AI responses`);
  } else if (mentionRates.client.mentionRate < benchmarks.mentionRate.low) {
    weaknesses.push(`Low mention rate (${mentionRates.client.mentionRate.toFixed(1)}%) - limited AI awareness`);
    opportunities.push('Increase content visibility to improve AI mention frequency');
  }
  
  // Analyze ranking position
  const { rankingAnalysis } = aggregatedMetrics;
  if (rankingAnalysis.client.avgPosition !== null) {
    if (rankingAnalysis.client.avgPosition <= benchmarks.rankingPosition.top) {
      strengths.push(`Strong ranking position (avg ${rankingAnalysis.client.avgPosition.toFixed(1)})`);
    } else if (rankingAnalysis.client.avgPosition > benchmarks.rankingPosition.middle) {
      weaknesses.push(`Poor ranking position (avg ${rankingAnalysis.client.avgPosition.toFixed(1)})`);
    }
  } else {
    weaknesses.push('Not appearing in AI rankings');
    opportunities.push('Develop ranking-focused content strategy');
  }
  
  // Analyze competitive position
  if (visibilityGapToLeader !== null && visibilityGapToLeader > 20) {
    threats.push(`Significant visibility gap (${visibilityGapToLeader.toFixed(1)} points) to leader ${topCompetitor?.name}`);
  }
  if (clientRankInCompetitors > 3) {
    threats.push(`Ranked #${clientRankInCompetitors + 1} among ${allCompetitors.length} competitors`);
  }
  
  // Model-specific insights
  modelBreakdown.forEach(m => {
    if (m.competitorVisibility && m.clientVisibility < m.competitorVisibility - 20) {
      threats.push(`${m.modelName}: ${m.strongestCompetitor} leads by ${(m.competitorVisibility - m.clientVisibility).toFixed(1)} points`);
    }
    if (m.clientVisibility >= benchmarks.visibility.good && (!m.competitorVisibility || m.clientVisibility > m.competitorVisibility)) {
      opportunities.push(`${m.modelName}: Strong position to defend and extend`);
    }
  });
  
  // Citation insights
  const { citationAnalysis } = aggregatedMetrics;
  const topDomainsWithInterpretation = citationAnalysis.topDomains.slice(0, 10).map(d => ({
    domain: d.domain,
    count: d.citationCount,
    interpretation: d.citationCount >= 10 
      ? 'High authority source' 
      : d.citationCount >= 5 
      ? 'Moderate citation source' 
      : 'Emerging source',
  }));
  
  return {
    clientName,
    snapshotDate: snapshot.metadata.generatedAt,
    benchmarks,
    
    clientPerformance: {
      overallVisibility: Math.round(overallClientVisibility * 10) / 10,
      visibilityInterpretation: interpretVisibility(overallClientVisibility, benchmarks),
      mentionRate: mentionRates.client.mentionRate,
      mentionRateInterpretation: interpretMentionRate(mentionRates.client.mentionRate, benchmarks),
      avgRankingPosition: rankingAnalysis.client.avgPosition,
      positionInterpretation: interpretPosition(rankingAnalysis.client.avgPosition, benchmarks),
      totalRankings: rankingAnalysis.client.totalRankings,
    },
    
    competitiveContext: {
      clientRank: clientRankInCompetitors >= 0 ? clientRankInCompetitors + 1 : allCompetitors.length + 1,
      totalCompetitors: allCompetitors.length,
      topCompetitor: topCompetitor ? { 
        name: topCompetitor.name, 
        visibilityScore: topCompetitor.avgVisibilityScore 
      } : null,
      visibilityGapToLeader,
      clientVsAverage,
    },
    
    modelBreakdown,
    
    keyInsights: {
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      opportunities: opportunities.slice(0, 5),
      threats: threats.slice(0, 5),
    },
    
    citationAuthority: {
      totalCitations: citationAnalysis.totalCitations,
      topDomains: topDomainsWithInterpretation,
      domainDiversity: interpretDomainDiversity(citationAnalysis.uniqueDomains),
    },
  };
}

// ===== END PHASE 2: CONSULTING DATA PACKET =====

export async function aggregateSnapshotData(
  clientId: string,
  runIds: string[]
): Promise<SnapshotData> {
  if (runIds.length === 0) {
    throw new Error('At least one run ID is required');
  }

  // Task #105 (P1) — Fan out every query that depends only on runIds /
  // clientId in a single Promise.all instead of two sequential awaits
  // (runsData, then itemsData, then the big block). Cuts ~2 round-trips
  // off cold report aggregation. answers / citations / mentions /
  // rankings still gate on item-id / answer-id results below.
  const [
    runsData,
    itemsData,
    uniquePrompts,
    modelsData,
    competitorScoresData,
    recommendationsData,
    topicsData,
    categoriesData,
    xraySitesData,
  ] = await Promise.all([
    db.select({
      id: promptRuns.id,
      name: promptRuns.name,
      status: promptRuns.status,
      createdAt: promptRuns.createdAt,
      totalPrompts: promptRuns.totalPrompts,
      projectId: clients.projectName,
    }).from(promptRuns)
      .innerJoin(clients, eq(promptRuns.clientId, clients.id))
      .where(
        and(
          eq(promptRuns.clientId, clientId),
          inArray(promptRuns.id, runIds)
        )
      ),

    db.select().from(promptRunItems).where(
      inArray(promptRunItems.promptRunId, runIds)
    ),

    db.selectDistinct({ 
      id: prompts.id, 
      text: prompts.text, 
      source: prompts.source,
      categoryId: prompts.categoryId,
      categoryName: promptCategories.name,
      accepted: prompts.accepted,
      createdAt: prompts.createdAt
    }).from(prompts)
      .innerJoin(promptRunItems, eq(prompts.id, promptRunItems.promptId))
      .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
      .where(inArray(promptRunItems.promptRunId, runIds)),
    
    db.select().from(aiModels),
    
    db.select().from(competitorScores).where(
      inArray(competitorScores.promptRunId, runIds)
    ),
    
    db.select().from(recommendations).where(
      and(
        eq(recommendations.clientId, clientId),
        inArray(recommendations.promptRunId, runIds)
      )
    ),
    
    // Fetch topics for the client
    db.select().from(topics).where(eq(topics.clientId, clientId)),
    
    // Fetch all prompt categories
    db.select().from(promptCategories),
    
    // Fetch X-Ray sites for the client
    db.select().from(xraySites).where(eq(xraySites.clientId, clientId)),
  ]);

  if (runsData.length === 0) {
    throw new Error('No prompt runs found for the specified IDs');
  }

  const invalidItems = itemsData.filter(item => !item.promptId || !item.modelId);
  if (invalidItems.length > 0) {
    const invalidIds = invalidItems.map(item => item.id).join(', ');
    throw new Error(`Data integrity error: ${invalidItems.length} prompt run items missing promptId or modelId. Invalid item IDs: ${invalidIds}`);
  }

  const itemIds = itemsData.map(item => item.id);

  const answersData = itemIds.length > 0
    ? await db.select().from(answers).where(inArray(answers.promptRunItemId, itemIds))
    : [];

  // Fetch X-Ray pages for all client sites
  const xraySiteIds = xraySitesData.map(s => s.id);
  
  const xrayPagesData = xraySiteIds.length > 0
    ? await db.select().from(xrayPages).where(inArray(xrayPages.siteId, xraySiteIds))
    : [];
  
  // Now filter structure and analysis by the client's page IDs (security + performance)
  const xrayPageIds = xrayPagesData.map(p => p.id);
  
  const [xrayPageStructureData, xrayPageAnalysisData] = await Promise.all([
    xrayPageIds.length > 0
      ? db.select().from(xrayPageStructure).where(inArray(xrayPageStructure.pageId, xrayPageIds))
      : Promise.resolve([]),
    xrayPageIds.length > 0
      ? db.select().from(xrayPageAnalysis).where(inArray(xrayPageAnalysis.pageId, xrayPageIds))
      : Promise.resolve([]),
  ]);

  // Create lookup maps for page structure and analysis
  const pageStructureMap = new Map(xrayPageStructureData.map(s => [s.pageId, s]));
  const pageAnalysisMap = new Map(xrayPageAnalysisData.map(a => [a.pageId, a]));
  const pageUrlMap = new Map(xrayPagesData.map(p => [p.id, p.url]));

  const answerIds = answersData.map(a => a.id);

  const [citationsData, mentionsData, rankingsData] = await Promise.all([
    answerIds.length > 0
      ? db.select().from(citations).where(inArray(citations.answerId, answerIds))
      : Promise.resolve([]),
    answerIds.length > 0
      ? db.select().from(mentions).where(inArray(mentions.answerId, answerIds))
      : Promise.resolve([]),
    answerIds.length > 0
      ? db.select().from(rankings).where(inArray(rankings.answerId, answerIds))
      : Promise.resolve([]),
  ]);

  const projectId = runsData[0].projectId || clientId;
  if (!runsData[0].projectId) {
    console.warn(`Warning: Client ${clientId} is missing projectName. Falling back to clientId for report organization.`);
  }
  const dates = runsData.map(r => r.createdAt).filter(d => d !== null);
  const earliest = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
  const latest = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

  const uniqueModelIds = new Set<string>();
  itemsData.forEach(item => {
    uniqueModelIds.add(item.modelId);
  });

  const modelIdSet = new Set(modelsData.map(m => m.id));
  const missingModelIds = Array.from(uniqueModelIds).filter(id => !modelIdSet.has(id));
  if (missingModelIds.length > 0) {
    console.warn(`Warning: ${missingModelIds.length} AI models referenced by prompt run items do not exist (will be skipped). Missing model IDs: ${missingModelIds.join(', ')}`);
  }

  const promptIdSet = new Set(uniquePrompts.map(p => p.id));
  const referencedPromptIds = new Set(itemsData.map(item => item.promptId));
  const missingPromptIds = Array.from(referencedPromptIds).filter(id => !promptIdSet.has(id));
  if (missingPromptIds.length > 0) {
    console.warn(`Warning: ${missingPromptIds.length} prompts referenced by prompt run items do not exist (will be skipped). Missing prompt IDs: ${missingPromptIds.join(', ')}`);
  }

  const answerMap = new Map<string, typeof answersData[0]>();
  answersData.forEach(a => {
    answerMap.set(a.promptRunItemId, a);
  });

  const itemsWithoutAnswers = itemsData.filter(item => !answerMap.has(item.id));
  if (itemsWithoutAnswers.length > 0) {
    const missingIds = itemsWithoutAnswers.map(item => item.id).join(', ');
    if (itemsWithoutAnswers.length === itemsData.length) {
      throw new Error(`Data integrity error: ALL prompt run items (${itemsWithoutAnswers.length}) have no corresponding answers. This indicates upstream corruption. Item IDs: ${missingIds.substring(0, 200)}...`);
    }
    console.warn(`Warning: ${itemsWithoutAnswers.length} of ${itemsData.length} prompt run items have no answers (will be skipped). Item IDs: ${missingIds.substring(0, 200)}${missingIds.length > 200 ? '...' : ''}`);
  }

  const promptMap = new Map(uniquePrompts.map(p => [p.id, p]));
  const modelMap = new Map(modelsData.map(m => [m.id, m]));

  const nativeRuns = await db.select({ id: promptRuns.id }).from(promptRuns).where(and(
    inArray(promptRuns.id, runIds), sql`${promptRuns.searchConfig}->'webSearch'->>'enabled' = 'true'`));
  const nativeRunIds = new Set(nativeRuns.map(run => run.id));
  const nativeRows = (await Promise.all(nativeRuns.map(run => new NativeSearchStore().details(run.id)))).flat();
  const nativeByItem = new Map(nativeRows.map(row => [row.itemId, row]));
  const responses = itemsData
    .filter(item => {
      const answer = answerMap.get(item.id);
      if (!answer) return false;

      const prompt = promptMap.get(item.promptId);
      if (!prompt || !prompt.text) {
        console.warn(`Skipping item ${item.id}: prompt ${item.promptId} is missing or has no text`);
        return false;
      }

      const model = modelMap.get(item.modelId);
      if (!model) {
        console.warn(`Skipping item ${item.id}: model ${item.modelId} is missing`);
        return false;
      }

      if (!answer.rawResponse) {
        console.warn(`Skipping item ${item.id}: answer has no rawResponse content`);
        return false;
      }

      return true;
    })
    .map(item => {
      const answer = answerMap.get(item.id)!;
      const answerId = answer.id;
      const prompt = promptMap.get(item.promptId)!;
      const model = modelMap.get(item.modelId)!;

      const itemCitations = citationsData.filter(c => c.answerId === answerId);
      const itemMentions = mentionsData.filter(m => m.answerId === answerId);
      const itemRankings = rankingsData.filter(r => r.answerId === answerId);
      let nativeSearchEvidence: SearchEvidence | undefined;
      if (nativeRunIds.has(item.promptRunId)) {
        const native = nativeByItem.get(item.id);
        if (!native?.evidence || native.answerText !== answer.rawResponse) {
          throw new Error("Required native answer attribution is missing or inconsistent; export stopped.");
        }
        nativeSearchEvidence = validateGeneration({ answerText: answer.rawResponse, evidence: native.evidence }).evidence;
      }

      return {
        promptRunItemId: item.id,
        answerId,
        promptId: item.promptId,
        modelId: item.modelId,
        answer: answer.rawResponse,
        ...(nativeSearchEvidence ? { nativeSearchEvidence } : {}),
        summary: answer.summary ?? null,
        citationCount: itemCitations.length,
        mentionCount: itemMentions.length,
        rankingCount: itemRankings.length,
        visibilityScore: answer.visibilityScore !== null && answer.visibilityScore !== undefined 
          ? parseFloat(answer.visibilityScore) : null,
        sentimentScore: answer.sentimentScore !== null && answer.sentimentScore !== undefined 
          ? parseFloat(answer.sentimentScore) : null,
        positionScore: answer.positionScore !== null && answer.positionScore !== undefined 
          ? parseFloat(answer.positionScore) : null,
        firstMentionPos: answer.firstMentionPos,
      };
    });

  if (responses.length === 0 && itemsData.length > 0) {
    throw new Error(`Data integrity error: No valid responses could be assembled from ${itemsData.length} prompt run items. All items are missing prompts, models, or answers.`);
  }

  console.log(`Snapshot aggregation: processed ${responses.length} of ${itemsData.length} total items`);

  // Prepare data in format expected by helper functions
  const formattedCitations: RawCitation[] = citationsData.map(c => ({
    answerId: c.answerId,
    url: c.url,
    domain: c.domain,
    displayText: c.displayText,
    position: c.position,
    type: c.type,
  }));

  const formattedMentions: RawMention[] = mentionsData.map(m => ({
    answerId: m.answerId,
    span: m.span,
    sentiment: m.sentiment,
    isAlias: m.isAlias,
  }));

  const formattedRankings: RawRanking[] = rankingsData.map(r => ({
    answerId: r.answerId,
    item: r.item,
    position: r.position,
    isClientBrand: r.isClientBrand,
    rankingGroup: r.rankingGroup,
    groupRelevance: r.groupRelevance,
    relevanceReason: r.relevanceReason,
  }));

  const formattedCompetitorScores: RawCompetitorScore[] = competitorScoresData.map(cs => ({
    competitorId: cs.competitorId,
    competitorName: cs.competitorName,
    promptId: cs.promptId,
    promptRunId: cs.promptRunId,
    isClient: cs.isClient,
    positionScore: parseFloat(cs.positionScore || '0'),
    sentimentScore: parseFloat(cs.sentimentScore || '0'),
    visibilityScore: parseFloat(cs.visibilityScore || '0'),
  }));

  const formattedModels: ModelInfo[] = modelsData.filter(m => uniqueModelIds.has(m.id)).map(m => ({
    id: m.id,
    vendor: m.vendor,
    model: m.model,
    displayName: m.displayName,
    maxTpm: m.maxTpm,
    maxRpm: m.maxRpm,
    costPer1kInput: m.costPer1kInput,
    costPer1kOutput: m.costPer1kOutput,
    enabled: m.enabled,
  }));

  // Calculate aggregated metrics
  console.log(`Calculating aggregated metrics...`);
  
  const visibilityByModel = calculateVisibilityByModel(
    formattedCompetitorScores,
    responses,
    formattedMentions,
    formattedModels
  );

  const mentionRates = calculateMentionRates(
    responses,
    formattedMentions,
    formattedCompetitorScores
  );

  const rankingAnalysis = calculateRankingAnalysis(
    formattedRankings,
    formattedCompetitorScores
  );

  const citationAnalysis = calculateCitationAnalysis(formattedCitations);

  const topCompetitors = calculateTopCompetitors(
    formattedCompetitorScores,
    formattedMentions,
    formattedRankings
  );

  console.log(`Aggregated metrics calculated: ${visibilityByModel.length} visibility entries, ${topCompetitors.length} competitors`);

  return {
    metadata: {
      clientId,
      projectId,
      runIds,
      generatedAt: new Date().toISOString(),
      totalPrompts: uniquePrompts.length,
      totalModels: uniqueModelIds.size,
      dateRange: {
        earliest: earliest.toISOString(),
        latest: latest.toISOString(),
      },
    },
    promptRuns: runsData.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      createdAt: run.createdAt,
      totalPrompts: run.totalPrompts,
    })),
    prompts: uniquePrompts.map(p => ({
      id: p.id,
      text: p.text,
      source: p.source,
      categoryId: p.categoryId || null,
      categoryName: p.categoryName || null,
      accepted: p.accepted ?? null,
      createdAt: p.createdAt ? p.createdAt.toISOString() : null,
    })),
    models: formattedModels,
    responses,
    citations: formattedCitations,
    mentions: formattedMentions,
    rankings: formattedRankings,
    competitorScores: formattedCompetitorScores,
    recommendations: recommendationsData.map(rec => ({
      id: rec.id,
      title: rec.title,
      category: rec.category,
      severity: rec.severity,
      description: rec.description,
      source: rec.source,
      examples: rec.examples || null,
      actionItems: rec.actionItems || null,
      promptRunId: rec.promptRunId || null,
      createdAt: rec.createdAt ? rec.createdAt.toISOString() : null,
      updatedAt: rec.updatedAt ? rec.updatedAt.toISOString() : null,
    })),
    aggregatedMetrics: {
      visibilityByModel,
      mentionRates,
      rankingAnalysis,
      citationAnalysis,
      topCompetitors,
    },
    topics: topicsData.map(t => ({
      id: t.id,
      label: t.label,
      category: t.category || null,
      keywords: t.keywords || null,
      source: t.source,
      accepted: t.accepted,
      createdAt: t.createdAt.toISOString(),
    })),
    promptCategories: categoriesData.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description || null,
      createdAt: c.createdAt.toISOString(),
    })),
    xraySites: xraySitesData.map(s => ({
      id: s.id,
      clientId: s.clientId,
      domain: s.domain,
      siteType: s.siteType,
      robotsTxtPresent: s.robotsTxtPresent,
      aiTxtPresent: s.aiTxtPresent,
      crawlAccessStatus: s.crawlAccessStatus,
      robotsRules: s.robotsRules || null,
      aiTxtContent: s.aiTxtContent || null,
      healthProbeStatus: s.healthProbeStatus || null,
      lastProbedAt: s.lastProbedAt ? s.lastProbedAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    xrayPages: xrayPagesData.map(p => {
      const structure = pageStructureMap.get(p.id);
      return {
        id: p.id,
        siteId: p.siteId,
        url: p.url,
        title: p.title || null,
        pageType: p.pageType || null,
        statusCode: p.statusCode || null,
        wordCount: p.wordCount || 0,
        headings: structure?.headings || null,
        entities: structure?.entities || null,
        topics: structure?.topics || null,
        sentimentScore: structure?.sentimentScore || null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    }),
    xrayAnalysis: xrayPageAnalysisData.map(a => ({
      id: a.id,
      pageId: a.pageId,
      pageUrl: pageUrlMap.get(a.pageId) || '',
      assessment: a.assessment || null,
      gaps: a.gaps || null,
      recommendations: a.recommendations || null,
      actions: a.actions || null,
      seoIssues: a.seoIssues || null,
      scores: a.scores || null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
  };
}
