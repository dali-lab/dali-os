import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  upsertStudentNote,
  studentVisibleFeedback,
} from "~/education/lib/student-notes.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("upsertStudentNote", () => {
  it("stamps author + timestamp only on the lanes being written", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      offeringId: "off-1",
    });
    mockPrisma.educationStudentNote.upsert.mockResolvedValue({});

    await upsertStudentNote({
      applicationId: "app-1",
      actorId: "instr-1",
      internalNote: "strong engagement",
      // feedback intentionally omitted — must remain untouched.
    });

    const call = mockPrisma.educationStudentNote.upsert.mock.calls[0][0];
    expect(call.update.internalNote).toBe("strong engagement");
    expect(call.update.internalNoteAuthorId).toBe("instr-1");
    expect(call.update).not.toHaveProperty("feedback");
    expect(call.update).not.toHaveProperty("feedbackAuthorId");
  });

  it("empties a lane to null rather than deleting the row", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      offeringId: "off-1",
    });
    mockPrisma.educationStudentNote.upsert.mockResolvedValue({});

    await upsertStudentNote({
      applicationId: "app-1",
      actorId: "instr-1",
      feedback: "   ",
    });

    const call = mockPrisma.educationStudentNote.upsert.mock.calls[0][0];
    expect(call.update.feedback).toBeNull();
  });
});

describe("studentVisibleFeedback — the leakage boundary", () => {
  it("never selects the internal lane from the database", async () => {
    mockPrisma.educationStudentNote.findUnique.mockResolvedValue({
      feedback: "great work",
      feedbackUpdatedAt: new Date(),
      feedbackAuthor: { firstName: "Ada", lastName: "L" },
    });

    await studentVisibleFeedback("app-1");

    const select = mockPrisma.educationStudentNote.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("internalNote");
    expect(select).not.toHaveProperty("internalNoteAuthor");
  });

  it("returns a shape with no internalNote key", async () => {
    mockPrisma.educationStudentNote.findUnique.mockResolvedValue({
      feedback: "great work",
      feedbackUpdatedAt: null,
      feedbackAuthor: null,
    });

    const result = await studentVisibleFeedback("app-1");

    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(["feedback", "updatedAt", "authorName"]);
    expect(JSON.stringify(result)).not.toContain("internal");
  });

  it("returns null when only an internal note exists (empty feedback lane)", async () => {
    mockPrisma.educationStudentNote.findUnique.mockResolvedValue({
      feedback: null,
      feedbackUpdatedAt: null,
      feedbackAuthor: null,
    });

    const result = await studentVisibleFeedback("app-1");

    expect(result).toBeNull();
  });
});
