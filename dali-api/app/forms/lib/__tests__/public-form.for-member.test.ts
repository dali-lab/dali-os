import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn(),
  sendFormReceipt: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { submitStaffingFormFor } from "~/forms/lib/public-form";
import { notifyFormSubmission, sendFormReceipt } from "~/forms/lib/submission-notify.server";
import { logAuditEvent } from "~/lib/audit";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

const QUESTIONS = [
  { key: "back", type: "select", required: true, data: { label: "Coming back?", options: ["Yes", "No"] } },
];
const MAPPING = {
  version: 1,
  entries: [
    {
      role: "intent-status",
      label: "Status — {{term}}",
      source: "question",
      questionKey: "back",
      order: 0,
      statusMap: { Yes: "Returning", No: "Off" },
    },
  ],
};
const BINDING = {
  slot: "intent-to-work",
  columnMapping: MAPPING,
  updatedAt: new Date("2026-11-01T12:00:00Z"),
  formVersionId: null,
  staffingCycle: { id: "cycle-1", termId: "term-1", maxPreferencesPerMember: 3, term: { code: "26F" } },
};
const FORM = {
  id: "form-1",
  versions: [{ id: "ver-1", questions: QUESTIONS, updatedAt: new Date("2026-11-01T00:00:00Z") }],
  cycleBindings: [BINDING],
};

const add = (over: Partial<Parameters<typeof submitStaffingFormFor>[0]> = {}) =>
  submitStaffingFormFor({
    staffingCycleId: "cycle-1",
    slot: "intent-to-work",
    userId: "member-1",
    enteredById: "manager-1",
    versionId: "ver-1",
    answers: { back: "Yes" },
    ...over,
  });

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function" ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma) : Promise.all(fn as Promise<unknown>[]),
  );
  mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ formId: "form-1" });
  mockPrisma.form.findUnique.mockResolvedValue(FORM);
  mockPrisma.user.findFirst.mockResolvedValue({ id: "member-1" });
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.term.findMany.mockResolvedValue([{ id: "term-1" }]);
  mockPrisma.intentToWork = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
});

describe("submitStaffingFormFor", () => {
  it("records the member's response with who added it and writes their intent", async () => {
    expect(await add()).toEqual({ ok: true, submissionId: "sub-1" });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "member-1",
          enteredById: "manager-1",
          staffingCycleId: "cycle-1",
          slot: "intent-to-work",
          answers: { back: "Yes" },
        }),
      }),
    );
    expect(mockPrisma.intentToWork.createMany).toHaveBeenCalledWith({
      data: [{ userId: "member-1", staffingCycleId: "cycle-1", termId: "term-1", status: "Returning" }],
    });
  });

  it("closes the member's todo for the form, sends no receipt or creator notice, and logs it", async () => {
    await add();
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ recipientUserId: "member-1", formId: "form-1" }) }),
    );
    expect(notifyFormSubmission).not.toHaveBeenCalled();
    expect(sendFormReceipt).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "form.response.add",
        userId: "manager-1",
        targetId: "sub-1",
        metadata: { formId: "form-1", slot: "intent-to-work", memberId: "member-1" },
      }),
    );
  });

  it("works while the form is closed", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ ...FORM, published: false });
    expect(await add()).toEqual({ ok: true, submissionId: "sub-1" });
  });

  it("refuses a member who already has a response, saying how to replace it", async () => {
    mockPrisma.formSubmission.findFirst.mockResolvedValue({ id: "old", createdAt: new Date() });
    expect(await add()).toEqual({
      error: "They already have a response for this term. Delete it first to replace it.",
      status: 409,
    });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("checks answers like a member's own submission", async () => {
    const r = await add({ answers: {} });
    expect(r).toMatchObject({ status: 400 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("refuses a term with no form connected, and someone who isn't a member", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValueOnce(null);
    expect(await add()).toEqual({ error: "No form is connected for this term.", status: 404 });
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);
    expect(await add()).toEqual({ error: "That member wasn't found.", status: 404 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("refuses a version edited after the form loaded", async () => {
    const r = await add({ versionUpdatedAt: "2026-10-01T00:00:00.000Z" });
    expect(r).toMatchObject({ status: 409 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });
});
