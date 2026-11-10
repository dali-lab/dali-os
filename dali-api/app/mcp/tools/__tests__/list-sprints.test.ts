import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { runListSprints, LIST_SPRINTS_TOOL } from "~/mcp/tools/list-sprints";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
};

function term(code: string, sortKey: number, start: string, end: string) {
  return { term: { code, sortKey, startDate: new Date(start), endDate: new Date(end) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 14, 12));
});

afterEach(() => vi.useRealTimers());

describe("list_sprints", () => {
  it("scope is read", () => {
    expect(LIST_SPRINTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns no sprints for a missing project or one with no terms", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce(null);
    expect(await runListSprints("u1", { projectId: "nope" })).toEqual({ sprints: [] });
    mockPrisma.project.findUnique.mockResolvedValueOnce({ projectTerms: [] });
    expect(await runListSprints("u1", { projectId: "p1" })).toEqual({ sprints: [] });
  });

  it("cuts each term into one-week sprints, clipping the last at the term end", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      projectTerms: [term("26W", 1, "2026-01-05T00:00:00Z", "2026-01-20T00:00:00Z")],
    });
    const { sprints } = await runListSprints("u1", { projectId: "p1" });
    expect(sprints).toEqual([
      {
        term: "26W",
        number: 1,
        label: "Sprint 1",
        startsAt: "2026-01-05T00:00:00.000Z",
        endsAt: "2026-01-12T00:00:00.000Z",
        phase: "past",
      },
      {
        term: "26W",
        number: 2,
        label: "Sprint 2",
        startsAt: "2026-01-12T00:00:00.000Z",
        endsAt: "2026-01-19T00:00:00.000Z",
        phase: "current",
      },
      {
        term: "26W",
        number: 3,
        label: "Sprint 3",
        startsAt: "2026-01-19T00:00:00.000Z",
        endsAt: "2026-01-21T00:00:00.000Z",
        phase: "upcoming",
      },
    ]);
  });

  it("orders terms by sort key and restarts numbering per term", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      projectTerms: [
        term("26S", 2, "2026-03-30T00:00:00Z", "2026-04-05T00:00:00Z"),
        term("26W", 1, "2026-01-05T00:00:00Z", "2026-01-11T00:00:00Z"),
      ],
    });
    const { sprints } = await runListSprints("u1", { projectId: "p1" });
    expect(sprints.map((s) => [s.term, s.number, s.phase])).toEqual([
      ["26W", 1, "past"],
      ["26S", 1, "upcoming"],
    ]);
  });

  it("queries the requested project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await runListSprints("u1", { projectId: "p9" });
    expect(mockPrisma.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p9" } }),
    );
  });
});
