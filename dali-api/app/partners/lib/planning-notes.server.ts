import type { prisma } from "~/lib/db.server";
import { personName } from "~/lib/core-members.server";

type Db = typeof prisma;

export const PLANNING_NOTE_MAX = 5000;

export type PlanningNoteOwner = { projectId: string } | { applicationId: string };

export type PlanningNoteView = { body: string; updatedAt: string; updatedByName: string | null };

export const PLANNING_NOTE_SELECT = {
  select: {
    body: true,
    updatedAt: true,
    updatedBy: { select: { firstName: true, lastName: true, daliEmail: true } },
  },
} as const;

export function toPlanningNoteView(
  row: {
    body: string;
    updatedAt: Date;
    updatedBy: Parameters<typeof personName>[0] | null;
  } | null,
): PlanningNoteView | null {
  if (!row) return null;
  return {
    body: row.body,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedBy ? personName(row.updatedBy) : null,
  };
}

export async function setPlanningNote(
  db: Db,
  input: { owner: PlanningNoteOwner; body: string; userId: string },
): Promise<"ok" | "not-found"> {
  const body = input.body.trim();
  const exists =
    "projectId" in input.owner
      ? await db.project.findUnique({ where: { id: input.owner.projectId }, select: { id: true } })
      : await db.partnerApplication.findUnique({ where: { id: input.owner.applicationId }, select: { id: true } });
  if (!exists) return "not-found";
  if (!body) {
    await db.planningNote.deleteMany({ where: input.owner });
    return "ok";
  }
  await db.planningNote.upsert({
    where: input.owner,
    create: { ...input.owner, body, updatedById: input.userId },
    update: { body, updatedById: input.userId },
  });
  return "ok";
}

export async function movePlanningNoteToProject(
  db: Pick<Db, "planningNote">,
  input: { applicationId: string; projectId: string },
): Promise<void> {
  await db.planningNote.updateMany({
    where: { applicationId: input.applicationId },
    data: { applicationId: null, projectId: input.projectId },
  });
}
