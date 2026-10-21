/**
 * Enhanced JSON Export Service
 * Creates enriched JSON export with per-prompt analysis structure
 */

import type { SnapshotData } from './report-snapshot';
import type { ClientInfo, CompetitorInfo } from './csv-exporter';
import { formatNativeAnswerForDisplay } from '../../shared/native-search-display';
import type { SearchEvidence } from '../../shared/native-web-search';

export interface EnhancedJSONExport {
  reportMetadata: {
    generatedAt: string;
    clientId: string;
    projectId: string;
    runIds: string[];
    totalPrompts: number;
    totalModels: number;
    totalResponses: number;
    dateRange: {
      earliest: string;
      latest: string;
    };
  };
  client: ClientInfo;
  competitors: CompetitorInfo[];
  promptAnalysis: PromptAnalysis[];
}

export interface PromptAnalysis {
  promptId: string;
  promptText: string;
  promptSource: string;
  modelResponses: ModelResponse[];
}

export interface ModelResponse {
  modelId: string;
  modelName: string;
  modelVendor: string;
  responseText: string;
  nativeSearchEvidence?: SearchEvidence;
  competitorScores: CompetitorScore[];
  aiRankings: AIRanking[];
  citations: Citation[];
}

export interface CompetitorScore {
  name: string;
  type: 'client' | 'configured';
  competitorId: string | null;
  scores: {
    visibility: number;
    sentiment: number;
    position: number;
  };
}

export interface AIRanking {
  group: string;
  groupRelevance: string | null;
  relevanceReason: string | null;
  position: number;
  entityName: string;
  entityType: 'client' | 'configured' | 'discovered';
}

export interface Citation {
  url: string | null;
  domain: string | null;
  displayText: string | null;
  position: number;
  type: string;
}

/**
 * Generate enhanced JSON export with per-prompt analysis structure
 */
export function generateEnhancedJSON(
  snapshot: SnapshotData,
  client: ClientInfo,
  competitors: CompetitorInfo[]
): EnhancedJSONExport {
  // Create lookup maps
  const promptMap = new Map(snapshot.prompts.map(p => [p.id, p]));
  const modelMap = new Map(snapshot.models.map(m => [m.id, m]));
  const competitorMap = new Map(competitors.map(c => [c.id, c]));
  const competitorNameMap = new Map(competitors.map(c => [c.name.toLowerCase(), c]));
  
  // Group responses by prompt
  const responsesByPrompt = new Map<string, typeof snapshot.responses>();
  for (const response of snapshot.responses) {
    if (!responsesByPrompt.has(response.promptId)) {
      responsesByPrompt.set(response.promptId, []);
    }
    responsesByPrompt.get(response.promptId)!.push(response);
  }
  
  // Build per-prompt analysis
  const promptAnalysis: PromptAnalysis[] = [];
  
  for (const prompt of snapshot.prompts) {
    const responses = responsesByPrompt.get(prompt.id) || [];
    
    const modelResponses: ModelResponse[] = responses.map(response => {
      const model = modelMap.get(response.modelId);
      
      // Get competitor scores for this prompt
      // NOTE: Scores are per-prompt (aggregated across all models), not per-model
      const competitorScores: CompetitorScore[] = snapshot.competitorScores
        .filter(score => score.promptId === prompt.id)
        .filter(score => {
          // Only include configured competitors (competitorId not null) or client (isClient=true)
          return score.competitorId !== null || score.isClient;
        })
        .map(score => ({
          name: score.competitorName,
          type: (score.isClient ? 'client' : 'configured') as 'client' | 'configured',
          competitorId: score.competitorId,
          scores: {
            visibility: parseFloat(String(score.visibilityScore || 0)),
            sentiment: parseFloat(String(score.sentimentScore || 0)),
            position: parseFloat(String(score.positionScore || 0)),
          },
        }));
      
      // Get AI rankings for this response (all entities including discovered)
      const aiRankings: AIRanking[] = snapshot.rankings
        .filter(ranking => ranking.answerId === response.answerId)
        .filter(ranking => {
          // Filter out non-competitor groups
          const rankingGroupLower = (ranking.rankingGroup || '').toLowerCase();
          const nonCompetitorGroups = ['features', 'factors', 'reasons', 'benefits', 'considerations', 'steps', 'options'];
          return !nonCompetitorGroups.some(ng => rankingGroupLower.includes(ng));
        })
        .map(ranking => {
          // Determine entity type
          let entityType: 'client' | 'configured' | 'discovered';
          if (ranking.isClientBrand) {
            entityType = 'client';
          } else {
            const itemLower = ranking.item.toLowerCase();
            const isConfigured = competitors.some(c => 
              c.name.toLowerCase() === itemLower || 
              itemLower.includes(c.name.toLowerCase())
            );
            entityType = isConfigured ? 'configured' : 'discovered';
          }
          
          return {
            group: ranking.rankingGroup || '',
            groupRelevance: ranking.groupRelevance || null,
            relevanceReason: ranking.relevanceReason || null,
            position: ranking.position,
            entityName: ranking.item,
            entityType,
          };
        });
      
      // Get citations for this response
      const citations: Citation[] = snapshot.citations
        .filter(citation => citation.answerId === response.answerId)
        .map(citation => ({
          url: citation.url,
          domain: citation.domain,
          displayText: citation.displayText,
          position: citation.position,
          type: citation.type,
        }));
      
      return {
        modelId: response.modelId,
        modelName: model?.displayName || '',
        modelVendor: model?.vendor || '',
        responseText: formatNativeAnswerForDisplay(response.answer, response.nativeSearchEvidence),
        ...(response.nativeSearchEvidence ? { nativeSearchEvidence: response.nativeSearchEvidence } : {}),
        competitorScores,
        aiRankings,
        citations,
      };
    });
    
    promptAnalysis.push({
      promptId: prompt.id,
      promptText: prompt.text,
      promptSource: prompt.source,
      modelResponses,
    });
  }
  
  return {
    reportMetadata: {
      generatedAt: snapshot.metadata.generatedAt,
      clientId: snapshot.metadata.clientId,
      projectId: snapshot.metadata.projectId,
      runIds: snapshot.metadata.runIds,
      totalPrompts: snapshot.metadata.totalPrompts,
      totalModels: snapshot.metadata.totalModels,
      totalResponses: snapshot.responses.length,
      dateRange: snapshot.metadata.dateRange,
    },
    client,
    competitors,
    promptAnalysis,
  };
}
