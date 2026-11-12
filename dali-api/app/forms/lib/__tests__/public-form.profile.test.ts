import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
  sendFormReceipt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/members/lib/welcome.server", () => ({ clearOnboardingTask: vi.fn() }));
vi.mock("~/slack/lib/slack-sync.server", () => ({ syncSlackUserId: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { submitMemberForm } from "~/forms/lib/public-form";
import { clearOnboardingTask } from "~/members/lib/welcome.server";
import { syncSlackUserId } from "~/slack/lib/slack-sync.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const QUESTIONS = [
  { key: "profile.pronouns", type: "text", required: false, data: { label: "Pronouns" } },
];

function submit() {
  return submitMemberForm({
    token: "tok",
    versionId: "ver-1",
    userId: "user-1",
    answers: { "profile.pronouns": "she/her" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(mockPrisma),
  );
  mockPrisma.form.findUnique.mockResolvedValue({
    id: "form-1",
    name: "Welcome to DALI! 👋",
    published: true,
    oneResponsePerMember: false,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings: [],
  });
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.term.findFirst.mockResolvedValue(null);
  mockPrisma.dALIMember.findUnique.mockResolvedValue({ userId: "user-1" });
  mockPrisma.onboardingProfileFormBinding.findFirst.mockResolvedValue(null);
  vi.mocked(syncSlackUserId).mockResolvedValue(undefined as never);
});

describe("submitMemberForm onboarding profile", () => {
  it("writes the profile and finishes onboarding on the bound form", async () => {
    mockPrisma.onboardingProfileFormBinding.findFirst.mockResolvedValue({ id: "b1" });
    expect(await submit()).toEqual({ ok: true });
    expect(mockPrisma.onboardingProfileFormBinding.findFirst).toHaveBeenCalledWith({
      where: { formId: "form-1" },
      select: { id: true },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { pronouns: "she/her" },
    });
    expect(mockPrisma.dALIMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", onboardedAt: null },
      data: { onboardedAt: expect.any(Date) },
    });
    expect(clearOnboardingTask).toHaveBeenCalledWith("user-1");
  });

  it("treats an unbound form as ordinary even with the old name", async () => {
    expect(await submit()).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.dALIMember.updateMany).not.toHaveBeenCalled();
    expect(clearOnboardingTask).not.toHaveBeenCalled();
  });

  it("leaves a non-member's profile alone on the bound form", async () => {
    mockPrisma.onboardingProfileFormBinding.findFirst.mockResolvedValue({ id: "b1" });
    mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
    await submit();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.dALIMember.updateMany).not.toHaveBeenCalled();
  });
});
