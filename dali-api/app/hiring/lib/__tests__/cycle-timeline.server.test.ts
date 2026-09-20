import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { saveCycleTimeline } from "~/hiring/lib/cycle-timeline.server";
import { STANDARD_TIMELINE, defaultTimeline } from "~/hiring/lib/cycle-timeline";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ timeline: STANDARD_TIMELINE }),
    update: vi.fn(),
  };
  mockPrisma.delibsSession = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("saveCycleTimeline", () => {
  it("saves a valid timeline and keeps hasInterviews in step", async () => {
    const next = defaultTimeline({ firstDelib: true, interviews: false });
    expect(await saveCycleTimeline("c1", next)).toBeNull();
    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { timeline: next, hasInterviews: false },
    });
  });

  it("rejects an invalid timeline without writing", async () => {
    const broken = STANDARD_TIMELINE.filter((b) => !(b.kind === "delib" && b.id === "first"));
    expect(await saveCycleTimeline("c1", broken)).toMatch(/right before/);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("won't drop a round that already has a board", async () => {
    mockPrisma.delibsSession.findMany.mockResolvedValue([{ roundId: "first" }]);
    const next = defaultTimeline({ firstDelib: false, interviews: false });
    expect(await saveCycleTimeline("c1", next)).toMatch(/First delib already has a board/);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });
});
