import { getClientIp } from "~/lib/rate-limit";
import type { Prisma } from "~/generated/prisma/client";
import type { AuditAction } from "./audit-actions";

// Re-exported so server callers keep one import for actions + logging.
export { AUDIT_ACTIONS, type AuditAction } from "./audit-actions";

export type AuditEvent = {
  action: AuditAction;
  userId?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  request?: Request;
  ip?: string | null;
  userAgent?: string | null;
};

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const ip =
      event.ip ?? (event.request ? getClientIp(event.request) : null);
    const userAgent =
      event.userAgent ??
      (event.request ? event.request.headers.get("User-Agent") : null);

    // Lazy-imported so tests that only mock ~/lib/auth (or other transitive
    // importers of this module) don't have to also mock the prisma client.
    const { prisma } = await import("~/lib/db");

    await prisma.auditLog.create({
      data: {
        action: event.action,
        userId: event.userId ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("audit log write failed", {
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
