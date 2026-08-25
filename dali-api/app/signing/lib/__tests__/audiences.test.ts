import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn(),
  resolveDynamicQuery: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
}));
vi.mock("~/signing/lib/staffing-audience.server", () => ({
  partitionStaffedMembers: vi.fn(),
  listStaffedMentors: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { resolveGroupMembers, resolveDynamicQuery } from "~/lib/groups";
import { currentTerm } from "~/lib/roles";
import {
  partitionStaffedMembers,
  listStaffedMentors,
} from "~/signing/lib/staffing-audience.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import type { SignerCohorts } from "~/signing/lib/state.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// Cohort literal helper so a new SignerCohorts field doesn't churn every test.
function cohorts(over: Partial<SignerCohorts> = {}): SignerCohorts {
  return {
    isMember: false,
    isStaffedThisTerm: false,
    isNewStaffed: false,
    isMentor: false,
    isActiveThisTerm: false,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AUDIENCE_RESOLVERS.includes", () => {
  it("partitions the staffed roster into new vs returning; Mentors keys off isMentor", () => {
    const newMember = cohorts({ isStaffedThisTerm: true, isNewStaffed: true });
    const returning = cohorts({ isStaffedThisTerm: true });
    const notStaffed = cohorts({ isMember: true });

    expect(AUDIENCE_RESOLVERS.NewMembers.includes(newMember)).toBe(true);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(returning)).toBe(false);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(notStaffed)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Members.includes(returning)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Members.includes(newMember)).toBe(false);
    // An active member who isn't staffed this term owes neither.
    expect(AUDIENCE_RESOLVERS.Members.includes(notStaffed)).toBe(false);

    // A mentor is a staffed (returning) member → in Members AND Mentors.
    const mentor = cohorts({ isStaffedThisTerm: true, isMentor: true });
    expect(AUDIENCE_RESOLVERS.Members.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(returning)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Manual.includes(mentor)).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.includes(mentor)).toBe(false);
  });

  it("NewMembers and Members partition the staffed set (union = staffed, disjoint)", () => {
    // Every staffed signer lands in exactly one of NewMembers / Members.
    for (const isNewStaffed of [true, false]) {
      const c = cohorts({ isStaffedThisTerm: true, isNewStaffed });
      const inNew = AUDIENCE_RESOLVERS.NewMembers.includes(c);
      const inReturning = AUDIENCE_RESOLVERS.Members.includes(c);
      expect(inNew !== inReturning).toBe(true); // exactly one
    }
    // A non-staffed signer is in neither.
    const off = cohorts({ isMember: true });
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(off)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Members.includes(off)).toBe(false);
  });

  it("Group (term group) gates on isActiveThisTerm, not membership", () => {
    const offTerm = cohorts({ isMember: true, isActiveThisTerm: false });
    const staffed = cohorts({ isMember: true, isActiveThisTerm: true });
    expect(AUDIENCE_RESOLVERS.Group.includes(offTerm)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Group.includes(staffed)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Group.includes(offTerm, { userGroupIds: new Set() })).toBe(false);
    expect(AUDIENCE_RESOLVERS.Group.includes(staffed, { audienceGroupId: null })).toBe(true);
  });

  it("Group (fixed group) gates on membership in that group, ignoring the term", () => {
    const c = cohorts({ isMember: true, isActiveThisTerm: false });
    const ctxIn = { audienceGroupId: "g1", userGroupIds: new Set(["g1"]) };
    const ctxOut = { audienceGroupId: "g1", userGroupIds: new Set(["g2"]) };
    expect(AUDIENCE_RESOLVERS.Group.includes(c, ctxIn)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Group.includes(c, ctxOut)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Group.includes(c, { audienceGroupId: "g1" })).toBe(false);
  });
});

describe("AUDIENCE_RESOLVERS.enumerable", () => {
  it("member/mentor/group audiences are enumerable; Manual + Hiring are not", () => {
    expect(AUDIENCE_RESOLVERS.NewMembers.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Members.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Group.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Manual.enumerable).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.enumerable).toBe(false);
  });
});

describe("AUDIENCE_RESOLVERS.listMembers", () => {
  const newMembers = [{ id: "u1", firstName: "Ada", lastName: "L" }];
  const returning = [
    { id: "u2", firstName: "Bo", lastName: "K" },
    { id: "u3", firstName: "Cy", lastName: "R" },
  ];

  it("NewMembers is the staffed roster's first-timers for the term", async () => {
    vi.mocked(partitionStaffedMembers).mockResolvedValue({ newMembers, returning });
    const people = await AUDIENCE_RESOLVERS.NewMembers.listMembers({ termId: "term-26f" });
    expect(partitionStaffedMembers).toHaveBeenCalledWith("term-26f");
    expect(people).toEqual(newMembers);
  });

  it("Members is the staffed roster minus the first-timers", async () => {
    vi.mocked(partitionStaffedMembers).mockResolvedValue({ newMembers, returning });
    const people = await AUDIENCE_RESOLVERS.Members.listMembers({ termId: "term-26f" });
    expect(people).toEqual(returning);
  });

  it("member audiences fall back to the current term when no termId is given", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-current" } as never);
    vi.mocked(partitionStaffedMembers).mockResolvedValue({ newMembers, returning });
    await AUDIENCE_RESOLVERS.Members.listMembers({});
    expect(partitionStaffedMembers).toHaveBeenCalledWith("term-current");
  });

  it("member audiences are empty when there is no term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    const people = await AUDIENCE_RESOLVERS.NewMembers.listMembers({});
    expect(people).toEqual([]);
    expect(partitionStaffedMembers).not.toHaveBeenCalled();
  });

  it("Mentors resolves the term's staffed mentors", async () => {
    vi.mocked(listStaffedMentors).mockResolvedValue([{ id: "m1", firstName: "Cy", lastName: "R" }]);
    const people = await AUDIENCE_RESOLVERS.Mentors.listMembers({ termId: "term-26f" });
    expect(listStaffedMentors).toHaveBeenCalledWith("term-26f");
    expect(people).toEqual([{ id: "m1", firstName: "Cy", lastName: "R" }]);
  });

  it("Group with a fixed id hydrates that group's members (staff dropped by the query)", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValue(["u2", "u3"]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "Bo", lastName: "K" },
      { id: "u3", firstName: "Cy", lastName: "R" },
    ]);
    const people = await AUDIENCE_RESOLVERS.Group.listMembers({ audienceGroupId: "g1" });
    expect(resolveGroupMembers).toHaveBeenCalledWith("g1");
    expect(resolveDynamicQuery).not.toHaveBeenCalled();
    expect(people.map((p) => p.id)).toEqual(["u2", "u3"]);
  });

  it("Group with no id resolves the given term's group", async () => {
    vi.mocked(resolveDynamicQuery).mockResolvedValue(["u1"]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", firstName: "Ada", lastName: "L" }]);
    const people = await AUDIENCE_RESOLVERS.Group.listMembers({ termId: "term-26f" });
    expect(resolveDynamicQuery).toHaveBeenCalledWith("term:term-26f");
    expect(currentTerm).not.toHaveBeenCalled();
    expect(people.map((p) => p.id)).toEqual(["u1"]);
  });

  it("non-enumerable audiences resolve to []", async () => {
    expect(await AUDIENCE_RESOLVERS.Manual.listMembers({})).toEqual([]);
    expect(await AUDIENCE_RESOLVERS.HiringParticipants.listMembers({ termId: "t" })).toEqual([]);
  });
});
