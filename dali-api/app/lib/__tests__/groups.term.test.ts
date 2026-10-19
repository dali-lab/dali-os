import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { isUserActiveInTerm, resolveDynamicQuery } from "../groups";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const TERM = "term-26F";

type InstructorRow = { userId: string; termId: string; isMember: boolean };
const instructors: InstructorRow[] = [
  { userId: "member-instructor", termId: TERM, isMember: true },
  { userId: "external-instructor", termId: TERM, isMember: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.projectAssignment!.findMany.mockResolvedValue([{ userId: "project-member" }]);
  mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ userId: "core-member" }]);
  mockPrisma.mentorshipPair!.findMany.mockImplementation(
    async (args: { select: Record<string, boolean> }) =>
      args.select.menteeUserId ? [{ menteeUserId: "mentee" }] : [{ mentorUserId: "mentor" }],
  );
  // Stand in for the DB's own filtering so the test asserts the query.
  mockPrisma.instructorAssignment!.findMany.mockImplementation(
    async (args: { where: { termId: string; user?: { daliMember?: { isNot: null } } } }) =>
      instructors
        .filter((r) => r.termId === args.where.termId)
        .filter((r) => !args.where.user?.daliMember || r.isMember)
        .map((r) => ({ userId: r.userId })),
  );
});

describe("term group membership", () => {
  it("includes everyone with a project, Core, member-instructor or mentorship role in the term", async () => {
    const members = await resolveDynamicQuery(`term:${TERM}`);
    expect(members.sort()).toEqual(
      ["core-member", "member-instructor", "mentee", "mentor", "project-member"].sort(),
    );
  });

  it("excludes external (non-DALIMember) instructors", async () => {
    expect(await resolveDynamicQuery(`term:${TERM}`)).not.toContain("external-instructor");
  });

  it("scopes instructor assignments to DALI members in the query", async () => {
    await resolveDynamicQuery(`term:${TERM}`);
    expect(mockPrisma.instructorAssignment!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { termId: TERM, user: { daliMember: { isNot: null } } },
      }),
    );
  });

  it("lists someone with several roles once", async () => {
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ userId: "project-member" }]);
    const members = await resolveDynamicQuery(`term:${TERM}`);
    expect(members.filter((id) => id === "project-member")).toHaveLength(1);
  });

  it("returns nothing for a malformed term query", async () => {
    expect(await resolveDynamicQuery("term:")).toEqual([]);
    expect(mockPrisma.instructorAssignment!.findMany).not.toHaveBeenCalled();
  });
});

describe("isUserActiveInTerm (signing gate)", () => {
  it("counts any instructor assignment, so external instructors still sign", async () => {
    mockPrisma.user!.findFirst.mockResolvedValue({ id: "external-instructor" });
    expect(await isUserActiveInTerm("external-instructor", TERM)).toBe(true);
    const where = mockPrisma.user!.findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ instructorAssignments: { some: { termId: TERM } } });
  });

  it("is false when the user has no role in the term", async () => {
    mockPrisma.user!.findFirst.mockResolvedValue(null);
    expect(await isUserActiveInTerm("nobody", TERM)).toBe(false);
  });
});
