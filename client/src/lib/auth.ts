import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export type UserRole = "admin" | "member" | "viewer";

export interface OrgMembership {
  orgId: string;
  role: UserRole;
}

export interface AuthSession {
  user: AuthUser;
  orgIds: string[];
  memberships?: OrgMembership[];
  mustChangePassword?: boolean;
  status?: "invited" | "active" | "disabled";
}

export const AUTH_QUERY_KEY = ["/api/v1/auth/me"] as const;

async function fetchAuth(): Promise<AuthSession | null> {
  const res = await fetch("/api/v1/auth/me", {
    credentials: "include",
  });
  if (res.status === 401) {
    // Mirror the shared 401 broadcast in api-client.ts so cross-tab
    // revocation toast behavior stays deterministic when the auth
    // probe is the first request to learn the session is gone.
    try {
      const body = await res.clone().json();
      const reason = typeof body?.reason === "string" ? body.reason : undefined;
      if (reason) {
        broadcastAuthEvent({ type: "revoked", reason });
      }
    } catch {
      /* response body not JSON — nothing to broadcast */
    }
    return null;
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function useAuth() {
  const query = useQuery<AuthSession | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchAuth,
    staleTime: 1000 * 30,
    retry: false,
  });

  return {
    session: query.data ?? null,
    user: query.data?.user ?? null,
    orgIds: query.data?.orgIds ?? [],
    isLoading: query.isLoading,
    isAuthenticated: !!query.data?.user,
    refetch: query.refetch,
  };
}

/**
 * Cross-tab logout coordination (Task #37). Tabs broadcast `{type:"logout"}`
 * from explicit signouts and `{type:"revoked", reason}` whenever the auth
 * probe returns 401 with a known reason. Sibling tabs clear their query
 * cache and route to /login. Graceful no-op when BroadcastChannel is
 * unavailable (older Safari).
 */
const AUTH_CHANNEL_NAME = "polaris-auth";
let authChannel: BroadcastChannel | null = null;
function getAuthChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (authChannel !== null) return authChannel;
  if (typeof BroadcastChannel === "undefined") return null;
  authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  return authChannel;
}

type AuthBroadcastMessage =
  | { type: "logout" }
  | { type: "revoked"; reason?: string };

export function broadcastAuthEvent(msg: AuthBroadcastMessage) {
  const ch = getAuthChannel();
  if (ch) {
    try {
      ch.postMessage(msg);
    } catch {
      /* ignore */
    }
  }
}

let authListenerInstalled = false;
export function installAuthBroadcastListener(handlers: {
  onLogout?: () => void;
  onRevoked?: (reason?: string) => void;
}) {
  if (authListenerInstalled) return;
  const ch = getAuthChannel();
  if (!ch) return;
  ch.addEventListener("message", (ev) => {
    const data = ev.data as AuthBroadcastMessage | null;
    if (!data) return;
    if (data.type === "logout" && handlers.onLogout) handlers.onLogout();
    if (data.type === "revoked" && handlers.onRevoked) handlers.onRevoked(data.reason);
  });
  authListenerInstalled = true;
}

export function useLogin() {
  return useMutation({
    mutationFn: async (input: {
      email: string;
      password: string;
      rememberMe?: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/v1/auth/login", input);
      return (await res.json()) as AuthSession;
    },
    onSuccess: (data) => {
      // Populate the cache from the login response for instant UX, then
      // re-probe /api/v1/auth/me to *verify* the session cookie actually
      // established. If the cookie never stuck (e.g. blocked in an
      // embedded / cross-site context, or dropped by the browser), the
      // probe returns 401 → fetchAuth resolves null → ProtectedRoute
      // bounces to /login. Without this, a phantom "logged in" state
      // renders the forced change-password screen and then fails the
      // first authenticated write (the change-password POST) with a 401.
      queryClient.setQueryData(AUTH_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/v1/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      queryClient.clear();
      broadcastAuthEvent({ type: "logout" });
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async (input: {
      email: string;
      password: string;
      displayName?: string;
      orgId?: string;
    }) => {
      const res = await apiRequest("POST", "/api/v1/auth/register", input);
      return (await res.json()) as AuthSession;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, data);
    },
  });
}
