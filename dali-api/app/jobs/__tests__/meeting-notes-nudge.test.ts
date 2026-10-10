import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { runMeetingNotesNudge } from "~/jobs/meeting-notes-nudge.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockGetUserRoles = getUserRoles as unknown as ReturnType<typeof vi.fn>;
const mockIsFeatureEnabled = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T15:00:00Z");
// Occurrence 13:00-13:30, ended 90 minutes before NOW — well past the default
// 15-minute delay.
const OCCURRENCE_START = new Date("2026-07-15T13:00:00Z");

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    userId: "u1",
    documentName: "doc:page1:body",
    scheduledMeetingId: "m1",
    occurrenceStart: OCCURRENCE_START,
    scheduledMeeting: { title: "Standup", durationMinutes: 30 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.meetingRecording = { findMany: vi.fn().mockResolvedValue([recording()]) } as never;
  mockPrisma.meetingReminderLog = { create: vi.fn().mockResolvedValue({}) } as never;
  mockGetUserRoles.mockResolvedValue({});
  mockIsFeatureEnabled.mockResolvedValue(true);
  mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
});

describe("runMeetingNotesNudge", () => {
  it("queries only Done, not-yet-inserted recordings with a meeting link, touched in the last week", async () => {
    await runMeetingNotesNudge({ now: NOW, lastSuccessAt: null, settings: { delayMinutes: 15 } });
    expect(mockPrisma.meetingRecording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "Done",
          insertedAt: null,
          scheduledMeetingId: { not: null },
          occurrenceStart: { not: null },
          updatedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });

  it("nudges the recording's owner once, with the meeting title and a transcript link", async () => {
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });

    expect(result.items).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "meeting.transcript_ready",
        recipients: [{ userId: "u1" }],
        message: expect.objectContaining({
          vars: { itemTitle: "Standup" },
          link: "/documents/page1?transcript=rec1",
          scheduledMeetingId: "m1",
          occurrenceStart: OCCURRENCE_START,
        }),
      }),
    );
    expect(mockPrisma.meetingReminderLog.create).toHaveBeenCalledWith({
      data: {
        scheduledMeetingId: "m1",
        occurrenceStart: OCCURRENCE_START,
        userId: "u1",
        kind: "TranscriptReady",
      },
    });
  });

  it("is idempotent on a second tick (P2002 on the reminder log)", async () => {
    mockPrisma.meetingReminderLog.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips an occurrence that hasn't ended delayMinutes ago yet", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([
      // Occurrence ends at 14:50 — only 10 minutes before NOW, short of the
      // default 15-minute delay.
      recording({ occurrenceStart: new Date("2026-07-15T14:20:00Z") }),
    ]);
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips when the recorder lacks the ai-meeting-notes flag", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith("ai-meeting-notes", "u1", {});
  });

  it("skips a recording with no meeting link", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([
      recording({ scheduledMeetingId: null, occurrenceStart: null, scheduledMeeting: null }),
    ]);
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips a recording whose documentName isn't a page body", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([
      recording({ documentName: "presence:room1" }),
    ]);
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 15 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("caches the flag lookup per recorder across recordings in one tick", async () => {
    mockPrisma.meetingRecording.findMany.mockResolvedValue([
      recording({ id: "rec1" }),
      recording({ id: "rec2", documentName: "doc:page2:body" }),
    ]);
    await runMeetingNotesNudge({ now: NOW, lastSuccessAt: null, settings: { delayMinutes: 15 } });
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
  });

  it("respects a configured delayMinutes", async () => {
    // Occurrence ends 13:30; 90 minutes before NOW, short of a 95-minute delay.
    const result = await runMeetingNotesNudge({
      now: NOW,
      lastSuccessAt: null,
      settings: { delayMinutes: 95 },
    });
    expect(result.items).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
