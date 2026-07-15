import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";

const mockPrisma = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
};

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Lab Survey",
    createdById: "creator-1",
    notifyOnSubmission: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.form.findUnique.mockResolvedValue(formRow());
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: "Ada",
    lastName: "Lovelace",
  });
  mockPrisma.notification.create.mockResolvedValue({ id: "n-1" });
});

describe("notifyFormSubmission", () => {
  it("notifies the creator with title, submitter, and responses link", async () => {
    await notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" });

    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientUserId: "creator-1",
        createdByUserId: "user-2",
        kind: "General",
        title: "New response: Lab Survey",
        body: "From Ada Lovelace",
        link: "/forms/responses/form-1",
      },
    });
  });

  it("does nothing when the toggle is off", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ notifyOnSubmission: false }),
    );
    await notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" });
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it("skips the creator's own submission", async () => {
    await notifyFormSubmission({
      formId: "form-1",
      submitterUserId: "creator-1",
    });
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it("falls back to 'Anonymous' without a user or name", async () => {
    await notifyFormSubmission({ formId: "form-1" });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdByUserId: null,
          body: "From Anonymous",
        }),
      }),
    );
  });

  it("uses the provided submitter name for unauthenticated fills", async () => {
    await notifyFormSubmission({ formId: "form-1", submitterName: "Guest" });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "From Guest" }),
      }),
    );
  });

  it("swallows notification failures", async () => {
    mockPrisma.notification.create.mockRejectedValue(new Error("db down"));
    await expect(
      notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" }),
    ).resolves.toBeUndefined();
  });
});
