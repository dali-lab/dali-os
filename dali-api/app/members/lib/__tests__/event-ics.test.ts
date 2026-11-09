import { describe, expect, it } from "vitest";
import { buildEventIcs } from "../event-ics";

const NOW = new Date("2026-11-09T12:00:00Z");
const base = {
  id: "ev1",
  title: "Alumni mixer",
  startsAt: "2026-12-04T23:00:00Z",
  endsAt: "2026-12-05T01:00:00Z",
};

describe("buildEventIcs", () => {
  it("writes one event with UTC times and a stable uid", () => {
    const ics = buildEventIcs(base, NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:ev1@connect.dali-os\r\n");
    expect(ics).toContain("DTSTAMP:20261109T120000Z\r\n");
    expect(ics).toContain("DTSTART:20261204T230000Z\r\n");
    expect(ics).toContain("DTEND:20261205T010000Z\r\n");
    expect(ics).toContain("SUMMARY:Alumni mixer\r\n");
    expect(ics).not.toContain("LOCATION");
    expect(ics).not.toContain("DESCRIPTION");
  });

  it("escapes commas, semicolons and newlines in text", () => {
    const ics = buildEventIcs({ ...base, title: "A, B; C", description: "Line one\nLine two", location: "Cafe, Boston" }, NOW);
    expect(ics).toContain("SUMMARY:A\\, B\; C");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("LOCATION:Cafe\\, Boston");
  });

  it("includes the link for online events", () => {
    expect(buildEventIcs({ ...base, url: "https://meet.example.edu/x" }, NOW)).toContain("URL:https://meet.example.edu/x\r\n");
  });

  it("folds lines longer than 75 octets", () => {
    const ics = buildEventIcs({ ...base, description: "x".repeat(200) }, NOW);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain(`DESCRIPTION:${"x".repeat(200)}`);
  });
});
