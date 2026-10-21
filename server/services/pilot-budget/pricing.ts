/** Conservative default-tier bounds shared by development and production pilots.
 * These are accounting upper estimates, not an invoice or an account-wide cap. */
export const pilotRates = {
  "gpt-5.6-terra": { provider: "openai", input: 10, output: 30, context: 1_050_000, maximumOutput: 128_000 },
  "gpt-5.4": { provider: "openai", input: 15, output: 45, context: 1_050_000, maximumOutput: 128_000 },
  "gpt-4o-mini": { provider: "openai", input: 1, output: 2, context: 128_000, maximumOutput: 16_384 },
  "claude-sonnet-5": { provider: "anthropic", input: 10, output: 30, context: 1_000_000, maximumOutput: 128_000 },
} as const;
type Model = keyof typeof pilotRates;
type Fail = (code: string) => never;
export type PilotQuote = { model: Model; input: number; output: number; searchUses: number; reservedMicros: number };
const integer = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;

export function quotePilotRequest(body: any, provider: "openai" | "anthropic", path: string, fail: Fail): PilotQuote {
  const model = body?.model as Model;
  if (!Object.hasOwn(pilotRates, model) || pilotRates[model].provider !== provider) fail("UNPRICED_MODEL");
  const rate = pilotRates[model];
  if (body.stream || (body.n !== undefined && body.n !== 1) || body.speed ||
      body.prediction || body.audio || body.modalities || body.functions ||
      body.web_search_options || body.previous_response_id || body.conversation || body.prompt) fail("UNAPPROVED_REQUEST");
  if (body.service_tier && body.service_tier !== "default" && body.service_tier !== "standard_only") fail("UNAPPROVED_TIER");
  const requested = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) fail("UNAPPROVED_TOOLS");
  let searchUses = 0;
  if (tools.length) {
    if (tools.length !== 1) fail("UNAPPROVED_TOOLS");
    const tool = tools[0];
    if (provider === "openai" && path === "/v1/responses" && tool.type === "web_search" &&
        integer(body.max_tool_calls, 5) && body.max_tool_calls > 0) searchUses = body.max_tool_calls;
    else if (provider === "anthropic" && tool.type === "web_search_20250305" &&
        integer(tool.max_uses, 5) && tool.max_uses > 0) searchUses = tool.max_uses;
    else fail("UNAPPROVED_TOOLS");
  }
  const maximum = !searchUses && provider === "openai" && path === "/v1/chat/completions" && requested === undefined;
  const output = maximum ? rate.maximumOutput : requested;
  if (!integer(output, maximum ? rate.maximumOutput : 8000) || output < 1) fail("UNBOUNDED_OUTPUT");
  if (body.messages && (!Array.isArray(body.messages) || body.messages.length > 32)) fail("UNAPPROVED_REQUEST");
  if (!searchUses && (!Array.isArray(body.messages) ||
      body.messages.some((message: any) => typeof message?.content !== "string"))) fail("TEXT_ONLY_REQUIRED");
  if (provider === "openai" && path === "/v1/responses" && typeof body.input !== "string") fail("TEXT_ONLY_REQUIRED");
  const input = searchUses ? rate.context : Buffer.byteLength(JSON.stringify(body), "utf8") + 4096;
  if (!searchUses && input + output > rate.context) fail("INPUT_BOUND_EXCEEDED");
  return { model, input, output, searchUses,
    reservedMicros: Math.ceil(input * rate.input + output * rate.output + searchUses * 20_000) };
}

export function settlePilotUsage(payload: any, quote: PilotQuote, provider: "openai" | "anthropic", fail: Fail) {
  const usage = payload?.usage;
  if (provider === "anthropic" && ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
    .some(key => !integer(usage?.[key] ?? 0, pilotRates[quote.model].context))) fail("UNVERIFIED_USAGE");
  const inputTokens = provider === "openai" ? usage?.input_tokens ?? usage?.prompt_tokens
    : usage && usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const outputTokens = provider === "openai" ? usage?.output_tokens ?? usage?.completion_tokens : usage?.output_tokens;
  if (!integer(inputTokens, quote.input) || !integer(outputTokens, quote.output)) fail("UNVERIFIED_USAGE");
  if (payload?.service_tier && !["default", "standard", "standard_only"].includes(payload.service_tier)) fail("UNAPPROVED_TIER");
  const rate = pilotRates[quote.model];
  return { state: "settled" as const,
    accountedMicros: Math.ceil(inputTokens * rate.input + outputTokens * rate.output + quote.searchUses * 20_000),
    inputTokens, outputTokens,
    ...(typeof payload.model === "string" && payload.model.length <= 200 ? { reportedModel: payload.model } : {}) };
}
