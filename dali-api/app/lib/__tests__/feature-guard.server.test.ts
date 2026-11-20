import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
  isImpersonating: vi.fn(),
  impersonationAllowsWrites: vi.fn(),
  loadExpenseViewer: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({
  requireAuth: m.requireAuth,
  isNonMember: m.isNonMember,
  isImpersonating: m.isImpersonating,
  impersonationAllowsWrites: m.impersonationAllowsWrites,
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: m.redirectToLogin }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("~/expenses/lib/viewer.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));

import { guardMemberFeature } from "../feature-guard.server";
import { guardPaperwork } from "~/paperwork/lib/guard.server";
import { guardExpenses } from "~/expenses/routes/guard.server";

const request = new Request("https://os.example.edu/x");
const body = async (r: Response) => (r.headers.get("content-type")?.includes("json") ? r.json() : r.text());

beforeEach(() => {
  vi.resetAllMocks();
  m.redirectToLogin.mockReturnValue(new Response(null, { status: 302, headers: { Location: "/login" } }));
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.getUserRoles.mockResolvedValue({ isAlumni: false });
  m.isFeatureEnabled.mockResolvedValue(true);
});

describe("guardMemberFeature", () => {
  const opts = { flag: "paperwork" as const, page: false, json: (error: string) => ({ error }), unauthorizedMessage: "nope" };

  it("returns the user and roles for a member with the flag on, checking the named flag", async () => {
    const r = await guardMemberFeature(request, opts);
    expect(r).toMatchObject({ ok: true, userId: "u1", roles: { isAlumni: false } });
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("paperwork", "u1", { isAlumni: false }, request);
  });

  it("answers signed-out as 401 JSON for APIs and a login redirect for pages", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    const api = await guardMemberFeature(request, opts);
    expect(api.ok === false && api.response.status).toBe(401);
    expect(api.ok === false && (await body(api.response))).toEqual({ error: "nope" });
    const page = await guardMemberFeature(request, { ...opts, page: true });
    expect(page.ok === false && page.response.headers.get("Location")).toBe("/login");
  });

  it("answers a non-member as 403 for APIs and a portal redirect for pages", async () => {
    m.isNonMember.mockResolvedValue(true);
    const api = await guardMemberFeature(request, opts);
    expect(api.ok === false && api.response.status).toBe(403);
    expect(api.ok === false && (await body(api.response))).toEqual({ error: "Forbidden" });
    const page = await guardMemberFeature(request, { ...opts, page: true });
    expect(page.ok === false && page.response.headers.get("Location")).toBe("/portal");
  });

  it("answers alumni and a flag that is off as 404", async () => {
    m.getUserRoles.mockResolvedValue({ isAlumni: true });
    const alumni = await guardMemberFeature(request, opts);
    expect(alumni.ok === false && alumni.response.status).toBe(404);
    m.getUserRoles.mockResolvedValue({ isAlumni: false });
    m.isFeatureEnabled.mockResolvedValue(false);
    const off = await guardMemberFeature(request, opts);
    expect(off.ok === false && off.response.status).toBe(404);
  });

  it("answers a custom blocked denial as 403 with its message, after the flag check", async () => {
    const blocked = { ...opts, denial: () => "blocked" as const, blockedMessage: "Read only." };
    const r = await guardMemberFeature(request, blocked);
    expect(r.ok === false && r.response.status).toBe(403);
    expect(r.ok === false && (await body(r.response))).toEqual({ error: "Read only." });
    m.isFeatureEnabled.mockResolvedValue(false);
    const off = await guardMemberFeature(request, blocked);
    expect(off.ok === false && off.response.status).toBe(404);
  });
});

describe("guardPaperwork", () => {
  it("keeps its response bodies", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    const out = await guardPaperwork(request, { page: false });
    expect(out.ok === false && out.response.status).toBe(401);
    expect(out.ok === false && (await body(out.response))).toEqual({ error: "Unauthorized" });
    m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m.isNonMember.mockResolvedValue(true);
    const forbidden = await guardPaperwork(request, { page: false });
    expect(forbidden.ok === false && (await body(forbidden.response))).toEqual({ error: "Forbidden" });
  });

  it("checks the paperwork flag and returns the user", async () => {
    expect(await guardPaperwork(request, { page: true })).toEqual({ ok: true, userId: "u1", roles: { isAlumni: false } });
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("paperwork", "u1", expect.anything(), request);
  });

  it("404s when the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    const out = await guardPaperwork(request, { page: true });
    expect(out.ok === false && out.response.status).toBe(404);
  });
});

describe("guardExpenses", () => {
  const write = { write: true, page: false };

  it("keeps its response bodies", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    const out = await guardExpenses(request, write);
    expect(out.ok === false && out.response.status).toBe(401);
    expect(out.ok === false && (await body(out.response))).toEqual({ ok: false, error: "Sign in again to continue." });
    m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m.isNonMember.mockResolvedValue(true);
    const forbidden = await guardExpenses(request, write);
    expect(forbidden.ok === false && (await body(forbidden.response))).toEqual({ ok: false, error: "Forbidden" });
  });

  it("loads the viewer and checks the expenses flag", async () => {
    m.loadExpenseViewer.mockResolvedValue({ userId: "u1" });
    expect(await guardExpenses(request, write)).toEqual({ ok: true, viewer: { userId: "u1" } });
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("expenses", "u1", expect.anything(), request);
  });

  it("blocks writes while impersonating but allows reads", async () => {
    m.isImpersonating.mockReturnValue(true);
    m.impersonationAllowsWrites.mockReturnValue(false);
    m.loadExpenseViewer.mockResolvedValue({ userId: "u1" });
    const out = await guardExpenses(request, write);
    expect(out.ok === false && out.response.status).toBe(403);
    expect(out.ok === false && (await body(out.response))).toEqual({
      ok: false,
      error: "Expenses can't be changed while viewing as someone else.",
    });
    expect((await guardExpenses(request, { write: false, page: false })).ok).toBe(true);
    m.impersonationAllowsWrites.mockReturnValue(true);
    expect((await guardExpenses(request, write)).ok).toBe(true);
  });

  it("404s alumni and a flag that is off before reporting the impersonation block", async () => {
    m.isImpersonating.mockReturnValue(true);
    m.impersonationAllowsWrites.mockReturnValue(false);
    m.isFeatureEnabled.mockResolvedValue(false);
    const out = await guardExpenses(request, write);
    expect(out.ok === false && out.response.status).toBe(404);
  });
});
