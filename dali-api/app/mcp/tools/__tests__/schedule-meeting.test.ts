import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/scheduled-meeting", () => ({
  createScheduledMeeting: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  canViewForms: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/groups", () => ({
  isCoreGroup: vi.fn().mockResolvedValue(false),
}));

import { createScheduledMeeting } from "~/lib/scheduled-meeting";
import { runScheduleMeeting, ScheduleMeetingError } from "../schedule-meeting";

const USER = { id: "u1", daliEmail: "u1@dali.dartmouth.edu", dartmouthEmail: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createScheduledMeeting).mockResolvedValue({
    ok: true,
    meeting: {
      id: "m1",
      title: "Sync",
      status: "Confirmed",
      selectedAt: new Date("2026-11-12T16:00:00Z"),
      durationMinutes: 30,
      participantUserIds: ["u2"],
      externalEventId: null,
      meetingUrl: null,
    } as never,
    notifiedCount: 1,
    gcalError: null,
    notePageId: null,
    whiteboardPageId: null,
  });
});

describe("runScheduleMeeting guestEmails", () => {
  it("passes guestEmails through to createScheduledMeeting", async () => {
    await runScheduleMeeting(USER, {
      title: "Sync with partner",
      durationMinutes: 30,
      scopeType: "UserList",
      participantUserIds: ["u2"],
      guestEmails: ["partner@acme.com"],
    });
    expect(createScheduledMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmails: ["partner@acme.com"] }),
    );
  });

  it("omits guestEmails when not given", async () => {
    await runScheduleMeeting(USER, {
      title: "Internal sync",
      durationMinutes: 30,
      scopeType: "UserList",
      participantUserIds: ["u2"],
    });
    expect(createScheduledMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmails: undefined }),
    );
  });

  it("requires an organizer email on file", async () => {
    await expect(
      runScheduleMeeting(
        { id: "u3", daliEmail: null, dartmouthEmail: null },
        { title: "x", durationMinutes: 30, scopeType: "None" },
      ),
    ).rejects.toThrow(ScheduleMeetingError);
  });
});
