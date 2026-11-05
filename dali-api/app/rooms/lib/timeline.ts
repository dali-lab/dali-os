import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";

export type ScheduleItem = {
  kind: "booking" | "meeting";
  id: string;
  title: string;
  start: string;
  end: string;
  occurrenceStart: string;
  recurring: boolean;
  organizer: { id: string; firstName: string; lastName: string };
  isEvent: boolean;
  source: "Web" | "Display" | "App" | "Interview" | "InterviewHold" | null;
  bookedTitle: string | null;
  fromCalendarEvent: boolean;
};

// The visible day, in local hours. Items outside it are clipped to the edges.
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 23;
export const SNAP_MIN = 30;

const DEFAULT_BOOKING_MS = 60 * 60_000;
const OPENING_HOUR = 9;
// A slot that has already started opens at the next tick of this, because the
// server refuses a start more than a few minutes in the past.
const START_TICK_MS = 5 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { start: new Date(y!, m! - 1, d!), end: new Date(y!, m! - 1, d! + 1) };
}

export function shiftDay(key: string, days: number) {
  const { start } = localDay(key);
  start.setDate(start.getDate() + days);
  return dayKey(start);
}

export function atTime(key: string, time: string) {
  const [h, m] = time.split(":").map(Number);
  const { start } = localDay(key);
  start.setHours(h!, m!, 0, 0);
  return start;
}

export function hhmm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** `start`, or the next bookable tick when it has already passed. */
export function notInPast(start: Date, now: Date) {
  if (start.getTime() >= now.getTime()) return start;
  return new Date(Math.ceil(now.getTime() / START_TICK_MS) * START_TICK_MS);
}

/** The hour a click on an empty slot proposes: past any booking still running
 *  at that time, and stopping short of the next one. */
export function slotForClick(slot: Date, items: ScheduleItem[], now: Date) {
  const spans = items
    .map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end) }))
    .sort((a, b) => a.start - b.start);
  let start = notInPast(slot, now).getTime();
  for (const s of spans) {
    if (s.start <= start && s.end > start) start = s.end;
  }
  const next = spans.find((s) => s.start > start)?.start ?? Infinity;
  return { start: new Date(start), end: new Date(Math.min(start + DEFAULT_BOOKING_MS, next)) };
}

/** Where the Book button opens: the next half hour on the day in view, or the
 *  next morning once today has run out. A past day opens on today. */
export function nextBookableSlot(viewedKey: string, now: Date) {
  const today = dayKey(now);
  const morning = (key: string) => {
    const start = atTime(key, `${pad(OPENING_HOUR)}:00`);
    return { date: key, start, end: new Date(start.getTime() + DEFAULT_BOOKING_MS) };
  };
  if (viewedKey > today) return morning(viewedKey);

  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil(start.getMinutes() / SNAP_MIN) * SNAP_MIN);
  if (dayKey(start) !== today || start.getHours() >= DAY_END_HOUR) return morning(shiftDay(today, 1));
  return { date: today, start, end: new Date(start.getTime() + DEFAULT_BOOKING_MS) };
}

export type Lane = { lane: number; lanes: number };

/** A lane per item, index for index, so overlapping items sit side by side (an
 *  interview inside its hold). The longer of two that start together takes the
 *  first lane. */
export function overlapLanes(items: { start: string; end: string }[]): Lane[] {
  const order = items
    .map((item, index) => ({ index, start: Date.parse(item.start), end: Date.parse(item.end) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Lane[] = items.map(() => ({ lane: 0, lanes: 1 }));
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  const closeCluster = () => {
    for (const i of cluster) out[i]!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const span of order) {
    if (laneEnds.length > 0 && span.start >= Math.max(...laneEnds)) closeCluster();
    const free = laneEnds.findIndex((end) => end <= span.start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = span.end;
    out[span.index]!.lane = lane;
    cluster.push(span.index);
  }
  closeCluster();
  return out;
}

export type BookingAccess = {
  canEdit: boolean;
  canCancel: boolean;
  // Where this item is really changed, when that isn't here.
  calendarHref: string | null;
  note: string | null;
};

/** What the viewer can do with an item. Mirrors updateRoomBookingAsMember and
 *  cancelRoomBookingAsMember, which enforce the same rules. */
export function bookingAccess(
  item: ScheduleItem,
  viewer: { userId: string; core: boolean },
  now: Date,
): BookingAccess {
  const readOnly = { canEdit: false, canCancel: false, calendarHref: null, note: null };
  if (item.kind === "meeting") {
    return { ...readOnly, calendarHref: meetingOccurrenceHref(item.id, item.occurrenceStart) };
  }
  if (item.source === "Interview" || item.source === "InterviewHold") {
    return { ...readOnly, note: "Managed by hiring. Change it from the cycle page." };
  }
  const ended = Date.parse(item.end) <= now.getTime();
  const mine = item.organizer.id === viewer.userId;
  if (item.fromCalendarEvent) {
    const day = dayKey(new Date(item.start));
    return {
      ...readOnly,
      canCancel: viewer.core && !ended,
      calendarHref: mine ? `/calendar?view=day&anchor=${day}` : null,
      note:
        viewer.core && !mine
          ? "Booked from a calendar event. Cancelling frees the room but leaves the event."
          : "Booked from a calendar event.",
    };
  }
  const canManage = !ended && (mine || viewer.core);
  return { ...readOnly, canEdit: canManage, canCancel: canManage };
}
