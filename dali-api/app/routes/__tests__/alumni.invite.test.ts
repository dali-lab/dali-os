import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/betterauth-session.server", () => ({ mintBetterAuthSession: vi.fn() }));
vi.mock("~/lib/betterauth-cookie.server", () => ({ appendBetterAuthSessionCookie: vi.fn() }));
vi.mock("~/members/lib/contact-email.server", () => ({ adoptInviteAddress: vi.fn() }));
vi.mock("~/alumni/lib/alumni-invite.server", () => ({
  lookupAlumniInvite: vi.fn(),
  redeemAlumniInvite: vi.fn(),
  sendFreshAlumniInvite: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";
import { adoptInviteAddress } from "~/members/lib/contact-email.server";
import { lookupAlumniInvite, redeemAlumniInvite, sendFreshAlumniInvite } from "~/alumni/lib/alumni-invite.server";
import { action, loader } from "../alumni.invite.$token";

const url = "https://os.example/alumni/invite/tok";
const params = { token: "tok" };
const runLoader = () => loader({ request: new Request(url), params } as never) as Promise<unknown>;
const post = (fields: Record<string, string> = {}) =>
  action({ request: new Request(url, { method: "POST", body: new URLSearchParams(fields) }), params } as never) as Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
  vi.mocked(mintBetterAuthSession).mockResolvedValue({ token: "sess", expiresAt: new Date(), sessionId: "s1" });
  vi.mocked(appendBetterAuthSessionCookie).mockImplementation(async (headers) => {
    headers.append("Set-Cookie", "ba=sess; Path=/");
  });
});

describe("loader", () => {
  it("shows the welcome for a valid link and never consumes it", async () => {
    vi.mocked(lookupAlumniInvite).mockResolvedValue({ status: "valid", userId: "u1", firstName: "Ada" });
    expect(await runLoader()).toEqual({ status: "valid", firstName: "Ada" });
    expect(redeemAlumniInvite).not.toHaveBeenCalled();
    expect(mintBetterAuthSession).not.toHaveBeenCalled();
  });

  it("gives expired, used and unknown links the same neutral answer", async () => {
    for (const status of ["expired", "used", "unknown"] as const) {
      vi.mocked(lookupAlumniInvite).mockResolvedValue({ status, userId: "u1", firstName: "Ada" });
      expect(await runLoader()).toEqual({ status: "unavailable" });
    }
  });

  it("sends someone already signed in as that user to onboarding, or home once onboarded", async () => {
    vi.mocked(lookupAlumniInvite).mockResolvedValue({ status: "used", userId: "u1", firstName: "Ada" });
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ alumniOnboardedAt: null } as never);
    expect(((await runLoader()) as Response).headers.get("Location")).toBe("/alumni/onboarding");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ alumniOnboardedAt: new Date() } as never);
    expect(((await runLoader()) as Response).headers.get("Location")).toBe("/");
  });

  it("shows the page normally to someone signed in as another user", async () => {
    vi.mocked(lookupAlumniInvite).mockResolvedValue({ status: "valid", userId: "u1", firstName: "Ada" });
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u2" } } as never);
    expect(await runLoader()).toEqual({ status: "valid", firstName: "Ada" });
  });
});

describe("action", () => {
  it("redeems, signs in with cookies, adopts the invite address and lands on onboarding", async () => {
    vi.mocked(redeemAlumniInvite).mockResolvedValue({ ok: true, userId: "u1", sentTo: "ada@example.com" });

    const res = (await post()) as Response;

    expect(res.headers.get("Location")).toBe("/alumni/onboarding");
    expect(res.headers.getSetCookie().join(";")).toContain("ba=sess");
    expect(mintBetterAuthSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }));
    expect(adoptInviteAddress).toHaveBeenCalledWith("u1", "ada@example.com", expect.any(Request));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login.success", userId: "u1", metadata: { via: "alumni-invite", method: "alumni-invite" } }),
    );
  });

  it("signs nobody in when the link was already used", async () => {
    vi.mocked(redeemAlumniInvite).mockResolvedValue({ ok: false });
    expect(await post()).toEqual({ expired: true });
    expect(mintBetterAuthSession).not.toHaveBeenCalled();
    expect(adoptInviteAddress).not.toHaveBeenCalled();
  });

  it("asks for a fresh link without redeeming, and answers the same either way", async () => {
    expect(await post({ intent: "new-link" })).toEqual({ requested: true });
    expect(sendFreshAlumniInvite).toHaveBeenCalledWith("tok");
    expect(redeemAlumniInvite).not.toHaveBeenCalled();
    expect(mintBetterAuthSession).not.toHaveBeenCalled();
  });
});
