import { describe, it, expect } from "vitest";
import { buildHiringEventIcs } from "../hiring-event-ics";

const BASE = {
  eventId: "event-1",
  summary: "DALI Application Help Hour",
  startTime: new Date("2026-10-14T20:00:00Z"),
  endTime: new Date("2026-10-14T21:00:00Z"),
  location: "DALI Lab, Sudikoff",
  organizer: { email: "applications@dali.dartmouth.edu", name: "DALI Lab" },
  attendee: { email: "alex@dartmouth.edu", name: "Alex" },
};

describe("buildHiringEventIcs", () => {
  it("derives a stable UID from the event id", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics).toContain("UID:hiring-event-event-1@dali.dartmouth.edu");
  });

  it("emits METHOD:REQUEST and STATUS:CONFIRMED", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("always sends SEQUENCE:0 (no revisions tracked)", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics).toMatch(/^SEQUENCE:0$/m);
  });

  it("includes only the one recipient as attendee", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics.match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(ics).toContain("mailto:alex@dartmouth.edu");
  });

  it("includes the organizer", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics).toContain("ORGANIZER;CN=DALI Lab:mailto:applications@dali.dartmouth.edu");
  });

  it("includes the location", () => {
    const ics = buildHiringEventIcs(BASE);
    expect(ics).toContain("LOCATION:DALI Lab\\, Sudikoff");
  });
});
