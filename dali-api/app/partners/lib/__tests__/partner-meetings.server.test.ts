import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, currentTerm: vi.fn(), getActiveCoreCycleTermIds: vi.fn().mockResolvedValue([]) };
});

vi.mock("~/lib/scheduled-meeting", () => ({
  createScheduledMeeting: vi.fn(),
}));

vi.mock("~/lib/availability", () => ({
  computeUserFreeBusy: vi.fn(),
}));

vi.mock("~/partners/lib/partner-activity.server", () => ({
  logPartnerActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/partners/lib/partner-notify.server", () => ({
  notifyPartners: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }),
  partnerNotifyRecipients: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/partners/lib/partner-emails.server", () => ({
  sendMeetingRequestDeclinedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { createScheduledMeeting } from "~/lib/scheduled-meeting";
import { computeUserFreeBusy } from "~/lib/availability";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { notifyPartners, partnerNotifyRecipients } from "~/partners/lib/partner-notify.server";
import { sendMeetingRequestDeclinedEmail } from "~/partners/lib/partner-emails.server";
import {
  linkScheduledMeetingToApplication,
  resolveMeetingParticipantIds,
  createMeetingRequest,
  respondToMeetingRequest,
  listPartnerMeetingsForContact,
  listPartnerMeetingRequests,
} from "../partner-meetings.server";

// The __mocks__/db.ts stub doesn't define userCalendarLink.findFirst — add it
// for respondToMeetingRequest's organizer-calendar lookup.
(prisma.userCalendarLink as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst = vi.fn();

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function armTransaction() {
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(mockPrisma),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  armTransaction();
});

describe("linkScheduledMeetingToApplication", () => {
  it("creates the PartnerMeeting row, clears meetingRequestedAt, and logs MeetingScheduled", async () => {
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({
      id: "app-1",
      applicantContactId: "contact-1",
    });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meet-1",
      selectedAt: new Date("2026-11-01T15:00:00Z"),
      participantUserIds: ["u1", "u2"],
      meetingUrl: "https://meet.google.com/abc",
    });
    mockPrisma.partnerMeeting.create.mockResolvedValue({
      id: "pm-1",
      scheduledAt: new Date("2026-11-01T15:00:00Z"),
    });
    mockPrisma.partnerApplication.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerMeetingRequest.updateMany.mockResolvedValue({ count: 0 });

    const result = await linkScheduledMeetingToApplication({
      applicationId: "app-1",
      scheduledMeetingId: "meet-1",
      actorUserId: "core-1",
    });

    expect(result).toMatchObject({ id: "pm-1" });
    expect(mockPrisma.partnerMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: "app-1",
          attendeeUserIds: ["u1", "u2"],
          contactId: "contact-1",
          scheduledMeetingId: "meet-1",
        }),
      }),
    );
    expect(mockPrisma.partnerApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { meetingRequestedAt: null } }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: "app-1",
        type: "MeetingScheduled",
        metadata: { scheduledMeetingId: "meet-1", meetingUrl: "https://meet.google.com/abc" },
      }),
    );
  });

  it("marks the request Accepted when requestId is given", async () => {
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "app-1", applicantContactId: null });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meet-1",
      selectedAt: new Date("2026-11-01T15:00:00Z"),
      participantUserIds: [],
      meetingUrl: null,
    });
    mockPrisma.partnerMeeting.create.mockResolvedValue({ id: "pm-1", scheduledAt: new Date() });

    await linkScheduledMeetingToApplication({
      applicationId: "app-1",
      scheduledMeetingId: "meet-1",
      actorUserId: "core-1",
      requestId: "req-1",
    });

    expect(mockPrisma.partnerMeetingRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "Accepted", scheduledMeetingId: "meet-1" }),
      }),
    );
  });

  it("returns null when the application doesn't exist", async () => {
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ id: "meet-1" });
    const result = await linkScheduledMeetingToApplication({
      applicationId: "missing",
      scheduledMeetingId: "meet-1",
      actorUserId: "core-1",
    });
    expect(result).toBeNull();
    expect(mockPrisma.partnerMeeting.create).not.toHaveBeenCalled();
  });

  it("returns null when the scheduled meeting doesn't exist", async () => {
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "app-1", applicantContactId: null });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    const result = await linkScheduledMeetingToApplication({
      applicationId: "app-1",
      scheduledMeetingId: "missing",
      actorUserId: "core-1",
    });
    expect(result).toBeNull();
  });
});

describe("resolveMeetingParticipantIds", () => {
  it("uses the interview panel when set", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({
      interviewPanelUserIds: ["panelist-1", "panelist-2"],
    });
    const ids = await resolveMeetingParticipantIds({ applicationId: "app-1" });
    expect(ids).toEqual(["panelist-1", "panelist-2"]);
    expect(partnerNotifyRecipients).not.toHaveBeenCalled();
  });

  it("falls back to all active Core when the panel is empty", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({ interviewPanelUserIds: [] });
    vi.mocked(partnerNotifyRecipients).mockResolvedValue(["core-a", "core-b"]);
    const ids = await resolveMeetingParticipantIds({ applicationId: "app-1" });
    expect(ids).toEqual(["core-a", "core-b"]);
  });

  it("resolves a project's current-term assignments", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1", code: "26F" } as never);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "u1" }, { userId: "u2" }, { userId: "u1" }]);
    const ids = await resolveMeetingParticipantIds({ projectId: "proj-1" });
    expect(ids).toEqual(["u1", "u2"]);
  });

  it("returns [] with no scope and no current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    expect(await resolveMeetingParticipantIds({ projectId: "proj-1" })).toEqual([]);
    expect(await resolveMeetingParticipantIds({})).toEqual([]);
  });
});

describe("createMeetingRequest", () => {
  it("creates the request, stamps meetingRequestedAt, logs, and notifies Core", async () => {
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue({ interviewPanelUserIds: ["core-1"] });
    mockPrisma.partnerMeetingRequest.create.mockResolvedValue({ id: "req-1" });
    mockPrisma.partnerApplication.updateMany.mockResolvedValue({ count: 1 });

    const result = await createMeetingRequest({
      contactId: "contact-1",
      applicationId: "app-1",
      startTime: new Date("2026-11-05T16:00:00Z"),
      durationMinutes: 30,
      note: "Mornings work best",
    });

    expect(result).toEqual({ id: "req-1" });
    expect(mockPrisma.partnerMeetingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: "app-1",
          contactId: "contact-1",
          participantUserIds: ["core-1"],
          note: "Mornings work best",
        }),
      }),
    );
    expect(mockPrisma.partnerApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { meetingRequestedAt: expect.any(Date) } }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ applicationId: "app-1", type: "MeetingRequested" }),
    );
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "partner.meeting_requested",
        link: "/core/partners?application=app-1",
      }),
    );
  });

  it("links to the org page for a project-scoped request", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1", code: "26F" } as never);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "u1" }]);
    mockPrisma.partnerMeetingRequest.create.mockResolvedValue({ id: "req-2" });
    mockPrisma.projectPartner.findFirst.mockResolvedValue({ partnerOrgId: "org-9" });

    await createMeetingRequest({
      contactId: "contact-1",
      projectId: "proj-1",
      startTime: new Date("2026-11-05T16:00:00Z"),
      durationMinutes: 30,
    });

    expect(mockPrisma.partnerApplication.updateMany).not.toHaveBeenCalled();
    expect(notifyPartners).toHaveBeenCalledWith(
      expect.objectContaining({ link: "/core/partners/orgs/org-9" }),
    );
  });
});

describe("respondToMeetingRequest", () => {
  it("errors when the request doesn't exist", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue(null);
    const result = await respondToMeetingRequest({
      requestId: "missing",
      actorUserId: "core-1",
      action: "decline",
    });
    expect(result).toEqual({ ok: false, error: "Meeting request not found" });
  });

  it("errors when the request was already handled", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Declined",
      contact: { id: "c1", name: "Pat", email: "pat@example.com" },
    });
    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "accept",
    });
    expect(result.ok).toBe(false);
  });

  it("declines: updates status, logs, and emails the partner", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Pending",
      applicationId: "app-1",
      contactId: "contact-1",
      contact: { id: "contact-1", name: "Pat", email: "pat@example.com" },
    });

    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "decline",
      note: "Can't make that week",
    });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.partnerMeetingRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "Declined", responseNote: "Can't make that week" }),
      }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "MeetingRequestDeclined" }),
    );
    expect(sendMeetingRequestDeclinedEmail).toHaveBeenCalledWith(
      "pat@example.com",
      "Pat",
      "Can't make that week",
    );
  });

  it("accepts: schedules a real meeting and links it to the application", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Pending",
      applicationId: "app-1",
      projectId: null,
      contactId: "contact-1",
      startTime: new Date("2026-11-05T16:00:00Z"),
      durationMinutes: 30,
      participantUserIds: ["core-1"],
      contact: { id: "contact-1", name: "Pat", email: "pat@example.com" },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: "core@dali.dartmouth.edu", dartmouthEmail: null });
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue({ id: "link-1" });
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "core-1",
      free: [{ start: new Date("2026-11-05T00:00:00Z"), end: new Date("2026-11-06T00:00:00Z") }],
      busy: [],
      hasCalendar: true,
      calendarError: false,
    });
    vi.mocked(createScheduledMeeting).mockResolvedValue({
      ok: true,
      meeting: { id: "meet-1", meetingUrl: "https://meet.google.com/xyz" } as never,
      notifiedCount: 1,
      gcalError: null,
      notePageId: null,
      whiteboardPageId: null,
    });
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "app-1", applicantContactId: "contact-1" });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meet-1",
      selectedAt: new Date("2026-11-05T16:00:00Z"),
      participantUserIds: ["core-1"],
      meetingUrl: "https://meet.google.com/xyz",
    });
    mockPrisma.partnerMeeting.create.mockResolvedValue({ id: "pm-1", scheduledAt: new Date() });

    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "accept",
    });

    expect(result).toMatchObject({ ok: true, scheduledMeetingId: "meet-1" });
    expect(createScheduledMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        organizerId: "core-1",
        organizerEmail: "core@dali.dartmouth.edu",
        guestEmails: ["pat@example.com"],
        addMeet: true,
        organizerCalendarLinkId: "link-1",
      }),
    );
    expect(mockPrisma.partnerMeetingRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req-1" }, data: expect.objectContaining({ status: "Accepted" }) }),
    );
  });

  it("flags a conflict but still schedules when a participant has gone busy", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Pending",
      applicationId: "app-1",
      projectId: null,
      contactId: "contact-1",
      startTime: new Date("2026-11-05T16:00:00Z"),
      durationMinutes: 30,
      participantUserIds: ["core-1"],
      contact: { id: "contact-1", name: "Pat", email: "pat@example.com" },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: "core@dali.dartmouth.edu", dartmouthEmail: null });
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue(null);
    // No free interval covering the request window → busy.
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "core-1",
      free: [],
      busy: [{ start: new Date("2026-11-05T16:00:00Z"), end: new Date("2026-11-05T16:30:00Z") }],
      hasCalendar: true,
      calendarError: false,
    });
    vi.mocked(createScheduledMeeting).mockResolvedValue({
      ok: true,
      meeting: { id: "meet-2", meetingUrl: null } as never,
      notifiedCount: 1,
      gcalError: null,
      notePageId: null,
      whiteboardPageId: null,
    });
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "app-1", applicantContactId: "contact-1" });
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "meet-2",
      selectedAt: new Date("2026-11-05T16:00:00Z"),
      participantUserIds: ["core-1"],
      meetingUrl: null,
    });
    mockPrisma.partnerMeeting.create.mockResolvedValue({ id: "pm-2", scheduledAt: new Date() });

    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "accept",
    });

    expect(result).toMatchObject({ ok: true, conflict: true, busyUserIds: ["core-1"] });
    expect(createScheduledMeeting).toHaveBeenCalled();
  });

  it("errors when the caller has no email on file", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Pending",
      applicationId: "app-1",
      participantUserIds: [],
      contact: { id: "contact-1", name: "Pat", email: "pat@example.com" },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: null, dartmouthEmail: null });
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue(null);

    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "accept",
    });
    expect(result.ok).toBe(false);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });

  it("accepting a project-scoped request (no applicationId) resolves the request directly", async () => {
    mockPrisma.partnerMeetingRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "Pending",
      applicationId: null,
      projectId: "proj-1",
      contactId: "contact-1",
      startTime: new Date("2026-11-05T16:00:00Z"),
      durationMinutes: 30,
      participantUserIds: [],
      contact: { id: "contact-1", name: "Pat", email: "pat@example.com" },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: "core@dali.dartmouth.edu", dartmouthEmail: null });
    mockPrisma.userCalendarLink.findFirst.mockResolvedValue(null);
    vi.mocked(createScheduledMeeting).mockResolvedValue({
      ok: true,
      meeting: { id: "meet-3", meetingUrl: null } as never,
      notifiedCount: 0,
      gcalError: null,
      notePageId: null,
      whiteboardPageId: null,
    });

    const result = await respondToMeetingRequest({
      requestId: "req-1",
      actorUserId: "core-1",
      action: "accept",
    });

    expect(result).toMatchObject({ ok: true, scheduledMeetingId: "meet-3" });
    // No application to link — the request itself is resolved instead.
    expect(mockPrisma.partnerMeeting.create).not.toHaveBeenCalled();
    expect(mockPrisma.partnerMeetingRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "Accepted", scheduledMeetingId: "meet-3" }),
      }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contactId: "contact-1", type: "MeetingScheduled" }),
    );
  });
});

describe("listPartnerMeetingsForContact", () => {
  it("maps upcoming meetings for the contact's email", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m1",
        title: "DALI x Acme",
        selectedAt: new Date("2026-12-01T15:00:00Z"),
        durationMinutes: 30,
        meetingUrl: "https://meet.google.com/abc",
      },
    ]);
    const result = await listPartnerMeetingsForContact("pat@example.com");
    expect(result).toEqual([
      {
        id: "m1",
        title: "DALI x Acme",
        startTime: "2026-12-01T15:00:00.000Z",
        durationMinutes: 30,
        meetingUrl: "https://meet.google.com/abc",
      },
    ]);
    expect(mockPrisma.scheduledMeeting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ guestEmails: { has: "pat@example.com" } }),
      }),
    );
  });
});

describe("listPartnerMeetingRequests", () => {
  it("splits pending and declined", async () => {
    mockPrisma.partnerMeetingRequest.findMany.mockResolvedValue([
      {
        id: "r1",
        startTime: new Date("2026-12-02T10:00:00Z"),
        durationMinutes: 30,
        status: "Pending",
        note: "note",
        responseNote: null,
      },
      {
        id: "r2",
        startTime: new Date("2026-12-03T10:00:00Z"),
        durationMinutes: 45,
        status: "Declined",
        note: null,
        responseNote: "Try next week",
      },
    ]);
    const result = await listPartnerMeetingRequests({ applicationId: "app-1" });
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].id).toBe("r1");
    expect(result.declined).toHaveLength(1);
    expect(result.declined[0].responseNote).toBe("Try next week");
  });
});
