import { describe, expect, it } from "vitest";
import type { UserRoles } from "~/lib/roles";
import {
  activityPhase,
  autoAssignTeams,
  clampTeamSize,
  isActivityActive,
  isActivityKind,
  matchesAudienceRoles,
  removeFromTeams,
  resolveHintState,
  teamForMember,
  type ActivityTeamView,
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

// ─── Teams ───────────────────────────────────────────────────────────────────

describe("autoAssignTeams", () => {
  // Stable ids so the expectations read as data, not UUIDs.
  const ids = () => {
    let n = 0;
    return () => `t${++n}`;
  };
  const shape = (teams: ActivityTeamView[]) => teams.map((t) => t.memberIds);

  const assign = (roster: string[], teams: ActivityTeamView[] = [], teamSize = 2) =>
    autoAssignTeams({ roster, teams, teamSize, newTeamId: ids() });

  it("pairs an even roster up", () => {
    expect(shape(assign(["a", "b", "c", "d"]))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("names the teams it creates", () => {
    expect(assign(["a", "b", "c", "d"]).map((t) => t.name)).toEqual(["Team 1", "Team 2"]);
  });

  it("puts a leftover person on an existing team rather than alone", () => {
    expect(shape(assign(["a", "b", "c"]))).toEqual([["a", "b", "c"]]);
  });

  it("honors a team size above two", () => {
    expect(shape(assign(["a", "b", "c", "d", "e", "f"], [], 3))).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("absorbs a remainder too small to be a team of its own", () => {
    // 7 into 3s leaves one person: a team of four beats a team of one.
    expect(shape(assign(["a", "b", "c", "d", "e", "f", "g"], [], 3))).toEqual([
      ["a", "b", "c", "g"],
      ["d", "e", "f"],
    ]);
  });

  it("tops up a half-full team before making a new one", () => {
    const existing: ActivityTeamView[] = [{ id: "keep", name: "Keepers", memberIds: ["a"] }];
    expect(shape(assign(["a", "b", "c", "d"], existing))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("leaves hand-made pairings alone", () => {
    const existing: ActivityTeamView[] = [
      { id: "keep", name: "Keepers", memberIds: ["a", "b"] },
    ];
    const out = assign(["a", "b", "c", "d"], existing);
    expect(out[0]).toEqual(existing[0]);
    expect(shape(out)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("is a no-op when everyone is already placed", () => {
    const existing: ActivityTeamView[] = [
      { id: "keep", name: "Keepers", memberIds: ["a", "b"] },
    ];
    expect(assign(["a", "b"], existing)).toEqual(existing);
  });

  it("makes one team of everyone when the roster is smaller than a pair", () => {
    expect(shape(assign(["a"]))).toEqual([["a"]]);
  });
});

describe("team helpers", () => {
  const teams: ActivityTeamView[] = [
    { id: "t1", name: "One", memberIds: ["a", "b"] },
    { id: "t2", name: "Two", memberIds: ["c"] },
  ];

  it("finds the team a member is on", () => {
    expect(teamForMember(teams, "b")?.id).toBe("t1");
    expect(teamForMember(teams, "zz")).toBeNull();
  });

  it("removes a member without touching the other teams", () => {
    expect(removeFromTeams(teams, "a")).toEqual([
      { id: "t1", name: "One", memberIds: ["b"] },
      { id: "t2", name: "Two", memberIds: ["c"] },
    ]);
  });

  it("clamps a team size to something a team can actually be", () => {
    expect(clampTeamSize(0)).toBe(2);
    expect(clampTeamSize(99)).toBe(12);
    expect(clampTeamSize(Number.NaN)).toBe(2);
    expect(clampTeamSize(3.4)).toBe(3);
  });
});
