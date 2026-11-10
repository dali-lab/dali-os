import { describe, it, expect } from "vitest";
import { buildIcs } from "~/lib/ics";

const base = {
  uid: "meeting-1@example.edu",
  method: "REQUEST" as const,
  summary: "Team sync",
  startTime: new Date("2026-10-27T00:30:00Z"), // Mon Oct 26, 8:30 PM EDT
  endTime: new Date("2026-10-27T01:30:00Z"),
  organizer: { email: "ada@example.edu", name: "Ada" },
  attendees: [{ email: "grace@example.edu" }],
  sequence: 0,
};

const lines = (ics: string) => ics.split("\r\n");

describe("buildIcs", () => {
  it("keeps a one-off event in UTC with no time zone block", () => {
    const out = lines(buildIcs(base));
    expect(out).toContain("DTSTART:20261027T003000Z");
    expect(out).toContain("DTEND:20261027T013000Z");
    expect(out).not.toContain("BEGIN:VTIMEZONE");
  });

  it("anchors a repeating event to the Eastern wall clock", () => {
    const out = lines(buildIcs({ ...base, recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" }));
    expect(out).toContain("DTSTART;TZID=America/New_York:20261026T203000");
    expect(out).toContain("DTEND;TZID=America/New_York:20261026T213000");
    expect(out).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(out.some((l) => l.startsWith("DTSTART:202"))).toBe(false);
  });

  it("defines the zone it references, before the event", () => {
    const out = lines(buildIcs({ ...base, recurrenceRule: "RRULE:FREQ=WEEKLY" }));
    const zone = out.indexOf("BEGIN:VTIMEZONE");
    expect(zone).toBeGreaterThan(-1);
    expect(zone).toBeLessThan(out.indexOf("BEGIN:VEVENT"));
    expect(out).toContain("TZID:America/New_York");
    expect(out).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(out).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(out.filter((l) => l.startsWith("RRULE:FREQ=WEEKLY"))).toHaveLength(1);
  });

  it("uses the same anchor when cancelling a series", () => {
    const out = lines(
      buildIcs({ ...base, method: "CANCEL", sequence: 1, recurrenceRule: "FREQ=WEEKLY" }),
    );
    expect(out).toContain("DTSTART;TZID=America/New_York:20261026T203000");
    expect(out).toContain("STATUS:CANCELLED");
  });
});
