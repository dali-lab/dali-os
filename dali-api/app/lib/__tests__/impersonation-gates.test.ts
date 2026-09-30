// Impersonation must not expose the impersonated member's private content.
// Two layers are covered here: resolveBetterAuthAuth surfacing `impersonatedBy`
// (without which no route can tell), and the route gates that read it.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
// isImpersonating is imported from ~/lib/auth, whose module graph reaches
// ~/lib/db. The generated Prisma client is not present in CI at unit-test time,
// so the real db module must never be loaded here.
vi.mock("~/lib/db", () => ({ prisma: {} }));

import { resolveBetterAuthAuth } from "~/lib/betterauth-compat.server";
import { isImpersonating, type AuthSuccess } from "~/lib/auth";

const BA_USER = { id: "member-1", daliEmail: "m@dali.dartmouth.edu", firstName: "M", lastName: "One" };

function authOf(impersonatedBy?: string): AuthSuccess {
  return { ok: true, user: { sub: "member-1", email: "m@dali.dartmouth.edu", type: "member" }, sessionId: "s1", ...(impersonatedBy ? { impersonatedBy } : {}) };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveBetterAuthAuth impersonation state", () => {
  it("surfaces the acting admin id for an impersonation session", async () => {
    mockGetSession.mockResolvedValue({
      session: { id: "sess-1", impersonatedBy: "admin-9" },
      user: BA_USER,
    });

    const resolved = await resolveBetterAuthAuth(new Request("http://x"));

    expect(resolved?.impersonatedBy).toBe("admin-9");
    // The identity still resolves to the impersonated member — that is the
    // whole point, and why the separate flag is the only available signal.
    expect(resolved?.user.sub).toBe("member-1");
  });

  it("omits impersonatedBy for a normal session", async () => {
    mockGetSession.mockResolvedValue({ session: { id: "sess-1" }, user: BA_USER });

    const resolved = await resolveBetterAuthAuth(new Request("http://x"));

    expect(resolved?.impersonatedBy).toBeUndefined();
    expect(isImpersonating(resolved as unknown as AuthSuccess)).toBe(false);
  });

  it("reads impersonation from the session it already fetched, with no second getSession", async () => {
    mockGetSession.mockResolvedValue({
      session: { id: "sess-1", impersonatedBy: "admin-9" },
      user: BA_USER,
    });

    await resolveBetterAuthAuth(new Request("http://x"));

    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});

describe("isImpersonating", () => {
  it("is true only when an acting admin stamped the session", () => {
    expect(isImpersonating(authOf("admin-9"))).toBe(true);
    expect(isImpersonating(authOf())).toBe(false);
  });
});

