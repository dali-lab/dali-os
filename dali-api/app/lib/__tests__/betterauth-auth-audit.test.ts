import { describe, it, expect, beforeEach, vi } from "vitest";

const { FakeAPIError } = vi.hoisted(() => {
  class FakeAPIError extends Error {
    status: string;
    body?: { code?: string };
    constructor(status: string, body?: { code?: string }) {
      super(status);
      this.status = status;
      this.body = body;
    }
  }
  return { FakeAPIError };
});
vi.mock("better-auth/api", () => ({ APIError: FakeAPIError }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { logAuditEvent } from "~/lib/audit";
import {
  signInMethod,
  auditSessionCreated,
  auditSignInFailure,
  auditAccountCreated,
} from "~/lib/betterauth-auth-audit.server";

const mockAudit = vi.mocked(logAuditEvent);

beforeEach(() => {
  vi.clearAllMocks();
  mockAudit.mockResolvedValue(undefined as any);
});

describe("signInMethod", () => {
  it.each([
    ["/sign-in/email-otp", "email-otp"],
    ["/magic-link/verify", "magic-link"],
    ["/passkey/verify-authentication", "passkey"],
    ["/callback/:id", "social"],
  ])("maps %s to %s", (path, method) => {
    expect(signInMethod(path)).toBe(method);
  });

  it("returns null for other paths", () => {
    expect(signInMethod("/passkey/verify-registration")).toBeNull();
    expect(signInMethod("/sign-out")).toBeNull();
    expect(signInMethod(undefined)).toBeNull();
  });
});

describe("auditSessionCreated", () => {
  it.each([
    ["/sign-in/email-otp", "email-otp"],
    ["/magic-link/verify", "magic-link"],
    ["/passkey/verify-authentication", "passkey"],
  ])("logs login.success for %s", async (path, method) => {
    const request = new Request("https://x.test/api/auth", {
      headers: { "User-Agent": "UA" },
    });
    await auditSessionCreated({ userId: "u1" }, { path, request });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "login.success",
        userId: "u1",
        metadata: { via: "betterauth", method },
        request,
      }),
    );
  });

  it("falls back to the session ip and user agent without a request", async () => {
    await auditSessionCreated(
      { userId: "u1", ipAddress: "1.2.3.4", userAgent: "UA" },
      { path: "/sign-in/email-otp" },
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "1.2.3.4", userAgent: "UA" }),
    );
  });

  it("skips impersonation sessions", async () => {
    await auditSessionCreated({ userId: "u1", impersonatedBy: "admin1" }, { path: "/x" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("skips MCP token sessions", async () => {
    await auditSessionCreated({ userId: "u1", grantId: "g1" }, null);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("skips sessions minted outside a BetterAuth endpoint", async () => {
    await auditSessionCreated({ userId: "u1" }, null);
    await auditSessionCreated({ userId: "u1" }, {});
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("logs an unmapped endpoint as method unknown", async () => {
    await auditSessionCreated({ userId: "u1" }, { path: "/sign-in/anonymous" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { via: "betterauth", method: "unknown" } }),
    );
  });
});

describe("auditSignInFailure", () => {
  it("logs login.failure with the error code and attempted email", async () => {
    await auditSignInFailure({
      path: "/sign-in/email-otp",
      body: { email: "A@B.com", otp: "123456" },
      context: { returned: new FakeAPIError("BAD_REQUEST", { code: "INVALID_OTP" }) },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "login.failure",
        metadata: {
          via: "betterauth",
          method: "email-otp",
          code: "INVALID_OTP",
          email: "a@b.com",
        },
      }),
    );
  });

  it("falls back to the status when the error has no code", async () => {
    await auditSignInFailure({
      path: "/passkey/verify-authentication",
      context: { returned: new FakeAPIError("UNAUTHORIZED") },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { via: "betterauth", method: "passkey", code: "UNAUTHORIZED" },
      }),
    );
  });

  it("no-ops on a successful sign-in", async () => {
    await auditSignInFailure({
      path: "/sign-in/email-otp",
      context: { returned: { token: "t" } },
    });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("no-ops on non-sign-in paths even with an error", async () => {
    await auditSignInFailure({
      path: "/passkey/verify-registration",
      context: { returned: new FakeAPIError("BAD_REQUEST") },
    });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("auditAccountCreated", () => {
  it("logs account.create with the user as actor and target", async () => {
    await auditAccountCreated({ id: "u9", email: "New@Dali.dartmouth.edu" }, null);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.create",
        userId: "u9",
        targetId: "u9",
        metadata: { via: "betterauth", email: "new@dali.dartmouth.edu" },
      }),
    );
  });
});
