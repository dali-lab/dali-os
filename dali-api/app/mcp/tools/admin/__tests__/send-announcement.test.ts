import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    form: { findUnique: vi.fn() },
    scheduledAnnouncement: { create: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
}));
vi.mock("~/lib/announcements.server", () => ({
  sendAnnouncement: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { sendAnnouncement } from "~/lib/announcements.server";
import { runSendAnnouncement, SEND_ANNOUNCEMENT_TOOL } from "~/mcp/tools/admin/send-announcement";

const mockPrisma = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn> };
  scheduledAnnouncement: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("send_announcement", () => {
  it("requires the mcp:admin scope", () => {
    expect(SEND_ANNOUNCEMENT_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(
      runSendAnnouncement("u-nobody", { title: "Hello", allMembers: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  });

  it("throws McpInvalidError when no audience is provided for immediate send", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    // sendAnnouncement returns an error when no audience resolves
    vi.mocked(sendAnnouncement).mockResolvedValue({ ok: false, error: "Pick an audience", status: 400 });

    await expect(
      runSendAnnouncement("u-core", { title: "No audience" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
  });

  it("throws McpInvalidError when no audience is provided for a scheduled send", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    // sendAt far in the future
    const sendAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      runSendAnnouncement("u-core", { title: "No audience", sendAt }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
  });

  it("calls sendAnnouncement and returns count on happy path", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(sendAnnouncement).mockResolvedValue({ ok: true, count: 42 });

    const out = await runSendAnnouncement("u-core", {
      title: "Important update",
      body: "Read this!",
      allMembers: true,
    });

    expect(sendAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserId: "u-core",
        title: "Important update",
        body: "Read this!",
        allMembers: true,
      }),
    );
    expect(out).toEqual({ ok: true, count: 42 });
  });

  it("schedules a future announcement and returns the scheduled id", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.scheduledAnnouncement.create.mockResolvedValue({
      id: "sa-1",
      sendAt: new Date(Date.now() + 3_600_000),
    });

    const sendAt = new Date(Date.now() + 3_600_000).toISOString();
    const out = await runSendAnnouncement("u-core", {
      title: "Future announcement",
      groupIds: ["g1"],
      sendAt,
    });

    expect(mockPrisma.scheduledAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdByUserId: "u-core",
          title: "Future announcement",
          groupIds: ["g1"],
        }),
      }),
    );
    expect(out).toMatchObject({ ok: true, scheduled: true, id: "sa-1" });
    // sendAnnouncement should NOT have been called
    expect(sendAnnouncement).not.toHaveBeenCalled();
  });

  it("throws McpNotFoundError when scheduled send references a missing form", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue(null);

    const sendAt = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      runSendAnnouncement("u-core", {
        title: "Form announcement",
        allMembers: true,
        formId: "form-missing",
        sendAt,
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
  });

  it("throws McpInvalidError when scheduled send references an unpublished form", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.form.findUnique.mockResolvedValue({ published: false });

    const sendAt = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      runSendAnnouncement("u-core", {
        title: "Form announcement",
        allMembers: true,
        formId: "form-draft",
        sendAt,
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
  });
});
