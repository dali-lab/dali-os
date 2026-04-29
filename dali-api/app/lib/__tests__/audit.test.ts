import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";

const mockPrisma = prisma as unknown as {
  auditLog: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
});

describe("logAuditEvent", () => {
  it("writes a row with the given fields", async () => {
    await logAuditEvent({
      action: "login.success",
      userId: "user-1",
      targetId: "target-1",
      metadata: { provider: "google" },
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledOnce();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "login.success",
        userId: "user-1",
        targetId: "target-1",
        metadata: { provider: "google" },
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      },
    });
  });

  it("derives ip and userAgent from the request when provided", async () => {
    const request = new Request("http://localhost/cb", {
      headers: {
        "X-Forwarded-For": "9.8.7.6, 1.2.3.4",
        "User-Agent": "test-agent/1.0",
      },
    });

    await logAuditEvent({ action: "logout", userId: "u-1", request });

    const call = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(call.data.ip).toBe("9.8.7.6");
    expect(call.data.userAgent).toBe("test-agent/1.0");
    expect(call.data.action).toBe("logout");
    expect(call.data.userId).toBe("u-1");
  });

  it("falls back to null ip / userAgent when neither request nor explicit values are given", async () => {
    await logAuditEvent({ action: "login.failure" });

    const call = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(call.data.ip).toBeNull();
    expect(call.data.userAgent).toBeNull();
    expect(call.data.userId).toBeNull();
    expect(call.data.targetId).toBeNull();
  });

  it("swallows DB errors so audit-log failures never propagate to the caller", async () => {
    mockPrisma.auditLog.create.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAuditEvent({ action: "login.success", userId: "u-1" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("prefers Fly-Client-IP over X-Forwarded-For when both are present", async () => {
    const request = new Request("http://localhost/cb", {
      headers: {
        "Fly-Client-IP": "5.5.5.5",
        "X-Forwarded-For": "1.1.1.1",
      },
    });

    await logAuditEvent({ action: "auth.token.invalid", request });

    const call = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(call.data.ip).toBe("5.5.5.5");
  });
});
