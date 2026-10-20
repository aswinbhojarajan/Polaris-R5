import { z } from 'zod';

export const mentionSchema = z.object({
  span: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  canonical_id: z.string(),
  surface_type: z.enum(['direct', 'alias']),
  confidence: z.number().min(0).max(1).default(1.0),
}).refine((data) => data.end > data.start, {
  message: 'end must be greater than start',
});

export const mentionsArraySchema = z.array(mentionSchema).refine(
  (mentions) => {
    const seen = new Set<string>();
    for (const m of mentions) {
      const key = `${m.start}-${m.end}-${m.span}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  },
  { message: 'Duplicate mentions detected' }
);

export const sentimentSchema = z.object({
  entity_id: z.string(),
  p_pos: z.number().min(0).max(1),
  p_neu: z.number().min(0).max(1),
  p_neg: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).default(1.0),
  support_spans: z.array(z.object({
    text: z.string(),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })).default([]),
}).refine(
  (data) => {
    const sum = data.p_pos + data.p_neu + data.p_neg;
    return Math.abs(sum - 1.0) < 0.01;
  },
  { message: 'Sentiment probabilities must sum to approximately 1.0' }
);

export const sentimentsArraySchema = z.array(sentimentSchema);

export const rankingSchema = z.object({
  item: z.string().min(1),
  position: z.number().int().positive(),
  confidence: z.number().min(0).max(1).default(1.0),
  evidence_span: z.object({
    text: z.string(),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).optional(),
  rankingGroup: z.string().optional(),
  groupRelevance: z.enum(['relevant', 'partial', 'irrelevant']).optional(),
  relevanceReason: z.string().optional(),
});

export const rankingsArraySchema = z.array(rankingSchema);

export const visibilitySchema = z.object({
  rate: z.number().min(0).max(1),
  first_pos: z.number().int().min(0).nullable(),
  heading_hits: z.number().int().min(0),
  coverage: z.number().min(0).max(1),
  raw_score: z.number(),
});

export const llmMentionResponseSchema = z.object({
  mentions: mentionsArraySchema,
});

export const llmSentimentResponseSchema = z.object({
  sentiments: sentimentsArraySchema,
});

export const llmRankingResponseSchema = z.object({
  rankings: rankingsArraySchema,
});

export const llmVisibilityResponseSchema = z.object({
  visibility: visibilitySchema,
});

export type MentionSchemaType = z.infer<typeof mentionSchema>;
export type SentimentSchemaType = z.infer<typeof sentimentSchema>;
export type RankingSchemaType = z.infer<typeof rankingSchema>;
export type VisibilitySchemaType = z.infer<typeof visibilitySchema>;
