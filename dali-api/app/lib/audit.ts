import { getClientIp } from "~/lib/rate-limit";
import type { Prisma } from "~/generated/prisma/client";

// Single source of truth for the set of audit actions. Kept as a runtime
// array (not just a type union) so the activity viewer can render it as a
// filter dropdown and the query builder can validate incoming filters.
export const AUDIT_ACTIONS = [
  "login.success",
  "login.failure",
  "logout",
  "auth.token.invalid",
  "role.change",
  "decision.finalize",
  "decision.release",
  "interview.invite-reminder.sent",
  "email.send",
  "email.extension_notice",
  "confidentiality.sign",
  "mcp.tool_called",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
