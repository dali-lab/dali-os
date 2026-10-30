// Application events (help hours, socials, info sessions) Core runs during a
// hiring cycle: creation/editing, QR self check-in (mirrors
// app/education/lib/session-checkin.server.ts, but keyed by userId with no
// enrollment gate — anyone with a Dartmouth login can check in), hand-marked
// attendance, and the roster/engagement reads the UI and reviewer surfaces
// build on. Request/Response objects never reach this module; routes
// translate the `{ error, status }` results.

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isCycleAdmin } from "~/lib/roles";
import type { HiringEvent, HiringEventKind } from "~/generated/prisma/client";

// Check-in stays reachable this long past the event's end, so a late QR scan
// still counts, then auto-closes even if Core forgets to close it by hand.
const CHECKIN_GRACE_MS = 30 * 60 * 1000;

export type HiringEventWithCount = HiringEvent & {
  _count: { attendances: number };
};

export async function listHiringEvents(cycleId: string): Promise<HiringEventWithCount[]> {
  return prisma.hiringEvent.findMany({
    where: { applicationCycleId: cycleId },
    orderBy: { startsAt: "asc" },
    include: { _count: { select: { attendances: true } } },
  });
}

export type HiringEventMutationResult =
  | { ok: true; event: HiringEvent }
  | { error: string; status: number };

function validateEventFields(fields: {
  title: string;
  startsAt: Date;
  endsAt: Date;
}): { error: string; status: number } | null {
  if (!fields.title.trim()) return { error: "Title is required", status: 400 };
  if (fields.endsAt.getTime() <= fields.startsAt.getTime()) {
    return { error: "End time must be after start time", status: 400 };
  }
  return null;
}

export async function createHiringEvent(args: {
  cycleId: string;
  actorId: string;
  kind: HiringEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
}): Promise<HiringEventMutationResult> {
  if (!(await isCycleAdmin(args.actorId, args.cycleId))) {
    return { error: "Forbidden", status: 403 };
  }
  const validationError = validateEventFields(args);
  if (validationError) return validationError;

  const event = await prisma.hiringEvent.create({
    data: {
      applicationCycleId: args.cycleId,
      kind: args.kind,
      title: args.title.trim(),
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      location: args.location ?? null,
      createdByUserId: args.actorId,
    },
  });
  await logAuditEvent({
    action: "hiring.event.create",
    userId: args.actorId,
    targetId: event.id,
    metadata: { cycleId: args.cycleId },
  });
  return { ok: true, event };
}

export async function updateHiringEvent(args: {
  eventId: string;
  actorId: string;
  kind?: HiringEventKind;
  title?: string;
  startsAt?: Date;
  endsAt?: Date;
  location?: string | null;
}): Promise<HiringEventMutationResult> {
  const existing = await prisma.hiringEvent.findUnique({ where: { id: args.eventId } });
  if (!existing) return { error: "Event not found", status: 404 };
  if (!(await isCycleAdmin(args.actorId, existing.applicationCycleId))) {
    return { error: "Forbidden", status: 403 };
  }

  const title = args.title !== undefined ? args.title : existing.title;
  const startsAt = args.startsAt ?? existing.startsAt;
  const endsAt = args.endsAt ?? existing.endsAt;
  const validationError = validateEventFields({ title, startsAt, endsAt });
  if (validationError) return validationError;

  const event = await prisma.hiringEvent.update({
    where: { id: args.eventId },
    data: {
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      title: title.trim(),
      startsAt,
      endsAt,
      ...(args.location !== undefined ? { location: args.location } : {}),
    },
  });
  await logAuditEvent({
    action: "hiring.event.update",
    userId: args.actorId,
    targetId: event.id,
    metadata: { cycleId: existing.applicationCycleId },
  });
  return { ok: true, event };
}

export async function deleteHiringEvent(args: {
  eventId: string;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const existing = await prisma.hiringEvent.findUnique({
    where: { id: args.eventId },
    select: { applicationCycleId: true },
  });
  if (!existing) return { error: "Event not found", status: 404 };
  if (!(await isCycleAdmin(args.actorId, existing.applicationCycleId))) {
    return { error: "Forbidden", status: 403 };
  }
  // HiringEventAttendance.event cascades on delete — no manual cleanup.
  await prisma.hiringEvent.delete({ where: { id: args.eventId } });
  await logAuditEvent({
    action: "hiring.event.delete",
    userId: args.actorId,
    targetId: args.eventId,
    metadata: { cycleId: existing.applicationCycleId },
  });
  return { ok: true };
}

export type HiringEventWindow = { endsAt: Date; checkInOpenAt: Date | null };

/**
 * Whether an applicant can self-check-in right now: Core has opened it AND
 * we're still inside the event's grace window. Same shape as
 * isSessionCheckInOpen (app/education/lib/session-checkin.server.ts).
 */
export function isEventCheckInOpen(event: HiringEventWindow, now: Date = new Date()): boolean {
  return event.checkInOpenAt != null && now.getTime() <= event.endsAt.getTime() + CHECKIN_GRACE_MS;
}

export async function setEventCheckInOpen(args: {
  eventId: string;
  open: boolean;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const event = await prisma.hiringEvent.findUnique({
    where: { id: args.eventId },
    select: { applicationCycleId: true },
  });
  if (!event) return { error: "Event not found", status: 404 };
  if (!(await isCycleAdmin(args.actorId, event.applicationCycleId))) {
    return { error: "Forbidden", status: 403 };
  }
  await prisma.hiringEvent.update({
    where: { id: args.eventId },
    data: { checkInOpenAt: args.open ? new Date() : null },
  });
  await logAuditEvent({
    action: args.open ? "hiring.event.checkin.open" : "hiring.event.checkin.close",
    userId: args.actorId,
    targetId: args.eventId,
    metadata: { cycleId: event.applicationCycleId },
  });
  return { ok: true };
}

export async function setEventBroadcast(args: {
  eventId: string;
  on: boolean;
  actorId: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const event = await prisma.hiringEvent.findUnique({
    where: { id: args.eventId },
    select: { applicationCycleId: true, checkInOpenAt: true },
  });
  if (!event) return { error: "Event not found", status: 404 };
  if (!(await isCycleAdmin(args.actorId, event.applicationCycleId))) {
    return { error: "Forbidden", status: 403 };
  }
  if (args.on && event.checkInOpenAt == null) {
    return { error: "Open check-in before showing it on the displays", status: 400 };
  }
  await prisma.hiringEvent.update({
    where: { id: args.eventId },
    data: { broadcastAt: args.on ? new Date() : null },
  });
  await logAuditEvent({
    action: args.on ? "hiring.event.broadcast.on" : "hiring.event.broadcast.off",
    userId: args.actorId,
    targetId: args.eventId,
    metadata: { cycleId: event.applicationCycleId },
  });
  return { ok: true };
}

export type BroadcastEvent = {
  id: string;
  title: string;
  kind: HiringEventKind;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
};

/**
 * The event every paired door display should show a check-in QR for right
 * now: broadcast switched on and check-in still open. With several on at
 * once, the one starting soonest wins.
 */
export async function getBroadcastEvent(now: Date = new Date()): Promise<BroadcastEvent | null> {
  const candidates = await prisma.hiringEvent.findMany({
    where: { broadcastAt: { not: null }, checkInOpenAt: { not: null } },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, kind: true, startsAt: true, endsAt: true, location: true, checkInOpenAt: true },
  });
  const live = candidates.find((e) => isEventCheckInOpen(e, now));
  if (!live) return null;
  const { checkInOpenAt: _open, ...event } = live;
  return event;
}

export type SelfCheckInResult =
  | { ok: true; alreadyPresent: boolean }
  | { error: string; status: number };

/**
 * Mark the caller present by scanning the projected QR. No enrollment or
 * application gate — any authenticated user — so someone who attends before
 * applying still gets credit once they apply (attendance is keyed by userId,
 * not by Application).
 */
export async function selfCheckInToEvent(args: {
  eventId: string;
  userId: string;
}): Promise<SelfCheckInResult> {
  const event = await prisma.hiringEvent.findUnique({
    where: { id: args.eventId },
    select: { id: true, endsAt: true, checkInOpenAt: true },
  });
  if (!event) return { error: "Event not found", status: 404 };
  if (!isEventCheckInOpen(event)) {
    return { error: "Check-in isn't open for this event", status: 403 };
  }

  const existing = await prisma.hiringEventAttendance.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: args.userId } },
    select: { id: true },
  });
  if (existing) return { ok: true, alreadyPresent: true };

  await prisma.hiringEventAttendance.upsert({
    where: { eventId_userId: { eventId: event.id, userId: args.userId } },
    create: { eventId: event.id, userId: args.userId, markedByUserId: null },
    update: {},
  });
  await logAuditEvent({
    action: "hiring.event.checkin.self",
    userId: args.userId,
    targetId: event.id,
  });
  return { ok: true, alreadyPresent: false };
}

export async function markEventAttendance(args: {
  eventId: string;
  actorId: string;
  userId: string;
  present: boolean;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const event = await prisma.hiringEvent.findUnique({
    where: { id: args.eventId },
    select: { applicationCycleId: true },
  });
  if (!event) return { error: "Event not found", status: 404 };
  if (!(await isCycleAdmin(args.actorId, event.applicationCycleId))) {
    return { error: "Forbidden", status: 403 };
  }

  if (args.present) {
    await prisma.hiringEventAttendance.upsert({
      where: { eventId_userId: { eventId: args.eventId, userId: args.userId } },
      create: { eventId: args.eventId, userId: args.userId, markedByUserId: args.actorId },
      update: { markedByUserId: args.actorId, markedAt: new Date() },
    });
  } else {
    // deleteMany rather than delete: absent is idempotent, not an error.
    await prisma.hiringEventAttendance.deleteMany({
      where: { eventId: args.eventId, userId: args.userId },
    });
  }
  await logAuditEvent({
    action: "hiring.event.attendance.mark",
    userId: args.actorId,
    targetId: args.eventId,
    metadata: { userId: args.userId, present: args.present },
  });
  return { ok: true };
}

export type EventRosterEntry = {
  userId: string;
  name: string;
  email: string | null;
  present: boolean;
  markedAt: Date | null;
  applicant: boolean;
};

function displayEmail(user: { dartmouthEmail: string | null; netId: string | null }): string | null {
  return user.dartmouthEmail ?? (user.netId ? `${user.netId}@dartmouth.edu` : null);
}

/**
 * Every applicant in the event's cycle, merged with attendance rows, plus
 * any walk-in attendee who has no Application yet (flagged `applicant:
 * false`) — attendance is keyed by userId so check-in before applying still
 * counts once they do.
 */
export async function getEventRoster(eventId: string): Promise<EventRosterEntry[]> {
  const event = await prisma.hiringEvent.findUnique({
    where: { id: eventId },
    select: { applicationCycleId: true },
  });
  if (!event) return [];

  const [applications, attendances] = await Promise.all([
    prisma.application.findMany({
      where: { applicationCycleId: event.applicationCycleId },
      select: {
        userId: true,
        user: { select: { firstName: true, lastName: true, dartmouthEmail: true, netId: true } },
      },
    }),
    prisma.hiringEventAttendance.findMany({
      where: { eventId },
      select: { userId: true, markedAt: true },
    }),
  ]);

  const attendanceByUserId = new Map(attendances.map((a) => [a.userId, a]));
  const byUserId = new Map<string, EventRosterEntry>();

  for (const app of applications) {
    const attendance = attendanceByUserId.get(app.userId);
    byUserId.set(app.userId, {
      userId: app.userId,
      name: `${app.user.firstName} ${app.user.lastName}`,
      email: displayEmail(app.user),
      present: !!attendance,
      markedAt: attendance?.markedAt ?? null,
      applicant: true,
    });
  }

  const walkInUserIds = attendances.map((a) => a.userId).filter((userId) => !byUserId.has(userId));
  if (walkInUserIds.length > 0) {
    const walkIns = await prisma.user.findMany({
      where: { id: { in: walkInUserIds } },
      select: { id: true, firstName: true, lastName: true, dartmouthEmail: true, netId: true },
    });
    for (const user of walkIns) {
      const attendance = attendanceByUserId.get(user.id);
      byUserId.set(user.id, {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: displayEmail(user),
        present: true,
        markedAt: attendance?.markedAt ?? null,
        applicant: false,
      });
    }
  }

  return [...byUserId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type HiringEventEngagementEntry = {
  eventId: string;
  title: string;
  kind: HiringEventKind;
  startsAt: Date;
  endsAt: Date;
  cycleId: string;
  cycleName: string;
};

/**
 * Events this user attended, newest first. `cycleId` is an optional narrowing
 * filter; omit it (as the reviewer/applications engagement panels do) to get
 * the user's full history. Every entry always carries its own cycleId/
 * cycleName — callers group "this cycle" vs. "prior cycle" by comparing that
 * against the cycle they're viewing, rather than this function returning two
 * separate lists.
 */
export async function getHiringEventEngagement(
  userId: string,
  cycleId?: string,
): Promise<HiringEventEngagementEntry[]> {
  const attendances = await prisma.hiringEventAttendance.findMany({
    where: {
      userId,
      ...(cycleId ? { event: { applicationCycleId: cycleId } } : {}),
    },
    select: {
      event: {
        select: {
          id: true,
          title: true,
          kind: true,
          startsAt: true,
          endsAt: true,
          applicationCycleId: true,
          applicationCycle: { select: { name: true } },
        },
      },
    },
    orderBy: { event: { startsAt: "desc" } },
  });

  return attendances.map((a) => ({
    eventId: a.event.id,
    title: a.event.title,
    kind: a.event.kind,
    startsAt: a.event.startsAt,
    endsAt: a.event.endsAt,
    cycleId: a.event.applicationCycleId,
    cycleName: a.event.applicationCycle.name,
  }));
}
