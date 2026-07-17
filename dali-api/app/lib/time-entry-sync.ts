import { prisma } from "~/lib/db";
import { resolveRoleRef } from "~/lib/roles";
import type { AssignmentType } from "~/generated/prisma/client";

export type SyncManualBlockTimeEntryResult = { ok: true } | { ok: false; error: string };

// Keeps a ManualBlock's linked Block-sourced TimeEntry in sync with the
// block's isWork/role/title/time fields. Called from the add/update/remove
// manual-block action handlers in app/calendar/routes/calendar.tsx — mirrors
// the upsert/delete pattern the attendance-toggle route uses for
// Meeting-sourced entries (api.scheduled-meetings.$id.attendance.ts), but for
// a calendar block instead of a scheduled meeting.
export async function syncManualBlockTimeEntry(params: {
  manualBlockId: string;
  userId: string;
  isWork: boolean;
  assignmentType: AssignmentType | null;
  roleRefId: string | null;
  title: string;
  startTime: Date;
  endTime: Date;
}): Promise<SyncManualBlockTimeEntryResult> {
  const { manualBlockId, userId, isWork, assignmentType, roleRefId, title, startTime, endTime } =
    params;

  if (!isWork || !assignmentType || !roleRefId) {
    await prisma.timeEntry.deleteMany({ where: { manualBlockId, userId } });
    return { ok: true };
  }

  const resolved = await resolveRoleRef(userId, assignmentType, roleRefId);
  if (!resolved) {
    return { ok: false, error: "roleRefId does not belong to this user" };
  }

  const hours = (endTime.getTime() - startTime.getTime()) / 3_600_000;

  await prisma.timeEntry.upsert({
    where: { manualBlockId_userId: { manualBlockId, userId } },
    create: {
      userId,
      source: "Block",
      manualBlockId,
      assignmentType,
      roleRefId,
      projectId: resolved.projectId,
      date: startTime,
      hours,
      note: title,
      startTime,
      endTime,
    },
    update: {
      assignmentType,
      roleRefId,
      projectId: resolved.projectId,
      date: startTime,
      hours,
      note: title,
      startTime,
      endTime,
    },
  });

  return { ok: true };
}
