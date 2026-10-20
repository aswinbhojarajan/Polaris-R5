import type { Request } from "express";
import type { UserSession } from "@shared/schema";
import { storage } from "../storage";

/**
 * User-session ledger (Task #37). Thin wrappers around IStorage so
 * legacy callers (server/auth.ts, routes/index.ts queue config) keep
 * working without each one having to know about the Request -> UA/IP
 * extraction. All persistence lives behind storage so the architectural
 * contract from the task plan is honored (closes M16).
 *
 * The session-epoch kill switch in `users` remains the source of truth
 * for revocation — pruning a row here only hides it from the UI;
 * bumping the epoch invalidates every session on the next request.
 */

function uaFromReq(req?: Request): string | null {
  const raw = req?.headers["user-agent"];
  return typeof raw === "string" ? raw : null;
}

function ipFromReq(req?: Request): string | null {
  return req?.ip ?? req?.socket?.remoteAddress ?? null;
}

export async function recordUserSession(opts: {
  sessionId: string;
  userId: string;
  req?: Request;
}): Promise<void> {
  await storage.recordUserSession({
    sessionId: opts.sessionId,
    userId: opts.userId,
    userAgent: uaFromReq(opts.req),
    ipAddress: ipFromReq(opts.req),
  });
}

export async function touchUserSession(sessionId: string): Promise<void> {
  await storage.touchUserSession(sessionId);
}

export async function deleteUserSession(sessionId: string): Promise<void> {
  await storage.deleteUserSession(sessionId);
}

export async function deleteUserSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  await storage.deleteUserSessionsForUser(userId, exceptSessionId);
}

export async function listUserSessionsForUser(userId: string): Promise<UserSession[]> {
  return storage.listUserSessionsForUser(userId);
}

export async function getUserSession(sessionId: string): Promise<UserSession | undefined> {
  return storage.getUserSession(sessionId);
}

export async function countActiveUserSessions(): Promise<number> {
  return storage.countActiveUserSessions();
}

export async function pruneOrphanUserSessions(): Promise<number> {
  return storage.pruneOrphanUserSessions();
}
