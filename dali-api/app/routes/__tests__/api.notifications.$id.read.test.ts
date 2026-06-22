import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(
    () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  ),
}));
vi.mock("~/lib/db");
vi.mock("~/members/lib/welcome.server", () => ({
  ONBOARDING_LINK: "/onboarding",
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action } from "~/routes/api.notifications.$id.read";

const USER_ID = "user-1";

const mockPrisma = prisma as unknown as {
  notification: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  (mockPrisma as any).notification = {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  };
});

function unreadReq(id: string) {
  return new Request(`http://localhost/api/notifications/${id}/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "unread" }),
  });
}

describe("POST /api/notifications/:id/read intent=unread", () => {
  it("flips readAt back to null for an owned, cleared row", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "General",
      link: "/x",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { readAt: null },
    });
  });

  it("enforces ownership", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: "someone-else",
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "General",
      link: "/x",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("is a no-op echo for a meeting invite", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: "m1",
      kind: "MeetingInvite",
      link: null,
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("is a no-op echo for the onboarding task", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      link: "/onboarding",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "onboarding" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the row is already unread", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: null,
      kind: "General",
      link: "/x",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });
});
