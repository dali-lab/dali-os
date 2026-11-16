import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  revoke: vi.fn(),
  audit: vi.fn(),
  baUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: { session: { findUnique: mocks.findSession } } }));
vi.mock("~/lib/session.server", () => ({ hashSessionId: (s: string) => `h:${s}`, revokeSession: mocks.revoke }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mocks.audit }));
vi.mock("~/lib/betterauth-compat.server", () => ({ getBetterAuthUser: mocks.baUser }));
vi.mock("~/lib/betterauth.server", () => ({ auth: { api: { signOut: mocks.signOut } } }));
vi.mock("~/lib/impersonation-restore.server", () => ({
  clearAdminSessionCookieHeader: async () => "admin=; Max-Age=0",
}));

import { loader } from "./logout";

function run(cookie?: string) {
  const request = new Request("http://localhost/logout", cookie ? { headers: { cookie } } : {});
  return loader({ request } as never);
}

describe("logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ headers: new Headers() });
  });

  it("attributes a BetterAuth logout to the member", async () => {
    mocks.baUser.mockResolvedValue({ sub: "u-ada", email: "ada@example.edu", type: "member" });
    await run();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "logout", userId: "u-ada" }));
  });

  it("attributes a legacy session logout and skips BetterAuth lookup", async () => {
    mocks.findSession.mockResolvedValue({ userId: "u-legacy" });
    await run("__dali_sid=abc");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-legacy" }));
    expect(mocks.baUser).not.toHaveBeenCalled();
  });

  it("logs null when there is no session, and still redirects when lookup throws", async () => {
    mocks.baUser.mockRejectedValue(new Error("boom"));
    const res = (await run()) as Response;
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(res.status).toBe(302);
  });
});
