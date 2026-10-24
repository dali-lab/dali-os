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
const mockFindMany = vi.hoisted(() => vi.fn());
vi.mock("~/lib/db", () => ({ prisma: { auditLog: { count: mockCount, findMany: mockFindMany } } }));
const ipRules = vi.hoisted(() => ({
  isIpBlocked: vi.fn(),
  isIpTrusted: vi.fn(),
  autoBlockIp: vi.fn(),
  auditBlockedHit: vi.fn(),
}));
vi.mock("~/lib/ip-rules.server", () => ipRules);

import { logAuditEvent } from "~/lib/audit";
import {
  AUTO_BLOCK_AFTER_THROTTLES,
  AUTO_BLOCK_WINDOW_MS,
  OTP_SEND_DAY_MS,
  OTP_SEND_HOUR_MS,
  OTP_SEND_MAX_PER_EMAIL,
  OTP_SEND_MAX_PER_EMAIL_DAY,
  OTP_SEND_MAX_PER_EMAIL_HOUR,
  OTP_SEND_MAX_PER_IP,
  OTP_SEND_MAX_PER_IP_DAY,
  OTP_SEND_MAX_PER_TRUSTED_IP,
  OTP_SEND_WINDOW_MS,
  rejectBlockedIp,
  rejectDirectMagicLink,
  throttleOtpSend,
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

// Per-email requests come back as timestamps (`email` of them a minute old, or
// one per entry of `emailAges` in ms); each count() is told apart by its where.
function counts({
  email = 0,
  emailAges = Array<number>(email).fill(60_000),
  ip = 0,
  day = 0,
  throttles = 0,
}: { email?: number; emailAges?: number[]; ip?: number; day?: number; throttles?: number } = {}) {
  mockFindMany.mockImplementation(async () =>
    emailAges.map((age) => ({ createdAt: new Date(Date.now() - age) })),
  );
  mockCount.mockImplementation(async ({ where }: any) => {
    if (where.action === "auth.code.throttled") return throttles;
    // Split well between the 10-minute and daily windows: elapsed test time
    // makes the 10-minute window read a few ms over 10 minutes.
    const windowMs = Date.now() - where.createdAt.gte.getTime();
    return windowMs > OTP_SEND_HOUR_MS ? day : ip;
  });
}

function countedWhere(predicate: (where: any) => boolean) {
  return mockCount.mock.calls.some(([{ where }]: any) => predicate(where));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  counts();
  ipRules.isIpBlocked.mockResolvedValue(false);
  ipRules.isIpTrusted.mockResolvedValue(false);
  ipRules.autoBlockIp.mockResolvedValue(true);
});

describe("throttleOtpSend", () => {
  it("ignores other endpoints", async () => {
    await throttleOtpSend(ctx({ path: "/sign-in/email-otp" }));
    await throttleOtpSend(ctx({ path: "/magic-link/verify" }));
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

  it("reads a day of requests for the email, and counts the IP over 10 minutes and a day", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await throttleOtpSend(ctx());
    const tenMin = new Date(now - OTP_SEND_WINDOW_MS);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        action: "auth.code.request",
        createdAt: { gte: new Date(now - OTP_SEND_DAY_MS) },
        metadata: { path: ["email"], equals: "ada@dali.dartmouth.edu" },
      },
      select: { createdAt: true },
    });
    expect(mockCount).toHaveBeenCalledWith({
      where: { action: "auth.code.request", createdAt: { gte: tenMin }, ip: "1.2.3.4" },
    });
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        action: "auth.code.request",
        ip: "1.2.3.4",
        createdAt: { gte: new Date(now - OTP_SEND_DAY_MS) },
      },
    });
  });

  it("allows the last request under each cap", async () => {
    counts({
      email: OTP_SEND_MAX_PER_EMAIL - 1,
      ip: OTP_SEND_MAX_PER_IP - 1,
      day: OTP_SEND_MAX_PER_IP_DAY - 1,
    });
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
  });

  it.each([
    ["email", { email: OTP_SEND_MAX_PER_EMAIL }],
    ["IP (10 min)", { ip: OTP_SEND_MAX_PER_IP }],
    ["IP (day)", { day: OTP_SEND_MAX_PER_IP_DAY }],
  ])("refuses at the %s cap and records a throttled row", async (_label, c) => {
    counts(c);
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.throttled", ip: "1.2.3.4" }),
    );
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.request" }),
    );
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

  it("skips IP caps when no client IP is known, but still applies the email cap", async () => {
    counts({ email: OTP_SEND_MAX_PER_EMAIL, ip: 999, day: 999 });
    await expect(throttleOtpSend(ctx({ headers: new Headers() }))).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockCount).not.toHaveBeenCalled();
    expect(ipRules.autoBlockIp).not.toHaveBeenCalled();

    vi.clearAllMocks();
    counts({ ip: 999, day: 999 });
    await expect(throttleOtpSend(ctx({ headers: new Headers() }))).resolves.toBeUndefined();
  });

  it("fails open when the count query errors", async () => {
    mockCount.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.code.request" }),
    );
  });

  describe("on a trusted network", () => {
    beforeEach(() => {
      ipRules.isIpTrusted.mockResolvedValue(true);
    });

    it("allows more requests per IP than an outside address", async () => {
      counts({ ip: OTP_SEND_MAX_PER_IP });
      await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
      counts({ ip: OTP_SEND_MAX_PER_TRUSTED_IP - 1 });
      await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
    });

    it("refuses at the trusted per-IP cap", async () => {
      counts({ ip: OTP_SEND_MAX_PER_TRUSTED_IP });
      await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    });

    it("has no daily cap", async () => {
      counts({ day: 10_000 });
      await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
      expect(countedWhere((w) => Date.now() - w.createdAt?.gte?.getTime() > OTP_SEND_HOUR_MS)).toBe(false);
    });

    it("keeps the same per-email cap", async () => {
      counts({ email: OTP_SEND_MAX_PER_EMAIL });
      await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    });

    it("is never auto-blocked", async () => {
      counts({ email: OTP_SEND_MAX_PER_EMAIL, throttles: 99 });
      await expect(throttleOtpSend(ctx())).rejects.toThrow();
      expect(ipRules.autoBlockIp).not.toHaveBeenCalled();
    });
  });

  describe("auto-blocking", () => {
    it("blocks an outside address once it has been refused enough times in an hour", async () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      counts({ ip: OTP_SEND_MAX_PER_IP, throttles: AUTO_BLOCK_AFTER_THROTTLES });
      await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
      expect(mockCount).toHaveBeenCalledWith({
        where: {
          action: "auth.code.throttled",
          ip: "1.2.3.4",
          createdAt: { gte: new Date(now - AUTO_BLOCK_WINDOW_MS) },
        },
      });
      expect(ipRules.autoBlockIp).toHaveBeenCalledWith(
        "1.2.3.4",
        `${AUTO_BLOCK_AFTER_THROTTLES} refused sign-in code requests within an hour`,
      );
    });

    it("does not block below the threshold", async () => {
      counts({ ip: OTP_SEND_MAX_PER_IP, throttles: AUTO_BLOCK_AFTER_THROTTLES - 1 });
      await expect(throttleOtpSend(ctx())).rejects.toThrow();
      expect(ipRules.autoBlockIp).not.toHaveBeenCalled();
    });

    it("does not check for a block when the request is allowed", async () => {
      await throttleOtpSend(ctx());
      expect(countedWhere((w) => w.action === "auth.code.throttled")).toBe(false);
    });

    it("still refuses the request when the block itself fails", async () => {
      counts({ ip: OTP_SEND_MAX_PER_IP, throttles: AUTO_BLOCK_AFTER_THROTTLES });
      ipRules.autoBlockIp.mockRejectedValue(new Error("db down"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    });
  });
});

describe("per-email limits over longer windows", () => {
  const MIN = 60_000;
  // Spaced 11 minutes apart so the 10-minute cap never trips on its own.
  const spaced = (n: number, start = MIN) => Array.from({ length: n }, (_, i) => start + i * 11 * MIN);

  it("allows the last request under the hourly cap", async () => {
    counts({ emailAges: spaced(OTP_SEND_MAX_PER_EMAIL_HOUR - 1).filter((a) => a < OTP_SEND_HOUR_MS) });
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
  });

  it("refuses at the hourly cap even when no 10-minute window is full", async () => {
    const ages = spaced(OTP_SEND_MAX_PER_EMAIL_HOUR);
    expect(ages.every((a) => a < OTP_SEND_HOUR_MS)).toBe(true);
    counts({ emailAges: ages });
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
  });

  it("stops counting a request toward the hourly cap once it is over an hour old", async () => {
    counts({
      emailAges: [...spaced(OTP_SEND_MAX_PER_EMAIL_HOUR - 1), OTP_SEND_HOUR_MS + MIN],
    });
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
  });

  it("allows the last request under the daily cap", async () => {
    const hourly = Array.from({ length: OTP_SEND_MAX_PER_EMAIL_DAY - 1 }, (_, i) => (i + 2) * OTP_SEND_HOUR_MS);
    counts({ emailAges: hourly });
    await expect(throttleOtpSend(ctx())).resolves.toBeUndefined();
  });

  it("refuses at the daily cap even when every hour is under its cap", async () => {
    const hourly = Array.from({ length: OTP_SEND_MAX_PER_EMAIL_DAY }, (_, i) => (i + 2) * OTP_SEND_HOUR_MS);
    expect(Math.max(...hourly)).toBeLessThan(OTP_SEND_DAY_MS);
    counts({ emailAges: hourly });
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
  });

  it("applies on a trusted network too, and never auto-blocks it", async () => {
    ipRules.isIpTrusted.mockResolvedValue(true);
    counts({ emailAges: spaced(OTP_SEND_MAX_PER_EMAIL_HOUR), throttles: 99 });
    await expect(throttleOtpSend(ctx())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(ipRules.autoBlockIp).not.toHaveBeenCalled();
  });

  it("limits one member however many addresses the requests come from", async () => {
    counts({ emailAges: spaced(OTP_SEND_MAX_PER_EMAIL_HOUR) });
    for (const ip of ["198.51.100.1", "198.51.100.2", "203.0.113.9"]) {
      const headers = new Headers({ "Fly-Client-IP": ip });
      await expect(throttleOtpSend(ctx({ headers }))).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    }
  });
});

describe("magic-link sends", () => {
  const link = (overrides: Record<string, unknown> = {}) =>
    ctx({ path: "/sign-in/magic-link", body: { email: "Ada@example.edu" }, ...overrides });

  it("records a request as a magic-link row in the shared bucket", async () => {
    await expect(throttleOtpSend(link())).resolves.toBeUndefined();
    expect(mockAudit).toHaveBeenCalledWith({
      action: "auth.code.request",
      metadata: { email: "ada@example.edu", type: "magic-link" },
      ip: "1.2.3.4",
      userAgent: "UA",
    });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: "auth.code.request",
          metadata: { path: ["email"], equals: "ada@example.edu" },
        }),
      }),
    );
  });

  it.each([
    ["email", { email: OTP_SEND_MAX_PER_EMAIL }],
    ["email (hour)", { emailAges: Array.from({ length: OTP_SEND_MAX_PER_EMAIL_HOUR }, (_, i) => (i + 1) * 11 * 60_000) }],
    ["IP (10 min)", { ip: OTP_SEND_MAX_PER_IP }],
    ["IP (day)", { day: OTP_SEND_MAX_PER_IP_DAY }],
  ])("refuses at the %s cap", async (_label, c) => {
    counts(c);
    await expect(throttleOtpSend(link())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.code.throttled",
        metadata: { email: "ada@example.edu", type: "magic-link" },
      }),
    );
  });

  it("auto-blocks an outside address refused too often", async () => {
    counts({ ip: OTP_SEND_MAX_PER_IP, throttles: AUTO_BLOCK_AFTER_THROTTLES });
    await expect(throttleOtpSend(link())).rejects.toThrow();
    expect(ipRules.autoBlockIp).toHaveBeenCalledWith("1.2.3.4", expect.any(String));
  });

  it("ignores a missing email", async () => {
    await throttleOtpSend(link({ body: {} }));
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("rejectDirectMagicLink", () => {
  const request = new Request("https://x.test/api/auth/sign-in/magic-link", { method: "POST" });

  it("refuses a magic-link request that came in over HTTP", () => {
    expect(() => rejectDirectMagicLink({ path: "/sign-in/magic-link", request })).toThrow(
      expect.objectContaining({ status: "NOT_FOUND" }),
    );
  });

  it("allows a server-side auth.api call, which carries headers but no request", () => {
    expect(() =>
      rejectDirectMagicLink({ path: "/sign-in/magic-link", headers: new Headers() }),
    ).not.toThrow();
  });

  it("leaves other endpoints reachable over HTTP, including link verification", () => {
    for (const path of ["/magic-link/verify", "/email-otp/send-verification-otp", "/get-session"]) {
      expect(() => rejectDirectMagicLink({ path, request })).not.toThrow();
    }
  });
});

describe("rejectBlockedIp", () => {
  it("lets an unblocked address through on any endpoint", async () => {
    await expect(rejectBlockedIp(ctx({ path: "/get-session" }))).resolves.toBeUndefined();
    expect(ipRules.auditBlockedHit).not.toHaveBeenCalled();
  });

  it("refuses a blocked address on any endpoint and records the hit", async () => {
    ipRules.isIpBlocked.mockResolvedValue(true);
    await expect(rejectBlockedIp(ctx({ path: "/sign-in/social" }))).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
    expect(ipRules.isIpBlocked).toHaveBeenCalledWith("1.2.3.4");
    expect(ipRules.auditBlockedHit).toHaveBeenCalledWith("1.2.3.4", "/sign-in/social", "UA");
  });

  it("skips the check when no client IP is known", async () => {
    ipRules.isIpBlocked.mockResolvedValue(true);
    await expect(rejectBlockedIp(ctx({ headers: new Headers() }))).resolves.toBeUndefined();
    expect(ipRules.isIpBlocked).not.toHaveBeenCalled();
  });
});
