import { db } from '../db';
import { 
  promptRuns,
  clients, 
  competitors,
  promptRunItems, 
  answers, 
  citations, 
  mentions, 
  rankings, 
  competitorScores,
  recommendations,
  prompts,
  aiModels,
  topics,
  xrayPages,
  xraySites,
  xrayPageAnalysis,
  promptCategories
} from '@shared/schema';
import { eq, inArray, and, desc, sql, isNull } from 'drizzle-orm';

export interface ClientContext {
  id: string;
  name: string;
  projectName: string | null;
  industry: string | null;
  geography: string | null;
}

export interface TopicData {
  id: string;
  label: string;
  source: string;
}

export interface XrayPageData {
  id: string;
  url: string;
  title: string | null;
  contentHash: string | null;
}

export interface XrayRecommendation {
  id: string;
  pageId: string;
  category: string;
  title: string;
  description: string | null;
  severity: string;
  url: string | null;
}

export interface PromptData {
  id: string;
  text: string;
  source: string;
  category: string | null;
}

export interface ModelData {
  id: string;
  vendor: string;
  displayName: string;
}

export interface ScoreTrend {
  promptRunId: string;
  runName: string;
  createdAt: Date;
  visibilityScore: number;
  sentimentScore: number;
  positionScore: number;
}

export interface PositionChange {
  promptId: string;
  promptText: string;
  modelId: string;
  modelName: string;
  previousPosition: number | null;
  currentPosition: number | null;
  change: number;
}

export interface DetailedScore {
  entityType: 'client' | 'competitor';
  entityId: string;
  entityName: string;
  promptId: string;
  modelId: string;
  visibilityScore: number;
  sentimentScore: number;
  positionScore: number;
  citationCount: number;
  mentionCount: number;
  rankingPosition: number | null;
}

export interface CompetitorData {
  id: string;
  name: string;
  website: string | null;
}

export interface CompetitorScore {
  competitorId: string | null;
  competitorName: string;
  promptId: string | null;
  promptRunId: string;
  positionScore: number;
  sentimentScore: number;
  visibilityScore: number;
}

export interface CitationDomain {
  domain: string;
  citationCount: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface CitationPattern {
  domain: string;
  url: string | null;
  occurrences: number;
  positions: number[];
  citationType: string;
}

export interface DiscoveryData {
  promptRunId: string;
  runName: string;
  newCompetitors: string[];
  newDomains: string[];
  newKeywords: string[];
}

export interface MisclassificationPattern {
  promptId: string;
  modelId: string;
  expectedEntity: string;
  actualEntity: string;
  occurrences: number;
}

export interface TopicMentionPattern {
  topicId: string;
  topicText: string;
  mentionCount: number;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
}

export class ReportAggregator {
  constructor(private clientId: string, private runIds: string[]) {
    if (!clientId) {
      throw new Error('Client ID is required');
    }
    if (runIds.length === 0) {
      throw new Error('At least one run ID is required');
    }
  }

  async getClient(): Promise<ClientContext> {
    const [client] = await db.select({
      id: clients.id,
      name: clients.name,
      projectName: clients.projectName,
      industry: clients.industry,
      geography: clients.geography,
    }).from(clients)
      .where(eq(clients.id, this.clientId))
      .limit(1);

    if (!client) {
      throw new Error(`Client not found: ${this.clientId}`);
    }

    return client;
  }

  async getClientIndustry(): Promise<string | null> {
    const client = await this.getClient();
    return client.industry;
  }

  async getClientLocation(): Promise<string | null> {
    const [clientData] = await db.select({
      geography: clients.geography,
    }).from(clients)
      .where(eq(clients.id, this.clientId))
      .limit(1);

    return clientData?.geography || null;
  }

  async getClientTopics(): Promise<TopicData[]> {
    const topicsData = await db.select({
      id: topics.id,
      label: topics.label,
      source: topics.source,
    }).from(topics)
      .where(eq(topics.clientId, this.clientId));

    return topicsData;
  }

  async getXrayPages(): Promise<XrayPageData[]> {
    const pages = await db.select({
      id: xrayPages.id,
      url: xrayPages.url,
      title: xrayPages.title,
      contentHash: sql<string | null>`NULL`,
    }).from(xrayPages)
      .innerJoin(xraySites, eq(xrayPages.siteId, xraySites.id))
      .where(eq(xraySites.clientId, this.clientId));

    return pages;
  }

  async getXrayRecommendations(): Promise<XrayRecommendation[]> {
    const analyses = await db.select({
      id: xrayPageAnalysis.id,
      pageId: xrayPageAnalysis.pageId,
      recommendations: xrayPageAnalysis.recommendations,
      url: xrayPages.url,
    }).from(xrayPageAnalysis)
      .innerJoin(xrayPages, eq(xrayPageAnalysis.pageId, xrayPages.id))
      .innerJoin(xraySites, eq(xrayPages.siteId, xraySites.id))
      .where(eq(xraySites.clientId, this.clientId));

    const recs: XrayRecommendation[] = [];
    for (const analysis of analyses) {
      const recsArray = analysis.recommendations as any[] || [];
      for (const rec of recsArray) {
        recs.push({
          id: analysis.id,
          pageId: analysis.pageId,
          category: rec.category || 'general',
          title: rec.title || rec.recommendation || '',
          description: rec.description || null,
          severity: rec.severity || rec.priority || 'medium',
          url: analysis.url,
        });
      }
    }

    return recs;
  }

  async getContentGaps(): Promise<string[]> {
    const allRecommendations = await db.select({
      id: recommendations.id,
      title: recommendations.title,
      category: recommendations.category,
      description: recommendations.description,
    }).from(recommendations)
      .where(
        and(
          eq(recommendations.clientId, this.clientId),
          eq(recommendations.category, 'content_gap')
        )
      );

    return allRecommendations.map(r => r.title);
  }

  async getPromptLibrary(): Promise<PromptData[]> {
    const promptsData = await db.selectDistinct({
      id: prompts.id,
      text: prompts.text,
      source: prompts.source,
      category: promptCategories.name,
    }).from(prompts)
      .innerJoin(promptRunItems, eq(prompts.id, promptRunItems.promptId))
      .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
      .where(inArray(promptRunItems.promptRunId, this.runIds));

    return promptsData.map(p => ({
      id: p.id,
      text: p.text,
      source: p.source,
      category: p.category || 'Others',
    }));
  }

  async getPromptCategories(promptIds: string[]): Promise<string[]> {
    if (promptIds.length === 0) {
      return [];
    }

    const categoriesData = await db.selectDistinct({
      categoryId: prompts.categoryId,
      categoryName: promptCategories.name,
    }).from(prompts)
      .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
      .where(inArray(prompts.id, promptIds));

    const categories = categoriesData.map(c => c.categoryName || 'Others');
    return Array.from(new Set(categories));
  }

  async getPromptsInCategory(promptIds: string[], category: string): Promise<PromptData[]> {
    if (promptIds.length === 0 || !category) {
      return [];
    }

    let promptsData;
    
    if (category === 'Others') {
      promptsData = await db.select({
        id: prompts.id,
        text: prompts.text,
        source: prompts.source,
      }).from(prompts)
        .where(
          and(
            inArray(prompts.id, promptIds),
            isNull(prompts.categoryId)
          )
        );
    } else {
      promptsData = await db.select({
        id: prompts.id,
        text: prompts.text,
        source: prompts.source,
      }).from(prompts)
        .leftJoin(promptCategories, eq(prompts.categoryId, promptCategories.id))
        .where(
          and(
            inArray(prompts.id, promptIds),
            eq(promptCategories.name, category)
          )
        );
    }

    return promptsData.map(p => ({
      id: p.id,
      text: p.text,
      source: p.source,
      category,
    }));
  }

  async getScoreTrends(): Promise<ScoreTrend[]> {
    const trends = await db.select({
      promptRunId: competitorScores.promptRunId,
      runName: promptRuns.name,
      createdAt: promptRuns.createdAt,
      visibilityScore: sql<number>`AVG(${competitorScores.visibilityScore})`,
      sentimentScore: sql<number>`AVG(${competitorScores.sentimentScore})`,
      positionScore: sql<number>`AVG(${competitorScores.positionScore})`,
    }).from(competitorScores)
      .innerJoin(promptRuns, eq(competitorScores.promptRunId, promptRuns.id))
      .where(
        and(
          inArray(competitorScores.promptRunId, this.runIds),
          eq(competitorScores.competitorId, this.clientId)
        )
      )
      .groupBy(competitorScores.promptRunId, promptRuns.name, promptRuns.createdAt)
      .orderBy(promptRuns.createdAt);

    return trends.map(t => ({
      promptRunId: t.promptRunId,
      runName: t.runName,
      createdAt: t.createdAt,
      visibilityScore: parseFloat(String(t.visibilityScore || 0)),
      sentimentScore: parseFloat(String(t.sentimentScore || 0)),
      positionScore: parseFloat(String(t.positionScore || 0)),
    }));
  }

  async getPositionChanges(): Promise<PositionChange[]> {
    if (this.runIds.length < 2) {
      return [];
    }

    const sortedRuns = await db.select({
      id: promptRuns.id,
      createdAt: promptRuns.createdAt,
    }).from(promptRuns)
      .where(inArray(promptRuns.id, this.runIds))
      .orderBy(promptRuns.createdAt);

    if (sortedRuns.length < 2) {
      return [];
    }

    const previousRunId = sortedRuns[sortedRuns.length - 2].id;
    const currentRunId = sortedRuns[sortedRuns.length - 1].id;

    const previousScores = await db.select({
      promptId: competitorScores.promptId,
      modelId: sql<string>`NULL`,
      positionScore: competitorScores.positionScore,
    }).from(competitorScores)
      .where(
        and(
          eq(competitorScores.promptRunId, previousRunId),
          eq(competitorScores.competitorId, this.clientId)
        )
      );

    const currentScores = await db.select({
      promptId: competitorScores.promptId,
      modelId: sql<string>`NULL`,
      positionScore: competitorScores.positionScore,
    }).from(competitorScores)
      .where(
        and(
          eq(competitorScores.promptRunId, currentRunId),
          eq(competitorScores.competitorId, this.clientId)
        )
      );

    const previousMap = new Map(
      previousScores.map(s => [`${s.promptId}`, parseFloat(String(s.positionScore || 0))])
    );

    const currentMap = new Map(
      currentScores.map(s => [`${s.promptId}`, parseFloat(String(s.positionScore || 0))])
    );

    const allPromptIds = new Set([
      ...previousScores.map(s => s.promptId).filter((id): id is string => id !== null),
      ...currentScores.map(s => s.promptId).filter((id): id is string => id !== null),
    ]);

    const promptTexts = await db.select({
      id: prompts.id,
      text: prompts.text,
    }).from(prompts)
      .where(inArray(prompts.id, Array.from(allPromptIds)));

    const promptTextMap = new Map(promptTexts.map(p => [p.id, p.text]));

    const changes: PositionChange[] = [];
    for (const promptId of Array.from(allPromptIds)) {
      const prev = previousMap.get(promptId) || null;
      const curr = currentMap.get(promptId) || null;
      const change = (curr || 0) - (prev || 0);

      if (change !== 0) {
        changes.push({
          promptId,
          promptText: promptTextMap.get(promptId) || '',
          modelId: 'aggregate',
          modelName: 'All Models',
          previousPosition: prev,
          currentPosition: curr,
          change,
        });
      }
    }

    return changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  async getDetailedScores(entityType: 'client' | 'competitor', entityId?: string): Promise<DetailedScore[]> {
    const targetEntityId = entityType === 'client' ? this.clientId : entityId;
    
    if (!targetEntityId) {
      return [];
    }

    const scores = await db.select({
      competitorId: competitorScores.competitorId,
      competitorName: competitorScores.competitorName,
      promptId: competitorScores.promptId,
      promptRunId: competitorScores.promptRunId,
      visibilityScore: competitorScores.visibilityScore,
      sentimentScore: competitorScores.sentimentScore,
      positionScore: competitorScores.positionScore,
    }).from(competitorScores)
      .where(
        and(
          inArray(competitorScores.promptRunId, this.runIds),
          eq(competitorScores.competitorId, targetEntityId)
        )
      );

    if (scores.length === 0) {
      return [];
    }

    const allPromptIds = scores.map(s => s.promptId).filter((id): id is string => id !== null);
    const uniquePromptIds = Array.from(new Set(allPromptIds));

    const itemsData = uniquePromptIds.length > 0
      ? await db.select({
          id: promptRunItems.id,
          promptId: promptRunItems.promptId,
          promptRunId: promptRunItems.promptRunId,
          modelId: promptRunItems.modelId,
        }).from(promptRunItems)
          .where(
            and(
              inArray(promptRunItems.promptRunId, this.runIds),
              inArray(promptRunItems.promptId, uniquePromptIds)
            )
          )
      : [];

    const itemIds = itemsData.map(item => item.id);
    
    const answersData = itemIds.length > 0
      ? await db.select({
          id: answers.id,
          promptRunItemId: answers.promptRunItemId,
          citationCount: answers.citationCount,
        }).from(answers)
          .where(inArray(answers.promptRunItemId, itemIds))
      : [];

    const answerIds = answersData.map(a => a.id);

    const [mentionsData, rankingsData] = await Promise.all([
      answerIds.length > 0
        ? db.select({
            answerId: mentions.answerId,
          }).from(mentions)
            .where(inArray(mentions.answerId, answerIds))
        : Promise.resolve([]),
      answerIds.length > 0
        ? db.select({
            answerId: rankings.answerId,
            position: rankings.position,
            isClientBrand: rankings.isClientBrand,
          }).from(rankings)
            .where(
              and(
                inArray(rankings.answerId, answerIds),
                eq(rankings.isClientBrand, entityType === 'client')
              )
            )
        : Promise.resolve([]),
    ]);

    const answerItemMap = new Map(
      answersData.map(a => [a.id, a.promptRunItemId])
    );

    const itemByPromptRun = new Map<string, typeof itemsData[0]>();
    itemsData.forEach(item => {
      const key = `${item.promptId}-${item.promptRunId}`;
      if (!itemByPromptRun.has(key)) {
        itemByPromptRun.set(key, item);
      }
    });

    const mentionCountMap = new Map<string, number>();
    mentionsData.forEach(m => {
      mentionCountMap.set(m.answerId, (mentionCountMap.get(m.answerId) || 0) + 1);
    });

    const rankingMap = new Map<string, number>();
    rankingsData.forEach(r => {
      if (!rankingMap.has(r.answerId)) {
        rankingMap.set(r.answerId, r.position);
      }
    });

    const citationCountMap = new Map(
      answersData.map(a => [a.promptRunItemId, a.citationCount || 0])
    );

    const results: DetailedScore[] = [];

    for (const score of scores) {
      if (!score.promptId) continue;

      const key = `${score.promptId}-${score.promptRunId}`;
      const item = itemByPromptRun.get(key);

      if (item) {
        const answer = answersData.find(a => a.promptRunItemId === item.id);
        const answerId = answer?.id;

        results.push({
          entityType,
          entityId: score.competitorId || '',
          entityName: score.competitorName,
          promptId: score.promptId,
          modelId: item.modelId,
          visibilityScore: parseFloat(String(score.visibilityScore || 0)),
          sentimentScore: parseFloat(String(score.sentimentScore || 0)),
          positionScore: parseFloat(String(score.positionScore || 0)),
          citationCount: citationCountMap.get(item.id) || 0,
          mentionCount: answerId ? (mentionCountMap.get(answerId) || 0) : 0,
          rankingPosition: answerId ? (rankingMap.get(answerId) || null) : null,
        });
      } else {
        results.push({
          entityType,
          entityId: score.competitorId || '',
          entityName: score.competitorName,
          promptId: score.promptId,
          modelId: 'aggregate',
          visibilityScore: parseFloat(String(score.visibilityScore || 0)),
          sentimentScore: parseFloat(String(score.sentimentScore || 0)),
          positionScore: parseFloat(String(score.positionScore || 0)),
          citationCount: 0,
          mentionCount: 0,
          rankingPosition: null,
        });
      }
    }

    return results;
  }

  async getConfiguredCompetition(): Promise<CompetitorData[]> {
    const competitorsData = await db.select({
      id: competitors.id,
      name: competitors.name,
      website: competitors.website,
    }).from(competitors)
      .where(eq(competitors.clientId, this.clientId));

    return competitorsData;
  }

  async getCompetitorScores(): Promise<CompetitorScore[]> {
    const scores = await db.select({
      competitorId: competitorScores.competitorId,
      competitorName: competitorScores.competitorName,
      promptId: competitorScores.promptId,
      promptRunId: competitorScores.promptRunId,
      positionScore: competitorScores.positionScore,
      sentimentScore: competitorScores.sentimentScore,
      visibilityScore: competitorScores.visibilityScore,
    }).from(competitorScores)
      .where(inArray(competitorScores.promptRunId, this.runIds));

    return scores.map(s => ({
      competitorId: s.competitorId,
      competitorName: s.competitorName,
      promptId: s.promptId,
      promptRunId: s.promptRunId,
      positionScore: parseFloat(String(s.positionScore || 0)),
      sentimentScore: parseFloat(String(s.sentimentScore || 0)),
      visibilityScore: parseFloat(String(s.visibilityScore || 0)),
    }));
  }

  async getCitedDomains(): Promise<CitationDomain[]> {
    const itemsData = await db.select({
      id: promptRunItems.id,
    }).from(promptRunItems)
      .where(inArray(promptRunItems.promptRunId, this.runIds));

    if (itemsData.length === 0) {
      return [];
    }

    const itemIds = itemsData.map(item => item.id);

    const answersData = await db.select({
      id: answers.id,
      promptRunItemId: answers.promptRunItemId,
    }).from(answers)
      .where(inArray(answers.promptRunItemId, itemIds));

    if (answersData.length === 0) {
      return [];
    }

    const answerIds = answersData.map(a => a.id);

    const itemDates = await db.select({
      id: promptRunItems.id,
      finishedAt: promptRunItems.finishedAt,
    }).from(promptRunItems)
      .where(inArray(promptRunItems.id, itemIds));

    const itemDateMap = new Map(
      itemDates.map(item => [item.id, item.finishedAt || new Date()])
    );
    const answerItemMap = new Map(
      answersData.map(a => [a.id, a.promptRunItemId])
    );

    const citationsData = await db.select({
      domain: citations.domain,
      answerId: citations.answerId,
    }).from(citations)
      .where(
        and(
          inArray(citations.answerId, answerIds),
          sql`${citations.domain} IS NOT NULL`
        )
      );

    const domainMap = new Map<string, { count: number; firstSeen: Date; lastSeen: Date }>();

    citationsData.forEach(c => {
      if (!c.domain) return;
      
      const itemId = answerItemMap.get(c.answerId);
      const answerDate = itemId ? (itemDateMap.get(itemId) || new Date()) : new Date();
      
      if (!domainMap.has(c.domain)) {
        domainMap.set(c.domain, {
          count: 0,
          firstSeen: answerDate,
          lastSeen: answerDate,
        });
      }

      const domainData = domainMap.get(c.domain)!;
      domainData.count++;
      if (answerDate < domainData.firstSeen) domainData.firstSeen = answerDate;
      if (answerDate > domainData.lastSeen) domainData.lastSeen = answerDate;
    });

    return Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        citationCount: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      }))
      .sort((a, b) => b.citationCount - a.citationCount);
  }

  async getCitationPatternsByDomain(): Promise<CitationPattern[]> {
    const itemsData = await db.select({
      id: promptRunItems.id,
    }).from(promptRunItems)
      .where(inArray(promptRunItems.promptRunId, this.runIds));

    if (itemsData.length === 0) {
      return [];
    }

    const itemIds = itemsData.map(item => item.id);

    const answersData = await db.select({
      id: answers.id,
    }).from(answers)
      .where(inArray(answers.promptRunItemId, itemIds));

    if (answersData.length === 0) {
      return [];
    }

    const answerIds = answersData.map(a => a.id);

    const citationsData = await db.select({
      domain: citations.domain,
      url: citations.url,
      position: citations.position,
      type: citations.type,
    }).from(citations)
      .where(
        and(
          inArray(citations.answerId, answerIds),
          sql`${citations.domain} IS NOT NULL`
        )
      );

    const patternMap = new Map<string, { url: string | null; positions: number[]; type: string }>();

    citationsData.forEach(c => {
      if (!c.domain) return;

      const key = `${c.domain}|${c.url || 'null'}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, {
          url: c.url,
          positions: [],
          type: c.type,
        });
      }
      patternMap.get(key)!.positions.push(c.position);
    });

    return Array.from(patternMap.entries())
      .map(([key, data]) => {
        const [domain] = key.split('|');
        return {
          domain,
          url: data.url,
          occurrences: data.positions.length,
          positions: data.positions,
          citationType: data.type,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  async getGapByRunDiscoveries(): Promise<DiscoveryData[]> {
    const discoveries: DiscoveryData[] = [];

    for (const runId of this.runIds) {
      const run = await db.select({
        id: promptRuns.id,
        name: promptRuns.name,
      }).from(promptRuns)
        .where(eq(promptRuns.id, runId))
        .limit(1);

      if (run.length === 0) continue;

      const newCompetitors = await db.select({
        competitorName: competitorScores.competitorName,
      }).from(competitorScores)
        .where(eq(competitorScores.promptRunId, runId))
        .groupBy(competitorScores.competitorName)
        .limit(10);

      const itemsData = await db.select({
        id: promptRunItems.id,
      }).from(promptRunItems)
        .where(eq(promptRunItems.promptRunId, runId))
        .limit(100);

      const itemIds = itemsData.map(i => i.id);
      const answersData = itemIds.length > 0 
        ? await db.select({ id: answers.id }).from(answers).where(inArray(answers.promptRunItemId, itemIds))
        : [];
      const answerIds = answersData.map(a => a.id);

      const newDomains = answerIds.length > 0
        ? await db.select({ domain: citations.domain })
            .from(citations)
            .where(
              and(
                inArray(citations.answerId, answerIds),
                sql`${citations.domain} IS NOT NULL`
              )
            )
            .groupBy(citations.domain)
            .limit(10)
        : [];

      discoveries.push({
        promptRunId: runId,
        runName: run[0].name,
        newCompetitors: newCompetitors.map(c => c.competitorName),
        newDomains: newDomains.map(d => d.domain).filter((d): d is string => d !== null),
        newKeywords: [],
      });
    }

    return discoveries;
  }

  async getMisclassifiedPatterns(): Promise<MisclassificationPattern[]> {
    const itemsData = await db.select({
      id: promptRunItems.id,
      promptId: promptRunItems.promptId,
      modelId: promptRunItems.modelId,
    }).from(promptRunItems)
      .where(inArray(promptRunItems.promptRunId, this.runIds))
      .limit(1000);

    if (itemsData.length === 0) {
      return [];
    }

    const itemIds = itemsData.map(item => item.id);
    const answersData = await db.select({
      id: answers.id,
      promptRunItemId: answers.promptRunItemId,
    }).from(answers)
      .where(inArray(answers.promptRunItemId, itemIds));

    if (answersData.length === 0) {
      return [];
    }

    const answerIds = answersData.map(a => a.id);
    const rankingsData = await db.select({
      answerId: rankings.answerId,
      item: rankings.item,
      isClientBrand: rankings.isClientBrand,
    }).from(rankings)
      .where(inArray(rankings.answerId, answerIds));

    const clientData = await this.getClient();
    const clientName = clientData.name.toLowerCase();

    const answerItemMap = new Map(
      answersData.map(a => [a.id, a.promptRunItemId])
    );
    const itemDetailsMap = new Map(
      itemsData.map(item => [item.id, item])
    );

    const patternMap = new Map<string, MisclassificationPattern>();

    for (const ranking of rankingsData) {
      const itemId = answerItemMap.get(ranking.answerId);
      if (!itemId) continue;

      const itemDetails = itemDetailsMap.get(itemId);
      if (!itemDetails) continue;

      const actualEntityIsClient = ranking.item.toLowerCase().includes(clientName);
      const expectedIsClient = ranking.isClientBrand;

      if (actualEntityIsClient !== expectedIsClient) {
        const key = `${itemDetails.promptId}-${itemDetails.modelId}`;
        if (!patternMap.has(key)) {
          patternMap.set(key, {
            promptId: itemDetails.promptId,
            modelId: itemDetails.modelId,
            expectedEntity: expectedIsClient ? 'client' : 'competitor',
            actualEntity: actualEntityIsClient ? 'client' : 'competitor',
            occurrences: 0,
          });
        }
        const pattern = patternMap.get(key)!;
        pattern.occurrences++;
      }
    }

    return Array.from(patternMap.values())
      .filter(p => p.occurrences > 1)
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  async getTopicMentionPatterns(): Promise<TopicMentionPattern[]> {
    const topicsData = await this.getClientTopics();
    
    const itemsData = await db.select({
      id: promptRunItems.id,
    }).from(promptRunItems)
      .where(inArray(promptRunItems.promptRunId, this.runIds));

    if (itemsData.length === 0) {
      return [];
    }

    const itemIds = itemsData.map(item => item.id);
    const answersData = await db.select({
      id: answers.id,
    }).from(answers)
      .where(inArray(answers.promptRunItemId, itemIds));

    if (answersData.length === 0) {
      return [];
    }

    const answerIds = answersData.map(a => a.id);
    const mentionsData = await db.select({
      answerId: mentions.answerId,
      span: mentions.span,
      sentiment: mentions.sentiment,
    }).from(mentions)
      .where(inArray(mentions.answerId, answerIds));

    const patterns: TopicMentionPattern[] = [];

    for (const topic of topicsData) {
      const topicMentions = mentionsData.filter(m => 
        m.span.toLowerCase().includes(topic.label.toLowerCase())
      );

      const sentimentDistribution = {
        positive: topicMentions.filter(m => m.sentiment === 'positive').length,
        neutral: topicMentions.filter(m => m.sentiment === 'neutral').length,
        negative: topicMentions.filter(m => m.sentiment === 'negative').length,
      };

      patterns.push({
        topicId: topic.id,
        topicText: topic.label,
        mentionCount: topicMentions.length,
        sentimentDistribution,
      });
    }

    return patterns.sort((a, b) => b.mentionCount - a.mentionCount);
  }

  async dashboard() {
    const [scoreTrends, positionChanges, recs] = await Promise.all([
      this.getScoreTrends(),
      this.getPositionChanges(),
      db.select({
        id: recommendations.id,
        title: recommendations.title,
        category: recommendations.category,
        severity: recommendations.severity,
        description: recommendations.description,
        source: recommendations.source,
      }).from(recommendations)
        .where(
          and(
            eq(recommendations.clientId, this.clientId),
            inArray(recommendations.promptRunId, this.runIds)
          )
        )
        .limit(20),
    ]);

    return {
      scoreTrends,
      positionChanges,
      recommendations: recs,
    };
  }
}
