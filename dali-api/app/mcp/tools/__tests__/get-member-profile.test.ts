import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runGetMemberProfile,
  GET_MEMBER_PROFILE_TOOL,
  MemberNotFoundError,
} from "~/mcp/tools/get-member-profile";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  term: { findFirst: ReturnType<typeof vi.fn> };
};

const FULL_USER = {
  id: "u-target",
  firstName: "Grace",
  lastName: "Hopper",
  daliEmail: "grace@dali.dartmouth.edu",
  dartmouthEmail: "grace@dartmouth.edu",
  netId: "f099xyz",
  personalEmail: "grace@personal.com",
  classYear: 2027,
  bioDocId: null,
  pronouns: "she/her",
  major: "CS",
  hometown: "NYC",
  linkedinUrl: null,
  githubUrl: null,
  personalSite: null,
  daliMember: { id: "dm-1", createdAt: new Date("2025-09-01T00:00:00Z") },
  adminMembership: null,
  coreAssignments: [],
  domainLeadAssignmentsAsUser: [],
  domainEligibilities: [
    { level: "P2", domain: { id: "d1", displayName: "Fullstack Dev" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1", code: "26S" });
});

describe("get_member_profile", () => {
  it("requires mcp:read", () => {
    expect(GET_MEMBER_PROFILE_TOOL.requiredScope).toBe("mcp:read");
  });

  it("includes personalEmail when caller is the same as memberId", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(FULL_USER);
    const out = await runGetMemberProfile("u-target", { memberId: "u-target" });
    expect(out.personalEmail).toBe("grace@personal.com");
    expect(out.tier).toBe("member");
    expect(out.domains[0]).toMatchObject({ name: "Fullstack Dev", eligibility: "P2" });
  });

  it("hides personalEmail when caller ≠ memberId (privacy gate)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(FULL_USER);
    const out = await runGetMemberProfile("u-other", { memberId: "u-target" });
    expect(out.personalEmail).toBeNull();
    expect(out.daliEmail).toBe("grace@dali.dartmouth.edu");
  });

  it("throws MemberNotFoundError when no DALIMember row exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...FULL_USER,
      daliMember: null,
    });
    await expect(
      runGetMemberProfile("u-other", { memberId: "u-target" }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("throws MemberNotFoundError when user does not exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(
      runGetMemberProfile("u-other", { memberId: "missing" }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("rejects missing memberId via the schema validator", () => {
    const r = validateInput({}, GET_MEMBER_PROFILE_TOOL.inputSchema as JsonSchema);
    expect(r.ok).toBe(false);
  });
});
