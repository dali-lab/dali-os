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
vi.mock("~/wallet/lib/wallet-token.server", () => ({ rotateWalletSecret: vi.fn() }));
vi.mock("~/wallet/lib/wallet-apns.server", () => ({ pushWalletPassUpdate: vi.fn() }));
vi.mock("~/wallet/lib/wallet-apple.server", () => ({ walletAppleConfigured: vi.fn(() => false) }));
vi.mock("~/wallet/lib/wallet-google.server", () => ({ walletGoogleConfigured: vi.fn(() => false) }));
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

import { requireAuth, redirectNonMemberToPortal, isImpersonating } from "~/lib/auth";
import { listProfileNotes, listSharedWithMe } from "~/members/lib/personal-notes.server";
import { walletAppleConfigured } from "~/wallet/lib/wallet-apple.server";
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

describe("loadProfilePage private data", () => {
  const RESUME = {
    resumeKey: "k",
    resumeFileName: "ada.pdf",
    resumeSizeBytes: 10,
    resumeUploadedAt: new Date("2026-02-01T00:00:00Z"),
  };

  it("never sends the resume file key and shows the resume only to the member or an admin", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, ...RESUME });
    const peer = await run();
    expect(peer.resume).toBeNull();
    expect(JSON.stringify(peer)).not.toContain('"resumeKey"');

    vi.mocked(isAdmin).mockResolvedValue(true);
    expect((await run()).resume).toEqual({
      fileName: "ada.pdf",
      uploadedAt: "2026-02-01T00:00:00.000Z",
      sizeBytes: 10,
    });
  });

  it("does not offer the resume to Core alone", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, ...RESUME });
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await run()).resume).toBeNull();
  });

  it("asks for the profile's notes as the viewer and skips the inbox on someone else's profile", async () => {
    await run();
    expect(listProfileNotes).toHaveBeenCalledWith("u2", "u1");
    expect(listSharedWithMe).not.toHaveBeenCalled();
  });

  it("shows the viewer's 'shared with me' inbox only on their own profile", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    prisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: new Date() });
    await run("u1");
    expect(listSharedWithMe).toHaveBeenCalledWith("u1");
  });

  it("hides every note and the inbox while an admin is impersonating", async () => {
    vi.mocked(isImpersonating).mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    prisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: new Date() });
    vi.mocked(listProfileNotes).mockResolvedValue([{ id: "private" }] as never);
    const data = await run("u1");
    expect(data.notes).toEqual([]);
    expect(data.sharedWithMe).toEqual([]);
    expect(listProfileNotes).not.toHaveBeenCalled();
    expect(listSharedWithMe).not.toHaveBeenCalled();
    vi.mocked(isImpersonating).mockReturnValue(false);
  });

  it("gives wallet details only to the member, and pass revocation to the member or Core", async () => {
    vi.mocked(walletAppleConfigured).mockReturnValue(true);
    const peer = await run();
    expect(peer.wallet).toBeNull();
    expect(peer.canRevokeWalletPass).toBe(false);

    vi.mocked(isCore).mockResolvedValue(true);
    const core = await run();
    expect(core.wallet).toBeNull();
    expect(core.canRevokeWalletPass).toBe(true);

    prisma.user.findUnique.mockResolvedValue({ ...MEMBER, id: "u1" });
    prisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: new Date() });
    vi.mocked(isCore).mockResolvedValue(false);
    const self = await run("u1");
    expect(self.wallet).toEqual({ apple: true, google: false });
    expect(self.canRevokeWalletPass).toBe(true);
    vi.mocked(walletAppleConfigured).mockReturnValue(false);
  });

  it("shows the eligibility ceiling and mentee counts only to Core, for the current term", async () => {
    const row = {
      id: "a1",
      level: "P2",
      domainId: "d1",
      projectId: "p1",
      project: { id: "p1", name: "Analytical Engine", iconEmoji: null },
      domain: { name: "Engineering" },
      term: { id: "t1", code: "26F", sortKey: 20263 },
    };
    prisma.projectAssignment.findMany.mockResolvedValue([row]);
    prisma.user.findUnique.mockResolvedValue({
      ...MEMBER,
      domainEligibilities: [{ id: "e1", level: "P3", domain: { id: "d1", displayName: "Engineering" } }],
    });
    prisma.mentorshipPair.groupBy.mockResolvedValue([{ projectId: "p1", domainId: "d1", _count: { _all: 2 } }]);

    const peer = await run();
    expect(peer.projectHistory[0].assignments[0]).toMatchObject({ eligibilityLevel: null, activeMenteeCount: 0 });
    expect(prisma.mentorshipPair.groupBy).not.toHaveBeenCalled();

    vi.mocked(isCore).mockResolvedValue(true);
    const core = await run();
    expect(prisma.mentorshipPair.groupBy.mock.calls[0][0].where).toEqual({ mentorUserId: "u2", termId: "t1" });
    expect(core.projectHistory[0].assignments[0]).toMatchObject({ eligibilityLevel: "P3", activeMenteeCount: 2 });
  });

  it("labels the hired roles held this term", async () => {
    prisma.coreAssignment.findMany.mockResolvedValue([{ leadTitle: "Director" }, { leadTitle: null }]);
    prisma.domainLeadAssignment.findMany.mockResolvedValue([{ domain: { displayName: "Engineering" } }]);
    prisma.instructorAssignment.findMany.mockResolvedValue([{ offering: { title: "Intro", type: "Class" } }]);
    prisma.technigalaAssignment.findMany.mockResolvedValue([{ id: "t" }]);
    const data = await run();
    expect(data.roleLabels).toEqual([
      "Core — Director",
      "Core",
      "Engineering Lead",
      "Instructor",
      "Technigala Support",
    ]);
  });

  it("only flags the reviews row when the member has unsubmitted reviews", async () => {
    prisma.applicationReview.count.mockResolvedValue(3);
    const data = await run();
    expect(data).toMatchObject({ pendingReviews: 3, showReviewsRow: true });
  });

  it("serialises dates and omits the raw department class", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...MEMBER,
      birthday: new Date("1815-12-10T00:00:00Z"),
      dartmouthDepartmentClass: "GR_TH",
    });
    const data = await run();
    expect(data.member.birthday).toBe("1815-12-10T00:00:00.000Z");
    expect(data.member.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(data.member.onboardedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(data.member).not.toHaveProperty("dartmouthDepartmentClass");
  });
});
