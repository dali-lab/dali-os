import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  displayScanSession: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
}));
vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledMeeting: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
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
  tx.displayScanSession.findFirst.mockResolvedValue(null);
});

afterEach(() => vi.useRealTimers());

describe("startDisplayScan", () => {
  it("lapses at the occurrence's end plus the check-in grace", async () => {
    const expiresAt = new Date("2026-09-30T23:15:00Z");
    expect(await startDisplayScan("m1", occurrenceStart, "u1")).toEqual({ ok: true, expiresAt });
    expect(tx.displayScanSession.create).toHaveBeenCalledWith({
      data: { scheduledMeetingId: "m1", occurrenceStart, expiresAt, startedByUserId: "u1" },
    });
  });

  it("refuses while another event has the iPads", async () => {
    tx.displayScanSession.findFirst.mockResolvedValue({
      scheduledMeetingId: "m2",
      occurrenceStart,
      scheduledMeeting: { title: "Design critique" },
    });
    const result = await startDisplayScan("m1", occurrenceStart, "u1");
    expect(result).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("Design critique") });
    expect(tx.displayScanSession.deleteMany).not.toHaveBeenCalled();
    expect(tx.displayScanSession.create).not.toHaveBeenCalled();
  });

  it("refuses another occurrence of the same series too", async () => {
    tx.displayScanSession.findFirst.mockResolvedValue({
      scheduledMeetingId: "m1",
      occurrenceStart: new Date("2026-09-23T22:00:00Z"),
      scheduledMeeting: { title: "Lab night" },
    });
    expect((await startDisplayScan("m1", occurrenceStart, "u1")).ok).toBe(false);
  });

  it("is a no-op when this occurrence already has the iPads", async () => {
    tx.displayScanSession.findFirst.mockResolvedValue({
      scheduledMeetingId: "m1",
      occurrenceStart,
      scheduledMeeting: { title: "Lab night" },
    });
    expect((await startDisplayScan("m1", occurrenceStart, "u1")).ok).toBe(true);
    expect(tx.displayScanSession.create).not.toHaveBeenCalled();
  });

  it("refuses an occurrence that's already over", async () => {
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    expect(await startDisplayScan("m1", occurrenceStart, "u1")).toMatchObject({ ok: false, status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("gives an unscheduled event 12 hours", async () => {
    vi.mocked(prisma.scheduledMeeting.findUnique).mockResolvedValue({ ...meeting, selectedAt: null } as never);
    expect(await startDisplayScan("m1", occurrenceStart, "u1")).toEqual({
      ok: true,
      expiresAt: new Date("2026-10-01T09:00:00Z"),
    });
  });
});
