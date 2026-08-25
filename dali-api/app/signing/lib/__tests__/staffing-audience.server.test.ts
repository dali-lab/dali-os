import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/new-member-cohort.server", () => ({
  getNewMemberCohortIds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getNewMemberCohortIds } from "~/hiring/lib/new-member-cohort.server";
import {
  partitionStaffedMembers,
  listStaffedMentors,
  isStaffedInTerm,
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
    // Staffed roster this term: u1, u2 (project) + u3 (core).
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([{ userId: "u3" }]);
    // Incoming hire cohort: u1, u3 (accepted this cycle); u2 is a returner.
    vi.mocked(getNewMemberCohortIds).mockResolvedValue(new Set(["u1", "u3"]));
  });

  it("splits the staffed roster into the incoming hire cohort (new) and returning", async () => {
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

  it("keeps staffed members outside the hire cohort in returning (pre-DALIOS, no history)", async () => {
    // A staffed member with no accept record must not be miscounted as new.
    vi.mocked(getNewMemberCohortIds).mockResolvedValue(new Set());
    const { newMembers, returning } = await partitionStaffedMembers("t1");
    expect(newMembers).toEqual([]);
    expect(returning.map((p) => p.id).sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("is empty when the term has no staffing", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([]);
    const { newMembers, returning } = await partitionStaffedMembers("t1");
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
