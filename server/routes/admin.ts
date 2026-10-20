import type { Express } from "express";
import { pingDatabase } from "../db";
import { jobQueue } from "./_shared";
import { processHealth } from "../utils/process-health";
import { alertHealthDbDown } from "../services/alert-sink";

/**
 * Production monitoring endpoints. Restored after the per-domain route split
 * (Task #3) accidentally dropped them from the monolithic `server/routes.ts`.
 *
 *   GET /health         - Readiness probe (Task #113 extended). Returns 503
 *                         when the DB ping fails or the server is shutting
 *                         down so the load balancer can drain us. Body now
 *                         includes queue counters, memory + uptime, and a
 *                         snapshot of the last unhandled rejection /
 *                         uncaught exception (count + timestamp + message).
 *   GET /health/live    - Pure liveness probe (Task #113). Always 200 as
 *                         long as the event loop can reply, regardless of
 *                         DB / queue state. Use this for the platform's
 *                         "is the container alive?" check; use /health for
 *                         "should the LB route traffic here?".
 *   GET /api/admin/queue - JobQueue tunables (heartbeat / stale threshold
 *                         / max resume attempts / concurrency / default
 *                         timeout). Used by ops to confirm runtime config.
 */
export function registerAdminRoutes(app: Express) {
  app.get("/health/live", (_req, res) => {
    // Liveness only — if this responds at all, the process is alive.
    res.status(200).json({
      status: "alive",
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health", async (_req, res) => {
    // Task #113 readiness contract:
    //   db:    "ok" | "down"           (pingDatabase boolean)
    //   queue: "ok" | "degraded"       ("degraded" when shutting down or
    //                                   any stale jobs sitting in queue)
    //   status: "ok" | "degraded" | "down"
    //     - "down"      → db is down OR server is shutting down (LB drain)
    //     - "degraded"  → DB up but queue is unhealthy
    //     - "ok"        → everything green
    // We respond 200 for ok/degraded and 503 for down so the load balancer
    // drains us only on hard failure; degraded queue still serves reads.
    const stats = await jobQueue.getHealthStats();
    const dbOk = await pingDatabase();
    // Task #115 — alert on readiness DB failure (debounced 5 min).
    if (!dbOk) {
      void alertHealthDbDown({ error: "pingDatabase() returned false" });
    }
    const mem = process.memoryUsage();
    const toMb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
    // Task #113 readiness payload — `queue` is an object carrying live
    // counters AND a derived status, so probes/operators get both shapes
    // in one field; `db` includes a `degraded` state (reserved for
    // future read-only-replica failover scenarios — today it only
    // collapses to ok|down depending on pingDatabase).
    const db: "ok" | "degraded" | "down" = dbOk ? "ok" : "down";
    const queueStatus: "ok" | "degraded" =
      stats.shuttingDown || stats.stale > 0 ? "degraded" : "ok";
    const status: "ok" | "degraded" | "down" =
      !dbOk || stats.shuttingDown
        ? "down"
        : queueStatus === "degraded"
          ? "degraded"
          : "ok";
    res.status(status === "down" ? 503 : 200).json({
      status,
      db,
      queue: {
        status: queueStatus,
        active: stats.active,
        queued: stats.queued,
        stale: stats.stale,
      },
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      shuttingDown: stats.shuttingDown,
      memoryMb: {
        rss: toMb(mem.rss),
        heapUsed: toMb(mem.heapUsed),
        heapTotal: toMb(mem.heapTotal),
        external: toMb(mem.external),
      },
      process: {
        unhandledRejectionCount: processHealth.unhandledRejectionCount,
        lastUnhandledRejectionAt: processHealth.lastUnhandledRejectionAt,
        lastUnhandledRejectionMessage:
          processHealth.lastUnhandledRejectionMessage,
        uncaughtExceptionCount: processHealth.uncaughtExceptionCount,
        lastUncaughtExceptionAt: processHealth.lastUncaughtExceptionAt,
        lastUncaughtExceptionMessage:
          processHealth.lastUncaughtExceptionMessage,
      },
      config: stats.config,
    });
  });

  app.get("/api/admin/queue", async (_req, res) => {
    // Return both live counters (active / queued / stale) and the tunable
    // config so the admin queue page can render everything in one poll.
    // Config fields stay at the top level for backward compatibility with
    // the routes-integration test (Task #15).
    const stats = await jobQueue.getHealthStats();
    const { countActiveUserSessions } = await import("../services/sessions");
    const activeUserSessions = await countActiveUserSessions();
    res.json({
      active: stats.active,
      queued: stats.queued,
      stale: stats.stale,
      shuttingDown: stats.shuttingDown,
      ...stats.config,
      activeUserSessions,
    });
  });
}
