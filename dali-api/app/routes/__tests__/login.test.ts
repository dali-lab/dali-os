import { describe, it, expect, beforeEach, vi } from "vitest";

// `~/routes/login` transitively imports `~/lib/auth`, which now reaches into
// `~/lib/oauth` for the silent-refresh path; `oauth` imports the real Prisma
// client. Mocking `~/lib/db` keeps these tests Prisma-free.
vi.mock("~/lib/db");

// The loader routes by membership, so it calls requireAuth + prisma directly.
// Mock requireAuth so each test can drive the authenticated user without
// standing up a full session.
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));

import { _resetForTests } from "~/lib/rate-limit";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action, loader } from "~/routes/login";

const mockRequireAuth = vi.mocked(requireAuth);
const mockMemberFind = vi.mocked(prisma.dALIMember.findUnique);

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

function makeRequest(ip = "1.2.3.4", next?: string) {
  const form = new URLSearchParams({
    provider: "google",
  });
  if (next) form.set("next", next);
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
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
});

describe("POST /login rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(302);
    }
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await action({ request: makeRequest() } as any);
    }
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per IP", async () => {
    for (let i = 0; i < 5; i++) {
      await action({ request: makeRequest("1.2.3.4") } as any);
    }
    const limited = await action({ request: makeRequest("1.2.3.4") } as any);
    expect(limited.status).toBe(429);

    const ok = await action({ request: makeRequest("5.6.7.8") } as any);
    expect(ok.status).toBe(302);
  });
});

describe("GET /login loader routing", () => {
  it("renders the login page for an unauthenticated visitor", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false } as any);
    const result = await loader({ request: loaderRequest() } as any);
    // No redirect — the loader returns plain data so the page renders.
    expect(result).toEqual({});
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
  it("stores a safe next in __dali_login_next", async () => {
    const res = await action({
      request: makeRequest("9.9.9.9", "/calendar/check-in/m1"),
    } as any);
    expect(res.status).toBe(302);
    const cookies = res.headers.getSetCookie?.() ?? [
      res.headers.get("Set-Cookie")!,
    ];
    expect(
      cookies.some((c) =>
        c.includes(
          `__dali_login_next=${encodeURIComponent("/calendar/check-in/m1")}`,
        ),
      ),
    ).toBe(true);
  });

  it("does not store an unsafe next", async () => {
    const res = await action({
      request: makeRequest("8.8.8.8", "//evil.com"),
    } as any);
    expect(res.status).toBe(302);
    const cookies = res.headers.getSetCookie?.() ?? [
      res.headers.get("Set-Cookie")!,
    ];
    expect(cookies.some((c) => c.includes("__dali_login_next="))).toBe(false);
  });
});
