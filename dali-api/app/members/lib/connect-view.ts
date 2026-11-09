import { getZonedParts, formatInTimeZone, zonedDateTimeLocalToUtc } from "~/lib/timezone";
import { placeKey, type ConnectPlace } from "~/members/lib/connect";

type Timed = { startsAt: string; endsAt: string };
type Placed = { online: boolean; lat: number | null; lng: number | null; location: string };

export function eventDateBlock(startsAt: string, tz: string): { month: string; day: string } {
  return {
    month: formatInTimeZone(startsAt, tz, { month: "short" }).toUpperCase(),
    day: formatInTimeZone(startsAt, tz, { day: "numeric" }),
  };
}

const time = (iso: string, tz: string) =>
  formatInTimeZone(iso, tz, { hour: "numeric", minute: "2-digit" });

/** "Thu 6:00 PM · Cafe Nero" */
export function eventWhenShort(e: Timed & Placed, tz: string): string {
  const day = formatInTimeZone(e.startsAt, tz, { weekday: "short" });
  return `${day} ${time(e.startsAt, tz)} · ${e.location}`;
}

/** "Thursday, Nov 12 · 6:00 PM to 7:30 PM" */
export function eventWhenFull(e: Timed, tz: string): string {
  const day = formatInTimeZone(e.startsAt, tz, { weekday: "long", month: "short", day: "numeric" });
  return `${day} · ${time(e.startsAt, tz)} to ${time(e.endsAt, tz)}`;
}

export function goingText(e: { goingCount: number; knownGoingCount: number }): string {
  if (e.goingCount === 0) return "Be the first to go";
  return e.knownGoingCount > 0
    ? `${e.goingCount} going, ${e.knownGoingCount} you know`
    : `${e.goingCount} going`;
}

export function splitEventsByPlace<T extends Placed>(events: readonly T[]): { onMap: T[]; online: T[] } {
  return {
    onMap: events.filter((e) => !e.online && e.lat != null && e.lng != null),
    online: events.filter((e) => e.online),
  };
}

export function eventsAtPlace<T extends Placed>(events: readonly T[], place: Pick<ConnectPlace, "key">): T[] {
  return events.filter(
    (e) => !e.online && e.lat != null && e.lng != null && placeKey({ lat: e.lat, lng: e.lng }) === place.key,
  );
}

export function classmatesAt(
  place: { people: readonly { classYear: number | null }[] },
  classYear: number | null,
): number {
  return classYear == null ? 0 : place.people.filter((p) => p.classYear === classYear).length;
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function shortYear(year: number | null): string | null {
  return year == null ? null : `'${String(year).slice(2)}`;
}

/** Form values for a date and 24h time, read back in the viewer's zone. */
export function wallClockFields(iso: string, tz: string): { date: string; time: string } {
  const p = getZonedParts(new Date(iso), tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${two(p.month)}-${two(p.day)}`, time: `${two(p.hour)}:${two(p.minute)}` };
}

export type EventFormResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; error: string };

/** Reads the host form into the shape createEvent/updateEvent take; the date and times are the viewer's wall clock. */
export function eventInputFromForm(form: FormData, tz: string): EventFormResult {
  const text = (k: string) => String(form.get(k) ?? "");
  const date = text("date");
  const startsAt = zonedDateTimeLocalToUtc(`${date}T${text("startTime")}`, tz);
  const endsAt = zonedDateTimeLocalToUtc(`${date}T${text("endTime")}`, tz);
  if (!date || !text("startTime") || !text("endTime") || !startsAt || !endsAt) {
    return { ok: false, error: "Pick a date and a start and end time." };
  }
  return {
    ok: true,
    input: {
      title: text("title"),
      description: text("description"),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      mode: text("mode"),
      placeName: text("placeName"),
      address: text("address"),
      meetingUrl: text("meetingUrl"),
      audience: text("audience"),
      notifyNearby: text("notifyNearby") === "on",
    },
  };
}
