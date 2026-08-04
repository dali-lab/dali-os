import { describe, it, expect } from "vitest";
import {
  isNewMember,
  isBirthdayToday,
  formatBirthdayMonthDay,
  birthdaysThisWeek,
} from "./warmth";

// Anchor: 2026-08-05 (Wednesday)
const NOW = new Date("2026-08-05T12:00:00Z");

// ----------------------------------------------------------------
// isNewMember
// ----------------------------------------------------------------

describe("isNewMember", () => {
  it("is true when onboardedAt is within 30 days", () => {
    const onboardedAt = new Date(NOW.getTime() - 29 * 86_400_000);
    expect(isNewMember({ onboardedAt, createdAt: new Date(0) }, NOW)).toBe(true);
  });

  it("is false when onboardedAt is exactly 30 days ago", () => {
    const onboardedAt = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(isNewMember({ onboardedAt, createdAt: new Date(0) }, NOW)).toBe(false);
  });

  it("falls back to createdAt when onboardedAt is null", () => {
    const createdAt = new Date(NOW.getTime() - 10 * 86_400_000);
    expect(isNewMember({ onboardedAt: null, createdAt }, NOW)).toBe(true);
  });

  it("uses onboardedAt over createdAt when both are present", () => {
    // createdAt is old but onboardedAt is recent
    const onboardedAt = new Date(NOW.getTime() - 5 * 86_400_000);
    const createdAt = new Date(NOW.getTime() - 60 * 86_400_000);
    expect(isNewMember({ onboardedAt, createdAt }, NOW)).toBe(true);
  });

  it("is false when createdAt is more than 30 days ago and onboardedAt is null", () => {
    const createdAt = new Date(NOW.getTime() - 31 * 86_400_000);
    expect(isNewMember({ onboardedAt: null, createdAt }, NOW)).toBe(false);
  });
});

// ----------------------------------------------------------------
// isBirthdayToday
// ----------------------------------------------------------------

describe("isBirthdayToday", () => {
  it("is true when birthday month+day matches now", () => {
    const birthday = new Date("2000-08-05T00:00:00Z");
    expect(isBirthdayToday(birthday, NOW)).toBe(true);
  });

  it("is false when the month differs", () => {
    const birthday = new Date("2000-07-05T00:00:00Z");
    expect(isBirthdayToday(birthday, NOW)).toBe(false);
  });

  it("is false when the day differs", () => {
    const birthday = new Date("2000-08-06T00:00:00Z");
    expect(isBirthdayToday(birthday, NOW)).toBe(false);
  });

  it("is false for null birthday", () => {
    expect(isBirthdayToday(null, NOW)).toBe(false);
  });

  it("ignores birth year", () => {
    const birthday = new Date("1999-08-05T00:00:00Z");
    expect(isBirthdayToday(birthday, NOW)).toBe(true);
  });
});

// ----------------------------------------------------------------
// formatBirthdayMonthDay
// ----------------------------------------------------------------

describe("formatBirthdayMonthDay", () => {
  it("formats as 'Month Day' with no year", () => {
    const birthday = new Date("2000-03-12T00:00:00Z");
    expect(formatBirthdayMonthDay(birthday)).toBe("Mar 12");
  });

  it("formats a January birthday correctly", () => {
    const birthday = new Date("1998-01-01T00:00:00Z");
    expect(formatBirthdayMonthDay(birthday)).toBe("Jan 1");
  });

  it("formats a December birthday correctly", () => {
    const birthday = new Date("2001-12-31T00:00:00Z");
    expect(formatBirthdayMonthDay(birthday)).toBe("Dec 31");
  });
});

// ----------------------------------------------------------------
// birthdaysThisWeek
// ----------------------------------------------------------------

type Member = { id: string; birthday: Date | null };

function m(id: string, birthday: Date | null): Member {
  return { id, birthday };
}

describe("birthdaysThisWeek", () => {
  // NOW is 2026-08-05 (Wednesday). Week runs Sun Aug 2 – Sat Aug 8.

  it("includes a member whose birthday is today (Wednesday)", () => {
    const members = [m("a", new Date("1995-08-05T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW).map((x) => x.id)).toEqual(["a"]);
  });

  it("includes a member whose birthday is Sunday (start of week)", () => {
    const members = [m("a", new Date("1990-08-02T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW).map((x) => x.id)).toEqual(["a"]);
  });

  it("includes a member whose birthday is Saturday (end of week)", () => {
    const members = [m("a", new Date("2000-08-08T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW).map((x) => x.id)).toEqual(["a"]);
  });

  it("excludes a member whose birthday is next Sunday", () => {
    const members = [m("a", new Date("1997-08-09T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW)).toHaveLength(0);
  });

  it("excludes a member whose birthday is last Saturday", () => {
    const members = [m("a", new Date("1997-08-01T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW)).toHaveLength(0);
  });

  it("excludes a member with null birthday", () => {
    expect(birthdaysThisWeek([m("a", null)], NOW)).toHaveLength(0);
  });

  it("handles a week that straddles a month boundary", () => {
    // NOW = 2026-08-31 (Monday). Week: Sun Aug 30 – Sat Sep 5.
    const nowBoundary = new Date("2026-08-31T12:00:00Z");
    const members = [
      m("aug30", new Date("2000-08-30T00:00:00Z")),
      m("aug31", new Date("2001-08-31T00:00:00Z")),
      m("sep1", new Date("2002-09-01T00:00:00Z")),
      m("sep5", new Date("2003-09-05T00:00:00Z")),
      m("sep6", new Date("2003-09-06T00:00:00Z")), // next week
      m("aug29", new Date("1999-08-29T00:00:00Z")), // last week
    ];
    const ids = birthdaysThisWeek(members, nowBoundary).map((x) => x.id);
    expect(ids).toContain("aug30");
    expect(ids).toContain("aug31");
    expect(ids).toContain("sep1");
    expect(ids).toContain("sep5");
    expect(ids).not.toContain("sep6");
    expect(ids).not.toContain("aug29");
  });

  it("matches year-agnostically (birth year does not matter)", () => {
    const members = [m("old", new Date("1940-08-03T00:00:00Z"))];
    expect(birthdaysThisWeek(members, NOW).map((x) => x.id)).toEqual(["old"]);
  });
});
