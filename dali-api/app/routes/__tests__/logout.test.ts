import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { session: { findUnique: vi.fn() } } }));
vi.mock("~/lib/session.server", () => ({ hashSessionId: vi.fn(), revokeSession: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/betterauth.server", () => ({ auth: { api: { signOut: vi.fn() } } }));
vi.mock("~/lib/impersonation-restore.server", () => ({
  clearAdminSessionCookieHeader: vi.fn(async () => "dali.admin_session=; Max-Age=0"),
}));

import { auth } from "~/lib/betterauth.server";
import { loader } from "~/routes/logout";

const run = () => loader({ request: new Request("http://localhost/logout") } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.signOut).mockResolvedValue({ headers: new Headers({ "set-cookie": "dali.session_token=; Max-Age=0" }) } as never);
});

describe("GET /logout", () => {
  it("clears admin_session so signing out mid-impersonation can't restore the admin", async () => {
    const res = await run();
    expect(res.headers.get("Location")).toBe("/login");
    expect(res.headers.getSetCookie()).toEqual(
      expect.arrayContaining(["dali.session_token=; Max-Age=0", "dali.admin_session=; Max-Age=0"]),
    );
  });

  it("still clears admin_session when the BetterAuth sign-out fails", async () => {
    vi.mocked(auth.api.signOut).mockRejectedValue(new Error("down"));
    const res = await run();
    expect(res.headers.getSetCookie()).toContain("dali.admin_session=; Max-Age=0");
  });
});
