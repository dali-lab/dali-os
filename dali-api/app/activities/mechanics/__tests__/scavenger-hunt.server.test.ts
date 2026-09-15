import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    activityEvent: { findMany: vi.fn(), createMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { scavengerHuntServer } from "~/activities/mechanics/scavenger-hunt.server";
import type { Activity } from "~/generated/prisma/client";

const DESIGNLOFT = { id: "c-loft", value: "DESIGNLOFT", label: "The design loft", points: 5 };
const FOUND_IN_THE_WORLD = { id: "c-other", value: "MARLIN", label: "Somewhere", points: 1 };

function activity(codes: unknown[]): Activity {
  return {
    id: "act-1",
    kind: "scavenger_hunt",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    config: { codes, leaderboard: "public" },
  } as unknown as Activity;
}

/** How many time entries the member has; the rule only reads `rows.length`. */
function timeEntries(n: number) {
  vi.mocked(prisma.timeEntry.findMany).mockResolvedValue(
    Array.from({ length: n }, (_, i) => ({ id: `te-${i}` })) as never,
  );
}

const award = () => scavengerHuntServer.autoAward!({ activity: activity([DESIGNLOFT]), userId: "u-1" });

describe("scavenger hunt: earned codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.activityEvent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.activityEvent.createMany).mockResolvedValue({ count: 1 } as never);
  });

  it("credits DESIGNLOFT once the member has more than one time entry", async () => {
    timeEntries(2);

    await expect(award()).resolves.toBe(true);
    expect(prisma.activityEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          activityId: "act-1",
          userId: "u-1",
          type: "code_found",
          refId: "c-loft",
          points: 5,
        },
      ],
      skipDuplicates: true,
    });
  });

  it("does not credit a member with exactly one time entry", async () => {
    timeEntries(1);

    await expect(award()).resolves.toBe(false);
    expect(prisma.activityEvent.createMany).not.toHaveBeenCalled();
  });

  it("does not credit a member with no time entries", async () => {
    timeEntries(0);

    await expect(award()).resolves.toBe(false);
    expect(prisma.activityEvent.createMany).not.toHaveBeenCalled();
  });

  it("is a no-op once the code is already credited — and skips the timesheet read", async () => {
    timeEntries(5);
    vi.mocked(prisma.activityEvent.findMany).mockResolvedValue([{ refId: "c-loft" }] as never);

    await expect(award()).resolves.toBe(false);
    expect(prisma.timeEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.activityEvent.createMany).not.toHaveBeenCalled();
  });

  it("ignores hunts whose config doesn't list the code", async () => {
    timeEntries(5);

    const result = await scavengerHuntServer.autoAward!({
      activity: activity([FOUND_IN_THE_WORLD]),
      userId: "u-1",
    });

    expect(result).toBe(false);
    expect(prisma.activityEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.activityEvent.createMany).not.toHaveBeenCalled();
  });

  it("matches the configured code value case- and whitespace-insensitively", async () => {
    timeEntries(2);

    const result = await scavengerHuntServer.autoAward!({
      activity: activity([{ ...DESIGNLOFT, value: "  designLoft " }]),
      userId: "u-1",
    });

    expect(result).toBe(true);
  });

  it("reports false when the write is a duplicate a concurrent load already made", async () => {
    timeEntries(2);
    vi.mocked(prisma.activityEvent.createMany).mockResolvedValue({ count: 0 } as never);

    await expect(award()).resolves.toBe(false);
  });
});

// ─── Team scoring ────────────────────────────────────────────────────────────
// summarize() is pure given its args, so the leaderboard needs no DB at all.

const CODES = [
  { id: "c1", value: "ONE", label: "First", points: 3 },
  { id: "c2", value: "TWO", label: "Second", points: 5 },
];

function teamActivity(): Activity {
  return { ...activity(CODES), scoring: "Team" } as Activity;
}

let eventSeq = 0;
function found(userId: string, refId: string, points: number, at = ++eventSeq) {
  return {
    id: `e-${at}`,
    activityId: "act-1",
    userId,
    type: "code_found",
    refId,
    points,
    createdAt: new Date(2026, 8, 1, 0, at),
  };
}

const RED = { id: "t-red", name: "Red team", memberIds: ["u-1", "u-2"] };
const BLUE = { id: "t-blue", name: "Blue team", memberIds: ["u-3"] };

function summarizeTeam(allEvents: ReturnType<typeof found>[], viewerTeam = RED) {
  return scavengerHuntServer.summarize({
    activity: teamActivity(),
    userId: "u-1",
    viewerIsCore: false,
    userEvents: allEvents.filter((e) => e.userId === "u-1") as never,
    allEvents: allEvents as never,
    teams: [RED, BLUE],
    viewerTeam,
  });
}

describe("scavenger hunt: team scoring", () => {
  beforeEach(() => {
    eventSeq = 0;
  });

  it("pools a team's points and ranks teams, not members", () => {
    const { results } = summarizeTeam([
      found("u-1", "c1", 3),
      found("u-2", "c2", 5),
      found("u-3", "c1", 3),
    ]);
    const board = results as { mode: string; rows: { id: string; teamName: string; points: number; found: number }[] };

    expect(board.mode).toBe("team");
    expect(board.rows.map((r) => [r.teamName, r.points, r.found])).toEqual([
      ["Red team", 8, 2],
      ["Blue team", 3, 1],
    ]);
  });

  it("scores a code once per team even when both partners submit it", () => {
    const { results } = summarizeTeam([found("u-1", "c1", 3), found("u-2", "c1", 3)]);
    const board = results as { rows: { points: number; found: number }[] };

    expect(board.rows[0]).toMatchObject({ points: 3, found: 1 });
  });

  it("counts a partner's find as the member's own progress, and credits them", () => {
    const { progress } = summarizeTeam([found("u-2", "c2", 5)]);
    const p = progress as {
      found: number;
      team: { name: string } | null;
      clues: { id: string; found: boolean; foundByUserId: string | null }[];
    };

    expect(p.found).toBe(1);
    expect(p.team?.name).toBe("Red team");
    expect(p.clues.find((c) => c.id === "c2")).toMatchObject({
      found: true,
      foundByUserId: "u-2",
    });
  });

  it("doesn't credit the member for their own find", () => {
    const { progress } = summarizeTeam([found("u-1", "c1", 3)]);
    const p = progress as { clues: { id: string; foundByUserId: string | null }[] };

    expect(p.clues.find((c) => c.id === "c1")?.foundByUserId).toBeNull();
  });

  it("keeps an unpaired member's finds off the board and flags them as teamless", () => {
    const { progress, results } = summarizeTeam([found("u-9", "c1", 3)], null as never);
    const p = progress as { teamless: boolean; found: number };
    const board = results as { rows: unknown[] };

    expect(p.teamless).toBe(true);
    expect(p.found).toBe(0);
    expect(board.rows).toEqual([]);
  });

  it("still ranks individuals when the activity isn't team-scored", () => {
    const events = [found("u-1", "c1", 3), found("u-2", "c2", 5)];
    const { results } = scavengerHuntServer.summarize({
      activity: activity(CODES),
      userId: "u-1",
      viewerIsCore: false,
      userEvents: [events[0]] as never,
      allEvents: events as never,
      teams: [],
      viewerTeam: null,
    });
    const board = results as { mode: string; rows: { userId: string; points: number }[] };

    expect(board.mode).toBe("individual");
    expect(board.rows.map((r) => [r.userId, r.points])).toEqual([
      ["u-2", 5],
      ["u-1", 3],
    ]);
  });
});
