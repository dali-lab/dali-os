import { describe, it, expect, beforeEach, vi } from "vitest";

// `~/routes/login` transitively imports `~/lib/auth`, which now reaches into
// `~/lib/oauth` for the silent-refresh path; `oauth` imports the real Prisma
// client. Mocking `~/lib/db.server` keeps these tests Prisma-free.
vi.mock("~/lib/db.server");

// The loader routes by membership, so it calls requireAuth + prisma directly.
// Mock requireAuth so each test can drive the authenticated user without
// standing up a full session.
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));

const mockSendVerificationOTP = vi.hoisted(() => vi.fn());
const mockSignInEmailOTP = vi.hoisted(() => vi.fn());
vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    api: {
      sendVerificationOTP: mockSendVerificationOTP,
      signInEmailOTP: mockSignInEmailOTP,
    },
  },
}));

import { _resetForTests } from "~/lib/rate-limit";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action, loader } from "~/routes/login";

const mockRequireAuth = vi.mocked(requireAuth);
const mockMemberFind = vi.mocked(prisma.dALIMember.findUnique);
const mockUserFindFirst = vi.mocked(prisma.user.findFirst);

function loaderRequest() {
  return new Request("http://localhost/login");
}

function authedAs(sub: string) {
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: { sub, type: "dartmouth" },
    sessionId: "s1",
  } as any);
}

function makeFlagOnRequest(ip: string, body: Record<string, string>) {
  const form = new URLSearchParams(body);
  return new Request("http://localhost/login", {
    method: "POST",
    headers: {
      "X-Forwarded-For": ip,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
}

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
  mockSendVerificationOTP.mockResolvedValue({ success: true });
  mockSignInEmailOTP.mockResolvedValue({ headers: new Headers() });
});

describe("POST /login legacy providers", () => {
  it.each(["google", "cas", ""])("provider=%j starts no external sign-in and returns to /login", async (provider) => {
    const res = (await action({
      request: makeFlagOnRequest("1.2.3.4", { provider }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(mockSendVerificationOTP).not.toHaveBeenCalled();
    expect(mockSignInEmailOTP).not.toHaveBeenCalled();
  });
});

describe("GET /login loader routing", () => {
  it("renders the login page for an unauthenticated visitor", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false } as any);
    const result = await loader({ request: loaderRequest() } as any);
    // Signed out, so the v2 auth dress can only follow the flag's everyone
    // switch — off here, since the test DB has no flag rows.
    expect(result).toEqual({ authV2: false });
    expect(mockMemberFind).not.toHaveBeenCalled();
  });

  it("sends a non-member (applicant) to the portal", async () => {
    authedAs("applicant-1");
    mockMemberFind.mockResolvedValue(null);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/portal");
  });

  it("sends an accepted member whose Workspace provisioning hasn't set daliEmail to onboarding, not the portal", async () => {
    // The regression: type derives to "dartmouth" (no daliEmail) but the
    // DALIMember row exists, so they must NOT be bounced to /portal.
    authedAs("member-unprovisioned");
    mockMemberFind.mockResolvedValue({
      onboardedAt: null,
      user: { adminMembership: null },
    } as any);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/onboarding");
  });

  it("sends an onboarded member to the home dashboard", async () => {
    authedAs("member-done");
    mockMemberFind.mockResolvedValue({
      onboardedAt: new Date(),
      user: { adminMembership: null },
    } as any);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("sends a not-yet-onboarded staff member straight to the dashboard (skips onboarding)", async () => {
    authedAs("member-staff");
    mockMemberFind.mockResolvedValue({
      onboardedAt: null,
      user: { adminMembership: { isStaff: true } },
    } as any);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("sends an onboarded member to a safe next path", async () => {
    authedAs("member-done");
    mockMemberFind.mockResolvedValue({
      onboardedAt: new Date(),
      user: { adminMembership: null },
    } as any);
    const res = (await loader({
      request: new Request(
        "http://localhost/login?next=%2Fcalendar%2Fcheck-in%2Fm1",
      ),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/calendar/check-in/m1");
  });

  it("ignores an unsafe next for an onboarded member", async () => {
    authedAs("member-done");
    mockMemberFind.mockResolvedValue({
      onboardedAt: new Date(),
      user: { adminMembership: null },
    } as any);
    const res = (await loader({
      request: new Request("http://localhost/login?next=//evil.com"),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("still sends un-onboarded members to onboarding even with next", async () => {
    authedAs("member-unprovisioned");
    mockMemberFind.mockResolvedValue({
      onboardedAt: null,
      user: { adminMembership: null },
    } as any);
    const res = (await loader({
      request: new Request(
        "http://localhost/login?next=%2Fcalendar%2Fcheck-in%2Fm1",
      ),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/onboarding");
  });

  it("honors next for staff who skip onboarding", async () => {
    authedAs("member-staff");
    mockMemberFind.mockResolvedValue({
      onboardedAt: null,
      user: { adminMembership: { isStaff: true } },
    } as any);
    const res = (await loader({
      request: new Request(
        "http://localhost/login?next=%2Fcalendar%2Fcheck-in%2Fm1",
      ),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/calendar/check-in/m1");
  });
});

describe("POST /login next cookie", () => {
  function verifyWithNext(next: string) {
    return makeFlagOnRequest("9.9.9.9", {
      provider: "verify-code",
      identifier: "ada@example.edu",
      otp: "123456",
      next,
    });
  }

  it("stores a safe next in __dali_login_next after a verified code", async () => {
    const res = (await action({ request: verifyWithNext("/calendar/check-in/m1") } as any)) as Response;
    expect(res.status).toBe(302);
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.includes(`__dali_login_next=${encodeURIComponent("/calendar/check-in/m1")}`)),
    ).toBe(true);
  });

  it("does not store an unsafe next", async () => {
    const res = (await action({ request: verifyWithNext("//evil.com") } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie().some((c) => c.includes("__dali_login_next="))).toBe(false);
  });
});

// /login is passwordless: enter your email, we send a 6-digit sign-in code;
// passkeys are the fast repeat-login method. No password, no Google.

describe("POST /login email-code", () => {
  it("sends a sign-in OTP and advances to the code screen", async () => {
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "email-code",
        email: "ada@dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({ codeSent: true, email: "ada@dartmouth.edu" });
    expect(mockSendVerificationOTP).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ email: "ada@dartmouth.edu", type: "sign-in" }),
      }),
    );
  });

  it("resolves an alias to the canonical login email and delivers the code there", async () => {
    // A member types their @dartmouth; it's recorded as an alias whose canonical
    // login email is their @dali. The code must go to the canonical, but the
    // screen keeps showing what they typed (no mapping leak).
    mockUserFindFirst.mockResolvedValue({ email: "ada@dali.dartmouth.edu" } as any);
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "email-code",
        email: "ada@dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({
      codeSent: true,
      email: "ada@dartmouth.edu", // displayed = typed
      identifier: "ada@dali.dartmouth.edu", // verify + delivery = canonical
    });
    expect(mockSendVerificationOTP).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ email: "ada@dali.dartmouth.edu", type: "sign-in" }),
      }),
    );
  });

  it("still advances to the code screen when the send throws (anti-enumeration)", async () => {
    mockSendVerificationOTP.mockRejectedValue(new Error("boom"));
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "email-code",
        email: "nobody@dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({ codeSent: true, email: "nobody@dartmouth.edu" });
  });

  it("rejects an email with no @", async () => {
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", { provider: "email-code", email: "notanemail" }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("valid email") });
    expect(mockSendVerificationOTP).not.toHaveBeenCalled();
  });
});

describe("POST /login verify-code", () => {
  it("verifies the OTP, forwards the session cookie, and routes through the passkey offer", async () => {
    const baHeaders = new Headers({ "Set-Cookie": "dali.session_token=abc; Path=/" });
    mockSignInEmailOTP.mockResolvedValue({ headers: baHeaders });
    const res = (await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "verify-code",
        identifier: "ada@dartmouth.edu",
        otp: "123456",
      }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    // First-time passkey nudge: land on /welcome (which gates it), not straight home.
    expect(res.headers.get("Location")).toBe("/welcome?step=passkey&next=%2F");
    expect(mockSignInEmailOTP).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ email: "ada@dartmouth.edu", otp: "123456" }),
      }),
    );
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie")!];
    expect(cookies.some((c: string) => c.includes("dali.session_token="))).toBe(true);
  });

  it("stays on the code screen with an error when the code is wrong", async () => {
    mockSignInEmailOTP.mockRejectedValue(new Error("invalid otp"));
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "verify-code",
        identifier: "ada@dartmouth.edu",
        otp: "000000",
      }),
    } as any);
    expect(result).toMatchObject({
      codeSent: true,
      email: "ada@dartmouth.edu",
      error: expect.stringContaining("didn't match"),
    });
  });

  it("steers to a fresh code when attempts on the code are exhausted (FORBIDDEN)", async () => {
    // BetterAuth throws a FORBIDDEN APIError once the per-code attempt cap is hit.
    mockSignInEmailOTP.mockRejectedValue({ status: "FORBIDDEN" });
    const result = await action({
      request: makeFlagOnRequest("1.2.3.4", {
        provider: "verify-code",
        identifier: "ada@dartmouth.edu",
        otp: "000000",
      }),
    } as any);
    expect(result).toMatchObject({
      codeSent: true,
      email: "ada@dartmouth.edu",
      error: expect.stringContaining("Request a new one"),
    });
  });
});

describe("POST /login rate-limit scoping", () => {
  it("keeps the user on the code screen with a message when BetterAuth throttles the send", async () => {
    mockSendVerificationOTP.mockRejectedValue({ status: "TOO_MANY_REQUESTS" });
    const result = await action({
      request: makeFlagOnRequest("7.7.7.7", {
        provider: "email-code",
        email: "ada@dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({
      codeSent: true,
      email: "ada@dartmouth.edu",
      error: expect.stringContaining("several codes"),
    });
  });

  it("does not throttle sends in the route itself; the shared BetterAuth hook owns the limit", async () => {
    for (let i = 0; i < 8; i++) {
      const result = await action({
        request: makeFlagOnRequest("7.7.7.9", {
          provider: "email-code",
          email: "ada@dartmouth.edu",
        }),
      } as any);
      expect(result).not.toHaveProperty("error");
    }
    expect(mockSendVerificationOTP).toHaveBeenCalledTimes(8);
  });

  it("does not coarse-limit verify attempts", async () => {
    const ip = "7.7.7.8";
    // A typo-fixing user posts verify-code several times on the same IP; each
    // still reaches BetterAuth (which caps attempts per code) instead of 429ing.
    for (let i = 0; i < 6; i++) {
      const res = (await action({
        request: makeFlagOnRequest(ip, {
          provider: "verify-code",
          email: "ada@dartmouth.edu",
          otp: "123456",
        }),
      } as any)) as Response;
      expect(res.status).toBe(302);
    }
    expect(mockSignInEmailOTP).toHaveBeenCalledTimes(6);
  });
});
