import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolveDynamicQuery } from "../groups";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

// ProjectAssignment rows are per (user, project, term) and are never deleted,
// so "everyone on project P" and "everyone on project P this term" are very
// different sets once a project runs for more than one term.
const CURRENT = "term-26S";
const PREVIOUS = "term-26W";

const assignments = [
  { userId: "still-on", termId: CURRENT },
  { userId: "also-still-on", termId: CURRENT },
  { userId: "rotated-off", termId: PREVIOUS },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: CURRENT } as never);
  // Stand in for the DB's own filtering so the test asserts the query, not a
  // hand-rolled copy of Prisma.
  mockPrisma.projectAssignment!.findMany.mockImplementation(
    async (args: { where?: { termId?: string } }) =>
      assignments
        .filter((a) => !args?.where?.termId || a.termId === args.where.termId)
        .map((a) => ({ userId: a.userId })),
  );
});

describe("project group membership", () => {
  it("includes only members staffed this term", async () => {
    const members = await resolveDynamicQuery("project:p1");
    expect(members.sort()).toEqual(["also-still-on", "still-on"]);
  });

  it("excludes someone who was on the project in a previous term", async () => {
    expect(await resolveDynamicQuery("project:p1")).not.toContain("rotated-off");
  });

  it("scopes the query by termId rather than filtering afterwards", async () => {
    await resolveDynamicQuery("project:p1");
    expect(mockPrisma.projectAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "p1", termId: CURRENT },
      }),
    );
  });

  it("is empty when there is no current term, rather than everyone ever", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    expect(await resolveDynamicQuery("project:p1")).toEqual([]);
    expect(mockPrisma.projectAssignment!.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing for a malformed project query", async () => {
    expect(await resolveDynamicQuery("project:")).toEqual([]);
  });
});
