import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import {
  submitMemberForm,
  ordinaryFillBlock,
} from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const mockNotify = notifyFormSubmission as ReturnType<typeof vi.fn>;

const QUESTIONS = [
  { key: "q1", type: "textarea", required: false, data: { label: "Thoughts?" } },
];

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Ordinary Form",
    published: true,
    oneResponsePerMember: false,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings: [],
    ...overrides,
  };
}

const ORDINARY_WHERE = {
  formId: "form-1",
  userId: "user-1",
  slot: null,
  staffingCycleId: null,
  educationOfferingId: null,
  educationSessionId: null,
};

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
  mockPrisma.form.findUnique.mockResolvedValue(formRow());
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.term.findFirst.mockResolvedValue(null);
});

describe("submitMemberForm one-response gate", () => {
  it("409s a second ordinary submission when the toggle is on", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ oneResponsePerMember: true }),
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: new Date("2026-07-01T12:00:00Z"),
    });

    const result = await submit();

    expect(result).toEqual({
      error: "You've already filled out this form.",
      status: 409,
    });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("defines 'ordinary' with the unscoped where-clause", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ oneResponsePerMember: true }),
    );

    await submit();

    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: ORDINARY_WHERE }),
    );
  });

  it("accepts a first submission when the toggle is on, and notifies", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ oneResponsePerMember: true }),
    );

    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith({
      formId: "form-1",
      submitterUserId: "user-1",
    });
  });

  it("never queries for duplicates when the toggle is off", async () => {
    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("lets slot-bound forms resubmit regardless of the toggle", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({
        oneResponsePerMember: true,
        cycleBindings: [
          {
            slot: "level-up",
            columnMapping: null,
            updatedAt: new Date("2026-07-01"),
            staffingCycle: {
              id: "cyc-1",
              termId: "term-1",
              maxPreferencesPerMember: 3,
            },
          },
        ],
      }),
    );
    // Even with a prior ordinary-looking row on file, the slot branch is
    // taken before the gate can run.
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: new Date(),
    });

    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slot: "level-up" }),
      }),
    );
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("lets education-context fills resubmit regardless of the toggle", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ oneResponsePerMember: true }),
    );
    mockPrisma.educationSession.findUnique.mockResolvedValue({
      id: "sess-1",
      offeringId: "off-1",
    });
    mockPrisma.educationFormBinding.findUnique.mockResolvedValue({
      formId: "form-1",
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      status: "Approved",
    });
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: new Date(),
    });

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "hi" },
      education: { sessionId: "sess-1" },
    });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

describe("ordinaryFillBlock", () => {
  it("returns null when the toggle is off", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      oneResponsePerMember: false,
      cycleBindings: [],
    });
    expect(await ordinaryFillBlock("form-1", "user-1")).toBeNull();
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("returns null for a slot-bound form even with a prior submission", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      oneResponsePerMember: true,
      cycleBindings: [
        {
          slot: "project-bids",
          updatedAt: new Date(),
          staffingCycle: { termId: "term-1" },
        },
      ],
    });
    expect(await ordinaryFillBlock("form-1", "user-1")).toBeNull();
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("returns the first submission's timestamp when blocked", async () => {
    const at = new Date("2026-07-01T12:00:00Z");
    mockPrisma.form.findUnique.mockResolvedValue({
      oneResponsePerMember: true,
      cycleBindings: [],
    });
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: at,
    });
    expect(await ordinaryFillBlock("form-1", "user-1")).toEqual({ at });
  });
});
