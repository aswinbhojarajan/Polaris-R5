import { z } from "zod";
import { validateGeneration } from "../../../shared/native-web-search";
import { baseEvidence, count, EvidenceBuilder, fail, finalText, reportIdentity, type ParseContext } from "./common";

/** Preparation only: R1A never dispatches a live grounded Google diagnostic. */
export function assertGeminiGroundingPermitted(): never {
  return fail("GOOGLE_TERMS_BLOCKED",
    "Gemini native grounding is unavailable for Polaris analytics pending applicable written permission and model-identity approval.");
}
export function buildGeminiSearchRequest(prompt: string, model: string, system: string) {
  return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    body: { systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 16000 } } };
}
const responseSchema = z.object({
  modelVersion: z.string().optional(), responseId: z.string().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string(),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).max(4096) }),
    groundingMetadata: z.object({
      webSearchQueries: z.array(z.string().max(4000)).max(1000).optional(),
      groundingChunks: z.array(z.object({ web: z.object({ uri: z.string(), title: z.string().optional() }).optional() })).max(10_000).optional(),
      groundingSupports: z.array(z.object({
        segment: z.object({ partIndex: z.number().int().nonnegative().optional(),
          startIndex: z.number().int().nonnegative(), endIndex: z.number().int().nonnegative() }),
        groundingChunkIndices: z.array(z.number().int().nonnegative()).max(16),
      })).max(1024).optional(),
      searchEntryPoint: z.object({ renderedContent: z.string().max(131_072).optional() }).optional(),
    }).optional(),
  })).min(1).max(1),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(),
    candidatesTokenCount: z.number().optional(), totalTokenCount: z.number().optional() }).optional(),
});
/** Synthetic fixtures only until R1B. Never call on prohibited live grounded outputs. */
export function normalizeGeminiSearch(value: unknown, ctx: ParseContext) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_PROVIDER_RESPONSE", "Gemini response does not match generateContent.");
  const response = parsed.data, candidate = response.candidates[0];
  if (response.promptFeedback?.blockReason || candidate.finishReason !== "STOP") {
    fail("INCOMPLETE_RESPONSE", "Gemini response was blocked or did not finish.");
  }
  const evidence = baseEvidence(ctx), builder = new EvidenceBuilder(evidence);
  reportIdentity(evidence, response.modelVersion, response.responseId);
  let answer = "";
  const parts = new Map<number, { start: number; text: string }>();
  candidate.content.parts.forEach((part, index) => {
    if (part.thought || part.text === undefined) return;
    if (answer) answer += "\n\n";
    parts.set(index, { start: answer.length, text: part.text }); answer += part.text;
  });
  const metadata = candidate.groundingMetadata;
  const chunks = metadata?.groundingChunks ?? [];
  for (const chunk of chunks) if (chunk.web) builder.source(chunk.web.uri, chunk.web.title, "consulted");
  for (const support of metadata?.groundingSupports ?? []) {
    const partIndex = support.segment.partIndex ?? 0, part = parts.get(partIndex);
    if (!part || support.segment.endIndex <= support.segment.startIndex ||
        support.segment.endIndex > part.text.length || Array.from(part.text).length !== part.text.length) {
      fail("INVALID_ATTRIBUTION", "Gemini support indices require a validated text/Unicode mapping.");
    }
    for (const index of support.groundingChunkIndices) {
      const source = chunks[index]?.web;
      if (!source) fail("INVALID_ATTRIBUTION", "Gemini support references a missing web source.");
      const id = builder.source(source.uri, source.title, "cited")!;
      builder.citation(id, part.start + support.segment.startIndex, part.start + support.segment.endIndex,
        partIndex, "span", "unambiguous", support.segment.startIndex, support.segment.endIndex);
    }
  }
  evidence.invocationStatus = metadata?.webSearchQueries?.length ? "invoked" :
    metadata && (chunks.length || (metadata.groundingSupports?.length ?? 0)) ? "unknown" : "not_invoked";
  // Query count isn't the same unit as a provider tool call or grounded-prompt billing.
  if (metadata?.webSearchQueries) evidence.searchCount = metadata.webSearchQueries.length;
  evidence.hasGoogleSearchSuggestions = !!metadata?.searchEntryPoint?.renderedContent;
  // Do not retain or inject the raw HTML; compliant display is a separately cleared R1B gate.
  evidence.usage = { inputTokens: count(response.usageMetadata?.promptTokenCount),
    outputTokens: count(response.usageMetadata?.candidatesTokenCount),
    totalTokens: count(response.usageMetadata?.totalTokenCount) };
  return validateGeneration({ answerText: finalText(answer), evidence });
}
