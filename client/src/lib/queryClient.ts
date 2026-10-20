import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getClientId } from "./clientContext";
import { apiClient } from "./api-client";

/**
 * Re-exported so existing modules can `import { apiClient } from "@/lib/queryClient"`.
 * The typed client is generated from `/openapi.json` — see
 * `scripts/generate-api-types.ts` and `client/src/lib/api-client.ts`.
 */
export { apiClient };
export type { ApiPaths } from "./api-client";

function broadcastRevokedFromBody(res: Response) {
  // Mirrors the OpenAPI client (api-client.ts): when a state-changing
  // call comes back 401 with a `reason` (idle_timeout / absolute_timeout
  // / session_revoked / account_disabled), broadcast it so sibling tabs
  // also clear their auth state. Cloning lets us still .text()/.json()
  // downstream.
  try {
    res
      .clone()
      .json()
      .then(async (parsed: unknown) => {
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as { reason?: unknown }).reason === "string"
        ) {
          const { broadcastAuthEvent } = await import("./auth");
          broadcastAuthEvent({
            type: "revoked",
            reason: (parsed as { reason: string }).reason,
          });
        }
      })
      .catch(() => {});
  } catch {
    /* noop */
  }
}

function redirectToLoginIfNeeded(res: Response) {
  if (res.status !== 401) return;
  if (typeof window === "undefined") return;
  broadcastRevokedFromBody(res);
  // Don't redirect away from login page itself, or the auth probe.
  if (window.location.pathname === "/login") return;
  if (res.url && res.url.includes("/api/v1/auth/")) return;
  window.location.replace("/login");
}

/**
 * Task #113 — Typed error from the unified backend error contract.
 *
 *   { error: { code, message, requestId, details? } }
 *
 * `ApiError.toString()` preserves the legacy `"${status}: ${text}"` shape
 * so existing call sites that pattern-match on `error.message` keep
 * working unchanged; new callers can check `instanceof ApiError` and
 * read `code` / `requestId` / `details` directly.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;
  readonly raw: string;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    details?: unknown;
    raw: string;
  }) {
    // Keep the legacy `"<status>: <text>"` Error.message shape so any
    // existing UI that does `error.message.includes("403")` still works.
    super(`${opts.status}: ${opts.message}`);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.details = opts.details;
    this.raw = opts.raw;
  }
}

interface ParsedErrorBody {
  code: string;
  message: string;
  requestId: string | null;
  details?: unknown;
}

function parseErrorBody(raw: string): ParsedErrorBody | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    // New shape: { error: { code, message, requestId, details? } }
    const errEnvelope = (parsed as { error?: unknown }).error;
    if (errEnvelope && typeof errEnvelope === "object") {
      const e = errEnvelope as {
        code?: unknown;
        message?: unknown;
        requestId?: unknown;
        details?: unknown;
      };
      return {
        code: typeof e.code === "string" ? e.code : "unknown",
        message:
          typeof e.message === "string" ? e.message : "Request failed",
        requestId: typeof e.requestId === "string" ? e.requestId : null,
        details: e.details,
      };
    }
    // Legacy shape: { message, code? }
    const legacy = parsed as { message?: unknown; code?: unknown };
    if (typeof legacy.message === "string") {
      return {
        code: typeof legacy.code === "string" ? legacy.code : "unknown",
        message: legacy.message,
        requestId: null,
      };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      redirectToLoginIfNeeded(res);
    }
    const text = (await res.text()) || res.statusText;
    const requestIdHeader = res.headers.get("x-request-id");
    const parsed = parseErrorBody(text);
    throw new ApiError({
      status: res.status,
      code: parsed?.code ?? "unknown",
      message: parsed?.message ?? text,
      requestId: parsed?.requestId ?? requestIdHeader,
      details: parsed?.details,
      raw: text,
    });
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const all = document.cookie ? document.cookie.split("; ") : [];
  for (const part of all) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

function getAuthHeaders(method?: string): Record<string, string> {
  const clientId = getClientId();
  const headers: Record<string, string> = {};

  if (clientId) {
    headers["x-client-id"] = clientId;
  }

  // CSRF double-submit (Task #37). Send `x-csrf-token` matching the
  // `polaris.csrf` cookie on every state-changing request. The server
  // ignores GET/HEAD/OPTIONS and a small auth-paths exemption list.
  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    const csrf = readCookie("polaris.csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = {
    ...getAuthHeaders(method),
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      headers: getAuthHeaders(),
      credentials: "include",
    });

    if (res.status === 401) {
      redirectToLoginIfNeeded(res);
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Task #114 — Retry policy.
 *
 * - 4xx (client errors / auth / validation): 0 retries — they won't fix
 *   themselves and re-issuing burns rate limit.
 * - 5xx + network errors (no `ApiError` thrown): up to 2 retries with
 *   exponential backoff (1s, 2s, capped at 5s).
 *
 * Applied to both queries and mutations so a flaky 503 from a transient
 * vendor blip self-heals instead of forcing the user to click Retry.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  // Per spec: up to 2 retries after the initial failure (so 3 total
  // attempts) for 5xx/network errors. TanStack passes the post-failure
  // count, so allow retry while failureCount < 3.
  if (failureCount >= 3) return false;
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) return false;
    return true;
  }
  // Network errors (fetch throws) — retry.
  return true;
}

function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 5000);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: shouldRetry,
      retryDelay,
    },
    mutations: {
      retry: shouldRetry,
      retryDelay,
    },
  },
});
