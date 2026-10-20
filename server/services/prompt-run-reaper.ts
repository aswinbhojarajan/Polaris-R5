/**
 * Task #59 — Stale prompt-run reaper.
 *
 * One-shot sweep run at boot (after seedDatabase, before route registration)
 * that marks any prompt_run rows stuck in a non-terminal status (queued /
 * running / scoring / queued_for_benchmarking / benchmarking) older than
 * `STALE_PROMPT_RUN_AGE_MS` (default 30 minutes) as `error`. Their
 * prompt_run_items in non-terminal status get the same treatment.
 *
 * Triggered once per process start because prompt-run executors do not
 * write a heartbeat column today (see Task #56 follow-up). Without this,
 * crashed / restarted workflows leave rows that surface as fake
 * "in progress" pills on the multi-user activity banner forever.
 *
 * Skipped under `NODE_ENV=test` and `SESSION_STORE=memory` so unit-test
 * boots don't touch any DB the storage layer happens to point at.
 */
import { storage } from "../storage";

const DEFAULT_STALE_AGE_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const REAP_REASON_BOOT = "Stale run reaped — server restart";
const REAP_REASON_SWEEP = "Stale run reaped — heartbeat lost";

function resolveAgeMs(): number {
  const parsed = parseInt(process.env.STALE_PROMPT_RUN_AGE_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_AGE_MS;
}

export async function reapStalePromptRunsAtBoot(): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.SESSION_STORE === "memory") {
    return;
  }
  const ageMs = resolveAgeMs();
  try {
    const { runs, items } = await storage.reapStalePromptRuns(ageMs, REAP_REASON_BOOT);
    if (runs > 0 || items > 0) {
      console.log(
        `[PromptRunReaper] Reaped ${runs} stale prompt_run(s) and ${items} item(s) older than ${ageMs}ms`,
      );
    } else {
      console.log(`[PromptRunReaper] No stale prompt_runs older than ${ageMs}ms`);
    }
  } catch (err) {
    console.error(
      "[PromptRunReaper] Failed to reap stale prompt_runs:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Task #115 — Periodic in-process sweep. Closes the gap left by Task #59
 * where a worker crash that didn't take the workflow down would leave
 * `prompt_runs` rows stuck in `running` until the next deploy.
 *
 * Runs every `STALE_PROMPT_RUN_SWEEP_INTERVAL_MS` (default 10 min) and
 * shares the same `IStorage.reapStalePromptRuns` impl as the boot-time
 * reaper. The reaper now prefers `heartbeat_at` over `createdAt` so a
 * long-running but healthy run that beats every 30 s is NOT reaped.
 *
 * Skipped under `NODE_ENV=test` / `SESSION_STORE=memory` to avoid
 * touching DB in unit-test boots. Returns the interval handle so callers
 * (or tests) can clear it; the handle is `.unref()`'d so it never holds
 * the event loop open during shutdown.
 */
export function startStalePromptRunSweep(): NodeJS.Timeout | null {
  if (process.env.NODE_ENV === "test" || process.env.SESSION_STORE === "memory") {
    return null;
  }
  // Accept either env var name — `STALE_PROMPT_RUN_SWEEP_MS` is the
  // shorter form referenced in the runbook; `_INTERVAL_MS` is the
  // original verbose name. Both work to avoid operator misconfiguration.
  const rawEnv =
    process.env.STALE_PROMPT_RUN_SWEEP_MS ??
    process.env.STALE_PROMPT_RUN_SWEEP_INTERVAL_MS ??
    "";
  const parsed = parseInt(rawEnv, 10);
  const intervalMs =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SWEEP_INTERVAL_MS;
  const ageMs = resolveAgeMs();

  console.log(
    `[PromptRunReaper] Periodic sweep enabled (every ${Math.round(intervalMs / 1000)}s, stale threshold ${Math.round(ageMs / 1000)}s)`,
  );

  const tick = async () => {
    try {
      const { runs, items } = await storage.reapStalePromptRuns(
        ageMs,
        REAP_REASON_SWEEP,
      );
      if (runs > 0 || items > 0) {
        console.log(
          `[PromptRunReaper] Sweep reaped ${runs} stale prompt_run(s) and ${items} item(s)`,
        );
      }
    } catch (err) {
      console.error(
        "[PromptRunReaper] Sweep tick failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  const handle = setInterval(tick, intervalMs);
  handle.unref();
  return handle;
}
