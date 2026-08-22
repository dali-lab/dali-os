import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  partitionStaffedMembers,
  listStaffedMentors,
  isStaffedInTerm,
  hasPriorStaffing,
  isStaffedMentorInTerm,
} from "~/signing/lib/staffing-audience.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const DIRECTORY: Record<string, { id: string; firstName: string; lastName: string }> = {
  u1: { id: "u1", firstName: "Ada", lastName: "Lovelace" },
  u2: { id: "u2", firstName: "Bo", lastName: "Katz" },
  u3: { id: "u3", firstName: "Cy", lastName: "Reed" },
  m5: { id: "m5", firstName: "Di", lastName: "Wu" },
};

beforeEach(() => {
  vi.resetAllMocks();
  // hydrate(): return directory rows for the requested ids.
  mockPrisma.user.findMany.mockImplementation(async (args: any) => {
    const ids: string[] = args.where.id.in;
    return ids.map((id) => DIRECTORY[id]).filter(Boolean);
  });
});

describe("partitionStaffedMembers", () => {
  beforeEach(() => {
    mockPrisma.term.findUnique.mockResolvedValue({ sortKey: 300 });
    // The proj/core queries branch on the where shape: {termId} = this term's
    // roster, {term:{sortKey}} = staffing in earlier terms.
    mockPrisma.projectAssignment.findMany.mockImplementation(async (args: any) =>
      args.where.termId
        ? [{ userId: "u1" }, { userId: "u2" }] // staffed this term
        : [{ userId: "u2" }], // prior staffing
    );
    mockPrisma.coreAssignment.findMany.mockImplementation(async (args: any) =>
      args.where.termId ? [{ userId: "u3" }] : [],
    );
  });

  it("splits the staffed roster into first-timers (new) and returning", async () => {
    const { newMembers, returning } = await partitionStaffedMembers("t1");
    expect(newMembers.map((p) => p.id).sort()).toEqual(["u1", "u3"]);
    expect(returning.map((p) => p.id)).toEqual(["u2"]);
  });

  it("union of new + returning equals the staffed roster; the two are disjoint", async () => {
    const { newMembers, returning } = await partitionStaffedMembers("t1");
    const newIds = new Set(newMembers.map((p) => p.id));
    const retIds = new Set(returning.map((p) => p.id));
    expect([...new Set([...newIds, ...retIds])].sort()).toEqual(["u1", "u2", "u3"]);
    expect([...newIds].some((id) => retIds.has(id))).toBe(false);
  });

  it("is empty when the term has no staffing", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([]);
    const { newMembers, returning } = await partitionStaffedMembers("t1");
    expect(newMembers).toEqual([]);
    expect(returning).toEqual([]);
  });

  it("is empty when the term does not exist", async () => {
    mockPrisma.term.findUnique.mockResolvedValue(null);
    const { newMembers, returning } = await partitionStaffedMembers("nope");
    expect(newMembers).toEqual([]);
    expect(returning).toEqual([]);
  });
});

describe("listStaffedMentors", () => {
  it("is the union of P3 project mentors and external mentors", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "u1" }]);
    mockPrisma.externalMentor.findMany.mockResolvedValue([{ userId: "m5" }]);
    const people = await listStaffedMentors("t1");
    expect(people.map((p) => p.id).sort()).toEqual(["m5", "u1"]);
  });
});

describe("single-user gates", () => {
  it("isStaffedInTerm reflects a proj/core existence check", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1" });
    expect(await isStaffedInTerm("u1", "t1")).toBe(true);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await isStaffedInTerm("u1", "t1")).toBe(false);
  });

  it("hasPriorStaffing checks strictly-earlier terms", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1" });
    expect(await hasPriorStaffing("u1", 300)).toBe(true);
    const arg = mockPrisma.user.findFirst.mock.calls[0][0] as any;
    expect(arg.where.OR[0].projectAssignments.some.term.sortKey.lt).toBe(300);
  });

  it("isStaffedMentorInTerm is true for a P3 or an external-mentor row", async () => {
    mockPrisma.projectAssignment.findFirst.mockResolvedValue({ id: "pa1" });
    mockPrisma.externalMentor.findFirst.mockResolvedValue(null);
    expect(await isStaffedMentorInTerm("u1", "t1")).toBe(true);

    mockPrisma.projectAssignment.findFirst.mockResolvedValue(null);
    mockPrisma.externalMentor.findFirst.mockResolvedValue({ id: "em1" });
    expect(await isStaffedMentorInTerm("u1", "t1")).toBe(true);

    mockPrisma.projectAssignment.findFirst.mockResolvedValue(null);
    mockPrisma.externalMentor.findFirst.mockResolvedValue(null);
    expect(await isStaffedMentorInTerm("u1", "t1")).toBe(false);
  });
});
