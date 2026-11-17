import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/partners/lib/referrals.server", () => ({
  getReferralForCore: vi.fn(),
  setReferralReachedOut: vi.fn(),
  updateReferralCoreNotes: vi.fn(),
}));
vi.mock("~/partners/lib/referral-status.server", () => ({
  linkReferralToApplication: vi.fn(),
  listApplicationOptions: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { linkReferralToApplication } from "~/partners/lib/referral-status.server";
import { action } from "~/partners/routes/core.partners.referrals.$id";

function post(body: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  const request = new Request("http://localhost/x", { method: "POST", body: form });
  return action({ request, params: { id: "r1" }, context: {} } as any) as Promise<any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({ ok: true, user: { sub: "core1" } });
  (isCore as any).mockResolvedValue(true);
  (linkReferralToApplication as any).mockResolvedValue({ ok: true });
});

describe("link-application action", () => {
  it("rejects non-Core users without touching the link", async () => {
    (isCore as any).mockResolvedValue(false);
    const res = await post({ intent: "link-application", partnerApplicationId: "app1" });
    expect(res.status).toBe(403);
    expect(linkReferralToApplication).not.toHaveBeenCalled();
  });

  it("links the referral to the chosen application", async () => {
    await post({ intent: "link-application", partnerApplicationId: " app1 " });
    expect(linkReferralToApplication).toHaveBeenCalledWith("r1", "app1", "core1");
  });

  it("clears the link when the id is blank", async () => {
    await post({ intent: "link-application", partnerApplicationId: "" });
    expect(linkReferralToApplication).toHaveBeenCalledWith("r1", null, "core1");
  });

  it("returns 400 when the application does not exist", async () => {
    (linkReferralToApplication as any).mockResolvedValue({ ok: false, error: "Application not found" });
    const res = await post({ intent: "link-application", partnerApplicationId: "nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Application not found" });
  });
});
