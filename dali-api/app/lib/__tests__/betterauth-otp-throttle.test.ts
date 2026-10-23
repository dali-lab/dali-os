import { describe, it, expect, beforeEach, vi } from "vitest";

const { FakeAPIError } = vi.hoisted(() => {
  class FakeAPIError extends Error {
    status: string;
    constructor(status: string) {
      super(status);
      this.status = status;
    }
  }
  return { FakeAPIError };
});
vi.mock("better-auth/api", () => ({ APIError: FakeAPIError }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
const mockCount = vi.hoisted(() => vi.fn());
vi.mock("~/lib/db", () => ({ prisma: { auditLog: { count: mockCount } } }));

import { logAuditEvent } from "~/lib/audit";
import {
  throttleOtpSend,
  OTP_SEND_MAX_PER_EMAIL,
  OTP_SEND_MAX_PER_IP,
  OTP_SEND_WINDOW_MS,
} from "~/lib/betterauth-otp-throttle.server";

const mockAudit = vi.mocked(logAuditEvent);
const PATH = "/email-otp/send-verification-otp";

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    path: PATH,
    body: { email: "Ada@DALI.dartmouth.edu", type: "sign-in" },
    headers: new Headers({ "Fly-Client-IP": "1.2.3.4", "User-Agent": "UA" }),
    ...overrides,
  };
}

// count() is called as [byEmail, byIp]; tell them apart by the where clause.
function counts(byEmail: number, byIp: number) {
  mockCount.mockImplementation(async ({ where }: any) =>
    where.metadata ? byEmail : byIp,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  counts(0, 0);
});

describe("throttleOtpSend", () => {
  it("ignores other endpoints", async () => {
    await throttleOtpSend(ctx({ path: "/sign-in/email-otp" }));
    await throttleOtpSend(ctx({ path: "/sign-in/magic-link" }));
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("ignores a missing or blank email (BetterAuth rejects it itself)", async () => {
    await throttleOtpSend(ctx({ body: { type: "sign-in" } }));
    await throttleOtpSend(ctx({ body: { email: "  ", type: "sign-in" } }));
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("records an allowed request with the normalized email, IP and user agent", async () => {
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
    expect(mockAudit).toHaveBeenCalledWith({
      action: "auth.code.request",
      metadata: { email: "ada@dali.dartmouth.edu", type: "sign-in" },
      ip: "1.2.3.4",
      userAgent: "UA",
    });
  });

  it("counts requests for this email and this IP within the window", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await throttleOtpSend(ctx());
    const since = new Date(now - OTP_SEND_WINDOW_MS);
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        action: "auth.code.request",
        createdAt: { gte: since },
        metadata: { path: ["email"], equals: "ada@dali.dartmouth.edu" },
      },
    });
    expect(mockCount).toHaveBeenCalledWith({
      where: { action: "auth.code.request", createdAt: { gte: since }, ip: "1.2.3.4" },
    });
    vi.restoreAllMocks();
  });

  it("allows the last request under each cap", async () => {
    counts(OTP_SEND_MAX_PER_EMAIL - 1, OTP_SEND_MAX_PER_IP - 1);
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
  });

  it("refuses once the email cap is reached and records a throttled row", async () => {
    counts(OTP_SEND_MAX_PER_EMAIL, 0);
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.throttled", ip: "1.2.3.4" }),
    );
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.request" }),
    );
  });

  it("refuses once the IP cap is reached, even across different emails", async () => {
    counts(0, OTP_SEND_MAX_PER_IP);
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
  });

  it("reads the IP from the request when BetterAuth was reached over HTTP", async () => {
    const request = new Request("https://x.test/api/auth", {
      headers: { "X-Forwarded-For": "9.9.9.9, 10.0.0.1", "User-Agent": "curl" },
    });
    await throttleOtpSend(ctx({ request, headers: undefined }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "9.9.9.9", userAgent: "curl" }),
    );
  });

  it("skips the IP cap when no client IP is known, but still applies the email cap", async () => {
    counts(OTP_SEND_MAX_PER_EMAIL, 999);
    await expect(throttleOtpSend(ctx({ headers: new Headers() }))).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
    expect(mockCount).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    counts(0, 999);
    await expect(throttleOtpSend(ctx({ headers: new Headers() }))).resolves.toBeUndefined();
  });

  it("fails open when the count query errors", async () => {
    mockCount.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.request" }),
    );
    vi.restoreAllMocks();
  });
});
