import { describe, it, expect } from "vitest";
import { sortAttendees, type SortableAttendee } from "~/lib/attendee-sort";

const roster: SortableAttendee[] = [
  { name: "Riley Chen", present: false, markedAt: null },
  { name: "ana delgado", present: true, markedAt: "2026-09-10T15:00:00.000Z" },
  { name: "Bo Nguyen", present: true, markedAt: "2026-09-10T17:00:00.000Z" },
];

const names = (rows: SortableAttendee[]) => rows.map((r) => r.name);

describe("sortAttendees", () => {
  it("sorts by name without letting case decide the order", () => {
    expect(names(sortAttendees(roster, "name-asc"))).toEqual([
      "ana delgado",
      "Bo Nguyen",
      "Riley Chen",
    ]);
  });

  it("reverses for name-desc", () => {
    expect(names(sortAttendees(roster, "name-desc"))).toEqual([
      "Riley Chen",
      "Bo Nguyen",
      "ana delgado",
    ]);
  });

  it("puts checked-in people first, then falls back to name", () => {
    expect(names(sortAttendees(roster, "status"))).toEqual([
      "ana delgado",
      "Bo Nguyen",
      "Riley Chen",
    ]);
  });

  it("orders by most recently marked and sinks never-marked rows", () => {
    expect(names(sortAttendees(roster, "marked-desc"))).toEqual([
      "Bo Nguyen",
      "ana delgado",
      "Riley Chen",
    ]);
  });

  it("leaves the caller's array alone", () => {
    const before = names(roster);
    sortAttendees(roster, "name-desc");
    expect(names(roster)).toEqual(before);
  });
});
