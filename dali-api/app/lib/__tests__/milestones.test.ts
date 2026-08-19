import { describe, it, expect } from "vitest";
import {
  coerceEntries,
  entriesToMarkers,
  weekCountFor,
  DEFAULT_WEEK_COUNT,
  type MilestoneEntry,
} from "~/lib/milestones";

const DAY = 86_400_000;

describe("coerceEntries", () => {
  it("keeps valid entries and normalizes types", () => {
    const out = coerceEntries([
      { id: "a", weekIndex: 2, name: "Kickoff", detail: "d", labWide: true },
      { id: "b", weekIndex: "3", name: "X", detail: "", labWide: false },
    ]);
    expect(out).toEqual([
      { id: "a", weekIndex: 2, name: "Kickoff", detail: "d", labWide: true },
      { id: "b", weekIndex: 3, name: "X", detail: "", labWide: false },
    ]);
  });

  it("drops non-objects and entries without a usable week index", () => {
    expect(coerceEntries("nope")).toEqual([]);
    expect(coerceEntries([null, 5, { weekIndex: -1 }, { weekIndex: "x" }])).toEqual([]);
  });

  it("synthesizes a stable id when one is missing", () => {
    const out = coerceEntries([{ weekIndex: 0, name: "n" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m-0-0");
    expect(out[0].labWide).toBe(false);
  });
});

describe("entriesToMarkers", () => {
  const termStart = "2026-03-30T00:00:00.000Z";
  const entries: MilestoneEntry[] = [
    { id: "k", weekIndex: 0, name: "Kickoff", detail: "", labWide: false },
    { id: "t", weekIndex: 9, name: "Technigala", detail: "demo", labWide: true },
  ];

  it("maps weekIndex to termStart + week·7 days", () => {
    const markers = entriesToMarkers(entries, termStart);
    expect(markers[0].dateIso).toBe(termStart);
    expect(Date.parse(markers[1].dateIso)).toBe(Date.parse(termStart) + 9 * 7 * DAY);
  });

  it("labWideOnly keeps only lab-wide entries", () => {
    const markers = entriesToMarkers(entries, termStart, { labWideOnly: true });
    expect(markers).toHaveLength(1);
    expect(markers[0].name).toBe("Technigala");
  });

  it("applies a key prefix and returns [] for an invalid term start", () => {
    expect(entriesToMarkers(entries, termStart, { keyPrefix: "lab-" })[0].id).toBe("lab-k");
    expect(entriesToMarkers(entries, "not-a-date")).toEqual([]);
  });
});

describe("weekCountFor", () => {
  it("never falls below the standard term length", () => {
    expect(weekCountFor([])).toBe(DEFAULT_WEEK_COUNT);
  });

  it("grows to fit an entry past the standard term", () => {
    expect(
      weekCountFor([{ id: "x", weekIndex: 12, name: "n", detail: "", labWide: false }]),
    ).toBe(13);
  });
});
