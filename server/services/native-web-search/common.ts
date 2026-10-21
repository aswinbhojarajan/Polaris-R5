import {
  MAX_ANSWER_CHARS, safeSourceUrl, validateGeneration,
  type NativeGeneration, type NativeProvider, type SearchEvidence,
} from "../../../shared/native-web-search";

export class NativeSearchError extends Error {
  constructor(public readonly code: string, message: string,
    public readonly retryable = false, public readonly status?: number,
    public readonly retryAfterMs?: number) { super(message); this.name = "NativeSearchError"; }
}
export const CONTROL_MESSAGES = new Set(["Job cancelled", "Job paused", "Run halted by admin disable"]);
export function isControlSignal(error: unknown): error is Error {
  return error instanceof Error && CONTROL_MESSAGES.has(error.message);
}
export interface ParseContext {
  provider: NativeProvider;
  model: string;
  requestId?: string;
  durationMs?: number;
  attempts?: number;
  continuations?: number;
  /** Only set by endpoint-specific verified evidence; never guess Unicode units. */
  openAiOffsetUnit?: "utf16" | "codepoint";
}

export function baseEvidence(ctx: ParseContext): SearchEvidence {
  return { version: 1, provider: ctx.provider, requestedModel: ctx.model, actualModel: null,
    actualModelEvidence: "not_reported", searchRequested: true, invocationStatus: "unknown",
    toolType: ctx.provider === "anthropic" ? "web_search_20250305" :
      ctx.provider === "google" ? "google_search" : "web_search",
    ...(ctx.requestId ? { providerRequestId: ctx.requestId } : {}),
    sources: [], citations: [], usage: {}, omittedConsultedSources: 0,
    generationDurationMs: ctx.durationMs ?? 0, attemptCount: ctx.attempts ?? 1,
    continuationCount: ctx.continuations ?? 0 };
}
export function fail(code: string, message: string): never {
  throw new NativeSearchError(code, message);
}
/** Error text deliberately excludes response bodies/SDK messages that can contain secrets. */
export function failedGeneration(ctx: ParseContext, error: unknown): NativeGeneration {
  const known = error instanceof NativeSearchError;
  return validateGeneration({ answerText: null, evidence: { ...baseEvidence(ctx),
    invocationStatus: "failed", error: {
      code: known ? error.code : "NATIVE_SEARCH_FAILED",
      message: known ? error.message.slice(0, 400) : "Native search failed; consult the request ID.",
      retryable: known && error.retryable,
    } } });
}
export function reportIdentity(evidence: SearchEvidence, model: unknown, responseId: unknown): void {
  if (typeof model === "string" && model.length > 0 && model.length <= 200) {
    evidence.actualModel = model; evidence.actualModelEvidence = "provider_reported";
  }
  if (typeof responseId === "string" && responseId.length <= 200) evidence.providerResponseId = responseId;
}
export function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function finalText(value: string): string {
  if (!value.trim() || value.length > MAX_ANSWER_CHARS) fail("INVALID_ANSWER", "Missing or oversized final answer.");
  return value;
}

export class EvidenceBuilder {
  constructor(readonly evidence: SearchEvidence) {}
  source(urlValue: unknown, title: unknown, kind: "cited" | "consulted"): string | null {
    const url = safeSourceUrl(urlValue);
    if (!url) {
      if (kind === "cited") fail("INVALID_ATTRIBUTION", "Required citation URL is unsafe or missing.");
      this.evidence.omittedConsultedSources++; return null;
    }
    const existing = this.evidence.sources.find(s => s.url === url);
    if (existing) {
      // Provider consulted-source lists often include sources cited later.
      // Promote in place so "other consulted" never claims a cited URL was
      // not cited, and all existing inline source IDs remain stable.
      if (kind === "cited") existing.kind = "cited";
      if (!existing.title && typeof title === "string") existing.title = title.slice(0, 300);
      return existing.id;
    }
    // Consulted entries may be dropped to make room for mandatory cited entries.
    if (this.evidence.sources.length >= 100) {
      if (kind === "consulted") { this.evidence.omittedConsultedSources++; return null; }
      const disposable = this.evidence.sources.findIndex(s => s.kind === "consulted");
      if (disposable === -1) fail("ATTRIBUTION_OVERFLOW", "Required citations exceed the evidence budget.");
      this.evidence.sources.splice(disposable, 1); this.evidence.omittedConsultedSources++;
    }
    const id = `s${this.nextId++}`;
    this.evidence.sources.push({ id, url, kind,
      ...(typeof title === "string" ? { title: title.slice(0, 300) } : {}) });
    return id;
  }
  private nextId = 1;
  citation(sourceId: string, start: number, end: number, blockIndex: number,
    association: "span" | "block", unit: "utf16" | "codepoint" | "unambiguous" | "block",
    originalStart?: number, originalEnd?: number): void {
    if (this.evidence.citations.length >= 128) fail("ATTRIBUTION_OVERFLOW", "Too many required inline citations.");
    this.evidence.citations.push({ sourceIds: [sourceId], textStart: start, textEnd: end, association,
      providerLocator: { blockIndex, unit, ...(originalStart === undefined ? {} : { start: originalStart }),
        ...(originalEnd === undefined ? {} : { end: originalEnd }) } });
  }
}
