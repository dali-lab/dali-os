import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(
    () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  ),
}));
vi.mock("~/lib/db");
vi.mock("~/members/lib/welcome.server", () => ({
  ONBOARDING_EVENT_TYPE: "member.onboarding",
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

  it("allows unread for a MeetingReminder that has scheduledMeetingId", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: "m1",
      kind: "MeetingReminder",
      link: "/calendar?meeting=m1",
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

  it("is a no-op echo for the onboarding task", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      eventType: "member.onboarding",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "onboarding" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("allows unread for an onboarding reminder (not the welcome todo)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      eventType: "member.onboarding.reminder",
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

  it("is a no-op echo for a form todo (it clears on submit)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: new Date(),
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      isTodo: true,
      form: { published: true, publicToken: "tok" },
      link: "/forms/fill/tok",
    });
    const res = await action({
      request: unreadReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "form-todo" });
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

describe("POST /api/notifications/:id/read", () => {
  function readReq(id: string) {
    return new Request(`http://localhost/api/notifications/${id}/read`, {
      method: "POST",
    });
  }

  it("marks a MeetingReminder read even when it has scheduledMeetingId", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: "m1",
      kind: "MeetingReminder",
      link: "/calendar?meeting=m1",
    });
    const res = await action({
      request: readReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { readAt: expect.any(Date) },
    });
  });

  it("still skips MeetingInvite on plain read", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: "m1",
      kind: "MeetingInvite",
      link: null,
    });
    const res = await action({
      request: readReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("skips a form todo on plain read — only submitting clears it", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      isTodo: true,
      form: { published: true, publicToken: "tok" },
      link: "/forms/fill/tok",
    });
    const res = await action({
      request: readReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "form-todo" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("marks a form todo read when its form has no fill page", async () => {
    // Unpublished form = no link to submit through, so the row would be
    // stranded if we refused the read.
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      isTodo: true,
      form: { published: false, publicToken: "tok" },
      link: null,
    });
    const res = await action({
      request: readReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe("POST /api/notifications/:id/read intent=dismiss", () => {
  function dismissReq(id: string) {
    return new Request(`http://localhost/api/notifications/${id}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "dismiss" }),
    });
  }

  it("clears a form todo the recipient won't fill (the escape hatch)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      isTodo: true,
      form: { published: true, publicToken: "tok" },
      link: "/forms/fill/tok",
    });
    const res = await action({
      request: dismissReq("n1"),
      params: { id: "n1" },
    } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    expect(json.skipped).toBeUndefined();
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { readAt: expect.any(Date) },
    });
  });

  it("still refuses to dismiss a meeting invite (RSVP/Decline instead)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: "m1",
      kind: "MeetingInvite",
      link: null,
    });
    const res = await action({
      request: dismissReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "meeting-invite" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it("still refuses to dismiss the onboarding task (finish it instead)", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      recipientUserId: USER_ID,
      readAt: null,
      scheduledMeetingId: null,
      kind: "SystemAnnouncement",
      eventType: "member.onboarding",
    });
    const res = await action({
      request: dismissReq("n1"),
      params: { id: "n1" },
    } as any);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "onboarding" });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });
});
