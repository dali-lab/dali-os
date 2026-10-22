import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { form: { findUnique: vi.fn() }, scheduledAnnouncement: { create: vi.fn() } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/announcements.server", () => ({ sendAnnouncement: vi.fn() }));
vi.mock("~/collab/blocknote-server", () => ({ renderAnnouncementBody: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { sendAnnouncement } from "~/lib/announcements.server";
import { action } from "~/admin/routes/api.notifications.send";

function post(body: unknown) {
  return action({
    request: new Request("http://localhost/api/notifications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(sendAnnouncement).mockResolvedValue({ ok: true, count: 42 });
});

describe("POST /api/notifications/send audit", () => {
  it("logs an instant send with the audience shape and recipient count, not the body", async () => {
    await post({
      title: "Office hours moved",
      body: "the private details",
      groupIds: ["g1", "g2"],
      userIds: ["u2"],
      isTodo: true,
    });

    const event = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      action: "announcement.send",
      userId: "u1",
      metadata: {
        title: "Office hours moved",
        kind: "General",
        isTodo: true,
        formId: null,
        allMembers: false,
        groupCount: 2,
        userCount: 1,
        recipients: 42,
      },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("private details");
  });

  it("logs a scheduled announcement against its row", async () => {
    const sendAt = new Date(Date.now() + 3_600_000);
    vi.mocked(prisma.scheduledAnnouncement.create).mockResolvedValue({ id: "sa-1", sendAt } as never);

    const res = await post({ title: "Later", allMembers: true, sendAt: sendAt.toISOString() });

    expect(res.status).toBe(201);
    expect(sendAnnouncement).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "announcement.schedule",
        targetId: "sa-1",
        metadata: expect.objectContaining({
          title: "Later",
          allMembers: true,
          sendAt: sendAt.toISOString(),
        }),
      }),
    );
  });

  it("logs nothing when the send is refused or the caller is not Core", async () => {
    vi.mocked(sendAnnouncement).mockResolvedValue({ ok: false, error: "Pick an audience", status: 400 });
    await post({ title: "No audience" });
    vi.mocked(isCore).mockResolvedValue(false);
    await post({ title: "Nope", allMembers: true });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
