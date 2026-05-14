import type { Route } from "./+types/api.calendar.group-availability";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { computeFreeIntervals, type Interval, type WorkingHoursDayInput } from "~/lib/availability";
import { fetchBusyEvents } from "~/lib/google-calendar";
import { getZonedYMD } from "~/lib/timezone";

const Schema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  weekStartIso: z.string().min(1),
  weekEndIso: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(480),
  timezone: z.string().min(1),
});

const DEFAULT_BUFFER_MIN = 15;
const DEFAULT_WORK_START_MIN = 9 * 60;
const DEFAULT_WORK_END_MIN = 17 * 60;

function defaultWorkingHours(): WorkingHoursDayInput[] {
  return Array.from({ length: 7 }).map((_, dow) => ({
    dayOfWeek: dow,
    enabled: dow >= 1 && dow <= 5,
    startMinute: DEFAULT_WORK_START_MIN,
    endMinute: DEFAULT_WORK_END_MIN,
  }));
}

type DayBucket = {
  // Sun=0 .. Sat=6 in the requesting user's timezone.
  dayOfWeek: number;
  // Calendar day number (e.g. 14 for "Mar 14"), in the requesting user's timezone.
  dayOfMonth: number;
  matches: { startHour: number; durationHours: number }[];
  busy: { startHour: number; durationHours: number }[];
};

function intersectMany(sets: Interval[][]): Interval[] {
  if (sets.length === 0) return [];
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    acc = intersectTwo(acc, sets[i]);
    if (acc.length === 0) return [];
  }
  return acc;
}

function intersectTwo(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start.getTime(), b[j].start.getTime());
    const end = Math.min(a[i].end.getTime(), b[j].end.getTime());
    if (start < end) out.push({ start: new Date(start), end: new Date(end) });
    if (a[i].end.getTime() < b[j].end.getTime()) i++;
    else j++;
  }
  return out;
}

function unionMany(sets: Interval[][]): Interval[] {
  const all: Interval[] = sets.flat().sort((x, y) => x.start.getTime() - y.start.getTime());
  if (all.length === 0) return [];
  const merged: Interval[] = [{ ...all[0] }];
  for (let i = 1; i < all.length; i++) {
    const last = merged[merged.length - 1];
    if (all[i].start.getTime() <= last.end.getTime()) {
      if (all[i].end.getTime() > last.end.getTime()) last.end = all[i].end;
    } else {
      merged.push({ ...all[i] });
    }
  }
  return merged;
}

// Split an interval at zoned midnight boundaries so each piece lives on a single
// calendar day in `timezone`, then emit { dayKey, startHour, durationHours }
// rows that the WeekGrid can render directly.
function splitByZonedDay(
  interval: Interval,
  timezone: string,
): { dayKey: string; startHour: number; durationHours: number }[] {
  const out: { dayKey: string; startHour: number; durationHours: number }[] = [];
  let cursor = interval.start;
  while (cursor.getTime() < interval.end.getTime()) {
    const ymd = getZonedYMD(cursor, timezone);
    const nextDayUtc = nextLocalMidnightUtc(cursor, timezone);
    const segmentEnd = nextDayUtc.getTime() < interval.end.getTime() ? nextDayUtc : interval.end;
    const startHour = localHourFractional(cursor, timezone);
    const durationHours = (segmentEnd.getTime() - cursor.getTime()) / 3_600_000;
    if (durationHours > 0) {
      out.push({
        dayKey: `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`,
        startHour,
        durationHours,
      });
    }
    cursor = segmentEnd;
  }
  return out;
}

function localHourFractional(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return (get("hour") % 24) + get("minute") / 60 + get("second") / 3600;
}

function nextLocalMidnightUtc(after: Date, timezone: string): Date {
  // Find the local midnight of the day strictly after `after`.
  const ymd = getZonedYMD(after, timezone);
  // Walk forward day-by-day in local terms.
  const oneDay = 24 * 60 * 60 * 1000;
  for (let i = 1; i <= 2; i++) {
    const guessUtc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day) + i * oneDay);
    const guessYmd = getZonedYMD(guessUtc, timezone);
    const midnightFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = midnightFmt.formatToParts(guessUtc);
    const lp = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
    const offsetMs =
      Date.UTC(lp("year"), lp("month") - 1, lp("day"), lp("hour") % 24, lp("minute")) -
      guessUtc.getTime();
    const localMidnight = new Date(guessUtc.getTime() - offsetMs);
    if (localMidnight.getTime() > after.getTime()) return localMidnight;
    // Otherwise iterate (handles a day-boundary skew).
    void guessYmd;
  }
  return new Date(after.getTime() + oneDay);
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant")
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  const windowStart = new Date(body.weekStartIso);
  const windowEnd = new Date(body.weekEndIso);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
    return withCors(request, Response.json({ error: "Invalid window" }, { status: 400 }));
  }

  const userIds = Array.from(new Set(body.userIds));

  // Per-user: load availability inputs and compute busy/free.
  const perUser = await Promise.all(
    userIds.map(async (uid) => {
      const [settings, whRows, blocks, busyRaw] = await Promise.all([
        prisma.userAvailabilitySettings.findUnique({ where: { userId: uid } }),
        prisma.workingHoursDay.findMany({ where: { userId: uid } }),
        prisma.manualBlock.findMany({ where: { userId: uid }, take: 500 }),
        fetchBusyEvents(uid, windowStart, windowEnd).catch(() => [] as { start: string; end: string }[]),
      ]);

      // Multiple segments per dow are allowed — expand each persisted row as
      // its own working-hours entry. Days with no persisted rows fall back to
      // the Mon–Fri 9–5 default.
      const persistedDows = new Set(whRows.map((r) => r.dayOfWeek));
      const workingHours: WorkingHoursDayInput[] = [
        ...whRows.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          enabled: r.enabled,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
        ...defaultWorkingHours().filter((d) => !persistedDows.has(d.dayOfWeek)),
      ];

      const externalBusy: Interval[] = busyRaw.map((b) => ({
        start: new Date(b.start),
        end: new Date(b.end),
      }));

      const { free, busy } = computeFreeIntervals({
        windowStart,
        windowEnd,
        workingHours,
        manualBlocks: blocks.map((b) => ({
          startTime: b.startTime,
          endTime: b.endTime,
          recurrenceRule: b.recurrenceRule,
        })),
        externalBusy,
        bufferMin: settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN,
        timezone: settings?.timezone ?? body.timezone,
      });
      return { userId: uid, free, busy };
    }),
  );

  // Intersect all users' free intervals → match windows. Keep only those ≥ duration.
  const minDurationMs = body.durationMinutes * 60_000;
  const matches = intersectMany(perUser.map((u) => u.free)).filter(
    (iv) => iv.end.getTime() - iv.start.getTime() >= minDurationMs,
  );

  // Union all users' busy intervals → aggregate "someone is busy" overlay.
  const busyUnion = unionMany(perUser.map((u) => u.busy));

  // Bucket by day in the requesting user's timezone.
  const dayMap = new Map<string, DayBucket>();
  const ensureDay = (key: string, dayOfWeek: number, dayOfMonth: number): DayBucket => {
    const existing = dayMap.get(key);
    if (existing) return existing;
    const bucket: DayBucket = { dayOfWeek, dayOfMonth, matches: [], busy: [] };
    dayMap.set(key, bucket);
    return bucket;
  };

  for (const m of matches) {
    for (const piece of splitByZonedDay(m, body.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.matches.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }
  for (const b of busyUnion) {
    for (const piece of splitByZonedDay(b, body.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.busy.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }

  const days = Array.from(dayMap.entries())
    .map(([dayKey, bucket]) => ({ dayKey, ...bucket }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  // Per-user free intervals so the client can answer "who specifically is
  // available during the user-dragged window?" without a second round-trip.
  const perUserOut = perUser.map((u) => ({
    userId: u.userId,
    free: u.free.map((iv) => ({
      startIso: iv.start.toISOString(),
      endIso: iv.end.toISOString(),
    })),
  }));

  return withCors(request, Response.json({ days, perUser: perUserOut }));
}
