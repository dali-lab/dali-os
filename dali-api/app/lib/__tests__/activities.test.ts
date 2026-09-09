import { describe, expect, it } from "vitest";
import type { UserRoles } from "~/lib/roles";
import {
  activityPhase,
  isActivityActive,
  isActivityKind,
  matchesAudienceRoles,
} from "~/lib/activities";

// Fixed clock so the window math is deterministic.
const NOW = new Date("2026-09-15T12:00:00.000Z");
const before = "2026-09-10T00:00:00.000Z";
const during = "2026-09-20T00:00:00.000Z";

const roles = (over: Partial<UserRoles>): UserRoles =>
  ({ isCore: false, isAdmin: false, isStaff: false, ...over }) as UserRoles;

describe("isActivityActive", () => {
  it("is true only for Published activities inside the window", () => {
    expect(
      isActivityActive({ status: "Published", startsAt: before, endsAt: during }, NOW),
    ).toBe(true);
  });

  it("is false when Draft, even inside the window", () => {
    expect(
      isActivityActive({ status: "Draft", startsAt: before, endsAt: during }, NOW),
    ).toBe(false);
  });

  it("is false before the window opens and after it closes", () => {
    expect(
      isActivityActive(
        { status: "Published", startsAt: during, endsAt: "2026-09-25T00:00:00Z" },
        NOW,
      ),
    ).toBe(false);
    expect(
      isActivityActive(
        { status: "Published", startsAt: before, endsAt: "2026-09-12T00:00:00Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("accepts Date inputs as well as ISO strings", () => {
    expect(
      isActivityActive(
        { status: "Published", startsAt: new Date(before), endsAt: new Date(during) },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("activityPhase", () => {
  it("classifies upcoming / active / ended", () => {
    expect(
      activityPhase({ status: "Published", startsAt: during, endsAt: during }, NOW),
    ).toBe("upcoming");
    expect(
      activityPhase({ status: "Published", startsAt: before, endsAt: during }, NOW),
    ).toBe("active");
    expect(
      activityPhase(
        { status: "Published", startsAt: before, endsAt: "2026-09-12T00:00:00Z" },
        NOW,
      ),
    ).toBe("ended");
  });
});

describe("matchesAudienceRoles", () => {
  it("matches when the user holds any targeted role", () => {
    expect(matchesAudienceRoles(["isCore"], roles({ isCore: true }))).toBe(true);
    expect(matchesAudienceRoles(["isAdmin", "isStaff"], roles({ isStaff: true }))).toBe(true);
  });

  it("does not match when the user holds none of them", () => {
    expect(matchesAudienceRoles(["isCore", "isAdmin"], roles({ isStaff: true }))).toBe(false);
  });

  it("an empty audience never matches on roles alone", () => {
    expect(matchesAudienceRoles([], roles({ isCore: true }))).toBe(false);
  });
});

describe("isActivityKind", () => {
  it("recognizes registered mechanics and rejects unknown kinds", () => {
    expect(isActivityKind("scavenger_hunt")).toBe(true);
    expect(isActivityKind("nope")).toBe(false);
  });
});
