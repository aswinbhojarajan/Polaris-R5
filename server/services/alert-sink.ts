/**
 * Task #115 — Operational alert sink.
 *
 * Centralizes "something operationally important happened" notifications
 * with three channels (console always, Slack if configured, email if
 * configured) and a 5-minute identical-event debounce so a stuck loop
 * doesn't drown a Slack channel.
 *
 * Channels:
 *  - `console`: always on. Structured `[Alert]` log line.
 *  - `slack`: enabled when `ALERT_SLACK_WEBHOOK_URL` (canonical) or its
 *    legacy alias `SLACK_ALERT_WEBHOOK_URL` is set. Posts a
 *     simple text payload (no Block Kit, keeps the surface tiny).
 *  - `email`: enabled when BOTH `ALERT_EMAIL_TO` (comma-separated
 *     recipients) and `ALERT_EMAIL_SMTP_URL` (`smtp://user:pass@host:port`
 *     or `smtps://…`) are set. `ALERT_EMAIL_FROM` is optional (defaults
 *     to `alerts@polaris.local`). Backed by `nodemailer`. Transport is
 *     created lazily on first use and cached for the process lifetime.
 *
 * Triggers wired by the rest of the system:
 *  - JobQueue failure after attempts >= max (see job-queue.ts).
 *  - Vendor pause toggled by an admin (see routes/ai-models.ts).
 *  - Unhandled rejection burst > N within 5 min (this file, polling
 *    `processHealth` from utils/process-health.ts).
 *  - DB readiness ping fails on /health (see routes/health.ts).
 *
 * Every alert carries a stable `dedupKey` that the debouncer uses to
 * collapse repeats. The debouncer is a plain `Map<string, number>` —
 * good enough for one process; sized small (cleaned opportunistically).
 */
import { processHealth } from "../utils/process-health";

export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface Alert {
  /** Short kebab-case slug for dedup + log filtering, e.g. "job-failure". */
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Stable across repeats of the SAME logical event, e.g. include the job id. */
  dedupKey: string;
  context?: Record<string, unknown>;
}

const DEFAULT_DEBOUNCE_MS = 5 * 60 * 1000;
const RECENT_REJECTIONS_WINDOW_MS = 5 * 60 * 1000;
const REJECTION_BURST_THRESHOLD = 5;

const lastSentByKey = new Map<string, number>();

function isDebounced(dedupKey: string): boolean {
  const last = lastSentByKey.get(dedupKey);
  if (!last) return false;
  if (Date.now() - last < DEFAULT_DEBOUNCE_MS) return true;
  return false;
}

function markSent(dedupKey: string): void {
  lastSentByKey.set(dedupKey, Date.now());
  // Opportunistic cleanup so the map can't grow unbounded.
  if (lastSentByKey.size > 500) {
    const cutoff = Date.now() - DEFAULT_DEBOUNCE_MS * 4;
    for (const [k, ts] of lastSentByKey) {
      if (ts < cutoff) lastSentByKey.delete(k);
    }
  }
}

function logAlert(alert: Alert): void {
  const line = `[Alert][${alert.severity.toUpperCase()}][${alert.type}] ${alert.title}: ${alert.message}`;
  if (alert.severity === "error" || alert.severity === "critical") {
    console.error(line, alert.context ?? {});
  } else if (alert.severity === "warning") {
    console.warn(line, alert.context ?? {});
  } else {
    console.log(line, alert.context ?? {});
  }
}

async function dispatchSlack(alert: Alert): Promise<void> {
  // Accept both names — `ALERT_SLACK_WEBHOOK_URL` is the canonical one
  // documented in the runbook + used by `server/scripts/queue-monitor.ts`.
  // `SLACK_ALERT_WEBHOOK_URL` is kept as a legacy alias to avoid silent
  // misconfiguration from earlier docs / task specs.
  const webhook =
    process.env.ALERT_SLACK_WEBHOOK_URL ??
    process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!webhook) return;
  try {
    const emoji =
      alert.severity === "critical" ? ":rotating_light:" :
      alert.severity === "error" ? ":x:" :
      alert.severity === "warning" ? ":warning:" : ":information_source:";
    const text = `${emoji} *${alert.title}*\n${alert.message}\n_type=${alert.type} severity=${alert.severity}_`;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`[AlertSink] Slack webhook returned ${res.status}`);
    }
  } catch (err) {
    console.warn(
      "[AlertSink] Slack dispatch failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Cached transport keyed by the SMTP URL so we don't reopen the
// connection pool for every alert. Reset on URL change (rare; env
// edits + restart cycle).
let emailTransport: import("nodemailer").Transporter | null = null;
let emailTransportUrl: string | null = null;

async function dispatchEmail(alert: Alert): Promise<void> {
  const to = process.env.ALERT_EMAIL_TO;
  const smtp = process.env.ALERT_EMAIL_SMTP_URL;
  // Email channel is enabled when BOTH a recipient list and an SMTP
  // URL are configured. Unset = channel disabled silently (console +
  // Slack still fire). Canonical env contract is documented in
  // ISSUE_LOG.md → "Alerts & Recovery".
  if (!to || !smtp) return;
  try {
    if (!emailTransport || emailTransportUrl !== smtp) {
      const nodemailer = await import("nodemailer");
      emailTransport = nodemailer.createTransport(smtp);
      emailTransportUrl = smtp;
    }
    const from = process.env.ALERT_EMAIL_FROM ?? "alerts@polaris.local";
    const subject = `[Polaris ${alert.severity.toUpperCase()}] ${alert.title}`;
    const body = `${alert.message}\n\ntype: ${alert.type}\nseverity: ${alert.severity}\ncontext: ${JSON.stringify(alert.context ?? {}, null, 2)}`;
    await emailTransport.sendMail({ from, to, subject, text: body });
  } catch (err) {
    console.warn(
      "[AlertSink] Email dispatch failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Emit an operational alert. Always logs to console; routes to Slack /
 * email when those channels are configured; debounces identical
 * `dedupKey`s within a 5-minute window. Never throws — alerting must
 * not be able to take a request handler down.
 */
export async function emitAlert(alert: Alert): Promise<void> {
  try {
    if (isDebounced(alert.dedupKey)) {
      return;
    }
    markSent(alert.dedupKey);
    logAlert(alert);
    // Skip remote dispatch in tests so unit-test suites don't fan out to a
    // real Slack workspace if env vars happen to be set in CI.
    if (process.env.NODE_ENV === "test") return;
    await Promise.all([dispatchSlack(alert), dispatchEmail(alert)]);
  } catch (err) {
    console.error(
      "[AlertSink] emitAlert failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Sweep the in-process `unhandledRejection` counter and fire one
 * `process-rejection-burst` alert when the rate exceeds the threshold
 * within a 5-minute window. Compares against a snapshot we keep here
 * so a single jump is detected once, not on every tick.
 */
let lastRejectionSnapshot = 0;
let lastRejectionSnapshotAt = Date.now();

function checkRejectionBurst(): void {
  const now = Date.now();
  const current = processHealth.unhandledRejectionCount;
  const delta = current - lastRejectionSnapshot;
  const windowMs = now - lastRejectionSnapshotAt;
  if (windowMs >= RECENT_REJECTIONS_WINDOW_MS) {
    // Roll the window forward without alerting; we only alert on the
    // first detection inside an active window.
    lastRejectionSnapshot = current;
    lastRejectionSnapshotAt = now;
    return;
  }
  if (delta >= REJECTION_BURST_THRESHOLD) {
    void emitAlert({
      type: "process-rejection-burst",
      severity: "error",
      title: "Unhandled rejection burst",
      message: `${delta} unhandled promise rejections in the last ${Math.round(windowMs / 1000)}s. Latest: ${processHealth.lastUnhandledRejectionMessage ?? "(no message)"}`,
      dedupKey: `process-rejection-burst:${Math.floor(now / DEFAULT_DEBOUNCE_MS)}`,
      context: {
        delta,
        total: current,
        lastAt: processHealth.lastUnhandledRejectionAt,
      },
    });
    // Roll the window so we don't re-alert until the next 5-min slot.
    lastRejectionSnapshot = current;
    lastRejectionSnapshotAt = now;
  }
}

/**
 * Start the in-process health monitor that polls `processHealth` and
 * fires a `process-rejection-burst` alert when the counter spikes.
 * Skipped under `NODE_ENV=test` / `SESSION_STORE=memory`. Returns the
 * interval handle so tests can clear it; `.unref()`'d so it never
 * blocks shutdown.
 */
export function startAlertSinkProcessHealthMonitor(): NodeJS.Timeout | null {
  if (process.env.NODE_ENV === "test" || process.env.SESSION_STORE === "memory") {
    return null;
  }
  // Initialize the snapshot from current state so the first tick after
  // boot doesn't fire on legacy counters carried into the snapshot.
  lastRejectionSnapshot = processHealth.unhandledRejectionCount;
  lastRejectionSnapshotAt = Date.now();
  const handle = setInterval(checkRejectionBurst, 30_000);
  handle.unref();
  return handle;
}

// Convenience helpers exported for the wiring sites. Keeping the dedup
// key construction in one place means a re-fire of the same vendor
// pause within 5 min collapses to a single Slack message.
export function alertJobFailure(opts: {
  jobId: string;
  jobType: string;
  attempts: number;
  error: string;
}): Promise<void> {
  return emitAlert({
    type: "job-failure",
    severity: "error",
    title: `Job ${opts.jobType} failed after ${opts.attempts} attempt(s)`,
    message: opts.error,
    dedupKey: `job-failure:${opts.jobId}`,
    context: opts,
  });
}

export function alertVendorPause(opts: {
  vendor: string;
  paused: boolean;
  actor?: string | null;
  reason?: string | null;
}): Promise<void> {
  return emitAlert({
    type: opts.paused ? "vendor-paused" : "vendor-resumed",
    severity: opts.paused ? "warning" : "info",
    title: `Vendor ${opts.vendor} ${opts.paused ? "paused" : "resumed"}`,
    message: opts.reason
      ? `By ${opts.actor ?? "admin"}: ${opts.reason}`
      : `By ${opts.actor ?? "admin"}`,
    dedupKey: `vendor-pause:${opts.vendor.toLowerCase()}:${opts.paused ? 1 : 0}`,
    context: opts,
  });
}

export function alertHealthDbDown(opts: { error: string }): Promise<void> {
  return emitAlert({
    type: "health-db-down",
    severity: "critical",
    title: "Readiness probe DB ping failed",
    message: opts.error,
    dedupKey: "health-db-down",
    context: opts,
  });
}
