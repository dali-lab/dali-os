import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn(),
  resolveAllLabMembers: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers, resolveAllLabMembers } from "~/lib/groups";
import { sendAnnouncement } from "~/lib/announcements.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockGroupMembers = resolveGroupMembers as unknown as ReturnType<typeof vi.fn>;
const mockAllMembers = resolveAllLabMembers as unknown as ReturnType<typeof vi.fn>;

function input(overrides: Record<string, unknown> = {}) {
  return {
    createdByUserId: "core-1",
    title: "Hello lab",
    allMembers: false,
    groupIds: [],
    userIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockNotify.mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 });
  mockAllMembers.mockResolvedValue(["u1", "u2"]);
  mockGroupMembers.mockResolvedValue(["u2", "u3"]);
  mockPrisma.form.findUnique.mockResolvedValue({ id: "f1", published: true });
});

describe("sendAnnouncement", () => {
  it("rejects an empty audience without resolving anything", async () => {
    const res = await sendAnnouncement(input());
    expect(res).toEqual({ ok: false, error: "Pick an audience", status: 400 });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("unions and dedupes all audience sources", async () => {
    const res = await sendAnnouncement(
      input({ allMembers: true, groupIds: ["g1"], userIds: ["u1", "u4"] }),
    );
    expect(res).toEqual({ ok: true, count: 2 });
    const call = mockNotify.mock.calls[0][0];
    expect(call.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
    // Mixed audience → no provenance group.
    expect(call.message.sourceGroupId).toBeNull();
  });

  it("keeps sourceGroupId only for a pure single-group send", async () => {
    await sendAnnouncement(input({ groupIds: ["g1"] }));
    expect(mockNotify.mock.calls[0][0].message.sourceGroupId).toBe("g1");
  });

  it("fails when the attached form is unpublished or missing", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "f1", published: false });
    let res = await sendAnnouncement(input({ userIds: ["u1"], formId: "f1" }));
    expect(res).toMatchObject({ ok: false, status: 400 });

    mockPrisma.form.findUnique.mockResolvedValue(null);
    res = await sendAnnouncement(input({ userIds: ["u1"], formId: "f1" }));
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("dispatches through notify() with the announcement eventType and payload", async () => {
    await sendAnnouncement(
      input({
        userIds: ["u1"],
        kind: "SystemAnnouncement",
        isTodo: true,
        formId: "f1",
        body: "Read me",
      }),
    );
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "announcement",
        createdByUserId: "core-1",
        message: expect.objectContaining({
          kind: "SystemAnnouncement",
          title: "Hello lab",
          body: "Read me",
          isTodo: true,
          formId: "f1",
        }),
      }),
    );
  });
});
