import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  updateGoogleAttendeeRsvp: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { updateGoogleAttendeeRsvp } from "~/lib/google-calendar";
import {
  runRsvpToNotification,
  RSVP_TO_NOTIFICATION_TOOL,
  RsvpError,
} from "~/mcp/tools/rsvp-to-notification";

const mockPrisma = prisma as unknown as {
  notification: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const CALLER = { id: "u1", daliEmail: "u1@dali.dartmouth.edu", dartmouthEmail: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rsvp_to_notification", () => {
  it("requires the mcp:write scope", () => {
    expect(RSVP_TO_NOTIFICATION_TOOL.requiredScope).toBe("mcp:write");
  });

  it("records RSVP and pushes to Google when meeting is on GCal", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: "u1",
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: "ev-1", organizerCalendarLinkId: "cl-1" },
    });
    mockPrisma.notification.update.mockResolvedValue({});

    const out = await runRsvpToNotification(CALLER, {
      notificationId: "n1",
      response: "accepted",
    });
    expect(out).toEqual({ ok: true, gcalError: null });
    expect(updateGoogleAttendeeRsvp).toHaveBeenCalledWith({
      linkId: "cl-1",
      eventId: "ev-1",
      attendeeEmail: "u1@dali.dartmouth.edu",
      response: "accepted",
    });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  it("records the in-app RSVP when Google push fails", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: "u1",
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: "ev-1", organizerCalendarLinkId: "cl-1" },
    });
    vi.mocked(updateGoogleAttendeeRsvp).mockRejectedValueOnce(new Error("token expired"));
    mockPrisma.notification.update.mockResolvedValue({});

    const out = await runRsvpToNotification(CALLER, {
      notificationId: "n1",
      response: "declined",
    });
    expect(out).toEqual({ ok: true, gcalError: "token expired" });
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  it("skips Google push when meeting wasn't pushed", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: "u1",
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: null, organizerCalendarLinkId: null },
    });
    mockPrisma.notification.update.mockResolvedValue({});

    const out = await runRsvpToNotification(CALLER, {
      notificationId: "n1",
      response: "tentative",
    });
    expect(out).toEqual({ ok: true, gcalError: null });
    expect(updateGoogleAttendeeRsvp).not.toHaveBeenCalled();
  });

  it("rejects notifications not tied to a meeting", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: "u1",
      scheduledMeetingId: null,
      scheduledMeeting: null,
    });
    await expect(
      runRsvpToNotification(CALLER, { notificationId: "n1", response: "accepted" }),
    ).rejects.toBeInstanceOf(RsvpError);
  });

  it("rejects notifications belonging to other users", async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      recipientUserId: "u2",
      scheduledMeetingId: "m1",
      scheduledMeeting: { externalEventId: null, organizerCalendarLinkId: null },
    });
    await expect(
      runRsvpToNotification(CALLER, { notificationId: "n1", response: "accepted" }),
    ).rejects.toThrowError("Forbidden");
  });
});
