import { describe, it, expect, vi, beforeEach } from "vitest";

const prisma = vi.hoisted(() => ({
  dALIMember: { findUnique: vi.fn() },
  form: { findFirst: vi.fn() },
  formSubmission: { count: vi.fn() },
  user: { findUnique: vi.fn() },
  domain: { findMany: vi.fn() },
  projectAssignment: { findMany: vi.fn(), findFirst: vi.fn() },
  mentorshipPair: { findMany: vi.fn(), groupBy: vi.fn() },
  mentorNote: { count: vi.fn() },
  applicationReview: { count: vi.fn() },
  coreAssignment: { findMany: vi.fn() },
  domainLeadAssignment: { findMany: vi.fn() },
  instructorAssignment: { findMany: vi.fn() },
  technigalaAssignment: { findMany: vi.fn() },
  cECredit: { count: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => u) }));
vi.mock("~/lib/dartmouth-people", () => ({ graduateProgramLabel: vi.fn(() => null) }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn(async () => "tok") }));
vi.mock("~/lib/presence-user", () => ({ getPresenceUser: vi.fn(async () => null) }));
vi.mock("~/members/lib/personal-notes.server", () => ({
  listProfileNotes: vi.fn(async () => []),
  listSharedWithMe: vi.fn(async () => []),
}));
vi.mock("~/lib/user-pages.server", () => ({ favoritePageIds: vi.fn(async () => new Set()) }));
vi.mock("~/members/lib/achievements.server", () => ({ achievementsForMember: vi.fn(async () => []) }));
vi.mock("~/projects/lib/member-staffing.server", () => ({ listMemberStaffingForms: vi.fn(async () => []) }));
vi.mock("~/signing/lib/state.server", () => ({ listMySignedDocuments: vi.fn(async () => []) }));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(async () => false),
  currentTerm: vi.fn(async () => ({ id: "t1", code: "26F" })),
  getUserRoles: vi.fn(async () => ({ isStaff: false, isAlumni: false })),
  instructorRoleLabel: vi.fn(() => "Instructor"),
  isAdmin: vi.fn(async () => false),
  isCore: vi.fn(async () => false),
  isLabMentor: vi.fn(async () => false),
}));
vi.mock("~/lib/groups", () => ({ listActiveGroupsForUser: vi.fn(async () => []) }));
vi.mock("~/lib/group-kind", () => ({
  groupKind: vi.fn(() => "custom"),
  orderGroupsForPicker: vi.fn(() => []),
}));
vi.mock("~/admin/lib/eligibility", () => ({ ALLOWED_LEVELS: [], parseLevel: vi.fn() }));
vi.mock("~/admin/lib/eligibility.server", () => ({}));
vi.mock("~/lib/handle", () => ({ normalizeHandle: vi.fn() }));
vi.mock("~/lib/wallet-token", () => ({ rotateWalletSecret: vi.fn() }));
vi.mock("~/lib/wallet-apns.server", () => ({ pushWalletPassUpdate: vi.fn() }));
vi.mock("~/lib/wallet-apple.server", () => ({ walletAppleConfigured: vi.fn(() => false) }));
vi.mock("~/lib/wallet-google.server", () => ({ walletGoogleConfigured: vi.fn(() => false) }));
vi.mock("~/lib/timezone", () => ({ isValidTimezone: vi.fn() }));
vi.mock("~/lib/geocode.server", () => ({ geocodePlace: vi.fn() }));
vi.mock("~/members/lib/coffee-chat.server", () => ({
  hasOutgoingCoffeeChat: vi.fn(async () => false),
  sendCoffeeChatInvite: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/education/lib/engagement.server", () => ({
  getEducationProfile: vi.fn(async () => ({ attended: [], taught: [], ceCredits: [] })),
}));
vi.mock("~/mentorship/lib/visibility", () => ({
  mentorshipPairWhere: vi.fn(async () => ({})),
  mentorNoteWhere: vi.fn(async () => ({})),
}));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { isAdmin, isCore, isLabMentor } from "~/lib/roles";
import { getEducationProfile } from "~/education/lib/engagement.server";
import { mentorshipPairWhere } from "~/mentorship/lib/visibility";
import { loadProfilePage } from "../profile-page.server";

const request = new Request("http://localhost/members/u2");
const MEMBER = {
  id: "u2",
  firstName: "Ada",
  lastName: "Lovelace",
  photoUrl: null,
  createdAt: new Date("2026-01-01"),
  daliMember: { onboardedAt: new Date("2026-01-02") },
  dartmouthDepartmentClass: null,
  workExperiences: [],
  domainEligibilities: [],
  birthday: null,
  resumeKey: null,
  openToCoffeeChats: false,
  openToResumeReviews: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", email: "ada@example.edu" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(isLabMentor).mockResolvedValue(false);
  prisma.user.findUnique.mockResolvedValue(MEMBER);
  prisma.domain.findMany.mockResolvedValue([]);
  prisma.projectAssignment.findMany.mockResolvedValue([]);
  prisma.projectAssignment.findFirst.mockResolvedValue(null);
  prisma.applicationReview.count.mockResolvedValue(0);
  prisma.coreAssignment.findMany.mockResolvedValue([]);
  prisma.domainLeadAssignment.findMany.mockResolvedValue([]);
  prisma.instructorAssignment.findMany.mockResolvedValue([]);
  prisma.technigalaAssignment.findMany.mockResolvedValue([]);
  prisma.mentorshipPair.findMany.mockResolvedValue([]);
  prisma.mentorNote.count.mockResolvedValue(0);
  prisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: null });
  prisma.form.findFirst.mockResolvedValue({ publicToken: "form-token" });
  prisma.formSubmission.count.mockResolvedValue(0);
});

const run = (targetId = "u2") => loadProfilePage({ request, targetId });

describe("loadProfilePage", () => {
  it("throws a 404 when the member does not exist", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });

  it("redirects a member who has not finished onboarding away from their own profile", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    const err = await run("u1").catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(302);
    expect(err.headers.get("Location")).toBe("/forms/fill/form-token");
  });

  it("does not redirect when the onboarding form was already submitted", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    prisma.formSubmission.count.mockResolvedValue(1);
    await expect(run("u1")).resolves.toMatchObject({ isSelf: true });
  });

  it("does not apply the onboarding gate to someone else's profile", async () => {
    await run();
    expect(prisma.dALIMember.findUnique).not.toHaveBeenCalled();
  });

  it("hides compliance, education and mentorship from an ordinary peer", async () => {
    const data = await run();
    expect(data).toMatchObject({
      isSelf: false,
      canEdit: false,
      canManageEligibility: false,
      compliance: null,
      education: null,
      mentorshipPanel: null,
    });
    expect(getEducationProfile).not.toHaveBeenCalled();
    expect(mentorshipPairWhere).not.toHaveBeenCalled();
  });

  it("shows compliance, education and mentorship to Core without an eligibility ceiling lookup for unstaffed members", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const data = await run();
    expect(data.canManageEligibility).toBe(true);
    expect(data.compliance).toMatchObject({ ce: null, agreements: [], staffingForms: [] });
    expect(data.education).not.toBeNull();
    expect(data.mentorshipPanel).toEqual({ pairs: [], recentNoteCount: 0 });
    expect(prisma.mentorshipPair.groupBy).not.toHaveBeenCalled();
  });

  it("shows the mentorship panel to a lab mentor who is not Core", async () => {
    vi.mocked(isLabMentor).mockResolvedValue(true);
    const data = await run();
    expect(data.canManageEligibility).toBe(false);
    expect(data.mentorshipPanel).not.toBeNull();
    expect(data.compliance).toBeNull();
  });

  it("never shows the mentorship panel on the viewer's own profile", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    prisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: new Date() });
    vi.mocked(isCore).mockResolvedValue(true);
    const data = await run("u1");
    expect(data.mentorshipPanel).toBeNull();
    expect(data.coffeeChatSent).toBe(false);
    expect(data.compliance).not.toBeNull();
  });

  it("lets an admin edit someone else's profile", async () => {
    vi.mocked(isAdmin).mockResolvedValue(true);
    expect((await run()).canEdit).toBe(true);
  });
});
