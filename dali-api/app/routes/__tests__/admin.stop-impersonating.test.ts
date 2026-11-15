import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/betterauth-compat.server", () => ({ getBetterAuthUser: vi.fn() }));
vi.mock("~/lib/betterauth.server", () => ({ auth: { api: { stopImpersonating: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/impersonation-restore.server", () => ({
  redirectRestoringAdmin: vi.fn(),
  clearAdminSessionCookieHeader: vi.fn(async () => "dali.admin_session=; Max-Age=0"),
}));

import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";
import { redirectRestoringAdmin } from "~/lib/impersonation-restore.server";
import { action } from "~/routes/admin.stop-impersonating";

const stop = vi.mocked(auth.api.stopImpersonating);
const request = () => new Request("http://localhost/admin/stop-impersonating", { method: "POST" });
const run = () => action({ request: request() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBetterAuthUser).mockResolvedValue({ sub: "member-1" } as never);
  stop.mockResolvedValue({ headers: new Headers({ "set-cookie": "dali.session_token=admin; Path=/" }) } as never);
  vi.mocked(redirectRestoringAdmin).mockResolvedValue(null);
});

describe("POST /admin/stop-impersonating", () => {
  it("ends a live impersonation and forwards the restored session cookie", async () => {
    const res = await run();
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("dali.session_token=admin");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.impersonate.stop", userId: "member-1" }));
    expect(redirectRestoringAdmin).not.toHaveBeenCalled();
  });

  it("restores the admin from admin_session once the impersonation has lapsed", async () => {
    vi.mocked(getBetterAuthUser).mockResolvedValue(null);
    const restored = new Response(null, { status: 302, headers: { Location: "/" } });
    vi.mocked(redirectRestoringAdmin).mockResolvedValue(restored);
    expect(await run()).toBe(restored);
    expect(stop).not.toHaveBeenCalled();
  });

  it("falls back to admin_session when BetterAuth refuses to stop", async () => {
    stop.mockRejectedValue(new Error("Failed to find admin session"));
    const restored = new Response(null, { status: 302, headers: { Location: "/" } });
    vi.mocked(redirectRestoringAdmin).mockResolvedValue(restored);
    expect(await run()).toBe(restored);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("goes home and clears admin_session when nothing can be restored", async () => {
    vi.mocked(getBetterAuthUser).mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("set-cookie")).toBe("dali.admin_session=; Max-Age=0");
  });
});
