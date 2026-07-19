import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";

const mockPrisma = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

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
  mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("notifyFormSubmission", () => {
  it("notifies the creator with title, submitter, and responses link", async () => {
    await notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" });

    expect(mockNotify).toHaveBeenCalledWith({
      eventType: "form.submission",
      createdByUserId: "user-2",
      message: {
        title: "New response: Lab Survey",
        body: "From Ada Lovelace",
        link: "/forms/responses/form-1",
      },
      recipients: [{ userId: "creator-1" }],
    });
  });

  it("does nothing when the toggle is off", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ notifyOnSubmission: false }),
    );
    await notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips the creator's own submission", async () => {
    await notifyFormSubmission({
      formId: "form-1",
      submitterUserId: "creator-1",
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("falls back to 'Anonymous' without a user or name", async () => {
    await notifyFormSubmission({ formId: "form-1" });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserId: null,
        message: expect.objectContaining({ body: "From Anonymous" }),
      }),
    );
  });

  it("uses the provided submitter name for unauthenticated fills", async () => {
    await notifyFormSubmission({ formId: "form-1", submitterName: "Guest" });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ body: "From Guest" }),
      }),
    );
  });

  it("swallows notification failures", async () => {
    mockNotify.mockRejectedValue(new Error("db down"));
    await expect(
      notifyFormSubmission({ formId: "form-1", submitterUserId: "user-2" }),
    ).resolves.toBeUndefined();
  });
});
