/**
 * Task #113 — Request-ID middleware + correlated logger.
 *
 * Attaches a stable id to every request as `req.id`, echoes it back on the
 * `X-Request-Id` response header, and provides a `req.log(level, msg, meta?)`
 * helper so handlers can emit log lines that include the id without having
 * to plumb it through every call.
 *
 * If the incoming request already carries `X-Request-Id` (e.g. set by an
 * upstream load balancer / tracing agent) we honor it after a length cap
 * + char allowlist so a hostile client can't poison logs with newlines.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { randomUUID } from "crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: (
        level: "debug" | "info" | "warn" | "error",
        msg: string,
        meta?: Record<string, unknown>,
      ) => void;
    }
  }
}

const SAFE_ID = /^[A-Za-z0-9_\-:.]{8,128}$/;

function pickInboundId(req: Request): string | null {
  const raw = req.headers["x-request-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!SAFE_ID.test(trimmed)) return null;
  return trimmed;
}

export function requestId(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = pickInboundId(req) ?? randomUUID();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    req.log = (level, msg, meta) => {
      const line = meta
        ? `[req ${id}] ${msg} ${JSON.stringify(meta)}`
        : `[req ${id}] ${msg}`;
      // eslint-disable-next-line no-console
      console[level === "debug" ? "log" : level](line);
    };
    next();
  };
}

/**
 * Returns the request id, or "-" when no middleware-attached id is present
 * (e.g. called from a background job's lifecycle).
 */
export function getRequestId(req: Request | undefined | null): string {
  return req?.id ?? "-";
}
