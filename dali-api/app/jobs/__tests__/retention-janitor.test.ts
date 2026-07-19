import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runRetentionJanitor } from "~/jobs/retention-janitor.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.deleteMany.mockResolvedValue({ count: 3 });
  mockPrisma.taskReminder.deleteMany.mockResolvedValue({ count: 2 });
  mockPrisma.meetingReminderLog.deleteMany.mockResolvedValue({ count: 1 });
});

describe("retention-janitor", () => {
  it("deletes only read notifications older than the cutoff", async () => {
    const now = new Date("2026-07-15T12:00:00Z");

    const result = await runRetentionJanitor({
      now,
      lastSuccessAt: null,
      settings: { retentionMonths: 6 },
    });

    // setMonth works in local wall time, so the UTC hour can shift across a
    // DST boundary — assert the month math, not an exact instant.
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { readAt: { not: null }, createdAt: { lt: cutoff } },
    });
    expect(result.items).toBe(6);
    expect(result.note).toBe("notifications=3 taskReminders=2 meetingLogs=1");
  });

  it("sweeps sent and stale-unsent task reminders, and old meeting logs", async () => {
    const now = new Date("2026-07-15T12:00:00Z");

    await runRetentionJanitor({
      now,
      lastSuccessAt: null,
      settings: { retentionMonths: 3 },
    });

    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 3);
    expect(mockPrisma.taskReminder.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { sentAt: { lt: cutoff } },
          { sentAt: null, dueAtSnapshot: { lt: cutoff } },
        ],
      },
    });
    expect(mockPrisma.meetingReminderLog.deleteMany).toHaveBeenCalledWith({
      where: { sentAt: { lt: cutoff } },
    });
  });
});
