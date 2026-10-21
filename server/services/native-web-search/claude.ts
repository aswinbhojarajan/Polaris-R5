import { z } from "zod";
import { validateGeneration } from "../../../shared/native-web-search";
import { baseEvidence, count, EvidenceBuilder, fail, finalText, reportIdentity, type ParseContext } from "./common";

const messageSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), stop_reason: z.string().nullable(),
  content: z.array(z.object({
    type: z.string(), id: z.string().optional(), name: z.string().optional(), tool_use_id: z.string().optional(),
    text: z.string().optional(),
    citations: z.array(z.object({
      type: z.string(), url: z.string().optional(), title: z.string().optional(),
    })).max(1024).nullable().optional(),
    content: z.union([
      z.object({ type: z.string(), error_code: z.string().optional() }),
      z.array(z.object({ type: z.string(), url: z.string().optional(), title: z.string().optional() })).max(10_000),
    ]).optional(),
  })).max(4096),
  usage: z.object({
    input_tokens: z.number().optional(), output_tokens: z.number().optional(),
    server_tool_use: z.object({ web_search_requests: z.number().optional() }).optional(),
  }).optional(),
});

export function buildClaudeSearchRequest(prompt: string, model: string, system: string, maxUses = 5) {
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 5) fail("INVALID_SEARCH_BUDGET", "Invalid Claude search budget.");
  return { model, system, max_tokens: model.endsWith("-5") ? 8000 : 2000,
    messages: [{ role: "user" as const, content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }] };
}

/** Input messages are responses to each continuation, not the repeated request transcript. */
export function normalizeClaudeSearch(values: unknown[], ctx: ParseContext) {
  if (!values.length || values.length > 4) fail("INVALID_CONTINUATION", "Invalid Claude continuation sequence.");
  const evidence = baseEvidence(ctx), builder = new EvidenceBuilder(evidence);
  let answer = "", blockIndex = 0, inputTokens = 0, outputTokens = 0, searches = 0;
  let allUsageKnown = true, searchUsageKnown = true;
  const uses = new Set<string>(), completed = new Set<string>();
  for (let turn = 0; turn < values.length; turn++) {
    const parsed = messageSchema.safeParse(values[turn]);
    if (!parsed.success) fail("INVALID_PROVIDER_RESPONSE", "Claude response does not match the native contract.");
    const message = parsed.data;
    if (message.stop_reason !== (turn === values.length - 1 ? "end_turn" : "pause_turn")) {
      fail("INCOMPLETE_RESPONSE", "Claude response did not finish within the continuation budget.");
    }
    if (evidence.actualModel && message.model && evidence.actualModel !== message.model) {
      fail("MODEL_IDENTITY_MISMATCH", "Claude changed reported model identity during continuation.");
    }
    reportIdentity(evidence, message.model, message.id);
    for (const block of message.content) {
      if (block.type === "server_tool_use") {
        if (block.name !== "web_search" || !block.id) fail("UNKNOWN_TOOL_ACTION", "Unexpected Claude tool action.");
        if (uses.has(block.id)) fail("INVALID_PROVIDER_RESPONSE", "Duplicate Claude search action.");
        uses.add(block.id);
      }
      if (block.type === "web_search_tool_result") {
        if (!block.tool_use_id || !uses.has(block.tool_use_id) || completed.has(block.tool_use_id)) {
          fail("INVALID_PROVIDER_RESPONSE", "Unmatched Claude search result.");
        }
        if (!Array.isArray(block.content)) fail("SEARCH_TOOL_FAILED", "Claude returned an embedded web-search tool error.");
        completed.add(block.tool_use_id);
        for (const source of block.content) {
          if (source.type !== "web_search_result") fail("SEARCH_TOOL_FAILED", "Unexpected Claude search result.");
          builder.source(source.url, source.title, "consulted");
        }
      }
      if (block.type !== "text") continue;
      if (block.text === undefined) fail("INVALID_ANSWER", "Claude text block is missing text.");
      if (answer) answer += "\n\n";
      const base = answer.length; answer += block.text;
      for (const citation of block.citations ?? []) {
        if (citation.type !== "web_search_result_location") fail("INVALID_ATTRIBUTION", "Unsupported Claude citation type.");
        const id = builder.source(citation.url, citation.title, "cited")!;
        // cited_text is a SOURCE quotation, not an offset into this assistant answer.
        builder.citation(id, base, answer.length, blockIndex, "block", "block");
      }
      blockIndex++;
    }
    const input = count(message.usage?.input_tokens), output = count(message.usage?.output_tokens);
    if (input === undefined || output === undefined) allUsageKnown = false;
    inputTokens += input ?? 0; outputTokens += output ?? 0;
    const search = count(message.usage?.server_tool_use?.web_search_requests);
    if (search === undefined) searchUsageKnown = false;
    searches += search ?? 0;
  }
  if (uses.size !== completed.size) fail("SEARCH_TOOL_FAILED", "Claude search result is incomplete.");
  if (uses.size > 5 || searches > 5) fail("SEARCH_BUDGET_EXCEEDED", "Claude exceeded the whole-item search budget.");
  evidence.invocationStatus = completed.size ? "invoked" : "not_invoked";
  evidence.toolCallCount = completed.size;
  if (searchUsageKnown) {
    evidence.searchCount = searches; evidence.usage.webSearchRequests = searches;
  }
  if (allUsageKnown) { evidence.usage.inputTokens = inputTokens; evidence.usage.outputTokens = outputTokens; }
  evidence.continuationCount = values.length - 1;
  return validateGeneration({ answerText: finalText(answer), evidence });
}
