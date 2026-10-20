import rrulePkg from "rrule";
import { prisma } from "~/lib/db";
import { buildRule } from "~/lib/meeting-occurrences";
import { formatDateShort } from "~/lib/display";
import type { JobResult } from "~/jobs/registry";

const { RRule, rrulestr } = rrulePkg as unknown as {
  RRule: typeof import("rrule").RRule;
  rrulestr: typeof import("rrule").rrulestr;
};

const BAND_MS = 40 * 24 * 60 * 60_000;

// buildRule's old expansion: the real UTC instant as the anchor, so an evening
// series landed a day early and every series kept its UTC hour across DST.
function legacyUtcStarts(rule: string, dtstart: Date, from: Date, to: Date): Date[] {
  try {
    const trimmed = rule.trim();
    const rrulePart = trimmed.toUpperCase().startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dt =
      `${dtstart.getUTCFullYear()}${pad(dtstart.getUTCMonth() + 1)}${pad(dtstart.getUTCDate())}` +
      `T${pad(dtstart.getUTCHours())}${pad(dtstart.getUTCMinutes())}${pad(dtstart.getUTCSeconds())}Z`;
    const parsed = rrulestr(`DTSTART:${dt}\n${rrulePart}`);
    return parsed instanceof RRule ? parsed.between(from, to, true) : [];
  } catch {
    return [];
  }
}

export type KeyMap = { moves: Map<number, Date>; ambiguous: Date[] };

/**
 * Where each stored key belongs now. Every key written under the old expansion
 * belongs to the real occurrence that snapped onto it (resolveOccurrence:
 * nearest start, ties to the earlier), so each real occurrence claims the old
 * key nearest it. A key claimed by exactly one occurrence moves there; one
 * claimed by two is ambiguous; one claimed by none stays.
 */
export function occurrenceKeyMap(rule: string, dtstart: Date, keys: Date[]): KeyMap {
  const empty: KeyMap = { moves: new Map(), ambiguous: [] };
  if (keys.length === 0) return empty;
  const times = keys.map((k) => k.getTime());
  const from = new Date(Math.min(...times, dtstart.getTime()) - BAND_MS);
  const to = new Date(Math.max(...times) + BAND_MS);
  const legacy = legacyUtcStarts(rule, dtstart, from, to);
  const real = buildRule(rule, dtstart)?.between(from, to, true) ?? [];
  if (legacy.length === 0 || real.length === 0) return empty;

  const claims = new Map<number, Date[]>();
  for (const r of real) {
    let best = legacy[0]!;
    for (const l of legacy) {
      if (Math.abs(l.getTime() - r.getTime()) < Math.abs(best.getTime() - r.getTime())) best = l;
    }
    const list = claims.get(best.getTime()) ?? [];
    list.push(r);
    claims.set(best.getTime(), list);
  }
  const moves = new Map<number, Date>();
  const ambiguous: Date[] = [];
  for (const k of new Set(times)) {
    const claimed = claims.get(k);
    if (!claimed) continue;
    if (claimed.length > 1) ambiguous.push(new Date(k));
    else if (claimed[0]!.getTime() !== k) moves.set(k, claimed[0]!);
  }
  return { moves, ambiguous };
}

/**
 * A meeting note is titled with its occurrence's date when it's made, so a note
 * on a misplaced key carries the misplaced date too. Swaps only that date text,
 * leaving whatever else someone typed. Null when there's nothing to change.
 */
export function retitledNote(title: string, from: Date, to: Date): string | null {
  const oldLabel = formatDateShort(from);
  const newLabel = formatDateShort(to);
  if (oldLabel === newLabel || !title.includes(oldLabel)) return null;
  return title.replace(oldLabel, newLabel);
}

type Table = {
  name: string;
  keys: (ownerId: string) => Promise<Date[]>;
  // "taken" when the new key already holds a row the unique key would collide with.
  move: (ownerId: string, from: Date, to: Date) => Promise<number | "taken">;
};

const ifFree = async (taken: boolean, write: () => Promise<{ count: number }>) =>
  taken ? ("taken" as const) : (await write()).count;

const present = (d: Date | null) => (d ? [d] : []);

const meetingTables: Table[] = [
  {
    name: "MeetingAttendance",
    keys: async (id) =>
      (await prisma.meetingAttendance.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .map((r) => r.occurrenceStart),
    move: async (id, from, to) =>
      ifFree(
        (await prisma.meetingAttendance.count({ where: { scheduledMeetingId: id, occurrenceStart: to } })) > 0,
        () => prisma.meetingAttendance.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } }),
      ),
  },
  {
    name: "Page (meeting note)",
    keys: async (id) =>
      (await prisma.page.findMany({ where: { meetingNoteId: id }, select: { meetingOccurrenceStart: true } }))
        .flatMap((r) => present(r.meetingOccurrenceStart)),
    move: async (id, from, to) => {
      if ((await prisma.page.count({ where: { meetingNoteId: id, meetingOccurrenceStart: to } })) > 0) return "taken";
      const notes = await prisma.page.findMany({
        where: { meetingNoteId: id, meetingOccurrenceStart: from },
        select: { id: true, title: true },
      });
      const { count } = await prisma.page.updateMany({
        where: { meetingNoteId: id, meetingOccurrenceStart: from },
        data: { meetingOccurrenceStart: to },
      });
      for (const note of notes) {
        const title = retitledNote(note.title, from, to);
        if (title) await prisma.page.update({ where: { id: note.id }, data: { title } });
      }
      return count;
    },
  },
  {
    name: "TimeEntry",
    keys: async (id) =>
      (await prisma.timeEntry.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .flatMap((r) => present(r.occurrenceStart)),
    move: async (id, from, to) =>
      ifFree(
        (await prisma.timeEntry.count({ where: { scheduledMeetingId: id, occurrenceStart: to } })) > 0,
        () => prisma.timeEntry.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } }),
      ),
  },
  {
    name: "MeetingException",
    keys: async (id) =>
      (await prisma.meetingException.findMany({ where: { scheduledMeetingId: id }, select: { originalStart: true } }))
        .map((r) => r.originalStart),
    move: async (id, from, to) =>
      ifFree(
        (await prisma.meetingException.count({ where: { scheduledMeetingId: id, originalStart: to } })) > 0,
        () => prisma.meetingException.updateMany({ where: { scheduledMeetingId: id, originalStart: from }, data: { originalStart: to } }),
      ),
  },
  {
    name: "MeetingReminderLog",
    keys: async (id) =>
      (await prisma.meetingReminderLog.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .map((r) => r.occurrenceStart),
    move: async (id, from, to) =>
      ifFree(
        (await prisma.meetingReminderLog.count({ where: { scheduledMeetingId: id, occurrenceStart: to } })) > 0,
        () => prisma.meetingReminderLog.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } }),
      ),
  },
  {
    name: "MeetingRecording",
    keys: async (id) =>
      (await prisma.meetingRecording.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .flatMap((r) => present(r.occurrenceStart)),
    move: async (id, from, to) =>
      (await prisma.meetingRecording.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } })).count,
  },
  {
    name: "Notification",
    keys: async (id) =>
      (await prisma.notification.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .flatMap((r) => present(r.occurrenceStart)),
    move: async (id, from, to) =>
      (await prisma.notification.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } })).count,
  },
  {
    name: "DisplayScanSession",
    keys: async (id) =>
      (await prisma.displayScanSession.findMany({ where: { scheduledMeetingId: id }, select: { occurrenceStart: true } }))
        .map((r) => r.occurrenceStart),
    move: async (id, from, to) =>
      (await prisma.displayScanSession.updateMany({ where: { scheduledMeetingId: id, occurrenceStart: from }, data: { occurrenceStart: to } })).count,
  },
];

const roomTables: Table[] = [
  {
    name: "RoomBookingException",
    keys: async (id) =>
      (await prisma.roomBookingException.findMany({ where: { roomBookingId: id }, select: { originalStart: true } }))
        .map((r) => r.originalStart),
    move: async (id, from, to) =>
      ifFree(
        (await prisma.roomBookingException.count({ where: { roomBookingId: id, originalStart: to } })) > 0,
        () => prisma.roomBookingException.updateMany({ where: { roomBookingId: id, originalStart: from }, data: { originalStart: to } }),
      ),
  },
];

type Counts = { moved: number; skipped: number; ambiguous: number };

async function rekey(label: string, ownerId: string, rule: string, dtstart: Date, tables: Table[], counts: Counts) {
  const perTable = await Promise.all(tables.map(async (t) => ({ t, keys: await t.keys(ownerId) })));
  const { moves, ambiguous } = occurrenceKeyMap(rule, dtstart, perTable.flatMap((p) => p.keys));
  for (const a of ambiguous) {
    counts.ambiguous++;
    console.log(`occurrence-rekey: ${label} (${ownerId}) ${a.toISOString()} AMBIGUOUS, left alone`);
  }
  for (const { t, keys } of perTable) {
    const own = new Set(keys.map((k) => k.getTime()));
    for (const [from, to] of moves) {
      if (!own.has(from)) continue;
      const line = `occurrence-rekey: ${label} (${ownerId}) ${t.name} ${new Date(from).toISOString()} -> ${to.toISOString()}`;
      const res = await t.move(ownerId, new Date(from), to);
      if (res === "taken") {
        counts.skipped++;
        console.log(`${line} SKIPPED, new key already has a row`);
      } else {
        counts.moved += res;
        console.log(`${line} (${res} rows)`);
      }
    }
  }
}

export async function runOccurrenceRekey(): Promise<JobResult> {
  const counts: Counts = { moved: 0, skipped: 0, ambiguous: 0 };

  const meetings = await prisma.scheduledMeeting.findMany({
    where: { recurrenceRule: { not: null }, selectedAt: { not: null } },
    select: { id: true, title: true, recurrenceRule: true, selectedAt: true },
  });
  for (const m of meetings) {
    await rekey(m.title, m.id, m.recurrenceRule!, m.selectedAt!, meetingTables, counts);
  }

  const bookings = await prisma.roomBooking.findMany({
    where: { recurrenceRule: { not: null } },
    select: { id: true, title: true, recurrenceRule: true, start: true },
  });
  for (const b of bookings) {
    await rekey(`Room: ${b.title}`, b.id, b.recurrenceRule!, b.start, roomTables, counts);
  }

  const note = `moved ${counts.moved} rows, skipped ${counts.skipped} taken keys, ${counts.ambiguous} ambiguous keys left alone`;
  console.log(`occurrence-rekey: ${note}`);
  return { items: counts.moved, note };
}
