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
