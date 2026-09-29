import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledMeeting: { findUnique: vi.fn() },
    displayScanSession: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/scheduled-meeting", () => ({
  CHECK_IN_GRACE_MIN: 15,
  resolveMeetingOccurrence: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { resolveMeetingOccurrence } from "~/lib/scheduled-meeting";
import { startDisplayScan } from "~/lib/display-scan.server";

const occurrenceStart = new Date("2026-09-30T22:00:00Z");
const meeting = {
  id: "m1",
  title: "Lab night",
  attendanceMode: "SelfCheckIn",
  selectedAt: occurrenceStart,
  createdAt: occurrenceStart,
  durationMinutes: 60,
  recurrenceRule: null,
  externalEventId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-09-30T21:00:00Z") });
  vi.mocked(prisma.scheduledMeeting.findUnique).mockResolvedValue(meeting as never);
  vi.mocked(resolveMeetingOccurrence).mockResolvedValue({
    originalStart: occurrenceStart,
    start: occurrenceStart,
    end: new Date("2026-09-30T23:00:00Z"),
  });
});

afterEach(() => vi.useRealTimers());

describe("startDisplayScan", () => {
  it("lapses at the occurrence's end plus the check-in grace", async () => {
    const started = await startDisplayScan("m1", occurrenceStart, "u1");
    expect(started?.expiresAt).toEqual(new Date("2026-09-30T23:15:00Z"));
    expect(prisma.displayScanSession.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.displayScanSession.create).toHaveBeenCalledWith({
      data: { scheduledMeetingId: "m1", occurrenceStart, expiresAt: started!.expiresAt, startedByUserId: "u1" },
    });
  });

  it("refuses an occurrence that's already over", async () => {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    expect(await startDisplayScan("m1", occurrenceStart, "u1")).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("gives an unscheduled event 12 hours", async () => {
    vi.mocked(prisma.scheduledMeeting.findUnique).mockResolvedValue({ ...meeting, selectedAt: null } as never);
    const started = await startDisplayScan("m1", occurrenceStart, "u1");
    expect(started?.expiresAt).toEqual(new Date("2026-10-01T09:00:00Z"));
  });
});
