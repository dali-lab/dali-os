import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  isPartnerAccount: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("~/lib/auth", async () => {
  const { redirect } = await import("react-router");
  return {
    requireAuth: mocks.requireAuth,
    isNonMember: mocks.isNonMember,
    redirectPartnerToPortal: async (auth: unknown) =>
      (await mocks.isPartnerAccount(auth)) ? redirect("/partner") : null,
  };
});
vi.mock("~/lib/roles", () => ({ getUserRoles: mocks.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));

import { requireLabViewer, labMemberOrCore } from "../lab-viewer.server";

const user = { sub: "u1", email: "ada@example.edu", firstName: "Ada", lastName: "L" };
const req = new Request("http://localhost/community/gallery?x=1");
const roles = (over: Record<string, boolean> = {}) => ({
  isLabMember: true,
  isCore: false,
  isAlumni: false,
  ...over,
});

async function thrown(p: Promise<unknown>): Promise<Response> {
  try {
    await p;
  } catch (e) {
    return e as Response;
  }
  throw new Error("did not throw");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuth.mockResolvedValue({ ok: true, user });
  mocks.isNonMember.mockResolvedValue(false);
  mocks.isPartnerAccount.mockResolvedValue(false);
  mocks.getUserRoles.mockResolvedValue(roles());
  mocks.isFeatureEnabled.mockResolvedValue(true);
});

describe("requireLabViewer", () => {
  it("sends a signed-out visitor to login with next", async () => {
    mocks.requireAuth.mockResolvedValue({ ok: false });
    const res = await thrown(requireLabViewer(req));
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("/login");
    expect(decodeURIComponent(location)).toContain("/community/gallery?x=1");
  });

  it("sends a partner contact straight to /partner, not /portal", async () => {
    mocks.isPartnerAccount.mockResolvedValue(true);
    mocks.isNonMember.mockResolvedValue(true);
    const res = await thrown(requireLabViewer(req));
    expect(res.headers.get("Location")).toBe("/partner");
    expect(mocks.isNonMember).not.toHaveBeenCalled();
  });

  it("sends an applicant or external instructor without a member row to /portal", async () => {
    mocks.isNonMember.mockResolvedValue(true);
    const res = await thrown(requireLabViewer(req));
    expect(res.headers.get("Location")).toBe("/portal");
    expect(mocks.getUserRoles).not.toHaveBeenCalled();
  });

  it("lets a current member through with auth, user, userId and roles", async () => {
    const out = await requireLabViewer(req, { flag: "community" });
    expect(out.userId).toBe("u1");
    expect(out.user).toBe(user);
    expect(out.roles.isLabMember).toBe(true);
    expect(mocks.getUserRoles).toHaveBeenCalledWith("u1", req);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith("community", "u1", out.roles, req);
  });

  it("lets alumni with a member row through", async () => {
    mocks.getUserRoles.mockResolvedValue(roles({ isAlumni: true }));
    const out = await requireLabViewer(req, { flag: "community", allow: labMemberOrCore });
    expect(out.userId).toBe("u1");
  });

  it("404s a member when the flag is off", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    const res = await thrown(requireLabViewer(req, { flag: "community" }));
    expect(res.status).toBe(404);
  });

  it("skips the flag check when no flag is given", async () => {
    await requireLabViewer(req);
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("404s when allow rejects, before checking the flag", async () => {
    mocks.getUserRoles.mockResolvedValue(roles({ isLabMember: false }));
    const res = await thrown(requireLabViewer(req, { flag: "community", allow: labMemberOrCore }));
    expect(res.status).toBe(404);
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("allows Core through allow, and sends a non-Core member home with denied home", async () => {
    mocks.getUserRoles.mockResolvedValue(roles({ isCore: true }));
    await expect(
      requireLabViewer(req, { allow: (r) => r.isCore, denied: "home" }),
    ).resolves.toBeTruthy();
    mocks.getUserRoles.mockResolvedValue(roles());
    const res = await thrown(requireLabViewer(req, { allow: (r) => r.isCore, denied: "home" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("uses the identity requireAuth resolves, so an impersonating admin gets the target's result", async () => {
    mocks.requireAuth.mockResolvedValue({ ok: true, user: { ...user, sub: "target" } });
    const out = await requireLabViewer(req);
    expect(out.userId).toBe("target");
    expect(mocks.getUserRoles).toHaveBeenCalledWith("target", req);
  });
});
