import type { Prisma } from "~/generated/prisma/client";
import type { PartnerActivityType, PartnerStage } from "~/generated/prisma/enums";

/**
 * A Prisma client or an interactive-transaction client — both expose the model
 * delegates this module needs, so callers can log inside or outside a
 * `$transaction`.
 */
export type ActivityDb = Prisma.TransactionClient;

type LogInput = {
  /** Omit for org- or contact-level events (project linked, member added). */
  applicationId?: string | null;
  /**
   * Denormalized scope. When only applicationId is given these are copied
   * from the application so the org and contact timelines see the row.
   */
  orgId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  type: PartnerActivityType;
  body?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Append one row to the partner timeline and, for application-scoped rows,
 * stamp the application's lastActivityAt (board sort, stale sweep).
 */
export async function logPartnerActivity(db: ActivityDb, input: LogInput): Promise<void> {
  let orgId = input.orgId ?? null;
  let contactId = input.contactId ?? null;

  if (input.applicationId && (orgId === null || contactId === null)) {
    const app = await db.partnerApplication.findUnique({
      where: { id: input.applicationId },
      select: { partnerOrgId: true, applicantContactId: true },
    });
    if (app) {
      orgId ??= app.partnerOrgId;
      contactId ??= app.applicantContactId;
    }
  }

  await db.partnerActivity.create({
    data: {
      applicationId: input.applicationId ?? null,
      orgId,
      contactId,
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      body: input.body ?? null,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });

  if (input.applicationId) {
    await db.partnerApplication.updateMany({
      where: { id: input.applicationId },
      data: { lastActivityAt: new Date() },
    });
  }
}

/**
 * Move an application to a stage (plus any extra fields) and log a
 * `StatusChanged` activity iff the stage actually moved. The single chokepoint
 * for stage writes so no transition goes unrecorded — used by the modal's stage
 * select, every decision intent, the promote flow, and the board-drag API.
 *
 * A card entering a new column lands at the top (position below the column's
 * current minimum). The drag API renumbers densely; here a gap is fine.
 * Returns the previous stage (null when the application is gone).
 */
export async function setApplicationStage(
  db: ActivityDb,
  input: {
    applicationId: string;
    to: PartnerStage;
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
): Promise<PartnerStage | null> {
  const existing = await db.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: { stage: true },
  });
  if (!existing) return null;

  const moved = existing.stage !== input.to;
  let position: number | undefined;
  if (moved) {
    const top = await db.partnerApplication.aggregate({
      where: { stage: input.to },
      _min: { position: true },
    });
    position = (top._min.position ?? 1) - 1;
  }

  await db.partnerApplication.update({
    where: { id: input.applicationId },
    data: {
      stage: input.to,
      ...(position !== undefined ? { position } : {}),
      ...(input.data ?? {}),
    },
  });

  if (moved) {
    await logPartnerActivity(db, {
      applicationId: input.applicationId,
      actorUserId: input.actorUserId,
      type: "StatusChanged",
      metadata: { from: existing.stage, to: input.to, ...(input.meta ?? {}) },
    });
  }
  return existing.stage;
}
