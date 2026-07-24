import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { runMeetingReminders } from "~/jobs/meeting-reminders.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T15:00:00Z");
const IN_10_MIN = new Date(NOW.getTime() + 10 * 60_000);

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Design sync",
    organizerId: "org",
    participantUserIds: ["u1", "u2"],
    selectedAt: IN_10_MIN,
    durationMinutes: 30,
    recurrenceRule: null,
    exceptions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.scheduledMeeting.findMany.mockResolvedValue([meeting()]);
  mockPrisma.notification.findMany.mockResolvedValue([]); // no Declined RSVPs
  mockPrisma.user.findMany.mockResolvedValue([]); // recipient-timezone lookup
  mockPrisma.meetingReminderLog = {
    create: vi.fn().mockResolvedValue({}),
  } as never;
  mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runMeetingReminders", () => {
  it("reminds organizer and participants for an occurrence starting within 15 minutes", async () => {
    const result = await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });

    expect(result.items).toBe(3);
    expect(mockPrisma.meetingReminderLog.create).toHaveBeenCalledTimes(3);
    expect(mockPrisma.meetingReminderLog.create).toHaveBeenCalledWith({
      data: { scheduledMeetingId: "m1", occurrenceStart: IN_10_MIN, userId: "org" },
    });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "meeting.reminder",
        message: expect.objectContaining({
          kind: "MeetingReminder",
          title: "Starting soon: Design sync",
          scheduledMeetingId: "m1",
          dueAt: IN_10_MIN,
        }),
      }),
    );
  });

  it("ignores meetings starting beyond the lead window or already started", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ id: "far", selectedAt: new Date(NOW.getTime() + 60 * 60_000) }),
      meeting({ id: "past", selectedAt: new Date(NOW.getTime() - 5 * 60_000) }),
    ]);
    const result = await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips a cancelled occurrence via MeetingException", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({
        exceptions: [
          {
            originalStart: IN_10_MIN,
            overrideStart: null,
            overrideDurationMin: null,
            cancelled: true,
          },
        ],
      }),
    ]);
    const result = await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });
    expect(result.items).toBe(0);
  });

  it("keys the log on the ORIGINAL start when an override retimes the occurrence", async () => {
    const original = new Date(NOW.getTime() + 3 * 3_600_000); // 3h out
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({
        selectedAt: original,
        exceptions: [
          {
            originalStart: original,
            overrideStart: IN_10_MIN, // moved into the lead window
            overrideDurationMin: null,
            cancelled: false,
          },
        ],
      }),
    ]);
    await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });
    expect(mockPrisma.meetingReminderLog.create).toHaveBeenCalledWith({
      data: { scheduledMeetingId: "m1", occurrenceStart: original, userId: "org" },
    });
  });

  it("treats a P2002 unique violation as already-sent and does not notify", async () => {
    mockPrisma.meetingReminderLog.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const result = await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("dedupes the organizer when they are also a participant", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ participantUserIds: ["org", "u1"] }),
    ]);
    const result = await runMeetingReminders({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 15 } });
    expect(result.items).toBe(2);
  });

  it("skips recipients who declined the invite", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{ recipientUserId: "u1" }]);
    const result = await runMeetingReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 15 },
    });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", rsvp: "Declined" },
      select: { recipientUserId: true },
    });
    // org + u2 reminded; u1 (declined) skipped.
    expect(result.items).toBe(2);
    const remindedIds = mockNotify.mock.calls.map(
      (c) => c[0].recipients[0].userId,
    );
    expect(remindedIds.sort()).toEqual(["org", "u2"]);
  });

  it("honors a configured lead time", async () => {
    // Starts in 50 minutes: outside the default 15-min lead, inside a 60-min one.
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ selectedAt: new Date(NOW.getTime() + 50 * 60_000) }),
    ]);
    let result = await runMeetingReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 15 },
    });
    expect(result.items).toBe(0);

    result = await runMeetingReminders({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 60 },
    });
    expect(result.items).toBe(3);
  });
});
