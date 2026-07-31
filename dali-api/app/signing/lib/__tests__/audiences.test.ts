import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AUDIENCE_RESOLVERS.includes", () => {
  it("ActiveMembers keys off isMember; Mentors keys off isMentor", () => {
    const both = { isMember: true, isMentor: true };
    const neither = { isMember: false, isMentor: false };
    expect(AUDIENCE_RESOLVERS.ActiveMembers.includes({ isMember: true, isMentor: false })).toBe(true);
    expect(AUDIENCE_RESOLVERS.ActiveMembers.includes(neither)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Mentors.includes({ isMember: false, isMentor: true })).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.includes(neither)).toBe(false);
    expect(AUDIENCE_RESOLVERS.Manual.includes(both)).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.includes(both)).toBe(false);
  });
});

describe("AUDIENCE_RESOLVERS.enumerable", () => {
  it("only the member/mentor audiences are enumerable", () => {
    expect(AUDIENCE_RESOLVERS.ActiveMembers.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Mentors.enumerable).toBe(true);
    expect(AUDIENCE_RESOLVERS.Manual.enumerable).toBe(false);
    expect(AUDIENCE_RESOLVERS.HiringParticipants.enumerable).toBe(false);
  });
});

describe("AUDIENCE_RESOLVERS.listMembers", () => {
  it("ActiveMembers returns the active non-staff member set", async () => {
    mockPrisma.dALIMember.findMany.mockResolvedValue([
      { user: { id: "u1", firstName: "Ada", lastName: "L" } },
      { user: { id: "u2", firstName: "Bo", lastName: "K" } },
    ]);
    const people = await AUDIENCE_RESOLVERS.ActiveMembers.listMembers({});
    expect(people).toEqual([
      { id: "u1", firstName: "Ada", lastName: "L" },
      { id: "u2", firstName: "Bo", lastName: "K" },
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
