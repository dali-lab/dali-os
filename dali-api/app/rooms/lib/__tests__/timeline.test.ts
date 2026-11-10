import { describe, expect, it } from "vitest";
import {
  atTime,
  bookingAccess,
  dayKey,
  hhmm,
  nextBookableSlot,
  notInPast,
  overlapLanes,
  slotForClick,
  type ScheduleItem,
} from "~/rooms/lib/timeline";

const DAY = "2026-11-04";
const t = (time: string, key = DAY) => atTime(key, time);

function item(start: string, end: string, over: Partial<ScheduleItem> = {}): ScheduleItem {
  const s = t(start).toISOString();
  return {
    kind: "booking",
    id: `${start}-${end}`,
    title: "Crit",
    start: s,
    end: t(end).toISOString(),
    occurrenceStart: s,
    recurring: false,
    organizer: { id: "ada", firstName: "Ada", lastName: "Lovelace" },
    isEvent: false,
    source: "Web",
    bookedTitle: "Crit",
    fromCalendarEvent: false,
    ...over,
  };
}

const times = (slot: { start: Date; end: Date }) => [hhmm(slot.start), hhmm(slot.end)];

describe("notInPast", () => {
  it("keeps a future start", () => {
    expect(notInPast(t("15:00"), t("14:10"))).toEqual(t("15:00"));
  });

  it("moves a past start to the next five-minute mark", () => {
    expect(hhmm(notInPast(t("14:00"), t("14:12")))).toBe("14:15");
  });
});

describe("slotForClick", () => {
  const before = t("08:00");

  it("proposes an hour when the room is free", () => {
    expect(times(slotForClick(t("10:00"), [], before))).toEqual(["10:00", "11:00"]);
  });

  it("stops short of the next booking", () => {
    expect(times(slotForClick(t("09:30"), [item("10:00", "11:00")], before))).toEqual(["09:30", "10:00"]);
  });

  it("starts when a booking still running in the slot ends", () => {
    expect(times(slotForClick(t("09:00"), [item("08:30", "09:20")], before))).toEqual(["09:20", "10:20"]);
  });

  it("follows back-to-back bookings to the first gap", () => {
    const items = [item("10:00", "10:30"), item("09:00", "10:00"), item("11:00", "12:00")];
    expect(times(slotForClick(t("09:00"), items, before))).toEqual(["10:30", "11:00"]);
  });

  it("starts now-ish when the slot is already under way", () => {
    expect(times(slotForClick(t("14:00"), [], t("14:12")))).toEqual(["14:15", "15:15"]);
  });
});

describe("nextBookableSlot", () => {
  it("opens the next half hour today", () => {
    const slot = nextBookableSlot(DAY, t("14:10"));
    expect(slot.date).toBe(DAY);
    expect(times(slot)).toEqual(["14:30", "15:30"]);
  });

  it("rolls an hour boundary over cleanly", () => {
    expect(times(nextBookableSlot(DAY, t("14:40")))).toEqual(["15:00", "16:00"]);
  });

  it("opens 9 AM on a future day", () => {
    const slot = nextBookableSlot("2026-11-09", t("14:10"));
    expect(slot.date).toBe("2026-11-09");
    expect(times(slot)).toEqual(["09:00", "10:00"]);
  });

  it("opens on today from a past day, where nothing can be booked", () => {
    const slot = nextBookableSlot("2026-11-01", t("14:10"));
    expect(slot.date).toBe(DAY);
    expect(times(slot)).toEqual(["14:30", "15:30"]);
  });

  it.each(["22:40", "23:10", "23:40"])("opens tomorrow morning at %s, when today has run out", (time) => {
    const slot = nextBookableSlot(DAY, t(time));
    expect(slot.date).toBe("2026-11-05");
    expect(times(slot)).toEqual(["09:00", "10:00"]);
  });

  it("never proposes an end before its start", () => {
    for (let h = 0; h < 24; h++) {
      const slot = nextBookableSlot(DAY, t(`${h}:31`));
      expect(slot.start.getTime()).toBeLessThan(slot.end.getTime());
      expect(dayKey(slot.start)).toBe(dayKey(slot.end));
    }
  });
});

describe("overlapLanes", () => {
  const spans = (...pairs: [string, string][]) => pairs.map(([s, e]) => item(s, e));

  it("gives every lone item a full-width lane", () => {
    expect(overlapLanes(spans(["09:00", "10:00"], ["10:00", "11:00"]))).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("sets an interview beside its hold", () => {
    expect(overlapLanes(spans(["10:00", "10:30"], ["09:00", "12:00"]))).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });

  it("reuses a lane once it frees, so a hold's interviews stack in one column", () => {
    const out = overlapLanes(spans(["09:00", "12:00"], ["09:00", "09:30"], ["09:30", "10:00"], ["10:00", "10:30"]));
    expect(out.map((l) => l.lane)).toEqual([0, 1, 1, 1]);
    expect(out.every((l) => l.lanes === 2)).toBe(true);
  });

  it("puts the longer of two that start together first", () => {
    expect(overlapLanes(spans(["09:00", "09:30"], ["09:00", "12:00"])).map((l) => l.lane)).toEqual([1, 0]);
  });

  it("treats clusters apart in the day separately", () => {
    const out = overlapLanes(spans(["09:00", "10:00"], ["09:30", "10:30"], ["13:00", "14:00"]));
    expect(out.map((l) => l.lanes)).toEqual([2, 2, 1]);
  });

  it("handles an empty day", () => {
    expect(overlapLanes([])).toEqual([]);
  });
});

describe("bookingAccess", () => {
  const now = t("08:00");
  const me = { userId: "ada", core: false };
  const stranger = { userId: "grace", core: false };
  const core = { userId: "grace", core: true };

  it("lets the booker edit and cancel", () => {
    expect(bookingAccess(item("10:00", "11:00"), me, now)).toMatchObject({ canEdit: true, canCancel: true });
  });

  it("gives other members nothing but the details", () => {
    expect(bookingAccess(item("10:00", "11:00"), stranger, now)).toEqual({
      canEdit: false,
      canCancel: false,
      calendarHref: null,
      note: null,
    });
  });

  it("gives Core the same control over anyone's booking", () => {
    expect(bookingAccess(item("10:00", "11:00"), core, now)).toMatchObject({ canEdit: true, canCancel: true });
  });

  it("closes a booking once it has ended, even for Core", () => {
    expect(bookingAccess(item("06:00", "07:00"), core, now)).toMatchObject({ canEdit: false, canCancel: false });
  });

  it("keeps an underway booking open", () => {
    expect(bookingAccess(item("07:00", "09:00"), me, now)).toMatchObject({ canEdit: true, canCancel: true });
  });

  it("opens a meeting on its own occurrence", () => {
    const meeting = item("10:00", "11:00", { kind: "meeting", id: "m1", source: null });
    const access = bookingAccess(meeting, core, now);
    expect(access.calendarHref).toBe(
      `/calendar/meeting/m1?occurrence=${encodeURIComponent(meeting.occurrenceStart)}`,
    );
    expect(access).toMatchObject({ canEdit: false, canCancel: false });
  });

  it.each(["Interview", "InterviewHold"] as const)("leaves a %s to hiring, even for Core", (source) => {
    expect(bookingAccess(item("10:00", "11:00", { source }), core, now)).toEqual({
      canEdit: false,
      canCancel: false,
      calendarHref: null,
      note: "Managed by hiring. Change it from the cycle page.",
    });
  });

  describe("a calendar event's hold", () => {
    const hold = item("10:00", "11:00", { fromCalendarEvent: true });

    it("sends the booker to that day in the calendar", () => {
      expect(bookingAccess(hold, me, now)).toEqual({
        canEdit: false,
        canCancel: false,
        calendarHref: `/calendar?view=day&anchor=${DAY}`,
        note: "Booked from a calendar event.",
      });
    });

    it("shows another member only where it came from", () => {
      expect(bookingAccess(hold, stranger, now)).toMatchObject({ canCancel: false, calendarHref: null });
    });

    it("lets Core free the room, and says the event stays", () => {
      expect(bookingAccess(hold, core, now)).toEqual({
        canEdit: false,
        canCancel: true,
        calendarHref: null,
        note: "Booked from a calendar event. Cancelling frees the room but leaves the event.",
      });
    });
  });
});
