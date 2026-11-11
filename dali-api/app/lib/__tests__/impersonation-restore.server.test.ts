import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeSignedCookie } from "better-call";

const SECRET = vi.hoisted(() => "test-secret-for-signing");

vi.mock("~/lib/betterauth.server", () => {
  const attributes = { path: "/", httpOnly: true, sameSite: "lax" as const };
  return {
    auth: {
      $context: Promise.resolve({
        secret: SECRET,
        createAuthCookie: (name: string) => ({ name: `dali.${name}`, attributes }),
        authCookies: { sessionToken: { name: "dali.session_token", attributes: { ...attributes, maxAge: 604800 } } },
      }),
    },
  };
});
vi.mock("~/lib/db.server", () => ({ prisma: { authSession: { findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  clearAdminSessionCookieHeader,
  redirectRestoringAdmin,
  restoreImpersonatingAdmin,
} from "~/lib/impersonation-restore.server";

const findSession = vi.mocked(prisma.authSession.findUnique);

async function adminCookie(value = "admin-token:", secret = SECRET): Promise<string> {
  return (await serializeSignedCookie("dali.admin_session", value, secret)).split(";")[0];
}

function request(cookie?: string): Request {
  return new Request("https://os.test/projects", cookie ? { headers: { Cookie: cookie } } : {});
}

const setCookies = (headers: Headers) => headers.getSetCookie();

beforeEach(() => {
  vi.clearAllMocks();
  findSession.mockResolvedValue({
    userId: "admin-1",
    expiresAt: new Date(Date.now() + 60_000),
    impersonatedBy: null,
  } as never);
  vi.mocked(isAdmin).mockResolvedValue(true);
});

describe("restoreImpersonatingAdmin", () => {
  it("does nothing without an admin_session cookie", async () => {
    expect(await restoreImpersonatingAdmin(request())).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it("puts the admin's session back and clears admin_session", async () => {
    const restored = await restoreImpersonatingAdmin(request(await adminCookie()));
    expect(restored?.adminId).toBe("admin-1");
    expect(findSession).toHaveBeenCalledWith(expect.objectContaining({ where: { token: "admin-token" } }));
    const cookies = setCookies(restored!.headers);
    expect(cookies[0]).toMatch(/^dali\.session_token=admin-token\./);
    expect(cookies[1]).toMatch(/^dali\.admin_session=;.*Max-Age=0/);
  });

  it("rejects a cookie signed with another secret", async () => {
    expect(await restoreImpersonatingAdmin(request(await adminCookie("admin-token:", "other")))).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it("rejects an unsigned cookie", async () => {
    expect(await restoreImpersonatingAdmin(request("dali.admin_session=admin-token:"))).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it("rejects a session that no longer exists", async () => {
    findSession.mockResolvedValue(null);
    expect(await restoreImpersonatingAdmin(request(await adminCookie()))).toBeNull();
  });

  it("rejects an expired admin session", async () => {
    findSession.mockResolvedValue({ userId: "admin-1", expiresAt: new Date(Date.now() - 1), impersonatedBy: null } as never);
    expect(await restoreImpersonatingAdmin(request(await adminCookie()))).toBeNull();
  });

  it("rejects a session that is itself an impersonation", async () => {
    findSession.mockResolvedValue({
      userId: "admin-1",
      expiresAt: new Date(Date.now() + 60_000),
      impersonatedBy: "someone",
    } as never);
    expect(await restoreImpersonatingAdmin(request(await adminCookie()))).toBeNull();
  });

  it("rejects a user who is no longer an admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect(await restoreImpersonatingAdmin(request(await adminCookie()))).toBeNull();
    expect(isAdmin).toHaveBeenCalledWith("admin-1");
  });
});

describe("redirectRestoringAdmin", () => {
  it("returns null and audits nothing when there is nothing to restore", async () => {
    expect(await redirectRestoringAdmin(request(), "/")).toBeNull();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("reloads the whole document at the target and audits the stop", async () => {
    const req = request(await adminCookie());
    const res = (await redirectRestoringAdmin(req, "/projects"))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/projects");
    expect(res.headers.get("X-Remix-Reload-Document")).toBe("true");
    expect(setCookies(res.headers)).toHaveLength(2);
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "admin.impersonate.stop",
      userId: "admin-1",
      metadata: { reason: "expired" },
      request: req,
    });
  });
});

describe("clearAdminSessionCookieHeader", () => {
  it("expires the admin_session cookie", async () => {
    expect(await clearAdminSessionCookieHeader()).toMatch(/^dali\.admin_session=;.*Max-Age=0/);
  });
});
