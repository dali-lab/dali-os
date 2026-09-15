import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn().mockResolvedValue({ id: "term-26S" }),
  getActiveCoreCycleTermIds: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { resolveDynamicQuery, listVisibleGroupIdsForUser } from "../groups";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

// DomainEligibility is monotonic and term-independent: rows are never deleted,
// and graduating doesn't touch them. So "everyone eligible for domain D" and
// "everyone currently working domain D" diverge a little more every year — the
// same shape of bug groups.project-term.test.ts pins down for project groups.
const ELIGIBILITIES = [
  { userId: "current-member", domainId: "d1" },
  { userId: "fresh-hire", domainId: "d1" },
  { userId: "graduated", domainId: "d1" },
];

const STATUS: Record<string, "Active" | "Alumni"> = {
  "current-member": "Active",
  "fresh-hire": "Active",
  graduated: "Alumni",
};

type UserGate = { membershipStatus?: string; daliMember?: unknown };

// Stands in for the DB's own filtering so the tests assert the query we send,
// not a hand-rolled copy of Prisma.
function matchesGate(userId: string, gate: UserGate | undefined): boolean {
  if (!gate) return true;
  if (gate.membershipStatus && STATUS[userId] !== gate.membershipStatus) return false;
  return true;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.domainEligibility!.findMany.mockImplementation(
    async (args: { where?: { domainId?: string; userId?: string; user?: UserGate } }) =>
      ELIGIBILITIES.filter(
        (e) =>
          (!args?.where?.domainId || e.domainId === args.where.domainId) &&
          (!args?.where?.userId || e.userId === args.where.userId) &&
          matchesGate(e.userId, args?.where?.user),
      ).map((e) => ({ userId: e.userId, domainId: e.domainId })),
  );
});

describe("domain group membership", () => {
  it("includes current members, whether or not they're staffed yet", async () => {
    const members = await resolveDynamicQuery("domain:d1");
    expect(members.sort()).toEqual(["current-member", "fresh-hire"]);
  });

  it("excludes a member who has graduated", async () => {
    expect(await resolveDynamicQuery("domain:d1")).not.toContain("graduated");
  });

  it("gates on the member in the query rather than filtering afterwards", async () => {
    await resolveDynamicQuery("domain:d1");
    expect(mockPrisma.domainEligibility!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domainId: "d1",
          user: expect.objectContaining({ membershipStatus: "Active" }),
        }),
      }),
    );
  });
});

// deriveUserGroups answers the same question inverted (is THIS user in the
// group) off the user's own rows, and groups.ts promises the two agree. A gate
// added to one and not the other is exactly the drift that promise guards.
describe("domain group membership, resolved per user", () => {
  beforeEach(() => {
    mockPrisma.groupDefinition!.findMany.mockResolvedValue([
      {
        id: "g-domain",
        name: "Domain Fullstack",
        type: "Dynamic",
        dynamicQuery: "domain:d1",
        staticMemberIds: [],
        systemKey: "domain:d1",
        archivedAt: null,
        boundTermIds: [],
      },
    ]);
    mockPrisma.term!.findMany.mockResolvedValue([]);
  });

  it("puts a current member in their domain's group", async () => {
    mockPrisma.user!.findUnique.mockResolvedValue({
      membershipStatus: "Active",
      daliMember: { userId: "current-member" },
    });

    const ids = await listVisibleGroupIdsForUser("current-member");
    expect(ids.map((g) => g.id)).toEqual(["g-domain"]);
  });

  it("keeps an alumnus out of the domain group they used to be in", async () => {
    mockPrisma.user!.findUnique.mockResolvedValue({
      membershipStatus: "Alumni",
      daliMember: { userId: "graduated" },
    });

    expect(await listVisibleGroupIdsForUser("graduated")).toEqual([]);
  });

  it("agrees with the forward resolver on who is in the group", async () => {
    const forward = (await resolveDynamicQuery("domain:d1")).sort();

    const inverse: string[] = [];
    for (const userId of Object.keys(STATUS)) {
      mockPrisma.user!.findUnique.mockResolvedValue({
        membershipStatus: STATUS[userId],
        daliMember: { userId },
      });
      const ids = await listVisibleGroupIdsForUser(userId);
      if (ids.some((g) => g.id === "g-domain")) inverse.push(userId);
    }

    expect(inverse.sort()).toEqual(forward);
  });
});
