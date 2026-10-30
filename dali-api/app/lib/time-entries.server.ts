// Timesheet writes shared by the Calendar route's actions and the mobile app's
// /api/mobile/time routes, so both surfaces validate, attribute, and mirror an
// entry the same way.

import { prisma } from "~/lib/db.server";
import { resolveRoleRef } from "~/lib/roles";
import { validateTimeEntryRange } from "~/lib/calendar-schemas";
import { resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { syncTimeEntryToGoogle, removeTimeEntryFromGoogle } from "~/lib/timesheet-mirror.server";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import type { AssignmentType, TimeEntry } from "~/generated/prisma/client";

export type TimeEntryWriteResult =
  | { ok: true; entry: TimeEntry }
  | { ok: false; error: string; status: number };

/** The row fields a client needs to draw a saved time entry without a reload. */
export function timeEntryResult(row: {
  id: string;
  hours: number;
  note: string | null;
  startTime: Date | null;
  endTime: Date | null;
  date: Date;
}) {
  return {
    id: row.id,
    hours: row.hours,
    note: row.note,
    date: row.date.toISOString(),
    startTime: row.startTime?.toISOString() ?? null,
    endTime: row.endTime?.toISOString() ?? null,
  };
}

const mirrorChains = new Map<string, Promise<void>>();

type EntryLockTx = Pick<typeof prisma, "timeEntry" | "$executeRaw">;

/**
 * Runs `fn` holding a Postgres advisory lock on the entry, so the Google writes
 * for one entry are serialized across machines, not just within this process.
 * The lock lasts for the transaction, and a crash releases it with the
 * connection. Google calls make the transaction long, hence the timeout.
 */
async function withEntryMirrorLock<T>(entryId: string, fn: (tx: EntryLockTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timesheet-mirror:${entryId}`}))`;
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * Mirror a timesheet write to Google without holding the response on it. Jobs
 * for one entry run one after another (in this process by a chain, across
 * machines by an advisory lock), so a second write can't start before the
 * first has saved its Google event id (which would insert a duplicate). The
 * mirror writes to Google, so the change marker is stamped again once it lands:
 * a read that raced it on another machine would otherwise be trusted.
 */
function mirrorInBackground(userId: string, entryId: string, mirror: (tx: EntryLockTx) => Promise<void>) {
  const job = (mirrorChains.get(entryId) ?? Promise.resolve())
    .then(() => withEntryMirrorLock(entryId, mirror))
    .catch((err) => console.error("time entry mirror failed", err))
    .then(() => markCalendarChanged(userId))
    .catch((err) => console.error("time entry mirror marker failed", err));
  mirrorChains.set(entryId, job);
  void job.then(() => {
    if (mirrorChains.get(entryId) === job) mirrorChains.delete(entryId);
  });
}

/** Mirrors the entry as it is when the job holds the lock, not as it was when queued. */
const mirrorLatest = (entryId: string) => async (tx: EntryLockTx) => {
  const latest = await tx.timeEntry.findUnique({ where: { id: entryId } });
  if (latest) await syncTimeEntryToGoogle(latest);
};

export type AddTimeEntryInput = {
  date: string;
  hours: number;
  assignmentType: AssignmentType;
  roleRefId: string;
  note?: string | null;
  startTime: string;
  endTime: string;
  scheduledMeetingId?: string;
};

export async function addTimeEntry(userId: string, input: AddTimeEntryInput): Promise<TimeEntryWriteResult> {
  const rangeError = validateTimeEntryRange(input);
  if (rangeError) return { ok: false, error: rangeError, status: 400 };
  const resolved = await resolveRoleRef(userId, input.assignmentType, input.roleRefId);
  if (!resolved) return { ok: false, error: "Invalid role", status: 400 };
  const common = {
    date: new Date(input.date),
    hours: input.hours,
    assignmentType: input.assignmentType,
    roleRefId: input.roleRefId,
    projectId: resolved.projectId,
    note: input.note ?? null,
    startTime: new Date(input.startTime),
    endTime: new Date(input.endTime),
  };
  if (input.scheduledMeetingId) {
    // Logged against a real meeting: link it (so the meeting block shows a
    // role accent rather than a second block) and DON'T mirror to the
    // Timesheet calendar — the meeting is already on the real calendar.
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: input.scheduledMeetingId },
      select: {
        id: true,
        selectedAt: true,
        createdAt: true,
        durationMinutes: true,
        recurrenceRule: true,
        externalEventId: true,
      },
    });
    if (!meeting) return { ok: false, error: "Not found", status: 404 };
    const occurrence = await resolveMeetingOccurrence(meeting, common.startTime);
    const key = { scheduledMeetingId: meeting.id, occurrenceStart: occurrence.originalStart, userId };
    const entry = await prisma.timeEntry.upsert({
      where: { scheduledMeetingId_occurrenceStart_userId: key },
      create: { ...key, source: "Meeting", ...common },
      update: common,
    });
    return { ok: true, entry };
  }
  const entry = await prisma.timeEntry.create({ data: { userId, source: "Manual", ...common } });
  mirrorInBackground(userId, entry.id, mirrorLatest(entry.id));
  return { ok: true, entry };
}

export type UpdateTimeEntryInput = {
  id: string;
  date?: string;
  hours?: number;
  assignmentType?: AssignmentType;
  roleRefId?: string;
  note?: string | null;
  startTime?: string;
  endTime?: string;
};

export async function updateTimeEntry(userId: string, input: UpdateTimeEntryInput): Promise<TimeEntryWriteResult> {
  const existing = await prisma.timeEntry.findUnique({ where: { id: input.id } });
  if (!existing || existing.userId !== userId) return { ok: false, error: "Not found", status: 404 };
  const assignmentType = input.assignmentType === undefined ? existing.assignmentType : input.assignmentType;
  const roleRefId = input.roleRefId === undefined ? existing.roleRefId : input.roleRefId;
  let projectId = existing.projectId;
  if (input.assignmentType !== undefined || input.roleRefId !== undefined) {
    // A patch that touches either half must land on a complete, real role
    // — this is the path that used to allow clearing back to unassigned.
    if (!assignmentType || !roleRefId) return { ok: false, error: "A role is required", status: 400 };
    const resolved = await resolveRoleRef(userId, assignmentType, roleRefId);
    if (!resolved) return { ok: false, error: "Invalid role", status: 400 };
    projectId = resolved.projectId;
  }

  const startTime = input.startTime === undefined ? existing.startTime : new Date(input.startTime);
  const endTime = input.endTime === undefined ? existing.endTime : new Date(input.endTime);
  const hours = input.hours ?? existing.hours;
  // Validate the MERGED result, not just the patch: a partial update that
  // moves only `end` earlier than the stored `start` is still invalid.
  const rangeError = validateTimeEntryRange({
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    hours,
  });
  if (rangeError) return { ok: false, error: rangeError, status: 400 };

  const entry = await prisma.timeEntry.update({
    where: { id: input.id },
    data: {
      date: input.date ? new Date(input.date) : existing.date,
      hours,
      assignmentType,
      roleRefId,
      projectId,
      note: input.note === undefined ? existing.note : input.note,
      startTime,
      endTime,
    },
  });
  mirrorInBackground(userId, entry.id, mirrorLatest(entry.id));
  return { ok: true, entry };
}

export type TimeEntryDeleteResult = { ok: true; id: string } | { ok: false; error: string; status: number };

export async function deleteTimeEntry(userId: string, id: string): Promise<TimeEntryDeleteResult> {
  // A mirror still creating this entry's Google event hasn't saved its id
  // yet; wait so the removal below knows which event to take down.
  await mirrorChains.get(id);
  // Under the lock, a mirror on another machine has finished and saved its
  // Google event id before the row is read and deleted.
  const outcome = await withEntryMirrorLock(id, async (tx) => {
    const row = await tx.timeEntry.findUnique({ where: { id } });
    if (!row) return "gone" as const;
    if (row.userId !== userId) return null;
    await tx.timeEntry.delete({ where: { id } });
    return row;
  });
  if (!outcome) return { ok: false, error: "Not found", status: 404 };
  // A repeated delete (a retry, a second tab, a client still drawing the row)
  // already got what it asked for.
  if (outcome === "gone") return { ok: true, id };
  mirrorInBackground(userId, outcome.id, () => removeTimeEntryFromGoogle(outcome));
  return { ok: true, id };
}
