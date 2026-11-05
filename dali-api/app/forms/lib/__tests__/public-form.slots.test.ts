import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
  sendFormReceipt: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { submitMemberForm } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const mockNotify = notifyFormSubmission as ReturnType<typeof vi.fn>;

const QUESTIONS = [
  { key: "q1", type: "textarea", required: false, data: { label: "Who?" } },
];

const SUBMITTER_MAPPING = {
  version: 1,
  entries: [{ source: "builtin", builtin: "submitter", role: "display", label: "Name", visible: true }],
};

function binding(slot: string, overrides: Record<string, unknown> = {}) {
  return {
    slot,
    columnMapping: SUBMITTER_MAPPING,
    updatedAt: new Date("2026-11-01T12:00:00Z"),
    staffingCycle: {
      id: "cycle-1",
      termId: "term-1",
      maxPreferencesPerMember: 3,
      term: { code: "26F" },
    },
    ...overrides,
  };
}

function boundForm(...cycleBindings: unknown[]) {
  return {
    id: "form-1",
    name: "Bound Form",
    published: true,
    oneResponsePerMember: false,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings,
  };
}

function submit() {
  return submitMemberForm({
    token: "tok",
    versionId: "ver-1",
    userId: "user-1",
    answers: { q1: "hi" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(fn as Promise<unknown>[]),
  );
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.term.findFirst.mockResolvedValue(null);
  mockPrisma.term.findMany.mockResolvedValue([{ id: "term-1" }]);
  mockPrisma.intentToWork = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
});

describe.each(["level-up"])("submitMemberForm: %s slot", (slot) => {
  beforeEach(() => {
    mockPrisma.form.findUnique.mockResolvedValue(boundForm(binding(slot)));
  });

  it("records the submission under its own slot and cycle", async () => {
    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          staffingCycleId: "cycle-1",
          slot,
          answers: { q1: "hi" },
        }),
      }),
    );
  });

  it("leaves the member's Intent to Work rows alone", async () => {
    await submit();

    expect(mockPrisma.intentToWork.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.intentToWork.createMany).not.toHaveBeenCalled();
  });

  it("closes the form todo and notifies", async () => {
    await submit();

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("still records when the column mapping is missing", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      boundForm(binding(slot, { columnMapping: null })),
    );

    expect(await submit()).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slot }) }),
    );
  });

  it("rejects a second submission for the same slot", async () => {
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });

    expect(await submit()).toEqual({
      error: "You've already filled out this form.",
      status: 409,
    });
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ slot, userId: "user-1" }),
      }),
    );
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("reports already filled when the unique constraint catches a race", async () => {
    mockPrisma.formSubmission.create.mockRejectedValue({ code: "P2002" });

    expect(await submit()).toEqual({
      error: "You've already filled out this form.",
      status: 409,
    });
  });
});

describe("submitMemberForm: intent-to-work slot", () => {
  it("still records intent and replaces the member's intent rows", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      boundForm(binding("intent-to-work")),
    );

    expect(await submit()).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slot: "intent-to-work" }),
      }),
    );
    expect(mockPrisma.intentToWork.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", staffingCycleId: "cycle-1" },
    });
  });
});
