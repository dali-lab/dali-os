import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/new-member-cohort.server", () => ({
  getNewMemberCohortIds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getNewMemberCohortIds } from "~/hiring/lib/new-member-cohort.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AUDIENCE_RESOLVERS.includes", () => {
  it("splits members into new vs returning; Mentors keys off isMentor", () => {
    const newMember = { isMember: true, isNewMember: true, isMentor: false };
    const returning = { isMember: true, isNewMember: false, isMentor: false };
    const neither = { isMember: false, isNewMember: false, isMentor: false };

    expect(AUDIENCE_RESOLVERS.NewMembers.includes(newMember)).toBe(true);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(returning)).toBe(false);
    expect(AUDIENCE_RESOLVERS.NewMembers.includes(neither)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Members.includes(returning)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Members.includes(newMember)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Members.includes(neither)).toBe(false);

    // A mentor is a returning member → in Members AND Mentors (gets both).
    const mentor = { isMember: true, isNewMember: false, isMentor: true };
    expect(AUDIENCE_RESOLVERS.Members.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(mentor)).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(returning)).toBe(false);

    expect(AUDIENCE_RESOLVERS.Manual.includes(mentor)).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.includes(mentor)).toBe(false);
  });
});

describe("AUDIENCE_RESOLVERS.enumerable", () => {
  it("only the member/mentor audiences are enumerable", () => {
    expect(AUDIENCE_RESOLVERS.NewMembers.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Members.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.enumerable).toBe(true);
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

  it("non-enumerable audiences resolve to []", async () => {
    expect(await AUDIENCE_RESOLVERS.Manual.listMembers({})).toEqual([]);
    expect(await AUDIENCE_RESOLVERS.HiringParticipants.listMembers({ termId: "t" })).toEqual([]);
  });
});
