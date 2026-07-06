import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { submitMemberForm } from "~/forms/lib/public-form";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const QUESTIONS = [
  { key: "q1", type: "textarea", required: false, data: { label: "Thoughts?" } },
];

function formRow() {
  return {
    id: "form-1",
    name: "Session Feedback",
    published: true,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(fn as Promise<unknown>[]),
  );
  mockPrisma.form.findUnique.mockResolvedValue(formRow());
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
});

describe("submitMemberForm education branch", () => {
  it("records the session context and closes ONLY that session's todo", async () => {
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

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "great" },
      education: { sessionId: "sess-1" },
    });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slot: "session-feedback",
          educationOfferingId: "off-1",
          educationSessionId: "sess-1",
        }),
      }),
    );
    // Targeted close: link must match this exact session's query — a
    // formId-wide close would wipe every other pending session todo.
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          formId: "form-1",
          link: { contains: "?session=sess-1" },
        }),
      }),
    );
  });

  it("rejects a submitter who isn't an approved enrollee", async () => {
    mockPrisma.educationSession.findUnique.mockResolvedValue({
      id: "sess-1",
      offeringId: "off-1",
    });
    mockPrisma.educationFormBinding.findUnique.mockResolvedValue({
      formId: "form-1",
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      status: "Waitlisted",
    });

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "great" },
      education: { sessionId: "sess-1" },
    });

    expect(result).toMatchObject({ status: 403 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("rejects a session context whose offering isn't bound to this form", async () => {
    mockPrisma.educationSession.findUnique.mockResolvedValue({
      id: "sess-1",
      offeringId: "off-1",
    });
    // Bound to a DIFFERENT form.
    mockPrisma.educationFormBinding.findUnique.mockResolvedValue({
      formId: "form-other",
    });

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "great" },
      education: { sessionId: "sess-1" },
    });

    expect(result).toMatchObject({ status: 403 });
  });

  it("validates the instructor-exit slot against InstructorAssignment", async () => {
    mockPrisma.educationFormBinding.findUnique.mockResolvedValue({
      formId: "form-1",
    });
    mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "went well" },
      education: { offeringId: "off-1" },
    });

    expect(result).toMatchObject({ status: 403 });

    mockPrisma.instructorAssignment.findFirst.mockResolvedValue({ id: "ia-1" });
    const ok = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "went well" },
      education: { offeringId: "off-1" },
    });
    expect(ok).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slot: "instructor-exit",
          educationOfferingId: "off-1",
          educationSessionId: null,
        }),
      }),
    );
  });
});
