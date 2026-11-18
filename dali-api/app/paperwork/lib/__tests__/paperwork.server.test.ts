import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    walletPassRegistration: { findFirst: vi.fn() },
    devicePairing: { findFirst: vi.fn() },
    memberClass: { count: vi.fn() },
    partnerReferral: { count: vi.fn() },
    educationCertificate: { count: vi.fn() },
    expense: { count: vi.fn() },
  },
  isFeatureEnabled: vi.fn(),
  currentTerm: vi.fn(),
  getInternalCycleApplyTasks: vi.fn(),
  listCards: vi.fn(),
  listExpenses: vi.fn(),
  loadExpenseViewer: vi.fn(),
  walletAppleConfigured: vi.fn(),
  walletGoogleConfigured: vi.fn(),
  listMemberStaffingForms: vi.fn(),
  listMySignedDocuments: vi.fn(),
  listOutstandingBindings: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("~/lib/roles", () => ({ currentTerm: m.currentTerm }));
vi.mock("~/lib/tasks.server", () => ({ getInternalCycleApplyTasks: m.getInternalCycleApplyTasks }));
vi.mock("~/expenses/lib/cards.server", () => ({ listCards: m.listCards }));
vi.mock("~/expenses/lib/expenses.server", () => ({ listExpenses: m.listExpenses }));
vi.mock("~/expenses/lib/viewer.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));
vi.mock("~/wallet/lib/wallet-apple.server", () => ({ walletAppleConfigured: m.walletAppleConfigured }));
vi.mock("~/wallet/lib/wallet-google.server", () => ({ walletGoogleConfigured: m.walletGoogleConfigured }));
vi.mock("~/projects/lib/member-staffing.server", () => ({ listMemberStaffingForms: m.listMemberStaffingForms }));
vi.mock("~/signing/lib/state.server", () => ({
  listMySignedDocuments: m.listMySignedDocuments,
  listOutstandingBindings: m.listOutstandingBindings,
}));

import { loadPaperworkCount, loadPaperworkInput } from "../paperwork.server";

const NOW = new Date("2026-11-18T12:00:00Z");
const roles = (over = {}) => ({ isStaff: false, isCore: false, isLabMemberOrAlum: true, ...over }) as never;
const request = new Request("https://os.example/paperwork");
const viewer = { userId: "u1", isCore: false, isStaff: false, ownedCardIds: [], groupIds: ["g1"] };
const card = (over = {}) => ({ id: "c1", nickname: "Design", last4: "4242", ownerId: "u2", holderIds: ["u1"], holderGroupIds: [], archivedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  m.isFeatureEnabled.mockResolvedValue(true);
  m.currentTerm.mockResolvedValue({ id: "t26f", season: "F", year: 2026 });
  m.getInternalCycleApplyTasks.mockResolvedValue([]);
  m.loadExpenseViewer.mockResolvedValue(viewer);
  m.listExpenses.mockResolvedValue([]);
  m.listCards.mockResolvedValue([]);
  m.walletAppleConfigured.mockReturnValue(true);
  m.walletGoogleConfigured.mockReturnValue(true);
  m.listMemberStaffingForms.mockResolvedValue([]);
  m.listMySignedDocuments.mockResolvedValue([]);
  m.listOutstandingBindings.mockResolvedValue([]);
  m.prisma.user.findUnique.mockResolvedValue({
    email: "ada@dartmouth.edu",
    classYear: 2028,
    graduatedAt: null,
    googleWalletSavedAt: null,
    daliMember: { onboardedAt: new Date() },
  });
  m.prisma.walletPassRegistration.findFirst.mockResolvedValue(null);
  m.prisma.devicePairing.findFirst.mockResolvedValue(null);
  m.prisma.memberClass.count.mockResolvedValue(2);
  m.prisma.partnerReferral.count.mockResolvedValue(1);
  m.prisma.educationCertificate.count.mockResolvedValue(0);
  m.prisma.expense.count.mockResolvedValue(0);
});

describe("loadPaperworkInput", () => {
  it("names the current term and counts its classes for this member only", async () => {
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.termLabel).toBe("Fall 2026");
    expect(input.classCount).toBe(2);
    expect(m.prisma.memberClass.count).toHaveBeenCalledWith({ where: { userId: "u1", termId: "t26f" } });
  });

  it("leaves classes out when there's no term", async () => {
    m.currentTerm.mockResolvedValue(null);
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.termLabel).toBeNull();
    expect(input.classCount).toBeNull();
    expect(m.prisma.memberClass.count).not.toHaveBeenCalled();
  });

  it("reads the member's own sent-back and unpaid expenses", async () => {
    m.listExpenses.mockImplementation(async (_v: unknown, scope: string, filters: { status?: string[]; outstanding?: boolean }) => {
      expect(scope).toBe("mine");
      if (filters.status) return [{ id: "e1", merchant: "Gnomon", totalCents: 4000, decisionNote: "Itemized, please." }];
      return [{ id: "e2" }, { id: "e3" }];
    });
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.returnedExpenses).toEqual([{ id: "e1", merchant: "Gnomon", totalCents: 4000, decisionNote: "Itemized, please." }]);
    expect(input.unpaidExpenseCount).toBe(2);
    expect(m.listExpenses).toHaveBeenCalledWith(viewer, "mine", { status: ["RETURNED"] });
    expect(m.listExpenses).toHaveBeenCalledWith(viewer, "mine", { outstanding: true });
  });

  it("keeps only the staff cards the member can file on", async () => {
    m.listCards.mockResolvedValue([card(), card({ id: "c2", nickname: "Owned", holderIds: [], ownerId: "u9" }), card({ id: "c3", nickname: "Group", holderIds: [], holderGroupIds: ["g1"] })]);
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.fileableCards).toEqual([
      { nickname: "Design", last4: "4242" },
      { nickname: "Group", last4: "4242" },
    ]);
  });

  it("skips every expense query while expenses are off", async () => {
    m.isFeatureEnabled.mockImplementation(async (key: string) => key !== "expenses");
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.expensesEnabled).toBe(false);
    expect(input.returnedExpenses).toEqual([]);
    expect(m.loadExpenseViewer).not.toHaveBeenCalled();
    expect(m.listExpenses).not.toHaveBeenCalled();
  });

  it("skips the referral count while referrals are off", async () => {
    m.isFeatureEnabled.mockImplementation(async (key: string) => key !== "refer-a-partner");
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.referEnabled).toBe(false);
    expect(input.referralCount).toBe(0);
    expect(m.prisma.partnerReferral.count).not.toHaveBeenCalled();
  });

  it("passes signatures, staffing forms and applications through", async () => {
    m.listOutstandingBindings.mockResolvedValue([{ bindingId: "b1", documentId: "d1", documentName: "Term agreement", versionId: "v1", role: "member" }]);
    m.listMySignedDocuments.mockResolvedValue([{}, {}, {}]);
    const forms = [{ slot: "intent-to-work", slotLabel: "Intent", formName: "Intent to work", fillLink: "/forms/fill/t", submitted: false, submittedAt: null }];
    m.listMemberStaffingForms.mockResolvedValue(forms);
    const tasks = [{ id: "a1", title: "Apply to Core", body: "Core 27W", link: "/core/apply/a1", dueAt: null }];
    m.getInternalCycleApplyTasks.mockResolvedValue(tasks);
    const input = await loadPaperworkInput("u1", roles(), request, NOW);
    expect(input.outstandingSignatures).toEqual([{ bindingId: "b1", documentName: "Term agreement" }]);
    expect(input.signedCount).toBe(3);
    expect(input.staffingForms).toBe(forms);
    expect(input.applications).toBe(tasks);
  });

  it("counts a Google save link as the wallet pass being added", async () => {
    m.prisma.user.findUnique.mockResolvedValue({ email: null, classYear: null, graduatedAt: null, googleWalletSavedAt: new Date(), daliMember: null });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).wallet).toEqual({ done: true });
  });

  it("counts an Apple Wallet registration as the wallet pass being added", async () => {
    m.prisma.walletPassRegistration.findFirst.mockResolvedValue({ id: "r1" });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).wallet).toEqual({ done: true });
    expect(m.prisma.walletPassRegistration.findFirst).toHaveBeenCalledWith({ where: { serialNumber: "u1" }, select: { id: true } });
  });

  it("drops the wallet item when no wallet is configured", async () => {
    m.walletAppleConfigured.mockReturnValue(false);
    m.walletGoogleConfigured.mockReturnValue(false);
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).wallet).toBeNull();
  });

  it("asks seniors for an email that outlasts their Dartmouth address", async () => {
    m.prisma.user.findUnique.mockResolvedValue({ email: "ada@dartmouth.edu", classYear: 2027, graduatedAt: null, googleWalletSavedAt: null, daliMember: null });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).graduationEmail).toEqual({ done: false });
    m.prisma.user.findUnique.mockResolvedValue({ email: "ada@example.com", classYear: 2027, graduatedAt: null, googleWalletSavedAt: null, daliMember: null });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).graduationEmail).toEqual({ done: true });
  });

  it("leaves the graduation email out for younger classes and anyone already graduated", async () => {
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).graduationEmail).toBeNull();
    m.prisma.user.findUnique.mockResolvedValue({ email: "a@dartmouth.edu", classYear: 2027, graduatedAt: new Date(), googleWalletSavedAt: null, daliMember: null });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).graduationEmail).toBeNull();
  });

  it("skips onboarding for staff and checks it for members", async () => {
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).onboarding).toEqual({ done: true });
    expect((await loadPaperworkInput("u1", roles({ isStaff: true }), request, NOW)).onboarding).toBeNull();
  });

  it("marks the desktop app done once a pairing has been used", async () => {
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).desktop).toEqual({ done: false });
    m.prisma.devicePairing.findFirst.mockResolvedValue({ id: "p1" });
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).desktop).toEqual({ done: true });
    expect(m.prisma.devicePairing.findFirst).toHaveBeenCalledWith({ where: { userId: "u1", status: "Consumed" }, select: { id: true } });
  });

  it("offers feedback to lab members and Core only", async () => {
    expect((await loadPaperworkInput("u1", roles(), request, NOW)).feedbackEnabled).toBe(true);
    expect((await loadPaperworkInput("u1", roles({ isLabMemberOrAlum: false }), request, NOW)).feedbackEnabled).toBe(false);
    expect((await loadPaperworkInput("u1", roles({ isLabMemberOrAlum: false, isCore: true }), request, NOW)).feedbackEnabled).toBe(true);
  });
});

describe("loadPaperworkCount", () => {
  it("adds sent-back expenses, unsigned documents and unsent staffing forms", async () => {
    m.prisma.expense.count.mockResolvedValue(1);
    m.listOutstandingBindings.mockResolvedValue([{ bindingId: "b1" }, { bindingId: "b2" }]);
    m.listMemberStaffingForms.mockResolvedValue([{ submitted: false }, { submitted: true }]);
    expect(await loadPaperworkCount("u1", roles(), request)).toBe(4);
    expect(m.prisma.expense.count).toHaveBeenCalledWith({ where: { submitterId: "u1", status: "RETURNED" } });
  });

  it("leaves expenses out of the count while they're off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    m.prisma.expense.count.mockResolvedValue(5);
    expect(await loadPaperworkCount("u1", roles(), request)).toBe(0);
    expect(m.prisma.expense.count).not.toHaveBeenCalled();
  });
});
