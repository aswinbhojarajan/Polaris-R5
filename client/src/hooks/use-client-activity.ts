import { useQuery } from "@tanstack/react-query";
import type { ActivityItem, ActivityKind, ActivitySummary } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";

const POLL_MS_ACTIVE = 5000;
// Per spec: refetchInterval is strictly `5000 | false`. Initiator
// updates land via `invalidateActivityQueries` from each enqueue
// mutation; cross-user discovery on a fully idle page relies on the
// next user-driven invalidation or remount.

/**
 * Force an immediate re-fetch of every activity query (per-project + the
 * catalog summary). Call this from any local mutation that just enqueued
 * cross-user-visible work so the initiator's own UI reflects the new
 * banner row in the same tick instead of waiting for the next poll.
 */
export function invalidateActivityQueries(clientId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ["/api/v1/clients/activity-summary"] });
  if (clientId) {
    queryClient.invalidateQueries({
      queryKey: ["/api/v1/clients", clientId, "activity"],
    });
  } else {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey;
        return Array.isArray(k) && k[0] === "/api/v1/clients" && k[2] === "activity";
      },
    });
  }
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/**
 * Task #56 — Polls active activities for a single project. While items are
 * in-flight the query refetches every 5s; when the project goes idle the
 * interval is `false` (no polling) per the task spec. New work started by
 * the current user re-activates polling via cache invalidation in the
 * mutation `onSuccess` of each enqueue action; new work started by *other*
 * users becomes visible the next time this hook re-mounts (page nav) or a
 * mutation invalidates the cache.
 */
export function useClientActivity(clientId: string | null | undefined) {
  return useQuery<{ items: ActivityItem[] }>({
    queryKey: ["/api/v1/clients", clientId, "activity"],
    enabled: !!clientId,
    refetchInterval: (query) => {
      if (isHidden()) return false;
      const items = (query.state.data as { items?: ActivityItem[] } | undefined)?.items;
      return items && items.length > 0 ? POLL_MS_ACTIVE : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

export function useClientActivityItems(clientId: string | null | undefined): ActivityItem[] {
  const q = useClientActivity(clientId);
  return q.data?.items ?? [];
}

/**
 * Returns the most-recently-started in-flight activity for this project of
 * the given kind, or `undefined` if none exist. Used by trigger buttons to
 * surface "started by {name} {Xago}" in tooltips and confirm-modal copy
 * instead of generic "already running" messaging.
 */
export function useActiveItemOfKind(
  clientId: string | null | undefined,
  kind: ActivityKind,
): ActivityItem | undefined {
  const items = useClientActivityItems(clientId);
  const matches = items.filter((i) => i.kind === kind);
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, i) =>
    new Date(i.startedAt).getTime() > new Date(latest.startedAt).getTime() ? i : latest,
  );
}

/**
 * Human-friendly label for "started by …": "you" if it's our own row,
 * otherwise the display name / email / fallback.
 */
export function describeStarter(item: ActivityItem, myUserId: string | null | undefined): string {
  if (item.startedByUserId && myUserId && item.startedByUserId === myUserId) return "you";
  return item.startedByDisplayName || item.startedByEmail || "another user";
}

/**
 * Catalog-page summary across all visible projects. Idle/active polling
 * mirrors {@link useClientActivity}.
 */
export function useClientsActivitySummary(orgId: string = "default-org") {
  return useQuery<{ summaries: ActivitySummary[] }>({
    queryKey: ["/api/v1/clients/activity-summary", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/clients/activity-summary?orgId=${encodeURIComponent(orgId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch activity summary");
      return res.json();
    },
    refetchInterval: (query) => {
      if (isHidden()) return false;
      const summaries = (query.state.data as { summaries?: ActivitySummary[] } | undefined)?.summaries;
      return summaries && summaries.length > 0 ? POLL_MS_ACTIVE : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

export function activityKindLabel(kind: ActivityKind): string {
  switch (kind) {
    case "metadata_generation":
      return "Metadata generation";
    case "site_xray":
      return "Site X-Ray";
    case "prompt_run":
      return "Prompt run";
    case "refresh_prompts":
      return "Refresh prompts";
    case "project_copy":
      return "Project duplicate";
    case "report_generation":
      return "Report generation";
  }
}

/**
 * Maps an activity item to the page that owns its action so banners and
 * popovers can deep-link the user into the right place.
 */
export function activityItemHref(item: ActivityItem): string {
  const c = `clientId=${encodeURIComponent(item.clientId)}`;
  switch (item.kind) {
    case "metadata_generation":
      return `/app/client-config?${c}`;
    case "site_xray":
      return `/app/site-xray?${c}`;
    case "prompt_run":
      // Prompt runs live on the Prompts Tracker page (App.tsx route
      // `/app/prompts`), not the dashboard.
      return `/app/prompts?${c}${item.refId ? `&runId=${encodeURIComponent(item.refId)}` : ""}`;
    case "refresh_prompts":
      // Refresh-prompts is owned by the Prompt Library page (App.tsx
      // route `/app/prompt-library`), where the trigger lives.
      return `/app/prompt-library?${c}`;
    case "project_copy":
      return `/app/clients`;
    case "report_generation":
      return `/app/reports?${c}`;
  }
}
