import { describe, it, expect, beforeEach, vi } from "vitest";

const requireAuth = vi.fn();
const getUserRoles = vi.fn();
const isFeatureEnabled = vi.fn();

vi.mock("~/lib/auth", () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: (...a: unknown[]) => getUserRoles(...a) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));

import { requireMobileUser } from "../mobile-auth.server";

const request = new Request("https://os.example/api/mobile/me", { headers: { Authorization: "Bearer t" } });
const authed = { ok: true, user: { sub: "u1", email: "a@b", type: "member" }, sessionId: "s" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(authed);
  getUserRoles.mockResolvedValue({ isLabMember: true });
  isFeatureEnabled.mockResolvedValue(true);
});

describe("requireMobileUser", () => {
  it("passes a lab member the flag has reached", async () => {
    const r = await requireMobileUser(request);
    expect(r).toMatchObject({ ok: true, userId: "u1" });
    expect(isFeatureEnabled).toHaveBeenCalledWith("mobile-app", "u1", { isLabMember: true }, request);
  });

  it("returns the auth failure response untouched", async () => {
    const response = new Response(null, { status: 401 });
    requireAuth.mockResolvedValue({ ok: false, response, reason: "no_session" });
    const r = await requireMobileUser(request);
    expect(r).toEqual({ ok: false, response });
  });

  it("404s when the flag is off for the member", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const r = await requireMobileUser(request);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(await r.response.json()).toEqual({ error: "Not found" });
  });

  it("404s a non-member even when the flag is on", async () => {
    getUserRoles.mockResolvedValue({ isLabMember: false });
    const r = await requireMobileUser(request);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });
});
