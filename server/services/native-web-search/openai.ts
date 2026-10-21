import { z } from "zod";
import { validateGeneration } from "../../../shared/native-web-search";
import { baseEvidence, count, EvidenceBuilder, fail, finalText, reportIdentity, type ParseContext } from "./common";

// Parse only fields used for the final answer/evidence; raw reasoning and tool bodies never escape.
const outputSchema = z.object({
  status: z.string(),
  model: z.string().optional(), id: z.string().optional(),
  output: z.array(z.object({
    type: z.string(), role: z.string().optional(), status: z.string().optional(),
    action: z.object({ type: z.string(), sources: z.array(z.object({
      url: z.string(), title: z.string().optional(),
    })).max(10_000).optional() }).optional(),
    content: z.array(z.object({
      type: z.string(), text: z.string().optional(),
      annotations: z.array(z.object({
        type: z.string(), url: z.string().optional(), title: z.string().optional(),
        start_index: z.number().int().nonnegative().optional(),
        end_index: z.number().int().nonnegative().optional(),
      })).max(1024).optional(),
    })).max(4096).optional(),
  })).max(4096),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(),
    total_tokens: z.number().optional() }).nullable().optional(),
});

export function buildOpenAiSearchRequest(prompt: string, model: string, instructions: string) {
  return { model, instructions, input: prompt, tools: [{ type: "web_search" }],
    tool_choice: "auto", include: ["web_search_call.action.sources"],
    max_output_tokens: model.startsWith("gpt-5") ? 8000 : 4000,
    max_tool_calls: 5, store: false };
}

function citationSpan(text: string, start: number, end: number, ctx: ParseContext) {
  const points = Array.from(text);
  if (end <= start) fail("INVALID_ATTRIBUTION", "Required citation has an invalid range.");
  if (ctx.openAiOffsetUnit === "codepoint") {
    if (end > points.length) fail("INVALID_ATTRIBUTION", "Required citation exceeds its text block.");
    return { start: points.slice(0, start).join("").length, end: points.slice(0, end).join("").length,
      unit: "codepoint" as const };
  }
  if (end > text.length) fail("INVALID_ATTRIBUTION", "Required citation exceeds its text block.");
  if (ctx.openAiOffsetUnit !== "utf16" && points.length !== text.length) {
    // If both interpretations select the same range, attribution is still unambiguous.
    if (end > points.length || points.slice(0, start).join("").length !== start ||
        points.slice(0, end).join("").length !== end) {
      fail("AMBIGUOUS_ATTRIBUTION", "Unicode citation index units require endpoint validation.");
    }
  }
  // Never split a UTF-16 surrogate pair.
  for (const edge of [start, end]) {
    if (edge > 0 && edge < text.length &&
        /[\uD800-\uDBFF]/.test(text[edge - 1]) && /[\uDC00-\uDFFF]/.test(text[edge])) {
      fail("INVALID_ATTRIBUTION", "Citation splits a Unicode character.");
    }
  }
  return { start, end, unit: ctx.openAiOffsetUnit ?? "unambiguous" as const };
}

export function normalizeOpenAiSearch(value: unknown, ctx: ParseContext) {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) fail("INVALID_PROVIDER_RESPONSE", "OpenAI response does not match the native contract.");
  const response = parsed.data;
  if (response.status !== "completed") fail("INCOMPLETE_RESPONSE", "OpenAI response did not complete.");
  const evidence = baseEvidence(ctx);
  reportIdentity(evidence, response.model, response.id);
  const builder = new EvidenceBuilder(evidence);
  let answer = "", blockIndex = 0, calls = 0, searches = 0;
  for (const output of response.output) {
    if (!["reasoning", "web_search_call", "message"].includes(output.type)) {
      fail("UNKNOWN_TOOL_ACTION", "Unexpected native OpenAI output block.");
    }
    if (output.type === "web_search_call") {
      if (output.status !== "completed") fail("SEARCH_TOOL_FAILED", "OpenAI search action did not complete.");
      if (!output.action || !["search", "open_page", "find_in_page"].includes(output.action.type)) {
        fail("UNKNOWN_TOOL_ACTION", "OpenAI search action is not recognized.");
      }
      calls++; if (output.action.type === "search") searches++;
      for (const source of output.action.sources ?? []) builder.source(source.url, source.title, "consulted");
    }
    if (output.type !== "message" || output.role !== "assistant") continue;
    if (output.status && output.status !== "completed") fail("INCOMPLETE_RESPONSE", "Assistant message is incomplete.");
    for (const block of output.content ?? []) {
      if (block.type === "refusal") fail("PROVIDER_REFUSAL", "OpenAI declined the diagnostic.");
      if (block.type !== "output_text") continue;
      if (block.text === undefined) fail("INVALID_ANSWER", "Assistant text block is missing text.");
      if (answer) answer += "\n\n";
      const base = answer.length;
      answer += block.text;
      for (const annotation of block.annotations ?? []) {
        if (annotation.type !== "url_citation") fail("INVALID_ATTRIBUTION", "Unsupported native OpenAI attribution.");
        if (annotation.start_index === undefined || annotation.end_index === undefined) {
          fail("INVALID_ATTRIBUTION", "Required citation has no text range.");
        }
        const span = citationSpan(block.text, annotation.start_index, annotation.end_index, ctx);
        const id = builder.source(annotation.url, annotation.title, "cited")!;
        builder.citation(id, base + span.start, base + span.end, blockIndex, "span", span.unit,
          annotation.start_index, annotation.end_index);
      }
      blockIndex++;
    }
  }
  evidence.invocationStatus = calls ? "invoked" : "not_invoked";
  evidence.toolCallCount = calls;
  // This counts native search actions, not billable queries or opened pages.
  evidence.searchCount = searches;
  evidence.usage = { inputTokens: count(response.usage?.input_tokens),
    outputTokens: count(response.usage?.output_tokens), totalTokens: count(response.usage?.total_tokens) };
  return validateGeneration({ answerText: finalText(answer), evidence });
}
