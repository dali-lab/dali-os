import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { auditLog: { findFirst: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { logApplicationView, APPLICATION_VIEW_WINDOW_MS } from "~/hiring/lib/application-view-audit.server";

const request = new Request("http://localhost/hiring/reviewer/application/app-1");
const args = { userId: "u1", applicationId: "app-1", cycleId: "c1", blinded: true, request };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("logApplicationView", () => {
  it("logs a view with the cycle and whether the reviewer was blinded", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);

    await logApplicationView(args);

    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "application.view",
      userId: "u1",
      targetId: "app-1",
      metadata: { cycleId: "c1", blinded: true },
      request,
    });
  });

  it("looks for the same user and application inside the window", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
    const before = Date.now();

    await logApplicationView(args);

    const where = vi.mocked(prisma.auditLog.findFirst).mock.calls[0][0]!.where as {
      action: string;
      userId: string;
      targetId: string;
      createdAt: { gte: Date };
    };
    expect(where).toMatchObject({ action: "application.view", userId: "u1", targetId: "app-1" });
    expect(where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(before - APPLICATION_VIEW_WINDOW_MS);
    expect(where.createdAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - APPLICATION_VIEW_WINDOW_MS + 5);
  });

  it("skips a repeat view inside the window", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue({ id: "a1" } as never);
    await logApplicationView(args);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("still logs when the dedupe lookup fails", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockRejectedValue(new Error("db down"));
    await logApplicationView(args);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });
});
