#!/usr/bin/env tsx
/**
 * Task #5 — Queue / health monitor.
 *
 * Polls the production monitoring endpoints exposed by `server/routes/admin.ts`:
 *
 *   - GET /health            (anonymous; reports active/queued/stale + dbOk)
 *   - GET /api/admin/queue   (admin; bearer-token bypass via MONITORING_TOKEN)
 *
 * and raises an alert when:
 *
 *   - `queue.stale > 0`                          (jobs past the heartbeat window)
 *   - `queue.queued > MONITOR_QUEUED_THRESHOLD`  (configurable backlog)
 *   - `/health` returns non-200 for >= MONITOR_UNHEALTHY_STREAK consecutive checks
 *
 * Designed to run two ways:
 *
 *   1. One-shot from cron / external uptime probe (default):
 *        tsx server/scripts/queue-monitor.ts
 *
 *   2. Long-running daemon:
 *        tsx server/scripts/queue-monitor.ts --watch
 *
 * Streak state and per-alert cooldowns are persisted to `MONITOR_STATE_FILE`
 * (default `.queue-monitor-state.json` in the project root) so the one-shot
 * mode can correctly count consecutive failures across cron invocations.
 *
 * Configuration (all env-driven):
 *
 *   MONITOR_BASE_URL              base URL to probe (default http://localhost:5000)
 *   MONITOR_QUEUED_THRESHOLD      backlog threshold (default 50)
 *   MONITOR_UNHEALTHY_STREAK      consecutive 503/error count before alerting (default 3)
 *   MONITOR_INTERVAL_MS           --watch interval in ms (default 60000)
 *   MONITOR_ALERT_COOLDOWN_MS     per-alert cooldown to avoid spam (default 900000 = 15m)
 *   MONITOR_STATE_FILE            path for persisted streak / cooldown state
 *   MONITOR_REQUEST_TIMEOUT_MS    per-request timeout (default 10000)
 *   MONITORING_TOKEN              bearer token for /api/admin/queue (also enforced server-side)
 *   ALERT_SLACK_WEBHOOK_URL       Slack incoming-webhook URL (optional)
 *   ALERT_WEBHOOK_URL             generic JSON POST webhook (optional)
 *
 * If neither webhook env is set, alerts are still emitted to stderr so the
 * surrounding job runner / log shipper can pick them up.
 */

import fs from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.MONITOR_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
const QUEUED_THRESHOLD = Number(process.env.MONITOR_QUEUED_THRESHOLD ?? 50);
const UNHEALTHY_STREAK = Number(process.env.MONITOR_UNHEALTHY_STREAK ?? 3);
const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS ?? 60_000);
const COOLDOWN_MS = Number(process.env.MONITOR_ALERT_COOLDOWN_MS ?? 15 * 60_000);
const REQUEST_TIMEOUT_MS = Number(process.env.MONITOR_REQUEST_TIMEOUT_MS ?? 10_000);
const STATE_FILE =
  process.env.MONITOR_STATE_FILE ??
  path.join(process.cwd(), ".queue-monitor-state.json");
const SLACK_WEBHOOK = process.env.ALERT_SLACK_WEBHOOK_URL ?? "";
const GENERIC_WEBHOOK = process.env.ALERT_WEBHOOK_URL ?? "";
const MONITORING_TOKEN = process.env.MONITORING_TOKEN ?? "";

type State = {
  unhealthyStreak: number;
  lastAlertAt: Record<string, number>;
};

function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      unhealthyStreak: Number(parsed.unhealthyStreak ?? 0) || 0,
      lastAlertAt:
        parsed.lastAlertAt && typeof parsed.lastAlertAt === "object"
          ? (parsed.lastAlertAt as Record<string, number>)
          : {},
    };
  } catch {
    return { unhealthyStreak: 0, lastAlertAt: {} };
  }
}

function saveState(state: State): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[monitor] failed to persist state:", err);
  }
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: unknown; error?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err };
  } finally {
    clearTimeout(timer);
  }
}

async function sendAlert(
  state: State,
  key: string,
  title: string,
  details: Record<string, unknown>,
): Promise<void> {
  const last = state.lastAlertAt[key] ?? 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) {
    console.log(
      `[monitor] suppressed alert "${key}" (last sent ${(now - last) / 1000}s ago, cooldown ${COOLDOWN_MS / 1000}s)`,
    );
    return;
  }
  state.lastAlertAt[key] = now;
  saveState(state);

  console.error(`[monitor] ALERT [${key}] ${title}`, details);

  const slackText =
    `:rotating_light: *Polaris queue alert* — ${title}\n` +
    "```" +
    JSON.stringify(details, null, 2) +
    "```";
  const webhookPayload = {
    key,
    title,
    details,
    baseUrl: BASE_URL,
    timestamp: new Date(now).toISOString(),
  };

  const tasks: Promise<unknown>[] = [];
  if (SLACK_WEBHOOK) {
    tasks.push(
      fetch(SLACK_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: slackText }),
      }).catch((err) => console.error("[monitor] slack webhook failed:", err)),
    );
  }
  if (GENERIC_WEBHOOK) {
    tasks.push(
      fetch(GENERIC_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(webhookPayload),
      }).catch((err) => console.error("[monitor] generic webhook failed:", err)),
    );
  }
  await Promise.all(tasks);
}

type HealthBody = {
  status?: string;
  dbOk?: boolean;
  shuttingDown?: boolean;
  queue?: { active?: number; queued?: number; stale?: number };
};

async function checkOnce(): Promise<void> {
  const state = loadState();

  const health = await fetchJson(`${BASE_URL}/health`);
  const healthBody = (health.body ?? {}) as HealthBody;

  if (!health.ok) {
    state.unhealthyStreak += 1;
    saveState(state);
    console.warn(
      `[monitor] /health unhealthy (status=${health.status}, streak=${state.unhealthyStreak})`,
    );
    if (state.unhealthyStreak >= UNHEALTHY_STREAK) {
      await sendAlert(
        state,
        "health-down",
        `/health unhealthy for ${state.unhealthyStreak} consecutive checks`,
        {
          url: `${BASE_URL}/health`,
          status: health.status,
          body: healthBody,
          error: health.error ? String(health.error) : undefined,
        },
      );
    }
  } else {
    if (state.unhealthyStreak > 0) {
      console.log(
        `[monitor] /health recovered after ${state.unhealthyStreak} failure(s)`,
      );
      state.unhealthyStreak = 0;
      saveState(state);
    } else {
      console.log(
        `[monitor] /health ok (queue=${JSON.stringify(healthBody.queue ?? {})})`,
      );
    }
  }

  const queue = healthBody.queue ?? {};
  const stale = typeof queue.stale === "number" ? queue.stale : 0;
  const queued = typeof queue.queued === "number" ? queue.queued : 0;
  const active = typeof queue.active === "number" ? queue.active : 0;

  if (stale > 0) {
    await sendAlert(state, "queue-stale", `${stale} stale job(s) detected`, {
      active,
      queued,
      stale,
    });
  }
  if (queued > QUEUED_THRESHOLD) {
    await sendAlert(
      state,
      "queue-backlog",
      `Queue backlog ${queued} exceeds threshold ${QUEUED_THRESHOLD}`,
      { active, queued, stale, threshold: QUEUED_THRESHOLD },
    );
  }

  // Optional: confirm the admin endpoint is reachable and surface the
  // runtime config so an alert can include heartbeat / stale-threshold
  // context. Only attempted when MONITORING_TOKEN is configured.
  if (MONITORING_TOKEN) {
    const cfg = await fetchJson(`${BASE_URL}/api/admin/queue`, {
      headers: { authorization: `Bearer ${MONITORING_TOKEN}` },
    });
    if (!cfg.ok) {
      console.warn(
        `[monitor] /api/admin/queue unreachable (status=${cfg.status})`,
      );
    } else {
      console.log(`[monitor] queue config:`, cfg.body);
    }
  }
}

async function main(): Promise<void> {
  const watch = process.argv.includes("--watch");
  console.log(
    `[monitor] base=${BASE_URL} queued_threshold=${QUEUED_THRESHOLD} ` +
      `unhealthy_streak=${UNHEALTHY_STREAK} state=${STATE_FILE} ` +
      `slack=${SLACK_WEBHOOK ? "yes" : "no"} webhook=${GENERIC_WEBHOOK ? "yes" : "no"}`,
  );
  await checkOnce();
  if (!watch) return;
  console.log(`[monitor] watching every ${INTERVAL_MS}ms`);
  setInterval(() => {
    checkOnce().catch((err) => console.error("[monitor] check failed:", err));
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[monitor] fatal:", err);
  process.exit(1);
});
