import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/new-member-cohort.server", () => ({
  getNewMemberCohortIds: vi.fn(),
}));
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn(),
  resolveDynamicQuery: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getNewMemberCohortIds } from "~/hiring/lib/new-member-cohort.server";
import { resolveGroupMembers, resolveDynamicQuery } from "~/lib/groups";
import { currentTerm } from "~/lib/roles";
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
    isNewMember: false,
    isMentor: false,
    isActiveThisTerm: false,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AUDIENCE_RESOLVERS.includes", () => {
  it("splits members into new vs returning; Mentors keys off isMentor", () => {
    const newMember = cohorts({ isMember: true, isNewMember: true });
    const returning = cohorts({ isMember: true });
    const neither = cohorts();

    expect(AUDIENCE_RESOLVERS.NewMembers.includes(newMember)).toBe(true);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(returning)).toBe(false);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(neither)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Members.includes(returning)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Members.includes(newMember)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Members.includes(neither)).toBe(false);

    // A mentor is a returning member → in Members AND Mentors (gets both).
    const mentor = cohorts({ isMember: true, isMentor: true });
    expect(AUDIENCE_RESOLVERS.Members.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(returning)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Manual.includes(mentor)).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.includes(mentor)).toBe(false);
  });

  it("Group (term group) gates on isActiveThisTerm, not membership", () => {
    // No fixed group id → the binding's term group. An off-term member (not
    // staffed) is excluded even though they're an active member.
    const offTerm = cohorts({ isMember: true, isActiveThisTerm: false });
    const staffed = cohorts({ isMember: true, isActiveThisTerm: true });
    expect(AUDIENCE_RESOLVERS.Group.includes(offTerm)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Group.includes(staffed)).toBe(true);
    // ctx present but with no fixed group id behaves the same.
    expect(AUDIENCE_RESOLVERS.Group.includes(offTerm, { userGroupIds: new Set() })).toBe(false);
    expect(AUDIENCE_RESOLVERS.Group.includes(staffed, { audienceGroupId: null })).toBe(true);
  });

  it("Group (fixed group) gates on membership in that group, ignoring the term", () => {
    const c = cohorts({ isMember: true, isActiveThisTerm: false });
    const ctxIn = { audienceGroupId: "g1", userGroupIds: new Set(["g1"]) };
    const ctxOut = { audienceGroupId: "g1", userGroupIds: new Set(["g2"]) };
    expect(AUDIENCE_RESOLVERS.Group.includes(c, ctxIn)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Group.includes(c, ctxOut)).toBe(false);
    // Missing membership set → not in the audience (never throws).
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
  const active = [
    { user: { id: "u1", firstName: "Ada", lastName: "L" } },
    { user: { id: "u2", firstName: "Bo", lastName: "K" } },
    { user: { id: "u3", firstName: "Cy", lastName: "R" } },
  ];

  it("NewMembers is the active members in the incoming cohort", async () => {
    mockPrisma.dALIMember.findMany.mockResolvedValue(active);
    vi.mocked(getNewMemberCohortIds).mockResolvedValue(new Set(["u1"]));
    const people = await AUDIENCE_RESOLVERS.NewMembers.listMembers({});
    expect(people).toEqual([{ id: "u1", firstName: "Ada", lastName: "L" }]);
  });

  it("Members is the active members NOT in the incoming cohort", async () => {
    mockPrisma.dALIMember.findMany.mockResolvedValue(active);
    vi.mocked(getNewMemberCohortIds).mockResolvedValue(new Set(["u1"]));
    const people = await AUDIENCE_RESOLVERS.Members.listMembers({});
    expect(people).toEqual([
      { id: "u2", firstName: "Bo", lastName: "K" },
      { id: "u3", firstName: "Cy", lastName: "R" },
    ]);
  });

  it("Mentors queries the term's mentor set when a termId is given", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "m1", firstName: "Cy", lastName: "R" }]);
    const people = await AUDIENCE_RESOLVERS.Mentors.listMembers({ termId: "term-26f" });
    expect(people).toEqual([{ id: "m1", firstName: "Cy", lastName: "R" }]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it("Mentors returns [] and issues no query without a termId", async () => {
    const people = await AUDIENCE_RESOLVERS.Mentors.listMembers({});
    expect(people).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
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

  it("Group with no id and no termId falls back to the current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-current" } as never);
    vi.mocked(resolveDynamicQuery).mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    const people = await AUDIENCE_RESOLVERS.Group.listMembers({});
    expect(resolveDynamicQuery).toHaveBeenCalledWith("term:term-current");
    expect(people).toEqual([]);
  });

  it("Group with no id and no current term is empty (no query)", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    const people = await AUDIENCE_RESOLVERS.Group.listMembers({});
    expect(people).toEqual([]);
    expect(resolveDynamicQuery).not.toHaveBeenCalled();
  });

  it("non-enumerable audiences resolve to []", async () => {
    expect(await AUDIENCE_RESOLVERS.Manual.listMembers({})).toEqual([]);
    expect(await AUDIENCE_RESOLVERS.HiringParticipants.listMembers({ termId: "t" })).toEqual([]);
  });
});
