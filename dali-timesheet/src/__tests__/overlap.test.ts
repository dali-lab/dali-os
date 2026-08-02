import { describe, it, expect } from "vitest";
import {
  parseClockLabel,
  savedRowRange,
  overlaps,
  conflictsWithSaved,
  totalHours,
  formatHours,
} from "../overlap";

const at = (h: number, m = 0): number => h * 60 + m;

describe("parseClockLabel", () => {
  it("handles the noon/midnight edges", () => {
    // The two cases a naive `h + 12` gets wrong.
    expect(parseClockLabel("12:00 AM")).toBe(0);
    expect(parseClockLabel("12:30 AM")).toBe(30);
    expect(parseClockLabel("12:00 PM")).toBe(at(12));
    expect(parseClockLabel("12:45 PM")).toBe(at(12, 45));
  });

  it("converts ordinary times", () => {
    expect(parseClockLabel("9:00 AM")).toBe(at(9));
    expect(parseClockLabel("1:15 PM")).toBe(at(13, 15));
    expect(parseClockLabel("11:59 PM")).toBe(at(23, 59));
  });

  it("is case- and spacing-insensitive", () => {
    expect(parseClockLabel("9:05am")).toBe(at(9, 5));
    expect(parseClockLabel("9:05   Am")).toBe(at(9, 5));
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseClockLabel("no time here")).toBeNull();
    expect(parseClockLabel("13:00 PM")).toBeNull();
    expect(parseClockLabel("0:30 AM")).toBeNull();
    expect(parseClockLabel("9:75 AM")).toBeNull();
  });
});

describe("savedRowRange", () => {
  it("reads the first two times out of a JobX row", () => {
    const row = "reg hours monday, july 27, 2026 9:00 am 11:00 am 2.00";
    expect(savedRowRange(row)).toEqual([at(9), at(11)]);
  });

  it("returns null when the row states fewer than two times", () => {
    expect(savedRowRange("reg hours monday, july 27, 2026 9:00 am")).toBeNull();
    expect(savedRowRange("reg hours monday, july 27, 2026")).toBeNull();
  });
});

describe("overlaps", () => {
  it("treats back-to-back blocks as separate", () => {
    // 9–11 and 11–1 are two sessions, not a conflict. Getting this wrong makes
    // every adjacent pair look like an override.
    expect(overlaps([at(9), at(11)], [at(11), at(13)])).toBe(false);
    expect(overlaps([at(11), at(13)], [at(9), at(11)])).toBe(false);
  });

  it("catches real collisions in either order", () => {
    expect(overlaps([at(9), at(12)], [at(11), at(13)])).toBe(true);
    expect(overlaps([at(11), at(13)], [at(9), at(12)])).toBe(true);
  });

  it("catches containment", () => {
    expect(overlaps([at(9), at(17)], [at(12), at(13)])).toBe(true);
    expect(overlaps([at(12), at(13)], [at(9), at(17)])).toBe(true);
  });

  it("treats an identical range as overlapping", () => {
    expect(overlaps([at(9), at(11)], [at(9), at(11)])).toBe(true);
  });
});

describe("conflictsWithSaved", () => {
  const morning = "reg hours monday, july 27, 2026 9:00 am 11:00 am 2.00";

  it("does NOT conflict for a second session later the same day", () => {
    // The reported bug: an afternoon block was treated as overriding the
    // morning one purely because they shared a date, and filling wiped it.
    expect(conflictsWithSaved([at(14), at(16)], [morning])).toBe(false);
  });

  it("conflicts when the hours actually overlap", () => {
    expect(conflictsWithSaved([at(10), at(12)], [morning])).toBe(true);
  });

  it("checks every saved row on the day, not just the first", () => {
    // The second half of the bug: with two sessions already saved, a third
    // entry has to be compared against both.
    const afternoon = "reg hours monday, july 27, 2026 2:00 pm 4:00 pm 2.00";
    expect(conflictsWithSaved([at(15), at(17)], [morning, afternoon])).toBe(true);
    expect(conflictsWithSaved([at(12), at(13)], [morning, afternoon])).toBe(false);
  });

  it("treats an unreadable saved row as a conflict", () => {
    // Better to ask the member to look than to silently double-log hours.
    expect(conflictsWithSaved([at(9), at(11)], ["reg hours monday, july 27, 2026"])).toBe(true);
  });

  it("is clear when nothing is saved", () => {
    expect(conflictsWithSaved([at(9), at(11)], [])).toBe(false);
  });
});

describe("totalHours / formatHours", () => {
  it("sums ranges", () => {
    expect(totalHours([[at(9), at(11)], [at(14), at(16, 30)]])).toBe(4.5);
    expect(totalHours([])).toBe(0);
  });

  it("ignores inverted ranges rather than subtracting", () => {
    expect(totalHours([[at(11), at(9)]])).toBe(0);
  });

  it("formats compactly", () => {
    expect(formatHours(0)).toBe("0m");
    expect(formatHours(0.75)).toBe("45m");
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(7.5)).toBe("7h 30m");
  });

  it("rounds to the nearest minute instead of leaking float noise", () => {
    expect(formatHours(1 / 3)).toBe("20m");
  });
});
