import { storage } from "../storage";
import type {
  ActivityItem,
  ActivityKind,
  ActivitySummary,
} from "@shared/schema";

/**
 * Task #56 — Active operations service.
 *
 * Surfaces in-flight work for a project so multiple users on the same
 * project see who is doing what. Pulls source rows via the IStorage
 * abstraction (`listActiveActivitySources`) so MemStorage / unit-test
 * environments still satisfy the contract, then projects them into the
 * public {@link ActivityItem} DTO and hydrates user attribution via
 * `storage.getUsersByIds`.
 *
 * Sources:
 *   - `jobs` rows with status in (queued, running) → metadata_generation,
 *     site_xray (xray_analysis), refresh_prompts, project_copy.
 *   - `prompt_runs` rows with status in (queued, running, scoring,
 *     queued_for_benchmarking, benchmarking) → prompt_run.
 *   - `report_jobs` joined to `report_snapshots` for the clientId, with
 *     status in (queued, aggregating, analyzing, rendering)
 *     → report_generation.
 *
 * The xray_analysis job handler is currently a latent stub in the queue
 * (the worker has no implementation), but we still surface enqueued rows
 * so administrators can see why the queue grows when someone clicks
 * "analyze". See follow-up task #58.
 */

const JOB_TYPE_TO_KIND: Record<string, ActivityKind> = {
  generate_metadata: "metadata_generation",
  xray_analysis: "site_xray",
  refresh_prompts: "refresh_prompts",
  copy_client: "project_copy",
  // crawler_raw is intentionally NOT mapped — the standalone crawler
  // playground enqueues these without a project context, so they do not
  // belong on a project's activity panel.
};

const ACTIVE_JOB_STATUSES = ["queued", "running"];
// In-flight prompt-run statuses also include scoring + benchmarking
// transitions so the banner doesn't clear too early while the executor
// is still doing post-LLM work (see `statusEnum` in shared/schema.ts).
// Exported so the boot-time stale-prompt-run reaper (Task #59) can use the
// same source of truth instead of duplicating the list.
export const ACTIVE_PROMPT_RUN_STATUSES = [
  "queued",
  "running",
  "scoring",
  "queued_for_benchmarking",
  "benchmarking",
];
const ACTIVE_REPORT_STATUSES = [
  "queued",
  "aggregating",
  "analyzing",
  "rendering",
];

function labelForKind(kind: ActivityKind): string {
  switch (kind) {
    case "metadata_generation":
      return "Generating metadata";
    case "site_xray":
      return "Running site X-Ray";
    case "prompt_run":
      return "Running prompt analysis";
    case "refresh_prompts":
      return "Refreshing prompts";
    case "project_copy":
      return "Duplicating project";
    case "report_generation":
      return "Generating report";
  }
}

type UserLite = { id: string; displayName: string | null; email: string };

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

function isRealUserId(s: string | null | undefined): s is string {
  // prompt_runs.createdBy is a free-form string for legacy rows. Treat
  // the well-known sentinels as "not a user id" so we don't try to
  // hydrate them.
  return !!s && s !== "user" && s !== "system";
}

/**
 * Returns active activities for a single client.
 */
export async function listActiveActivitiesForClient(
  clientId: string,
): Promise<ActivityItem[]> {
  return listActiveActivitiesForClients([clientId]);
}

/**
 * Returns active activities across many clients in one round-trip.
 * Used by the per-project endpoint (single id) and the catalog summary.
 */
export async function listActiveActivitiesForClients(
  clientIds: string[],
): Promise<ActivityItem[]> {
  if (clientIds.length === 0) return [];

  const sources = await storage.listActiveActivitySources(
    clientIds,
    Object.keys(JOB_TYPE_TO_KIND),
    ACTIVE_JOB_STATUSES,
    ACTIVE_PROMPT_RUN_STATUSES,
    ACTIVE_REPORT_STATUSES,
  );

  const userIds: string[] = [];
  for (const j of sources.jobs) if (j.startedByUserId) userIds.push(j.startedByUserId);
  for (const r of sources.promptRuns) if (isRealUserId(r.createdBy)) userIds.push(r.createdBy);
  for (const r of sources.reports) if (r.startedByUserId) userIds.push(r.startedByUserId);
  const userRows = await storage.getUsersByIds(userIds);
  const usersById = new Map<string, UserLite>(userRows.map((u) => [u.id, u]));

  function attribute(uid: string | null) {
    if (!uid) return { startedByUserId: null, startedByDisplayName: null, startedByEmail: null };
    const u = usersById.get(uid);
    if (!u) return { startedByUserId: uid, startedByDisplayName: null, startedByEmail: null };
    return { startedByUserId: u.id, startedByDisplayName: u.displayName, startedByEmail: u.email };
  }

  const items: ActivityItem[] = [];

  for (const j of sources.jobs) {
    const kind = JOB_TYPE_TO_KIND[j.type];
    if (!kind) continue;
    const payload = j.payload || {};
    const cid =
      (typeof payload.clientId === "string" && payload.clientId) ||
      (typeof payload.sourceClientId === "string" && payload.sourceClientId) ||
      "";
    if (!clientIds.includes(cid)) continue;
    items.push({
      id: `job:${j.id}`,
      kind,
      clientId: cid,
      status: j.status === "running" ? "running" : "queued",
      progress: j.progress,
      label: labelForKind(kind),
      startedAt: toIso(j.startedAt ?? j.createdAt),
      ...attribute(j.startedByUserId),
      refId: j.id,
    });
  }

  for (const r of sources.promptRuns) {
    const uid = isRealUserId(r.createdBy) ? r.createdBy : null;
    items.push({
      id: `prompt_run:${r.id}`,
      kind: "prompt_run",
      clientId: r.clientId,
      status: r.status === "queued" || r.status === "queued_for_benchmarking" ? "queued" : "running",
      progress: null,
      label: labelForKind("prompt_run"),
      startedAt: toIso(r.createdAt),
      ...attribute(uid),
      refId: r.id,
    });
  }

  for (const r of sources.reports) {
    items.push({
      id: `report_job:${r.id}`,
      kind: "report_generation",
      clientId: r.clientId,
      status: r.status === "queued" ? "queued" : "running",
      progress: r.progressPercent,
      label: labelForKind("report_generation"),
      startedAt: toIso(r.createdAt),
      ...attribute(r.startedByUserId),
      refId: r.snapshotId,
    });
  }

  // Most recent first
  items.sort((a, b) => {
    const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
    const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
    return tb - ta;
  });

  return items;
}

/**
 * Catalog summary — one entry per project that has any in-flight work.
 */
export async function getActivitySummaryForClients(
  clientIds: string[],
): Promise<ActivitySummary[]> {
  const items = await listActiveActivitiesForClients(clientIds);
  const byClient = new Map<string, ActivitySummary>();
  for (const it of items) {
    let s = byClient.get(it.clientId);
    if (!s) {
      s = { clientId: it.clientId, count: 0, kinds: [], items: [] };
      byClient.set(it.clientId, s);
    }
    s.count += 1;
    if (!s.kinds.includes(it.kind)) s.kinds.push(it.kind);
    s.items.push(it);
  }
  return Array.from(byClient.values());
}
