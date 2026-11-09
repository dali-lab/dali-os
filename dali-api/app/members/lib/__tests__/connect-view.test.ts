import { describe, expect, it } from "vitest";
import {
  classmatesAt,
  eventDateBlock,
  eventInputFromForm,
  eventWhenFull,
  eventWhenShort,
  eventsAtPlace,
  goingText,
  plural,
  shortYear,
  splitEventsByPlace,
  wallClockFields,
} from "../connect-view";

const NY = "America/New_York";
// 6:00 PM to 7:30 PM Eastern on Thu Nov 12 2026
const START = "2026-11-12T23:00:00.000Z";
const END = "2026-11-13T00:30:00.000Z";

describe("event formatting", () => {
  it("draws the date block in the viewer's zone", () => {
    expect(eventDateBlock(START, NY)).toEqual({ month: "NOV", day: "12" });
    expect(eventDateBlock(START, "Asia/Tokyo")).toEqual({ month: "NOV", day: "13" });
  });

  it("writes the short and full when lines", () => {
    const e = { startsAt: START, endsAt: END, online: false, lat: 1, lng: 1, location: "Cafe Nero" };
    expect(eventWhenShort(e, NY)).toBe("Thu 6:00 PM · Cafe Nero");
    expect(eventWhenFull(e, NY)).toBe("Thursday, Nov 12 · 6:00 PM to 7:30 PM");
  });

  it("says how many are going and how many you know", () => {
    expect(goingText({ goingCount: 0, knownGoingCount: 0 })).toBe("Be the first to go");
    expect(goingText({ goingCount: 12, knownGoingCount: 0 })).toBe("12 going");
    expect(goingText({ goingCount: 12, knownGoingCount: 3 })).toBe("12 going, 3 you know");
  });

  it("formats small helpers", () => {
    expect(plural(1, "person", "people")).toBe("1 person");
    expect(plural(2, "person", "people")).toBe("2 people");
    expect(shortYear(2019)).toBe("'19");
    expect(shortYear(null)).toBeNull();
  });
});

describe("event grouping", () => {
  const inPerson = { online: false, lat: 43.7, lng: -72.29, location: "Hanover" };
  const online = { online: true, lat: null, lng: null, location: "Online" };

  it("splits events on the map from online ones", () => {
    const split = splitEventsByPlace([inPerson, online, { ...inPerson, lat: null, lng: null }]);
    expect(split.onMap).toEqual([inPerson]);
    expect(split.online).toEqual([online]);
  });

  it("finds the events at a place pin", () => {
    expect(eventsAtPlace([inPerson, online], { key: "43.70,-72.29" })).toEqual([inPerson]);
    expect(eventsAtPlace([inPerson, online], { key: "40.00,-70.00" })).toEqual([]);
  });

  it("counts classmates at a place", () => {
    const place = { people: [{ classYear: 2020 }, { classYear: 2021 }, { classYear: 2020 }] };
    expect(classmatesAt(place, 2020)).toBe(2);
    expect(classmatesAt(place, null)).toBe(0);
  });
});

describe("host form", () => {
  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    const base = {
      title: "Mixer",
      description: "",
      date: "2026-11-12",
      startTime: "18:00",
      endTime: "19:30",
      mode: "inPerson",
      placeName: "Cafe Nero",
      address: "",
      meetingUrl: "",
      audience: "alumni",
      notifyNearby: "on",
      ...over,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    return fd;
  };

  it("turns wall-clock times in the viewer's zone into instants", () => {
    expect(eventInputFromForm(form(), NY)).toMatchObject({
      ok: true,
      input: { startsAt: START, endsAt: END, notifyNearby: true, audience: "alumni", mode: "inPerson" },
    });
  });

  it("treats an unchecked nearby switch as off", () => {
    expect(eventInputFromForm(form({ notifyNearby: "off" }), NY)).toMatchObject({ input: { notifyNearby: false } });
  });

  it("asks for a date and times when they are missing", () => {
    expect(eventInputFromForm(form({ date: "" }), NY)).toEqual({
      ok: false,
      error: "Pick a date and a start and end time.",
    });
    expect(eventInputFromForm(form({ endTime: "" }), NY).ok).toBe(false);
  });

  it("reads an instant back as form fields", () => {
    expect(wallClockFields(START, NY)).toEqual({ date: "2026-11-12", time: "18:00" });
  });
});
