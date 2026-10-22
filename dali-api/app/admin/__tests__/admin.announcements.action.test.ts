import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { scheduledAnnouncement: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupsForUser: vi.fn() }));
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));
vi.mock("~/core/lib/regroup-redirect.server", () => ({ regroupRedirect: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/admin/routes/admin.announcements";

function cancel(id: string, intent = "cancel-scheduled") {
  const body = new FormData();
  body.set("intent", intent);
  body.set("id", id);
  return action({
    request: new Request("http://localhost/admin/announcements", { method: "POST", body }),
    params: {},
    context: {},
  } as never);
}

const SEND_AT = new Date("2026-11-01T15:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(prisma.scheduledAnnouncement.findUnique).mockResolvedValue({ title: "Retreat", sendAt: SEND_AT } as never);
  vi.mocked(prisma.scheduledAnnouncement.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe("admin.announcements action", () => {
  it("logs a cancel with the title and the time it would have gone out", async () => {
    await cancel("sa-1");

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "announcement.cancel",
        userId: "u1",
        targetId: "sa-1",
        metadata: { title: "Retreat", sendAt: SEND_AT.toISOString() },
      }),
    );
  });

  it("logs nothing when the announcement already went out or was already canceled", async () => {
    vi.mocked(prisma.scheduledAnnouncement.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await cancel("sa-1")).toEqual({ ok: true, canceled: false });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing for another intent", async () => {
    await cancel("sa-1", "other");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
