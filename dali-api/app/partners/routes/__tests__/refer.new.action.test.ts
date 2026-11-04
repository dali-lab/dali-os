import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocked at module load so importing the route doesn't drag in the Prisma
// runtime through ~/lib/db.server (CI runs the unit job without a generated
// client; see CLAUDE.md § Test gotchas).
vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
  isNonMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/partners/lib/referrals.server", () => ({
  hasPassedReferralQuiz: vi.fn(),
  createPartnerReferral: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import {
  createPartnerReferral,
  hasPassedReferralQuiz,
} from "~/partners/lib/referrals.server";
import { action } from "~/partners/routes/refer.new";

function post(body: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  const request = new Request("http://localhost/refer/new", {
    method: "POST",
    body: form,
  });
  return action({ request, params: {}, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "u1" },
    sessionId: "s1",
  });
  (hasPassedReferralQuiz as any).mockResolvedValue(true);
  (createPartnerReferral as any).mockResolvedValue({ id: "r1" });
});

describe("refer.new action", () => {
  it("bounces back to /refer when the quiz hasn't been passed — even if someone POSTs straight to the form", async () => {
    (hasPassedReferralQuiz as any).mockResolvedValue(false);
    const res = (await post({
      tier: "Cold",
      partnerName: "Someone",
      context: "A lead",
    })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/refer");
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("rejects an unknown tier", async () => {
    const res = await post({
      tier: "Hot",
      partnerName: "X",
      context: "Y",
    });
    expect(res).toEqual({ error: expect.stringContaining("tier") });
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("requires a partner name", async () => {
    const res = await post({ tier: "Cold", partnerName: "   ", context: "x" });
    expect(res).toEqual({ error: expect.any(String) });
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("requires an email for the Warm tier", async () => {
    const res = await post({
      tier: "Warm",
      partnerName: "Jane",
      context: "A lead",
    });
    expect(res).toEqual({ error: expect.stringContaining("email") });
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("requires a pitch body for the FullPitch tier", async () => {
    const res = await post({
      tier: "FullPitch",
      partnerName: "Jane",
      partnerEmail: "jane@example.com",
      context: "A lead",
    });
    expect(res).toEqual({ error: expect.stringContaining("pitch") });
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("creates a Cold referral with no email and redirects to the success page", async () => {
    const res = (await post({
      tier: "Cold",
      partnerName: "Jane",
      context: "A family friend",
    })) as Response;
    expect(createPartnerReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        referredByUserId: "u1",
        tier: "Cold",
        partnerName: "Jane",
        partnerEmail: null,
        context: "A family friend",
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/refer/done?id=r1");
  });

  it("creates a FullPitch referral with the pitch body and redirects", async () => {
    const res = (await post({
      tier: "FullPitch",
      partnerName: "Museum X",
      partnerEmail: "dir@example.org",
      context: "A museum I know",
      pitchBody: "Build them a donations page",
    })) as Response;
    expect(createPartnerReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "FullPitch",
        pitchBody: "Build them a donations page",
      }),
    );
    expect(res.status).toBe(302);
  });
});
