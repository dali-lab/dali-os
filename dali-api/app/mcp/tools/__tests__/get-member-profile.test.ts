import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn().mockResolvedValue("https://cdn.example.com/photo.jpg"),
}));
vi.mock("~/members/lib/achievements.server", () => ({
  achievementsForMember: vi.fn().mockResolvedValue([
    { key: "onboarded", title: "First Light", description: "Joined the lab.", earned: true },
  ]),
}));
vi.mock("~/education/lib/engagement.server", () => ({
  getEducationProfile: vi.fn().mockResolvedValue({
    attended: [],
    taught: [],
    ceCredits: [],
  }),
}));
vi.mock("~/lib/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/roles")>();
  return {
    ...actual,
    isAdminViaEnv: vi.fn().mockReturnValue(false),
    isCore: vi.fn().mockResolvedValue(false),
  };
});

import { prisma } from "~/lib/db";
import { getEducationProfile } from "~/education/lib/engagement.server";
import { isCore } from "~/lib/roles";
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

const BASE_USER = {
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
  linkedinUrl: "https://linkedin.com/in/grace",
  githubUsername: "gracehopper",
  personalSite: "https://grace.dev",
  handle: "grace",
  photoUrl: "gs://bucket/grace.jpg",
  timeZone: "America/New_York",
  phoneNumber: "+16035550123",
  birthday: new Date("1906-12-09T00:00:00Z"),
  dietaryRestrictions: "Vegetarian",
  daliMember: { id: "dm-1", createdAt: new Date("2025-09-01T00:00:00Z") },
  adminMembership: null,
  coreAssignments: [],
  domainLeadAssignmentsAsUser: [],
  domainEligibilities: [
    { level: "P2", domain: { id: "d1", displayName: "Fullstack Dev" } },
  ],
  projectAssignments: [
    {
      id: "pa-1",
      level: "P2",
      project: { id: "proj-1", name: "DALI OS", iconEmoji: null },
      domain: { name: "Fullstack Dev" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1", code: "26S" });
  vi.mocked(isCore).mockResolvedValue(false);
});

describe("get_member_profile", () => {
  it("requires mcp:read", () => {
    expect(GET_MEMBER_PROFILE_TOOL.requiredScope).toBe("mcp:read");
  });

  // ── Privacy gates ─────────────────────────────────────────────────────────

  it("includes private fields when caller is the same member (self)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-target", { memberId: "u-target" });
    expect(out.personalEmail).toBe("grace@personal.com");
    expect(out.netId).toBe("f099xyz");
    expect(out.phoneNumber).toBe("+16035550123");
    expect(out.timezone).toBe("America/New_York");
    expect(out.dietaryRestrictions).toBe("Vegetarian");
  });

  it("hides private fields when caller ≠ memberId (privacy gate)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-other", { memberId: "u-target" });
    expect(out.personalEmail).toBeNull();
    expect(out.netId).toBeNull();
    expect(out.phoneNumber).toBeNull();
    expect(out.timezone).toBeNull();
    expect(out.dietaryRestrictions).toBeNull();
  });

  // ── Public fields ─────────────────────────────────────────────────────────

  it("returns public profile fields for any authenticated caller", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-other", { memberId: "u-target" });
    expect(out.daliEmail).toBe("grace@dali.dartmouth.edu");
    expect(out.dartmouthEmail).toBe("grace@dartmouth.edu");
    expect(out.pronouns).toBe("she/her");
    expect(out.classYear).toBe(2027);
    expect(out.major).toBe("CS");
    expect(out.hometown).toBe("NYC");
    expect(out.githubUsername).toBe("gracehopper");
    expect(out.linkedinUrl).toBe("https://linkedin.com/in/grace");
    expect(out.handle).toBe("grace");
    expect(out.photoUrl).toBe("https://cdn.example.com/photo.jpg");
    expect(out.tier).toBe("member");
    expect(out.domains[0]).toMatchObject({ name: "Fullstack Dev", eligibility: "P2" });
    expect(out.projectAssignments[0]).toMatchObject({ level: "P2", domain: { name: "Fullstack Dev" } });
    expect(out.achievements).toHaveLength(1);
    expect(out.achievements[0]).toMatchObject({ key: "onboarded", earned: true });
  });

  // ── Education gating ──────────────────────────────────────────────────────

  it("includes education profile when caller is self", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-target", { memberId: "u-target" });
    expect(out.education).not.toBeNull();
    expect(getEducationProfile).toHaveBeenCalledWith("u-target");
  });

  it("includes education profile when caller is Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-core", { memberId: "u-target" });
    expect(out.education).not.toBeNull();
  });

  it("hides education profile for non-Core peer callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    mockPrisma.user.findUnique.mockResolvedValue(BASE_USER);
    const out = await runGetMemberProfile("u-other", { memberId: "u-target" });
    expect(out.education).toBeNull();
    expect(getEducationProfile).not.toHaveBeenCalled();
  });

  // ── Error cases ───────────────────────────────────────────────────────────

  it("throws MemberNotFoundError when no daliMember row exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...BASE_USER, daliMember: null });
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
