import { z } from "zod";

/** Shared wire types only. No environment, provider SDK or DB dependencies. */
export const SEARCH_POLICY_VERSION = "native-search-r1a-v1" as const;
export const MAX_EVIDENCE_BYTES = 131_072;
export const MAX_ANSWER_CHARS = 250_000;
export const nativeProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type NativeProvider = z.infer<typeof nativeProviderSchema>;
export const webSearchEnabledInput = z.boolean().optional().default(false);

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 ||
      /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

const urlSchema = z.string().max(2048).refine(v => safeSourceUrl(v) !== null, "Unsafe source URL");
export const searchConfigSchema = z.object({
  version: z.literal(1),
  models: z.record(z.object({
    vendor: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
  }).strict()).optional(),
  actor: z.object({
    userId: z.string().min(1).max(200),
    tenantId: z.string().min(1).max(200),
    validation: z.boolean(),
  }).strict().optional(),
  validationApprovals: z.array(z.string().min(1).max(200)).max(12).optional(),
  webSearch: z.object({
    enabled: z.boolean(),
    invocationPolicy: z.literal("auto"),
    policyVersion: z.literal(SEARCH_POLICY_VERSION),
    claudeMaxUses: z.literal(5),
    maxRetries: z.literal(2).default(2),
    itemDeadlineMs: z.literal(180000).default(180000),
  }).strict(),
}).strict();
export type SearchConfig = z.infer<typeof searchConfigSchema>;
export function createSearchConfig(enabled = false): SearchConfig {
  return { version: 1, webSearch: { enabled, invocationPolicy: "auto",
    policyVersion: SEARCH_POLICY_VERSION, claudeMaxUses: 5, maxRetries: 2, itemDeadlineMs: 180000 } };
}
/** Legacy absent config is OFF; malformed/newer config is never downgraded. */
export function readSearchConfig(value: unknown): SearchConfig {
  return value == null ? createSearchConfig() : searchConfigSchema.parse(value);
}

export const nativeSourceSchema = z.object({
  id: z.string().min(1).max(32),
  url: urlSchema,
  title: z.string().max(300).optional(),
  kind: z.enum(["cited", "consulted"]),
}).strict();

export const nativeCitationSchema = z.object({
  sourceIds: z.array(z.string().max(32)).min(1).max(16),
  textStart: z.number().int().nonnegative().max(MAX_ANSWER_CHARS),
  textEnd: z.number().int().nonnegative().max(MAX_ANSWER_CHARS),
  association: z.enum(["span", "block"]),
  providerLocator: z.object({
    blockIndex: z.number().int().nonnegative().max(4096),
    start: z.number().int().nonnegative().max(MAX_ANSWER_CHARS).optional(),
    end: z.number().int().nonnegative().max(MAX_ANSWER_CHARS).optional(),
    unit: z.enum(["utf16", "codepoint", "unambiguous", "block"]),
  }).strict(),
}).strict().refine(c => c.textEnd > c.textStart, "Empty/reversed citation");

export const searchEvidenceSchema = z.object({
  version: z.literal(1),
  provider: nativeProviderSchema,
  requestedModel: z.string().min(1).max(200),
  actualModel: z.string().min(1).max(200).nullable(),
  actualModelEvidence: z.enum(["provider_reported", "not_reported"]),
  searchRequested: z.literal(true),
  invocationStatus: z.enum(["not_invoked", "invoked", "failed", "unknown"]),
  toolType: z.enum(["web_search", "web_search_20250305", "google_search"]),
  providerRequestId: z.string().max(200).optional(),
  providerResponseId: z.string().max(200).optional(),
  toolCallCount: z.number().int().nonnegative().max(1000).optional(),
  searchCount: z.number().int().nonnegative().max(1000).optional(),
  omittedConsultedSources: z.number().int().nonnegative().max(100_000).default(0),
  sources: z.array(nativeSourceSchema).max(100),
  citations: z.array(nativeCitationSchema).max(128),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    webSearchRequests: z.number().int().nonnegative().optional(),
  }).strict(),
  hasGoogleSearchSuggestions: z.boolean().optional(),
  generationDurationMs: z.number().int().nonnegative(),
  attemptCount: z.number().int().min(0).max(20),
  continuationCount: z.number().int().min(0).max(5),
  error: z.object({
    code: z.string().max(80),
    message: z.string().max(400),
    retryable: z.boolean(),
  }).strict().optional(),
}).strict();
export type SearchEvidence = z.infer<typeof searchEvidenceSchema>;
export type NativeCitation = z.infer<typeof nativeCitationSchema>;
export type NativeSource = z.infer<typeof nativeSourceSchema>;
export type GenerationPhase = "not_started" | "generating" | "generated" | "scoring" | "scored" | "failed";
export interface NativeGeneration {
  answerText: string | null;
  evidence: SearchEvidence;
}
export type SearchEligibilityReason = "validated" | "unverified" | "unsupported" |
  "permission_required" | "terms_blocked" | "temporarily_disabled";
export interface SearchEligibility {
  eligible: boolean;
  reason: SearchEligibilityReason;
  message: string;
  policyVersion: typeof SEARCH_POLICY_VERSION;
}

/** Validate both schema and cross-field attribution invariants before durable save. */
export function validateGeneration(value: NativeGeneration): NativeGeneration {
  const evidence = searchEvidenceSchema.parse(value.evidence);
  // Optional consulted links may be bounded, with an explicit omission count.
  // Required cited links and inline attribution are never silently truncated.
  while (new TextEncoder().encode(JSON.stringify(evidence)).byteLength > MAX_EVIDENCE_BYTES) {
    const lastConsulted = evidence.sources.findLastIndex(s => s.kind === "consulted");
    if (lastConsulted < 0) throw new Error("Required native evidence exceeds storage budget");
    evidence.sources.splice(lastConsulted, 1);
    evidence.omittedConsultedSources++;
  }
  if (value.answerText !== null &&
      (!value.answerText.trim() || value.answerText.length > MAX_ANSWER_CHARS)) {
    throw new Error("Invalid final answer length");
  }
  if ((evidence.actualModel !== null) !== (evidence.actualModelEvidence === "provider_reported")) {
    throw new Error("Inconsistent model identity evidence");
  }
  if (evidence.invocationStatus === "failed" && !evidence.error) throw new Error("Missing failure reason");
  if (evidence.error && evidence.invocationStatus !== "failed") throw new Error("Error cannot be successful");
  if (value.answerText === null && !evidence.error) throw new Error("Missing successful answer");
  const sources = new Map(evidence.sources.map(s => [s.id, s]));
  if (sources.size !== evidence.sources.length) throw new Error("Duplicate source identity");
  for (const citation of evidence.citations) {
    if (!value.answerText || citation.textEnd > value.answerText.length ||
        citation.sourceIds.some(id => sources.get(id)?.kind !== "cited")) {
      throw new Error("Citation does not map to saved answer and cited source");
    }
  }
  if (evidence.sources.some(s => s.kind === "cited" &&
      !evidence.citations.some(c => c.sourceIds.includes(s.id)))) {
    throw new Error("Cited source has no inline attribution");
  }
  return { answerText: value.answerText, evidence };
}
