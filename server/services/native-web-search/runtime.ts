import type { NativeGeneration, NativeProvider } from "../../../shared/native-web-search";
import { normalizeOpenAiSearch, buildOpenAiSearchRequest } from "./openai";
import { normalizeClaudeSearch, buildClaudeSearchRequest } from "./claude";
import { assertGeminiGroundingPermitted } from "./gemini";
import { NativeSearchError, failedGeneration, isControlSignal, type ParseContext } from "./common";

export interface AttemptLedger {
  attemptCount: number;
  continuationCount: number;
  searchBudgetReserved: number;
}
export interface NativeSearchOptions {
  provider: NativeProvider;
  model: string;
  prompt: string;
  instructions: string;
  apiKey: string;
  /** Required real admission/execution checks supplied by the queued ON worker. */
  assertEligible: () => Promise<void>;
  checkControl: () => void;
  /** MUST durably commit under the item's fenced ownership before any paid dispatch. */
  saveAttempt: (ledger: AttemptLedger) => Promise<void>;
  ledger: AttemptLedger;
  deadlineAt: number;
  maxRetries: number;
  actualModels: readonly string[];
  openAiOffsetUnit?: "utf16" | "codepoint";
  transport?: typeof fetch;
}
const MAX_RESPONSE_BYTES = 2_097_152;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new NativeSearchError("INVALID_PROVIDER_RESPONSE", "Missing provider response.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new NativeSearchError("RESPONSE_TOO_LARGE", "Provider response exceeded its bounded transport limit.");
      }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    try { return JSON.parse(body); }
    catch { throw new NativeSearchError("INVALID_PROVIDER_RESPONSE", "Provider returned invalid JSON."); }
  } finally { reader.releaseLock(); }
}
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
async function sleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); };
    const aborted = () => { done(); reject(signal.reason); };
    const timer = setTimeout(() => { done(); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); });
    if (signal.aborted) aborted();
  });
}

/**
 * Search-only HTTP owner: no SDK/vendor/batch retry wrapper.
 * Called only by the admitted, fenced queued worker; OFF uses the legacy executor.
 */
export async function executeNativeSearch(options: NativeSearchOptions): Promise<NativeGeneration> {
  // Even injected transport cannot bypass Google's independent gate.
  if (options.provider === "google") assertGeminiGroundingPermitted();
  if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 2 ||
      !Number.isInteger(options.ledger.attemptCount) || options.ledger.attemptCount < 0 || options.ledger.attemptCount > 20 ||
      !Number.isInteger(options.ledger.continuationCount) || options.ledger.continuationCount < 0 || options.ledger.continuationCount > 3 ||
      !Number.isInteger(options.ledger.searchBudgetReserved) || options.ledger.searchBudgetReserved < 0 || options.ledger.searchBudgetReserved > 5 ||
      !Number.isFinite(options.deadlineAt) || options.deadlineAt - Date.now() > 300_000) {
    throw new NativeSearchError("INVALID_EXECUTION_BUDGET", "Invalid native execution bounds.");
  }
  const start = Date.now();
  const ledger = { ...options.ledger };
  const controller = new AbortController();
  const ctx = (): ParseContext => ({ provider: options.provider, model: options.model,
    durationMs: Date.now() - start, attempts: ledger.attemptCount,
    continuations: ledger.continuationCount, openAiOffsetUnit: options.openAiOffsetUnit });
  let monitorBusy = false;
  const guard = async () => {
    options.checkControl();
    if (Date.now() >= options.deadlineAt) throw new NativeSearchError("ITEM_DEADLINE", "Native search item deadline exceeded.");
    await abortable(options.assertEligible(), controller.signal);
    options.checkControl();
  };
  const monitor = setInterval(async () => {
    if (monitorBusy || controller.signal.aborted) return;
    monitorBusy = true;
    try { await guard(); } catch (e) { controller.abort(e); } finally { monitorBusy = false; }
  }, 250);
  const deadlineTimer = setTimeout(() =>
    controller.abort(new NativeSearchError("ITEM_DEADLINE", "Native search item deadline exceeded.")),
  Math.max(0, options.deadlineAt - Date.now()));
  const transport = options.transport ?? fetch;
  const responses: unknown[] = [];
  let requestId: string | undefined;
  let reportedModel: string | null = null;
  let transientRetries = 0;
  let claudeBudgetLeft = 5 - ledger.searchBudgetReserved;
  let claudeMessages: unknown[] = [{ role: "user", content: options.prompt }];
  try {
    if (!options.apiKey) throw new NativeSearchError("PROVIDER_KEY_MISSING", "Provider credentials are unavailable.");
    for (;;) {
      await guard();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (ledger.attemptCount >= options.maxRetries + (options.provider === "openai" ? 1 : 4) ||
          ledger.continuationCount > 3) {
        throw new NativeSearchError("ATTEMPT_BUDGET_EXCEEDED", "Native search exhausted its persisted attempt budget.");
      }
      let body: object;
      if (options.provider === "openai") {
        body = buildOpenAiSearchRequest(options.prompt, options.model, options.instructions);
      } else {
        if (claudeBudgetLeft < 1) throw new NativeSearchError("SEARCH_BUDGET_EXCEEDED", "Claude search budget is exhausted or indeterminate.");
        body = { ...buildClaudeSearchRequest(options.prompt, options.model, options.instructions, claudeBudgetLeft),
          messages: claudeMessages };
        // Reserve before dispatch. An unknown outcome must not reset paid work on recovery.
        ledger.searchBudgetReserved += claudeBudgetLeft;
      }
      ledger.attemptCount++;
      // Deliberately outside HTTP retry handling: a failed DB write never causes a paid retry.
      await abortable(options.saveAttempt({ ...ledger }), controller.signal);
      await guard();
      const requestBody = JSON.stringify(body);
      let response: Response;
      try {
        response = await transport(options.provider === "openai" ? "https://api.openai.com/v1/responses" :
          "https://api.anthropic.com/v1/messages", {
          method: "POST", body: requestBody, signal: controller.signal,
          headers: { "Content-Type": "application/json", ...(options.provider === "openai" ?
            { Authorization: `Bearer ${options.apiKey}` } :
            { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" }) },
        });
      } catch (e) {
        if (controller.signal.aborted) throw controller.signal.reason;
        // A lost Claude request has an indeterminate five-use reservation: fail closed.
        if (options.provider === "anthropic" || transientRetries++ >= options.maxRetries) {
          throw new NativeSearchError("PROVIDER_NETWORK_ERROR", "Native provider connection failed with an indeterminate outcome.", true);
        }
        await sleep(Math.random() * Math.min(4000, 250 * 2 ** transientRetries), controller.signal);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const canRetry = [408, 429].includes(response.status) || response.status >= 500;
        const error = new NativeSearchError(`PROVIDER_HTTP_${response.status}`,
          `Native provider rejected the request (HTTP ${response.status}).`,
          canRetry, response.status, retryAfter(response.headers.get("retry-after")));
        // Only a clear rate rejection releases Claude's reservation; other outcomes remain uncertain.
        if (options.provider === "anthropic" && response.status === 429) {
          ledger.searchBudgetReserved -= claudeBudgetLeft;
          await abortable(options.saveAttempt({ ...ledger }), controller.signal);
        }
        if (!canRetry || (options.provider === "anthropic" && response.status !== 429) ||
            transientRetries++ >= options.maxRetries) throw error;
        // Respect the full Retry-After; refuse rather than retry earlier than the server asked.
        const delay = Math.max(error.retryAfterMs ?? 0, Math.random() * Math.min(4000, 250 * 2 ** transientRetries));
        if (Date.now() + delay >= options.deadlineAt) throw error;
        await sleep(delay, controller.signal);
        continue;
      }
      const payload = await readJson(response);
      requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
      if (requestId && !/^[\w:.-]{1,200}$/.test(requestId)) requestId = undefined;
      if (options.provider === "openai") {
        const normalized = normalizeOpenAiSearch(payload, { ...ctx(), requestId });
        reportedModel = normalized.evidence.actualModel;
        assertActualModel(normalized, options);
        return normalized;
      }
      // Raw encrypted assistant blocks live only inside this bounded local continuation transcript.
      // Never include them in durable evidence or errors.
      const message = payload as { stop_reason?: unknown; content?: unknown;
        usage?: { server_tool_use?: { web_search_requests?: unknown } } };
      if (!Array.isArray(message.content)) throw new NativeSearchError("INVALID_PROVIDER_RESPONSE", "Claude content is missing.");
      const uses = message.content.filter(b => b && b.type === "server_tool_use" && b.name === "web_search").length;
      const reported = message.usage?.server_tool_use?.web_search_requests;
      const consumed = typeof reported === "number" && Number.isInteger(reported) && reported >= 0 ?
        Math.max(reported, uses) : uses;
      if (consumed > claudeBudgetLeft) throw new NativeSearchError("SEARCH_BUDGET_EXCEEDED", "Claude exceeded its reserved search budget.");
      ledger.searchBudgetReserved -= claudeBudgetLeft - consumed;
      claudeBudgetLeft = 5 - ledger.searchBudgetReserved;
      responses.push(payload);
      if (message.stop_reason === "pause_turn") {
        if (++ledger.continuationCount > 3) throw new NativeSearchError("CONTINUATION_BUDGET_EXCEEDED", "Claude continuation limit reached.");
        claudeMessages = [...claudeMessages, { role: "assistant", content: message.content }];
        continue;
      }
      const normalized = normalizeClaudeSearch(responses, { ...ctx(), requestId });
      reportedModel = normalized.evidence.actualModel;
      assertActualModel(normalized, options);
      return normalized;
    }
  } catch (e) {
    const error = controller.signal.aborted ? controller.signal.reason : e;
    if (isControlSignal(error)) throw error;
    const failure = failedGeneration({ ...ctx(), requestId }, error);
    if (reportedModel) {
      failure.evidence.actualModel = reportedModel;
      failure.evidence.actualModelEvidence = "provider_reported";
    }
    return failure;
  } finally { clearInterval(monitor); clearTimeout(deadlineTimer); }
}
function assertActualModel(result: NativeGeneration, options: NativeSearchOptions) {
  const actual = result.evidence.actualModel;
  if (actual && actual !== options.model && !options.actualModels.includes(actual)) {
    throw new NativeSearchError("MODEL_IDENTITY_MISMATCH", "Provider reported an unapproved model identity; no substitution accepted.");
  }
}
