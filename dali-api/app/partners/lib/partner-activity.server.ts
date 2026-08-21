import type { Prisma } from "~/generated/prisma/client";
import type {
  PartnerActivityType,
  PartnerApplicationStatus,
} from "~/generated/prisma/enums";

/**
 * A Prisma client or an interactive-transaction client — both expose the model
 * delegates this module needs, so callers can log inside or outside a
 * `$transaction`.
 */
export type ActivityDb = Prisma.TransactionClient;

type LogInput = {
  applicationId: string;
  actorUserId?: string | null;
  type: PartnerActivityType;
  body?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/** Append one row to a partner opportunity's activity timeline. */
export async function logPartnerActivity(
  db: ActivityDb,
  input: LogInput,
): Promise<void> {
  await db.partnerActivity.create({
    data: {
      applicationId: input.applicationId,
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      body: input.body ?? null,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });
}

/**
 * Update an application's status (plus any extra fields) and log a
 * `StatusChanged` activity iff the status actually moved. The single chokepoint
 * for status writes so no stage transition goes unrecorded — used by the status
 * dropdown, every triage/decision intent, the promote flow, and the kanban-drag
 * API route. Returns the previous status (null when the application is gone).
 */
export async function setApplicationStatus(
  db: ActivityDb,
  input: {
    applicationId: string;
    to: PartnerApplicationStatus;
    actorUserId?: string | null;
    /**
     * Extra fields to write in the same update (e.g. decisionReason, or the
     * scalar FKs resultingProjectId/partnerOrgId set at promotion). Unchecked
     * input so scalar foreign keys can be assigned directly.
     */
    data?: Prisma.PartnerApplicationUncheckedUpdateInput;
    /** Extra keys merged into the StatusChanged metadata (e.g. projectId). */
    meta?: Record<string, string | number | null>;
  },
): Promise<PartnerApplicationStatus | null> {
  const existing = await db.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: { status: true },
  });
  if (!existing) return null;

  await db.partnerApplication.update({
    where: { id: input.applicationId },
    data: { status: input.to, ...(input.data ?? {}) },
  });

  if (existing.status !== input.to) {
    await logPartnerActivity(db, {
      applicationId: input.applicationId,
      actorUserId: input.actorUserId,
      type: "StatusChanged",
      metadata: { from: existing.status, to: input.to, ...(input.meta ?? {}) },
    });
  }
  return existing.status;
}
