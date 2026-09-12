import { describe, expect, it } from "vitest";
import type { UserRoles } from "~/lib/roles";
import {
  activityPhase,
  isActivityActive,
  isActivityKind,
  matchesAudienceRoles,
  normalizeRoute,
  resolveHintState,
  routesMatch,
  type HuntHintPolicy,
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

describe("normalizeRoute", () => {
  it("forces a single leading slash and strips a trailing one", () => {
    expect(normalizeRoute("projects")).toBe("/projects");
    expect(normalizeRoute("/projects/")).toBe("/projects");
    expect(normalizeRoute("  /projects  ")).toBe("/projects");
  });

  it("drops any query/hash if a full path was pasted", () => {
    expect(normalizeRoute("/projects?tab=1")).toBe("/projects");
    expect(normalizeRoute("/projects#top")).toBe("/projects");
  });

  it("keeps root as / and treats empty as empty", () => {
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("")).toBe("");
    expect(normalizeRoute(null)).toBe("");
  });
});

describe("routesMatch", () => {
  it("matches across sloppy formatting on either side", () => {
    expect(routesMatch("projects", "/projects")).toBe(true);
    expect(routesMatch("/projects/", "/projects")).toBe(true);
    expect(routesMatch(" /projects ", "/projects/")).toBe(true);
  });

  it("does not match a different route, and an empty location never matches", () => {
    expect(routesMatch("/projects", "/calendar")).toBe(false);
    expect(routesMatch("", "/projects")).toBe(false);
  });
});

describe("resolveHintState", () => {
  const start = new Date("2026-09-15T12:00:00Z").getTime();
  const policy = (over: Partial<HuntHintPolicy>): HuntHintPolicy =>
    ({ mode: "free", penalty: 0, delayMinutes: 0, ...over });

  it("free mode always shows, no cost", () => {
    const s = resolveHintState(policy({ mode: "free" }), {
      revealed: false,
      nowMs: start,
      startsAtMs: start,
    });
    expect(s).toEqual({ show: true, cost: null, unlocksAt: null });
  });

  it("points mode withholds until revealed, surfacing the cost", () => {
    const p = policy({ mode: "points", penalty: 3 });
    expect(resolveHintState(p, { revealed: false, nowMs: start, startsAtMs: start })).toEqual({
      show: false,
      cost: 3,
      unlocksAt: null,
    });
    expect(resolveHintState(p, { revealed: true, nowMs: start, startsAtMs: start })).toEqual({
      show: true,
      cost: null,
      unlocksAt: null,
    });
  });

  it("delay mode locks until the unlock time, then shows", () => {
    const p = policy({ mode: "delay", delayMinutes: 60 });
    const unlocksAt = start + 60 * 60_000;
    expect(resolveHintState(p, { revealed: false, nowMs: start, startsAtMs: start })).toEqual({
      show: false,
      cost: null,
      unlocksAt,
    });
    expect(
      resolveHintState(p, { revealed: false, nowMs: unlocksAt, startsAtMs: start }),
    ).toEqual({ show: true, cost: null, unlocksAt: null });
  });
});
