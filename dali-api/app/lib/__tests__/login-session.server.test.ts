import { describe, it, expect, beforeEach, vi } from "vitest";

const mockMint = vi.hoisted(() => vi.fn());
const mockAppendCookie = vi.hoisted(() => vi.fn());

vi.mock("~/lib/betterauth-session.server", () => ({ mintBetterAuthSession: mockMint }));
vi.mock("~/lib/betterauth-cookie.server", () => ({
  appendBetterAuthSessionCookie: mockAppendCookie,
}));

import { startLoginSession } from "~/lib/login-session.server";

function request() {
  return new Request("http://localhost/partner/invite/x", {
    method: "POST",
    headers: { "fly-client-ip": "203.0.113.4", "user-agent": "Browser/1.0" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMint.mockResolvedValue({ token: "ba-token", sessionId: "s1", expiresAt: new Date() });
  mockAppendCookie.mockImplementation(async (headers: Headers, token: string) => {
    headers.append("Set-Cookie", `dali.session_token=${token}.sig; Path=/; HttpOnly`);
  });
});

describe("startLoginSession", () => {
  it("mints a BetterAuth session with the client's IP and user agent and plants its cookie", async () => {
    const headers = new Headers();
    await startLoginSession(headers, request(), "user-1");

    expect(mockMint).toHaveBeenCalledWith({
      userId: "user-1",
      ipAddress: "203.0.113.4",
      userAgent: "Browser/1.0",
    });
    expect(mockAppendCookie).toHaveBeenCalledWith(headers, "ba-token");
  });

  it("clears any legacy cookie so it can't keep the browser signed in as someone else", async () => {
    const headers = new Headers();
    await startLoginSession(headers, request(), "user-1");

    const cookies = headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("dali.session_token=ba-token"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__dali_sid=;") && c.includes("Max-Age=0"))).toBe(true);
  });
});
