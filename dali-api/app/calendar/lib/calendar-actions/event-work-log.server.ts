import { prisma } from "~/lib/db.server";
import { type RoleInstance, resolveRoleRef } from "~/lib/roles";

/** The validated "Count this as work" half of an event form. */
export type EventWorkLog = {
  assignmentType: RoleInstance["assignmentType"];
  roleRefId: string;
  projectId: string | null;
  note: string | null;
};

/** What an event save should do to the hours attached to it. "none" is the
 *  default: silence about work means leave the log alone, so a save from a
 *  client that wasn't showing the log (or a path that doesn't carry the fields
 *  at all) can never quietly delete payroll data. Removing hours takes the
 *  composer explicitly saying so via clearWork. */
export type EventWorkAction =
  | { kind: "write"; log: EventWorkLog }
  | { kind: "clear" }
  | { kind: "none" };

/**
 * Read and validate the work fields off an event form.
 *
 * Called BEFORE the Google write on every path, so an unusable role fails the
 * whole save rather than leaving an event behind with no hours attached to it.
 */
export async function resolveEventWorkLog(
  userId: string,
  get: (k: string) => string,
): Promise<{ error: Response } | { error?: undefined; work: EventWorkAction }> {
  if (get("isWork") !== "1") {
    return { work: get("clearWork") === "1" ? { kind: "clear" } : { kind: "none" } };
  }
  const assignmentType = get("assignmentType") || null;
  const roleRefId = get("roleRefId") || null;
  if (!assignmentType || !roleRefId) {
    return { error: Response.json({ error: "Pick a role to log this time against." }, { status: 400 }) };
  }
  const resolved = await resolveRoleRef(
    userId,
    assignmentType as RoleInstance["assignmentType"],
    roleRefId,
  );
  if (!resolved) {
    return { error: Response.json({ error: "That role isn't yours to log against." }, { status: 400 }) };
  }
  return {
    work: {
      kind: "write",
      log: {
        assignmentType: assignmentType as RoleInstance["assignmentType"],
        roleRefId,
        projectId: resolved.projectId,
        note: get("workNote").trim() || null,
      },
    },
  };
}

/**
 * Write — or clear — the TimeEntry linked to a calendar event. Keyed by
 * (sourceEventId, userId), so re-saving an event retimes the log it already has
 * instead of stacking a second one, and unticking the box deletes it while
 * leaving the event itself alone.
 *
 * Linked entries are deliberately NOT mirrored to the DALI Timesheet calendar:
 * the event is already on a real calendar, so a mirror would draw those hours a
 * second time — the same rule add-time-entry applies to meeting-sourced rows.
 */
export async function writeEventWorkLog(opts: {
  userId: string;
  eventId: string;
  linkId: string;
  title: string;
  startIso: string;
  endIso: string;
  work: EventWorkAction;
}): Promise<void> {
  const { userId, eventId, work } = opts;
  if (work.kind === "none") return;
  if (work.kind === "clear") {
    await prisma.timeEntry.deleteMany({ where: { userId, sourceEventId: eventId } });
    return;
  }
  const { log } = work;
  const startTime = new Date(opts.startIso);
  const endTime = new Date(opts.endIso);
  const common = {
    date: startTime,
    hours: (endTime.getTime() - startTime.getTime()) / 3_600_000,
    assignmentType: log.assignmentType,
    roleRefId: log.roleRefId,
    projectId: log.projectId,
    note: log.note ?? opts.title,
    startTime,
    endTime,
    sourceCalendarLinkId: opts.linkId,
  };
  await prisma.timeEntry.upsert({
    where: { sourceEventId_userId: { sourceEventId: eventId, userId } },
    create: { userId, source: "Manual", sourceEventId: eventId, ...common },
    update: common,
  });
}

/** Keep a linked work log in step when its event is dragged or resized on the
 *  grid: the logged hours ARE the event's hours, so they move with it. */
export async function retimeEventWorkLog(
  userId: string,
  eventId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const startTime = new Date(startIso);
  const endTime = new Date(endIso);
  await prisma.timeEntry.updateMany({
    where: { userId, sourceEventId: eventId },
    data: {
      date: startTime,
      startTime,
      endTime,
      hours: (endTime.getTime() - startTime.getTime()) / 3_600_000,
    },
  });
}

/** Work can only hang off one concrete, timed occurrence. Repeats have no single
 *  occurrence to key on and an all-day event has no range to measure, so the
 *  composer hides the toggle for both — this backs that up server-side. */
export function workLogShapeError(recurrenceRule: string | null, allDay: boolean): Response | null {
  if (recurrenceRule) {
    return Response.json(
      { error: "A repeating event can't be marked as work — log the hours on a single occurrence." },
      { status: 400 },
    );
  }
  if (allDay) {
    return Response.json(
      { error: "An all-day event can't be marked as work — give it a start and end time." },
      { status: 400 },
    );
  }
  return null;
}
