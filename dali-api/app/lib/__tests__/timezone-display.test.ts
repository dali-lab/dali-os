import { describe, it, expect } from "vitest";
import {
  APPLICATION_TZ,
  resolveUserTimeZone,
  formatInTimeZone,
  formatDateTimeInZone,
  formatDateShortInZone,
  zonedDayLabel,
  formatZoneLabel,
  formatDualTime,
} from "~/lib/timezone";

// A winter (standard-time) instant and a summer (DST) instant. Both are safe
// probes because zone offsets differ predictably: Mar 5 2026 is before US DST
// (which begins Mar 8 2026), Jul 1 2026 is inside it.
const WINTER = new Date("2026-03-05T19:30:00Z"); // 2:30 PM EST / 11:30 AM PST
const SUMMER = new Date("2026-07-01T18:00:00Z"); // 2:00 PM EDT / 11:00 AM PDT

describe("resolveUserTimeZone", () => {
  it("falls back to the application zone for null/undefined", () => {
    expect(resolveUserTimeZone(null)).toBe(APPLICATION_TZ);
    expect(resolveUserTimeZone(undefined)).toBe(APPLICATION_TZ);
    expect(resolveUserTimeZone({ timeZone: null })).toBe(APPLICATION_TZ);
  });

  it("falls back to the application zone for an invalid IANA string", () => {
    expect(resolveUserTimeZone({ timeZone: "Not/AZone" })).toBe(APPLICATION_TZ);
    expect(resolveUserTimeZone({ timeZone: "" })).toBe(APPLICATION_TZ);
  });

  it("passes a valid zone through", () => {
    expect(resolveUserTimeZone({ timeZone: "America/Los_Angeles" })).toBe(
      "America/Los_Angeles",
    );
  });
});

describe("formatInTimeZone (hydration determinism)", () => {
  // The output is a pure function of (instant, zone) because the zone is
  // explicit — it never consults the runtime's local zone. This is what keeps
  // the UTC server and the browser client producing identical strings.
  it("renders the same instant differently per explicit zone", () => {
    expect(
      formatInTimeZone(WINTER, "America/New_York", { hour: "numeric", minute: "2-digit" }),
    ).toBe("2:30 PM");
    expect(
      formatInTimeZone(WINTER, "America/Los_Angeles", { hour: "numeric", minute: "2-digit" }),
    ).toBe("11:30 AM");
  });

  it("is DST-correct for summer instants", () => {
    expect(
      formatInTimeZone(SUMMER, "America/New_York", { hour: "numeric", minute: "2-digit" }),
    ).toBe("2:00 PM");
    expect(
      formatInTimeZone(SUMMER, "America/Los_Angeles", { hour: "numeric", minute: "2-digit" }),
    ).toBe("11:00 AM");
  });
});

describe("formatDateTimeInZone / formatDateShortInZone", () => {
  it("formats a full date-time in the given zone", () => {
    expect(formatDateTimeInZone(WINTER, "America/New_York")).toBe("Mar 5, 2026 at 2:30 PM");
    expect(formatDateTimeInZone(WINTER, "America/Los_Angeles")).toBe(
      "Mar 5, 2026 at 11:30 AM",
    );
  });

  it("formats a short date in the given zone", () => {
    expect(formatDateShortInZone(WINTER, "America/New_York")).toBe("Mar 5, 2026");
    // Tokyo is +9, so this UTC instant lands on Mar 6 there.
    expect(formatDateShortInZone(WINTER, "Asia/Tokyo")).toBe("Mar 6, 2026");
  });
});

describe("zonedDayLabel", () => {
  const now = new Date("2026-03-06T12:00:00Z");

  it("labels the same zoned day as Today", () => {
    expect(zonedDayLabel(now, now, "America/New_York")).toBe("Today");
  });

  it("computes the day boundary in the target zone, not the host zone", () => {
    // 2026-03-06T02:00Z is Mar 5 21:00 in New York but Mar 6 11:00 in Tokyo.
    const instant = new Date("2026-03-06T02:00:00Z");
    expect(zonedDayLabel(instant, now, "America/New_York")).toBe("Yesterday");
    expect(zonedDayLabel(instant, now, "Asia/Tokyo")).toBe("Today");
  });

  it("falls back to a formatted date beyond yesterday", () => {
    const old = new Date("2026-02-01T12:00:00Z");
    expect(zonedDayLabel(old, now, "America/New_York")).toBe("February 1");
  });
});

describe("formatZoneLabel", () => {
  it("includes the city and a UTC offset", () => {
    const label = formatZoneLabel("America/Los_Angeles");
    expect(label).toContain("Los Angeles");
    expect(label).toMatch(/UTC[+-]\d/);
  });

  it("returns the raw value for an invalid zone", () => {
    expect(formatZoneLabel("garbage")).toBe("garbage");
    expect(formatZoneLabel(null)).toBe("");
  });
});

describe("formatDualTime", () => {
  it("shows the anchor plus the viewer's local time when they differ", () => {
    expect(formatDualTime(SUMMER, "America/Los_Angeles", "America/New_York")).toBe(
      "2:00 PM EDT · 11:00 AM your time (PDT)",
    );
  });

  it("collapses to the anchor alone when the viewer zone matches or is unknown", () => {
    expect(formatDualTime(SUMMER, "America/New_York", "America/New_York")).toBe("2:00 PM EDT");
    expect(formatDualTime(SUMMER, null, "America/New_York")).toBe("2:00 PM EDT");
    expect(formatDualTime(SUMMER, "garbage", "America/New_York")).toBe("2:00 PM EDT");
  });
});
