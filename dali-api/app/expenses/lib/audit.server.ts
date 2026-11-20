import { logAuditEvent, type AuditAction } from "~/lib/audit";
import type { Prisma } from "~/generated/prisma/client";
import type { ExpenseViewer } from "./access";

export function auditExpense(actor: ExpenseViewer, action: AuditAction, targetId: string, metadata?: Prisma.InputJsonValue) {
  return logAuditEvent({ action, userId: actor.userId, targetId, metadata });
}
