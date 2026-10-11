import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { runMeetingRecordPrompts } from "~/jobs/meeting-record-prompts.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockGetUserRoles = getUserRoles as unknown as ReturnType<typeof vi.fn>;
const mockIsFeatureEnabled = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T15:00:00Z");
const IN_30_SEC = new Date(NOW.getTime() + 30_000);

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Standup",
    organizerId: "org",
    selectedAt: IN_30_SEC,
    durationMinutes: 30,
    recurrenceRule: null,
    exceptions: [],
    meetingType: "Team",
    meetingUrl: null,
    notePages: [{ id: "note1", meetingOccurrenceStart: IN_30_SEC }],
    project: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.scheduledMeeting.findMany.mockResolvedValue([meeting()]);
  mockPrisma.meetingRecording.findFirst.mockResolvedValue(null);
  mockPrisma.meetingReminderLog = {
    create: vi.fn().mockResolvedValue({}),
  } as never;
  mockGetUserRoles.mockResolvedValue({});
  mockIsFeatureEnabled.mockResolvedValue(true);
  mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runMeetingRecordPrompts", () => {
  it("queries only Confirmed, not-opted-out meetings", async () => {
    await runMeetingRecordPrompts({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 1 } });
    expect(mockPrisma.scheduledMeeting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "Confirmed",
          selectedAt: { not: null },
          recordPrompt: true,
        }),
      }),
    );
  });

  it("notifies the organizer only, never participants", async () => {
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });

    expect(result.items).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "meeting.record_prompt",
        recipients: [{ userId: "org" }],
        message: expect.objectContaining({
          vars: { itemTitle: "Standup" },
          scheduledMeetingId: "m1",
          occurrenceStart: IN_30_SEC,
        }),
      }),
    );
    expect(mockPrisma.meetingReminderLog.create).toHaveBeenCalledWith({
      data: {
        scheduledMeetingId: "m1",
        occurrenceStart: IN_30_SEC,
        userId: "org",
        kind: "RecordPrompt",
      },
    });
  });

  it("links to the occurrence's note tab with ?record=1 when one exists", async () => {
    await runMeetingRecordPrompts({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 1 } });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ link: "/documents/note1?record=1" }) }),
    );
  });

  it("falls back to the meeting page when the occurrence has no note tab yet", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([meeting({ notePages: [] })]);
    await runMeetingRecordPrompts({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 1 } });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          link: meetingOccurrenceHref("m1", IN_30_SEC.toISOString()),
        }),
      }),
    );
  });

  it("skips a meeting whose project disabled recording", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ project: { recordingPolicy: "Disabled" } }),
    ]);
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips when the organizer lacks the ai-meeting-notes flag", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith("ai-meeting-notes", "org", {});
  });

  it("caches the flag lookup per organizer across meetings in one tick", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ id: "m1" }),
      meeting({ id: "m2", notePages: [{ id: "note2", meetingOccurrenceStart: IN_30_SEC }] }),
    ]);
    await runMeetingRecordPrompts({ now: NOW, lastSuccessAt: null, settings: { leadMinutes: 1 } });
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
  });

  it("skips a meeting that has no type and no note to record into", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ meetingType: null, notePages: [] }),
    ]);
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips an occurrence that already has a non-Failed recording", async () => {
    mockPrisma.meetingRecording.findFirst.mockResolvedValue({ id: "rec1" });
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockPrisma.meetingRecording.findFirst).toHaveBeenCalledWith({
      where: {
        scheduledMeetingId: "m1",
        occurrenceStart: IN_30_SEC,
        status: { notIn: ["Failed"] },
      },
      select: { id: true },
    });
  });

  it("is idempotent on a second tick (P2002 on the reminder log)", async () => {
    mockPrisma.meetingReminderLog.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("ignores occurrences outside the configured lead window", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ selectedAt: new Date(NOW.getTime() + 5 * 60_000) }),
    ]);
    const result = await runMeetingRecordPrompts({
      now: NOW,
      lastSuccessAt: null,
      settings: { leadMinutes: 1 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
