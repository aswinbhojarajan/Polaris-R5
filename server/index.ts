import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes, jobQueue, isCsrfExemptApiV1 } from "./routes";
import { csrfTokenIssuer, csrfProtect } from "./middleware/csrf";
import { requestId } from "./middleware/request-id";
import { errorHandler } from "./middleware/error-handler";
import { processHealth } from "./utils/process-health";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seed";
import { reapStalePromptRunsAtBoot, startStalePromptRunSweep } from "./services/prompt-run-reaper";
import { startAlertSinkProcessHealthMonitor } from "./services/alert-sink";
import { ensureVendorPauseLoaded } from "./config/vendor-pause";
import { runPdfSelfTest } from "./services/pdf-self-test";
import { pool } from "./db";
import type { Server } from "http";
import { setupAuth } from "./auth";

const app = express();

// Drop the default `X-Powered-By: Express` header — Task #37 baseline
// hardening. No code path depends on it.
app.disable("x-powered-by");

// Helmet baseline security headers (Task #37). The CSP is intentionally
// permissive in development so Vite HMR (inline scripts + websockets),
// the Replit dev banner / cartographer / runtime-error overlay, and the
// Swagger UI CDN on `/api/docs` all keep working. Production tightens
// `script-src` and turns on the rest of the defaults.
const isProd = process.env.NODE_ENV === "production";
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProd
          ? [
              "'self'",
              "https://cdn.jsdelivr.net", // Swagger UI bundle on /api/docs
            ]
          : [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'",
              "https://cdn.jsdelivr.net",
              "https://replit.com",
              "https://*.replit.com",
              "https://*.replit.dev",
            ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
        ],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: isProd
          ? ["'self'"]
          : [
              "'self'",
              "ws:",
              "wss:",
              "https://replit.com",
              "https://*.replit.com",
              "https://*.replit.dev",
            ],
        fontSrc: [
          "'self'",
          "data:",
          "https://cdn.jsdelivr.net",
          "https://fonts.gstatic.com",
        ],
        frameAncestors: isProd ? ["'self'"] : ["'self'", "https://replit.com", "https://*.replit.com"],
        objectSrc: ["'none'"],
      },
    },
    // Disable HSTS unless explicitly enabled — Task #37 keeps it off until
    // the operator opts in (preload requires careful rollout).
    hsts: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Task #113 — Stamp every request with a stable id (honoring an inbound
// X-Request-Id when safe), echo it back as a response header, and attach
// req.log so handlers can log correlated lines. Mounted before the
// request logger below so the access line includes the id.
app.use(requestId());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Task #113 — Include the request id so an `[error]` log line and
      // its originating access line are grep-correlatable.
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms [req ${req.id}]`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Seed database with default data (organisation, models, default admin user, etc.)
  await seedDatabase();

  // Task #59 — One-shot sweep of prompt_runs stuck in a non-terminal
  // status from a previous (crashed / restarted) process. Without this,
  // those rows surface as fake "in progress" pills on the multi-user
  // activity banner forever. Runs before routes/executor polling so the
  // queue starts from a clean slate. No-ops under test / memory store.
  await reapStalePromptRunsAtBoot();

  // Task #115 — Periodic in-process sweep so a worker crash that doesn't
  // restart the workflow can't leave prompt_runs stuck for hours. Boot
  // reaper above already cleaned restart leftovers; this catches the
  // mid-life case using the new `heartbeat_at` column.
  startStalePromptRunSweep();

  // Task #115 — Alert sink: watch the in-process counters for unhandled
  // rejection bursts and dispatch alerts to the configured channels.
  startAlertSinkProcessHealthMonitor();

  // Task #78 — Preload the vendor-pause cache once at boot so the
  // synchronous `assertVendorNotPaused` guards used by the internal
  // LLM SDK factories cannot fall through during the first request
  // window after a process restart. Subsequent invalidations / TTL
  // refreshes are handled by `vendor-pause.ts` itself.
  await ensureVendorPauseLoaded();

  // Task #104 — Boot-time Chromium self-test for executive-report PDF
  // rendering. Fire-and-forget: never blocks startup, logs `[PDF
  // Self-Test] OK` or `FAILED` so a misconfigured Playwright binary is
  // caught at boot instead of when a user clicks Generate Report.
  void runPdfSelfTest();

  // CSRF double-submit (Task #37) MUST be mounted before setupAuth(app)
  // so that auth/session routes registered inside setupAuth — logout,
  // /auth/sessions, etc. — sit behind csrfProtect. Express runs
  // middleware in registration order; mounting csrf after setupAuth
  // would silently leave those state-changing routes unprotected.
  // The token issuer runs globally so the SPA receives a polaris.csrf
  // cookie on its first GET; csrfProtect runs only on /api/v1 and only
  // on state-changing methods.
  app.use(csrfTokenIssuer());
  app.use("/api/v1", (req, res, next) => {
    if (isCsrfExemptApiV1(req.path)) return next();
    return csrfProtect()(req, res, next);
  });

  // Wire session middleware + Passport BEFORE routes so req.user is available
  setupAuth(app);

  const server = await registerRoutes(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Task #113 — Global error middleware. Single source of truth for the
  // `/api/v1` error wire format `{error:{code,message,requestId,details?}}`.
  // Replaces the previous handler that re-threw after responding (leaving
  // the connection state ambiguous and bypassing downstream log lines).
  // MUST be mounted LAST (after registerRoutes AND after vite/static) so
  // it sees errors thrown anywhere in the request lifecycle.
  app.use(errorHandler());

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });

  registerShutdownHandlers(server);

  // Task #105 (R3) — Daily sweep of stale on-disk PDFs in
  // generated_reports/. PDFs older than 30 days are deleted; the report
  // file rows in `report_files` retain their fileUrl but the download
  // endpoint already 404s for missing files. Runs every 24h, fires once
  // shortly after boot to clean up anything carried over from a previous
  // process. Skipped under tests / NODE_ENV=test.
  if (process.env.NODE_ENV !== 'test') {
    const { cleanupOldPDFs } = await import('./services/pdf-renderer');
    const path = await import('path');
    const pdfDir = path.join(process.cwd(), 'generated_reports');
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    const sweep = () =>
      cleanupOldPDFs(pdfDir, maxAgeMs).catch((err) => {
        log(`PDF cleanup sweep error: ${err instanceof Error ? err.message : String(err)}`);
      });
    // Run once 60s after boot, then every 24h.
    setTimeout(sweep, 60_000).unref();
    setInterval(sweep, 24 * 60 * 60 * 1000).unref();
  }
})();

/**
 * Wire SIGTERM/SIGINT to a graceful shutdown:
 *  1. Stop accepting new HTTP connections.
 *  2. Tell the JobQueue to stop picking up new work.
 *  3. Wait up to SHUTDOWN_GRACE_MS (default 25s) for in-flight jobs to finish.
 *  4. Close the HTTP server and DB pool, then exit.
 *
 * If shutdown takes longer than SHUTDOWN_FORCE_MS (default 35s) we hard-exit
 * so the platform's SIGKILL doesn't catch us mid-DB-write.
 */
function registerShutdownHandlers(server: Server): void {
  const graceMs = parseInt(process.env.SHUTDOWN_GRACE_MS || '25000', 10);
  const forceMs = parseInt(process.env.SHUTDOWN_FORCE_MS || '35000', 10);
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      log(`Received ${signal} again - shutdown already in progress`);
      return;
    }
    shuttingDown = true;
    log(`Received ${signal}, starting graceful shutdown (grace=${graceMs}ms, force=${forceMs}ms)`);

    // Hard timeout so we always exit even if something hangs.
    const forceTimer = setTimeout(() => {
      log('Force exit timeout reached - exiting process');
      process.exit(1);
    }, forceMs);
    forceTimer.unref();

    try {
      // 1. Stop the queue from picking up new jobs *immediately* on signal,
      //    so any in-flight HTTP request that finishes during step 2 cannot
      //    enqueue more work and the polling loop is paused right away.
      jobQueue.stopAcceptingJobs();

      // 2. Stop accepting new HTTP connections (existing ones complete normally).
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) log(`HTTP server close error: ${err.message}`);
          else log('HTTP server stopped accepting new connections');
          resolve();
        });
      });

      // 3. Wait for in-flight jobs to drain.
      const drained = await jobQueue.drain(graceMs);
      if (!drained) {
        log('Some jobs did not drain in time - they will be picked up as stale on next boot');
      }

      // 4a. Task #105 (R3) — Close the shared Chromium pool used by
      //     the PDF renderer. Done before the DB pool so any in-flight
      //     PDF render that finished after step 3 still has DB access.
      try {
        const { closeSharedBrowser } = await import('./services/pdf-renderer');
        await closeSharedBrowser();
        log('Shared PDF browser closed');
      } catch (err) {
        log(`PDF browser close error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 4b. Close the DB pool.
      try {
        await pool.end();
        log('Database pool closed');
      } catch (err) {
        log(`Database pool close error: ${err instanceof Error ? err.message : String(err)}`);
      }

      log('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      log(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

// Task #113 — Process-level sinks. Default Node behavior on an unhandled
// rejection / uncaught exception is "print to stderr and (eventually)
// crash the process". For a long-lived multi-tenant server that's worse
// than logging and continuing — one buggy handler shouldn't take every
// other in-flight request down with it. We log structured lines so on-call
// can search for them, but we DO NOT call process.exit(). The snapshot
// counter lives in ./utils/process-health to avoid a circular import
// from server/routes/admin.ts back into this file.
process.on('unhandledRejection', (reason: unknown) => {
  processHealth.unhandledRejectionCount++;
  processHealth.lastUnhandledRejectionAt = new Date().toISOString();
  const msg = reason instanceof Error ? reason.message : String(reason);
  processHealth.lastUnhandledRejectionMessage = msg;
  // eslint-disable-next-line no-console
  console.error(`[unhandledRejection] ${msg}`);
  if (reason instanceof Error && reason.stack) {
    // eslint-disable-next-line no-console
    console.error(reason.stack);
  }
});

process.on('uncaughtException', (err: Error) => {
  processHealth.uncaughtExceptionCount++;
  processHealth.lastUncaughtExceptionAt = new Date().toISOString();
  processHealth.lastUncaughtExceptionMessage = err.message;
  // eslint-disable-next-line no-console
  console.error(`[uncaughtException] ${err.message}`);
  if (err.stack) {
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
});

