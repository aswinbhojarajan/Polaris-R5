export interface BrandRecord {
  id: string;
  name: string;
  aliases: string[];
  website?: string;
}

export interface DocumentInput {
  text: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface EntityMention {
  span: string;
  start: number;
  end: number;
  canonicalId: string;
  surfaceType: 'direct' | 'alias';
  confidence: number;
}

export interface EntitySentiment {
  entityId: string;
  pPos: number;
  pNeu: number;
  pNeg: number;
  confidence: number;
  supportSpans: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

export type GroupRelevance = 'relevant' | 'partial' | 'irrelevant';

export interface RankingItem {
  item: string;
  position: number;
  confidence: number;
  rankingGroup?: string;
  groupRelevance?: GroupRelevance;
  relevanceReason?: string;
  evidenceSpan?: {
    text: string;
    start: number;
    end: number;
  };
}

export interface VisibilityDetails {
  rate: number;
  firstPos: number | null;
  headingHits: number;
  coverage: number;
  rawScore: number;
}

export interface EngineOutput {
  mentions: EntityMention[];
  sentiment: EntitySentiment[];
  rankings: RankingItem[];
  visibility: VisibilityDetails;
  scores: {
    visibilityScore: number;
    sentimentScore: number;
    positionScore: number;
    overallScore: number;
  };
}

export interface LLMExtractionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fallbackUsed: boolean;
  latencyMs?: number;
  tokensUsed?: number;
}
