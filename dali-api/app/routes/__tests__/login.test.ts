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

function makeRequest(ip = "1.2.3.4") {
  const form = new URLSearchParams({
    provider: "google",
  });
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
    mockMemberFind.mockResolvedValue({ onboardedAt: null } as any);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/onboarding");
  });

  it("sends an onboarded member to the member app", async () => {
    authedAs("member-done");
    mockMemberFind.mockResolvedValue({ onboardedAt: new Date() } as any);
    const res = (await loader({ request: loaderRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/hiring/reviewer");
  });
});
