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

  const LEVEL_UP_BINDING = {
    slot: "level-up",
    columnMapping: null,
    updatedAt: new Date("2026-07-01"),
    staffingCycle: {
      id: "cyc-1",
      termId: "term-1",
      maxPreferencesPerMember: 3,
    },
  };

  it("409s a second slot-bound submission (one-and-done)", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ cycleBindings: [LEVEL_UP_BINDING] }),
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
    // Keyed on the bound tuple, not the unscoped ordinary where-clause.
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          staffingCycleId: { in: ["cyc-1"] },
          slot: "level-up",
        },
      }),
    );
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("409s when the prior submission sits under another cycle the form is bound to", async () => {
    // The prod bug: bound to both the 26F and 27W cycles' slot. The fill
    // records against the most recently bound cycle, but a row under EITHER
    // one means they've filled it — the per-cycle @@unique can't see that.
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({
        cycleBindings: [
          LEVEL_UP_BINDING,
          {
            ...LEVEL_UP_BINDING,
            updatedAt: new Date("2026-09-29"),
            staffingCycle: {
              id: "cyc-2",
              termId: "term-2",
              maxPreferencesPerMember: 3,
            },
          },
        ],
      }),
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: new Date("2026-09-24T12:00:00Z"),
    });

    const result = await submit();

    expect(result).toEqual({
      error: "You've already filled out this form.",
      status: 409,
    });
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          staffingCycleId: { in: ["cyc-1", "cyc-2"] },
        }),
      }),
    );
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("409s the loser of a submit race instead of surfacing the index error", async () => {
    // Both requests pass the read gate, then @@unique rejects the second with
    // P2002. The row is refused either way — the member should read the
    // one-and-done message, not a 500.
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ cycleBindings: [LEVEL_UP_BINDING] }),
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockRejectedValue({ code: "P2002" });

    const result = await submit();

    expect(result).toEqual({
      error: "You've already filled out this form.",
      status: 409,
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("still surfaces a write failure that isn't a duplicate", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ cycleBindings: [LEVEL_UP_BINDING] }),
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockRejectedValue({ code: "P1001" });

    await expect(submit()).rejects.toMatchObject({ code: "P1001" });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("accepts a first slot-bound submission and records it once", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ cycleBindings: [LEVEL_UP_BINDING] }),
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);

    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slot: "level-up",
          staffingCycleId: "cyc-1",
        }),
      }),
    );
    expect(mockNotify).toHaveBeenCalledTimes(1);
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

  it("blocks a slot-bound form once the member has submitted", async () => {
    const at = new Date("2026-07-01T12:00:00Z");
    mockPrisma.form.findUnique.mockResolvedValue({
      // Independent of oneResponsePerMember — bound forms are one-and-done.
      oneResponsePerMember: false,
      cycleBindings: [
        {
          slot: "project-bids",
          updatedAt: new Date(),
          staffingCycle: { id: "cyc-1", termId: "term-1" },
        },
      ],
    });
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-0",
      createdAt: at,
    });
    expect(await ordinaryFillBlock("form-1", "user-1")).toEqual({ at });
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          staffingCycleId: { in: ["cyc-1"] },
          slot: "project-bids",
        },
      }),
    );
  });

  it("returns null for a slot-bound form the member hasn't submitted", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      oneResponsePerMember: false,
      cycleBindings: [
        {
          slot: "project-bids",
          updatedAt: new Date(),
          staffingCycle: { id: "cyc-1", termId: "term-1" },
        },
      ],
    });
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
    expect(await ordinaryFillBlock("form-1", "user-1")).toBeNull();
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
