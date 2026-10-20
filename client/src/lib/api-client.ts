import createClient, { type Middleware } from "openapi-fetch";

import type { paths } from "@shared/api-types";
import { getClientId } from "./clientContext";

/**
 * Redirects the browser to `/login` on a 401 response, mirroring the
 * behavior of the legacy `apiRequest` helper in `queryClient.ts`. We
 * intentionally skip redirecting away from `/login` itself and from the
 * auth probe endpoint so the login page can detect the unauthenticated
 * state without bouncing.
 */
async function redirectToLoginIfNeeded(response: Response) {
  if (response.status !== 401) return;
  if (typeof window === "undefined") return;
  // Best-effort: peek at the response body for a `reason` so we can
  // broadcast a richer event to sibling tabs (Task #37). The body is
  // already consumed downstream — clone first.
  try {
    const cloned = response.clone();
    const text = await cloned.text();
    if (text) {
      const parsed = JSON.parse(text) as { reason?: string };
      if (parsed?.reason) {
        const { broadcastAuthEvent } = await import("./auth");
        broadcastAuthEvent({ type: "revoked", reason: parsed.reason });
      }
    }
  } catch {
    /* best-effort only */
  }
  if (window.location.pathname === "/login") return;
  if (response.url && response.url.includes("/api/v1/auth/")) return;
  window.location.replace("/login");
}

/**
 * Reads a cookie value from `document.cookie`. Used to inject the CSRF
 * double-submit header (Task #37) — the server sets `polaris.csrf` as a
 * non-httpOnly cookie and the SPA echoes it in `x-csrf-token` on every
 * state-changing call.
 */
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

const tenancyAndAuthMiddleware: Middleware = {
  async onRequest({ request }) {
    const clientId = getClientId();
    if (clientId && !request.headers.has("x-client-id")) {
      request.headers.set("x-client-id", clientId);
    }
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const csrf = readCookie("polaris.csrf");
      if (csrf && !request.headers.has("x-csrf-token")) {
        request.headers.set("x-csrf-token", csrf);
      }
    }
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) {
      redirectToLoginIfNeeded(response);
    }
    return response;
  },
};

/**
 * Typed HTTP client generated from the OpenAPI spec at
 * `shared/api-types.ts`. Use this in preference to bare `fetch` /
 * `apiRequest` for any endpoint that's documented in
 * `server/routes/openapi.ts` — every path, query param, body, and
 * response is end-to-end type-checked.
 *
 * Example:
 *   const { data, error } = await apiClient.GET("/api/v1/clients", {
 *     params: { query: { orgId: "..." } },
 *   });
 */
export const apiClient = createClient<paths>({
  credentials: "include",
});

apiClient.use(tenancyAndAuthMiddleware);

export type ApiPaths = paths;
