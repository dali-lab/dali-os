import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/notification-settings.server", () => ({
  notificationAudience: vi.fn(),
  loadOutsideNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(async () => ({ ok: true, error: null })),
}));
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import {
  loadOutsideNotificationSettings,
  notificationAudience,
  saveNotificationSettings,
} from "~/lib/notification-settings.server";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { action as portalAction, loader as portalLoader } from "~/routes/portal.settings";
import { action as partnerAction } from "~/partners/routes/partner.settings";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function post(path: string, fields: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

const args = (request: Request) => ({ request, params: {}, context: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("portal settings notifications", () => {
  it("saves a portal student's notification settings", async () => {
    vi.mocked(notificationAudience).mockResolvedValue("portal");
    const res = await portalAction(
      args(post("/portal/settings", { intent: "notifications", "education.grade:present": "1" })),
    );
    expect(res).toEqual({ ok: true, error: null });
    expect(saveNotificationSettings).toHaveBeenCalledWith("u1", expect.any(FormData), {
      audience: "portal",
      isAdmin: false,
      isCore: false,
    });
  });

  it("refuses a member, who saves on the member settings page", async () => {
    vi.mocked(notificationAudience).mockResolvedValue("member");
    const res = (await portalAction(args(post("/portal/settings", { intent: "notifications" })))) as Response;
    expect(res.status).toBe(403);
    expect(saveNotificationSettings).not.toHaveBeenCalled();
  });

  it("loads the block only for portal students", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "L", photoUrl: null });
    vi.mocked(loadOutsideNotificationSettings).mockResolvedValue({ audience: "portal" } as never);

    vi.mocked(notificationAudience).mockResolvedValue("portal");
    const portal = (await portalLoader(args(new Request("http://localhost/portal/settings")))) as {
      notifications: unknown;
    };
    expect(portal.notifications).toEqual({ audience: "portal" });
    expect(loadOutsideNotificationSettings).toHaveBeenCalledWith("u1", "portal", "/portal/settings");

    vi.mocked(notificationAudience).mockResolvedValue("member");
    const member = (await portalLoader(args(new Request("http://localhost/portal/settings")))) as {
      notifications: unknown;
    };
    expect(member.notifications).toBeNull();
  });
});

describe("partner settings notifications", () => {
  it("saves a partner's notification settings", async () => {
    vi.mocked(requirePartnerAccount).mockResolvedValue({
      auth: { user: { sub: "p1" } },
      memberships: [],
    } as never);
    const res = await partnerAction(
      args(post("/partner/settings", { intent: "notifications", "collab.comment_reply:present": "1" })),
    );
    expect(res).toEqual({ ok: true, intent: "notifications" });
    expect(saveNotificationSettings).toHaveBeenCalledWith("p1", expect.any(FormData), {
      audience: "partner",
      isAdmin: false,
      isCore: false,
    });
  });
});
