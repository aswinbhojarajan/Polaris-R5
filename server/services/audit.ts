import type { Request } from "express";
import { db } from "../db";
import { auditLog, type User } from "@shared/schema";

/**
 * Append-only audit log for admin-module mutations. Designed to never throw —
 * a failed audit insert must not block the caller's response.
 */
export async function recordAudit(opts: {
  req?: Request;
  orgId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const actorUserId =
      opts.actorUserId ||
      (opts.req?.user ? (opts.req.user as User).id : undefined);
    await db.insert(auditLog).values({
      orgId: opts.orgId ?? null,
      actorUserId: actorUserId ?? null,
      action: opts.action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      metadata: (opts.metadata ?? {}) as any,
    });
  } catch (err) {
    console.error("[audit] failed to record audit entry", err);
  }
}
