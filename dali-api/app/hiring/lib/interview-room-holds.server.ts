// A hiring cycle's standing hold on its interview rooms (InterviewConfig.holdRooms):
// one recurring RoomBooking per room (source InterviewHold), covering interview
// hours across the interview window, so members can't book over it. The cycle's
// own Interview bookings sit inside the hold (blockedBy in rooms.server.ts).
//
// applyRoomHolds is the single write path: it always releases the cycle's
// existing holds first, then — if the cycle still wants holds — recreates them
// from scratch rather than diffing, so a changed window, hour range, or room
// list is picked up for free. Conflicts (another booking or meeting already in
// the way) are scanned before anything is written; the caller decides whether
// to reject or to evict them.

import { prisma } from "~/lib/db";
import { rruleUntilBasic } from "~/lib/meeting-occurrences";
import { formatInTimeZone, zonedWallTimeUtc } from "~/lib/timezone";
import {
  cancelRoomBooking,
  createRoomBooking,
  listRoomConflicts,
  previewBookingSeries,
  releaseCycleRoomBookings,
  type RoomScheduleItem,
} from "~/lib/rooms.server";
import { notify } from "~/lib/notify.server";

export type HoldConfig = {
  interviewStartDate: Date;
  interviewEndDate: Date;
  dayStartHour: number;
  dayEndHour: number;
  timezone: string;
};

export type HoldOccurrence = { start: Date; end: Date; recurrenceRule: string };

export type RoomConflict = { roomId: string; roomName: string; items: RoomScheduleItem[] };

function zonedYmd(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The hold's first occurrence and RRULE: the first weekday on or after
 * max(interviewStartDate, today) in the cycle's timezone, at
 * dayStartHour-dayEndHour, repeating weekly on weekdays through the end of
 * the interview window. Null when the window has no weekday left to hold
 * (the interview window has already ended).
 */
export function holdOccurrencesFor(config: HoldConfig): HoldOccurrence | null {
  const { interviewStartDate, interviewEndDate, dayStartHour, dayEndHour, timezone } = config;
  const startYmd = zonedYmd(interviewStartDate, timezone);
  const todayYmd = zonedYmd(new Date(), timezone);
  const endYmd = zonedYmd(interviewEndDate, timezone);

  let ymd = startYmd > todayYmd ? startYmd : todayYmd;
  while (weekdayOf(ymd) === 0 || weekdayOf(ymd) === 6) {
    ymd = addDaysYmd(ymd, 1);
  }
  if (ymd > endYmd) return null;

  const [y, m, d] = ymd.split("-").map(Number);
  const start = zonedWallTimeUtc(y, m, d, dayStartHour, 0, timezone);
  const end = zonedWallTimeUtc(y, m, d, dayEndHour, 0, timezone);
  // interviewEndDate is local midnight on the last day (zonedDayStartUtc); the
  // hold needs to cover that whole day, so UNTIL is just before the next one.
  const until = new Date(interviewEndDate.getTime() + 24 * 60 * 60_000 - 1000);
  const recurrenceRule = `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=${rruleUntilBasic(until)}`;
  return { start, end, recurrenceRule };
}

/**
 * Every schedule item (booking or meeting) that the hold would bump, grouped
 * by room. Rooms with nothing in the way are left out of the result.
 */
export async function findHoldConflicts(
  cycleId: string,
  config: HoldConfig,
  rooms: { id: string; name: string }[],
): Promise<RoomConflict[]> {
  const occ = holdOccurrencesFor(config);
  if (!occ || rooms.length === 0) return [];
  const preview = await previewBookingSeries({
    start: occ.start,
    end: occ.end,
    recurrenceRule: occ.recurrenceRule,
  });
  if (!preview.ok) return [];
  const writer = { source: "InterviewHold" as const, applicationCycleId: cycleId };

  const out: RoomConflict[] = [];
  for (const room of rooms) {
    const items = await listRoomConflicts(room.id, preview.value, writer);
    if (items.length > 0) out.push({ roomId: room.id, roomName: room.name, items });
  }
  return out;
}

export type ApplyRoomHoldsResult = { ok: true } | { ok: false; conflicts: RoomConflict[] };

function formatHoldWhen(d: Date, timezone: string): string {
  return formatInTimeZone(d, timezone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Bring a cycle's room holds in line with `config`: always releases its
 * existing holds, then — when `config.holdRooms` is on and there's a room and
 * an occurrence to hold — recreates one hold per room.
 *
 * Conflicts are scanned before any write. With `override` false, a conflict
 * rolls the whole call back (nothing released, nothing created) and returns
 * the list for the caller to show. With `override` true, every conflicting
 * booking is cancelled and every conflicting meeting loses just that room,
 * then the holds are created; each evicted item's organizer is notified once
 * the transaction commits.
 */
export async function applyRoomHolds(input: {
  cycleId: string;
  config: HoldConfig & { holdRooms: boolean; rooms: { id: string; name: string }[] };
  actorUserId: string;
  override: boolean;
}): Promise<ApplyRoomHoldsResult> {
  const { cycleId, config, actorUserId, override } = input;
  const rooms = config.rooms;
  const occ = config.holdRooms ? holdOccurrencesFor(config) : null;
  const wantsHold = config.holdRooms && !!occ && rooms.length > 0;

  let conflicts: RoomConflict[] = [];
  if (wantsHold) {
    conflicts = await findHoldConflicts(cycleId, config, rooms);
    if (conflicts.length > 0 && !override) {
      return { ok: false, conflicts };
    }
  }

  type NotifyTarget = { userId: string; itemTitle: string; itemDetail: string; link: string };
  const notifyTargets = new Map<string, NotifyTarget>();
  let cycleNamePromise: Promise<string> | null = null;
  const cycleName = () => {
    if (!cycleNamePromise) {
      cycleNamePromise = prisma.applicationCycle
        .findUnique({ where: { id: cycleId }, select: { name: true } })
        .then((c) => c?.name ?? "the hiring cycle");
    }
    return cycleNamePromise;
  };

  await prisma.$transaction(async (tx) => {
    await releaseCycleRoomBookings(cycleId, "InterviewHold", actorUserId, tx);
    if (!wantsHold) return;

    if (override && conflicts.length > 0) {
      const name = await cycleName();
      for (const conflict of conflicts) {
        for (const item of conflict.items) {
          if (item.kind === "booking") {
            await cancelRoomBooking(
              item.id,
              actorUserId,
              { scope: item.recurring ? "this" : "all", occurrenceStart: item.occurrenceStart },
              tx,
            );
          } else {
            await tx.scheduledMeeting.update({
              where: { id: item.id },
              data: { rooms: { disconnect: { id: conflict.roomId } } },
            });
          }
          const dedupeKey = `${item.organizer.id}:${item.kind}:${item.id}:${item.occurrenceStart.getTime()}`;
          if (!notifyTargets.has(dedupeKey)) {
            notifyTargets.set(dedupeKey, {
              userId: item.organizer.id,
              itemTitle: item.title,
              itemDetail: `${conflict.roomName} on ${formatHoldWhen(item.start, config.timezone)} is held for ${name} interviews.`,
              link: item.kind === "booking" ? "/rooms" : `/calendar?meeting=${item.id}`,
            });
          }
        }
      }
    }

    for (const room of rooms) {
      const created = await createRoomBooking(
        {
          roomId: room.id,
          userId: actorUserId,
          start: occ!.start,
          end: occ!.end,
          title: "Reserved for interviews",
          source: "InterviewHold",
          recurrenceRule: occ!.recurrenceRule,
          applicationCycleId: cycleId,
        },
        tx,
      );
      if (!created.ok) throw new Error(created.error);
    }
  });

  if (notifyTargets.size > 0) {
    notify({
      eventType: "room.booking_bumped",
      createdByUserId: actorUserId,
      message: {},
      recipients: [...notifyTargets.values()].map((t) => ({
        userId: t.userId,
        vars: { itemTitle: t.itemTitle, itemDetail: t.itemDetail },
        link: t.link,
      })),
    }).catch(() => {});
  }

  return { ok: true };
}
