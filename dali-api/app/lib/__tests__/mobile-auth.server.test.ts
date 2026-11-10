import { describe, it, expect, beforeEach, vi } from "vitest";

const requireAuth = vi.fn();
const getUserRoles = vi.fn();

vi.mock("~/lib/auth", () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: (...a: unknown[]) => getUserRoles(...a) }));

import { requireMobileUser } from "../mobile-auth.server";

const request = new Request("https://os.example/api/mobile/me", { headers: { Authorization: "Bearer t" } });
const authed = { ok: true, user: { sub: "u1", email: "a@b", type: "member" }, sessionId: "s" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(authed);
  getUserRoles.mockResolvedValue({ isLabMember: true });
});

describe("requireMobileUser", () => {
  it("passes a lab member", async () => {
    const r = await requireMobileUser(request);
    expect(r).toMatchObject({ ok: true, userId: "u1" });
  });

  it("returns the auth failure response untouched", async () => {
    const response = new Response(null, { status: 401 });
    requireAuth.mockResolvedValue({ ok: false, response, reason: "no_session" });
    const r = await requireMobileUser(request);
    expect(r).toEqual({ ok: false, response });
  });

  it("404s a non-member, so the mobile routes stay invisible to them", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: false });
    const r = await requireMobileUser(request);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(await r.response.json()).toEqual({ error: "Not found" });
  });
});
