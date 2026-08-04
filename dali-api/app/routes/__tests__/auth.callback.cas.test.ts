import { describe, it, expect, beforeEach, vi } from "vitest";

// Standalone Dartmouth CAS login lands the user on their intended destination
// (the __dali_login_next cookie set by /login) instead of always /portal.
// Mock every server dependency the loader touches so the test stays Prisma-
// free; leave ~/lib/login-next real so we exercise the actual cookie consume.
vi.mock("~/lib/auth", () => ({
  validateCasTicket: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/user-provisioning", () => ({ upsertUserFromCas: vi.fn() }));
vi.mock("~/lib/session", () => ({ issueSession: vi.fn() }));
vi.mock("~/lib/membership-status", () => ({
  syncAndRecomputeMembershipStatus: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cookies", () => ({ setSessionCookie: vi.fn() }));
vi.mock("~/lib/request-meta", () => ({ getClientIp: () => "1.2.3.4" }));
vi.mock("~/lib/app-env", () => ({
  getApiBaseUrl: () => "http://localhost",
  getAppEnv: () => "dev",
}));

import { validateCasTicket } from "~/lib/auth";
import { upsertUserFromCas } from "~/lib/user-provisioning";
import { issueSession } from "~/lib/session";
import { LOGIN_NEXT_COOKIE } from "~/lib/login-next";
import { loader } from "~/routes/auth.callback.cas";

const mockValidate = vi.mocked(validateCasTicket);
const mockUpsert = vi.mocked(upsertUserFromCas);
const mockIssue = vi.mocked(issueSession);

function casRequest(nextCookie?: string) {
  const headers: Record<string, string> = {};
  if (nextCookie !== undefined) {
    headers.Cookie = `${LOGIN_NEXT_COOKIE}=${encodeURIComponent(nextCookie)}`;
  }
  return new Request("http://localhost/auth/callback/cas?ticket=T123", {
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidate.mockResolvedValue({
    netId: "abc123",
    firstName: "Ada",
    lastName: "Lovelace",
  });
  mockUpsert.mockResolvedValue({ user: { id: "u1" } } as any);
  mockIssue.mockResolvedValue({ rawId: "raw-session" } as any);
});

describe("GET /auth/callback/cas standalone login next", () => {
  it("lands the user on a safe next path from the cookie", async () => {
    const res = (await loader({
      request: casRequest("/education/offering-1"),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/education/offering-1");
  });

  it("clears the login-next cookie after consuming it", async () => {
    const res = (await loader({
      request: casRequest("/education/offering-1"),
    } as any)) as Response;
    const cookies = res.headers.getSetCookie?.() ?? [
      res.headers.get("Set-Cookie") ?? "",
    ];
    const cleared = cookies.find((c) => c.startsWith(`${LOGIN_NEXT_COOKIE}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toContain("Max-Age=0");
  });

  it("falls back to /portal when there is no next cookie", async () => {
    const res = (await loader({ request: casRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/portal");
  });

  it("ignores an unsafe next cookie and falls back to /portal", async () => {
    const res = (await loader({
      request: casRequest("//evil.com"),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/portal");
  });
});
