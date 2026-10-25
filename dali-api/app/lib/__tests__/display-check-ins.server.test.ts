import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledMeeting: { findUnique: vi.fn() },
    meetingAttendance: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => (u ? `https://cdn/${u}` : null)) }));

import { prisma } from "~/lib/db";
import { getDisplayCheckIns, isCheckedIn } from "~/lib/display-check-ins.server";

const occurrenceStart = new Date("2026-10-23T22:00:00Z");
const row = (id: string, present: boolean, minute: number, photoUrl: string | null = null) => ({
  present,
  markedAt: new Date(occurrenceStart.getTime() + minute * 60_000),
  user: { id, firstName: id.toUpperCase(), lastName: "L", photoUrl },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.scheduledMeeting.findUnique).mockResolvedValue({
    organizerId: "org",
    participantUserIds: ["a", "b", "c"],
  } as never);
  vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue([]);
});

describe("getDisplayCheckIns", () => {
  it("reads one occurrence's attendance, latest first", async () => {
    await getDisplayCheckIns("m1", occurrenceStart, 4);
    expect(prisma.meetingAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduledMeetingId: "m1", occurrenceStart },
        orderBy: { markedAt: "desc" },
      }),
    );
  });

  it("counts only people marked present", async () => {
    vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue([
      row("a", true, 3),
      row("b", false, 2),
      row("c", true, 1),
    ] as never);
    const result = await getDisplayCheckIns("m1", occurrenceStart, 4);
    expect(result.count).toBe(2);
    expect(result.recent.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("expects the organizer, invitees, and walk-ins on the roster, each once", async () => {
    vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue([
      row("a", true, 2),
      row("walk-in", true, 1),
    ] as never);
    expect((await getDisplayCheckIns("m1", occurrenceStart, 4)).expected).toBe(5);
  });

  it("caps the recent list but not the count", async () => {
    vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue(
      ["a", "b", "c", "d", "e"].map((id, i) => row(id, true, 10 - i)) as never,
    );
    const result = await getDisplayCheckIns("m1", occurrenceStart, 2);
    expect(result.count).toBe(5);
    expect(result.recent).toHaveLength(2);
  });

  it("resolves photos and sends when each person checked in", async () => {
    vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue([row("a", true, 5, "key.jpg")] as never);
    const [checkIn] = (await getDisplayCheckIns("m1", occurrenceStart, 4)).recent;
    expect(checkIn).toEqual({
      id: "a",
      firstName: "A",
      lastName: "L",
      photoUrl: "https://cdn/key.jpg",
      at: "2026-10-23T22:05:00.000Z",
    });
  });

  it("still counts check-ins for a meeting that's gone", async () => {
    vi.mocked(prisma.scheduledMeeting.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.meetingAttendance.findMany).mockResolvedValue([row("a", true, 1)] as never);
    expect(await getDisplayCheckIns("m1", occurrenceStart, 4)).toMatchObject({ count: 1, expected: 1 });
  });
});

describe("isCheckedIn", () => {
  it("looks for a present row for that person at that occurrence", async () => {
    vi.mocked(prisma.meetingAttendance.findFirst).mockResolvedValue({ id: "x" } as never);
    expect(await isCheckedIn("m1", occurrenceStart, "u1")).toBe(true);
    expect(prisma.meetingAttendance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scheduledMeetingId: "m1", occurrenceStart, userId: "u1", present: true } }),
    );
  });

  it("is false with no row", async () => {
    vi.mocked(prisma.meetingAttendance.findFirst).mockResolvedValue(null);
    expect(await isCheckedIn("m1", occurrenceStart, "u1")).toBe(false);
  });
});
