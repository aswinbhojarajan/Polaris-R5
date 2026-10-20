/**
 * Task #115 — Jittered retry wrapper for vendor LLM SDK calls.
 *
 * Retries transient failures (HTTP 429, 5xx, connection-level errors)
 * with exponential backoff + full jitter, up to `maxAttempts` total
 * attempts (so `maxAttempts=3` means 1 initial try + 2 retries) bounded
 * by an absolute `maxTotalMs` budget. Vendor-paused refusals and 4xx
 * client errors bypass the retry — those will not succeed on a second
 * try and we'd only burn rate-limit quota.
 *
 * The wrapper intentionally has no dependency on a specific SDK shape.
 * Callers pass a function that throws on failure; the wrapper inspects
 * the thrown error for the status code (Anthropic / OpenAI SDKs put it
 * on `.status`; node-fetch / undici errors expose `.code`).
 *
 * Usage:
 *   return withVendorRetry('OpenAI', () => client.chat.completions.create(...));
 *
 * For executePrompt-style call sites that return `{ error, statusCode }`
 * instead of throwing, use `withVendorRetryResult` which retries when
 * the returned object reports a retryable status.
 */
import { VendorPausedError } from '../config/vendor-pause';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxTotalMs?: number;
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  maxTotalMs: 10_000,
};

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
  if (anyErr.response && typeof anyErr.response.status === 'number') {
    return anyErr.response.status;
  }
  return undefined;
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'UND_ERR_SOCKET'
  );
}

export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  if (status === 408) return true;
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof VendorPausedError) return false;
  if (isNetworkError(err)) return true;
  return isRetryableStatus(extractStatus(err));
}

function jitter(delay: number): number {
  // Full jitter: pick uniform in [0, delay].
  return Math.floor(Math.random() * delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function on transient vendor errors. The function is
 * expected to throw on failure (standard SDK behavior).
 */
export async function withVendorRetry<T>(
  vendor: string,
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const start = Date.now();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Vendor paused → fail fast, no retry. Paused means paused.
      if (err instanceof VendorPausedError) throw err;
      if (!isRetryableError(err)) throw err;
      if (attempt >= opts.maxAttempts) break;

      const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay = jitter(exp);
      const elapsed = Date.now() - start;
      if (elapsed + delay > opts.maxTotalMs) {
        console.warn(
          `[LLM-Retry] ${vendor}: retry budget (${opts.maxTotalMs}ms) exhausted after ${attempt} attempt(s)`,
        );
        break;
      }
      const status = extractStatus(err);
      console.warn(
        `[LLM-Retry] ${vendor}: attempt ${attempt}/${opts.maxAttempts} failed (status=${status ?? 'network'}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Variant for call sites that don't throw — they return a result envelope
 * carrying `{ error, statusCode, isRateLimited? }`. Used by `executePrompt`.
 * The function is invoked until it returns a non-retryable result or the
 * attempt/time budget is exhausted; the last result is then returned.
 */
export async function withVendorRetryResult<T extends { error?: string; statusCode?: number; isRateLimited?: boolean }>(
  vendor: string,
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const start = Date.now();
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const result = await fn();
    lastResult = result;
    const failed = !!result.error;
    // Treat 503 vendor-paused responses as terminal — the caller already
    // short-circuited at the kill-switch guard, retrying would just hit
    // the same guard again.
    if (!failed) return result;
    const status = result.statusCode;
    if (status === 503 && /paused/i.test(result.error ?? '')) return result;
    if (!isRetryableStatus(status) && !result.isRateLimited) return result;
    if (attempt >= opts.maxAttempts) break;

    const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
    const delay = jitter(exp);
    const elapsed = Date.now() - start;
    if (elapsed + delay > opts.maxTotalMs) {
      console.warn(
        `[LLM-Retry] ${vendor}: retry budget (${opts.maxTotalMs}ms) exhausted after ${attempt} attempt(s)`,
      );
      break;
    }
    console.warn(
      `[LLM-Retry] ${vendor}: attempt ${attempt}/${opts.maxAttempts} returned status=${status ?? '?'}, retrying in ${delay}ms`,
    );
    await sleep(delay);
  }
  return lastResult as T;
}
