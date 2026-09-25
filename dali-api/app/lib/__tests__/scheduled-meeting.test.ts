import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/pages", () => ({
  createProjectPage: vi.fn(async () => ({ id: "page-project" })),
  createLabMeetingPage: vi.fn(async () => ({ id: "page-lab" })),
  ensureMeetingNotesFolder: vi.fn(async () => ({ id: "folder-project" })),
  ensureCoreMeetingNotesFolder: vi.fn(async () => "folder-core"),
  ensureLabMeetingNotesFolder: vi.fn(async () => "folder-lab-notes"),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(async () => false) }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn(async () => []) }));
vi.mock("~/lib/google-calendar", () => ({
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { isCore } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotesFolder,
  ensureCoreMeetingNotesFolder,
  ensureLabMeetingNotesFolder,
} from "~/lib/pages";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  getGoogleEvent,
  deleteGoogleCalendarEvent,
} from "~/lib/google-calendar";
import {
  attachMeetingNote,
  cancelScheduledMeeting,
  createScheduledMeeting,
  isWithinCheckInWindow,
  meetingIsUpcoming,
  setMeetingProject,
  trackExternalEventAsMeeting,
  updateScheduledMeeting,
} from "~/lib/scheduled-meeting";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so a prior test's mockResolvedValue on
  // isCore would leak. Reset to the factory default; tests opt into Core.
  vi.mocked(isCore).mockResolvedValue(false);
});

describe("cancelScheduledMeeting", () => {
  it("flips a meeting to Cancelled and notifies participants (not the actor)", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: ["org-1", "u2", "u3"],
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});

    const res = await cancelScheduledMeeting("m1", "org-1");

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "Cancelled" },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("meeting.cancelled");
    expect(call.message.title).toBe("Meeting cancelled: Sprint sync");
    // Not stamped: surfaces hide rows whose meeting is Cancelled.
    expect(call.message.scheduledMeetingId).toBeUndefined();
    expect(call.recipients).toEqual([
      { userId: "u2", ics: null },
      { userId: "u3", ics: null },
    ]);
  });

  it("attaches a per-recipient CANCEL ics when the invite ICS was ours", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: ["u2"],
      selectedAt: new Date("2026-07-20T15:00:00Z"),
      durationMinutes: 30,
      recurrenceRule: null,
      ownerCalendarEmail: "org@dali.dartmouth.edu",
      externalEventId: null,
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
    (
      prisma as unknown as { user: { findMany: ReturnType<typeof vi.fn> } }
    ).user.findMany.mockResolvedValue([
      {
        id: "u2",
        firstName: "Ada",
        lastName: "L",
        daliEmail: "ada@dali.dartmouth.edu",
        dartmouthEmail: null,
      },
    ]);

    await cancelScheduledMeeting("m1", "org-1");

    const recipient = mockNotify.mock.calls[0][0].recipients[0];
    expect(recipient.userId).toBe("u2");
    expect(recipient.ics).toContain("METHOD:CANCEL");
    expect(recipient.ics).toContain("UID:meeting-m1@dali.dartmouth.edu");
  });

  it("skips the CANCEL ics for Google-managed meetings", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: ["u2"],
      selectedAt: new Date("2026-07-20T15:00:00Z"),
      durationMinutes: 30,
      recurrenceRule: null,
      ownerCalendarEmail: "org@dali.dartmouth.edu",
      externalEventId: "gcal-123",
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});

    await cancelScheduledMeeting("m1", "org-1");

    expect(mockNotify.mock.calls[0][0].recipients[0].ics).toBeNull();
  });

  it("still cancels when the notify fan-out fails", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: ["u2"],
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
    mockNotify.mockRejectedValue(new Error("smtp down"));

    const res = await cancelScheduledMeeting("m1", "org-1");

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
  });

  it("forbids non-organizers", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: [],
    });

    const res = await cancelScheduledMeeting("m1", "someone-else");

    expect(res).toEqual({ ok: false, error: "Only the organizer can cancel", status: 403 });
    expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("404s a missing meeting", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);

    const res = await cancelScheduledMeeting("nope", "org-1");

    expect(res).toEqual({ ok: false, error: "Not found", status: 404 });
    expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("lets Core cancel someone else's meeting with allowCore (the Attendance-tab gate)", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: [],
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await cancelScheduledMeeting("m1", "core-9", { allowCore: true });

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "Cancelled" },
    });
  });

  it("is idempotent — re-cancelling does not write or notify again", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Cancelled",
      title: "Sprint sync",
      participantUserIds: ["u2"],
    });

    const res = await cancelScheduledMeeting("m1", "org-1");

    expect(res).toEqual({ ok: true, alreadyCancelled: true });
    expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("scope=all deletes the Google event when externalEventId is set", async () => {
    const mockDelete = vi.mocked(deleteGoogleCalendarEvent);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Sprint sync",
      participantUserIds: [],
      externalEventId: "gcal-evt-1",
      organizerCalendarLinkId: "link-1",
      organizerCalendarId: "cal-1",
      selectedAt: null,
      durationMinutes: 30,
      recurrenceRule: null,
      ownerCalendarEmail: "org@dali.dartmouth.edu",
    });
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
    const mockLink = prisma as unknown as { userCalendarLink: { findUnique: ReturnType<typeof vi.fn> } };
    mockLink.userCalendarLink = { findUnique: vi.fn().mockResolvedValue({ id: "link-1", enabled: true }) };

    const res = await cancelScheduledMeeting("m1", "org-1", { scope: "all" });

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "Cancelled" },
    });
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "gcal-evt-1" }),
    );
  });

  it("scope=this upserts MeetingException{cancelled:true} and deletes the Google instance, NOT the whole meeting", async () => {
    const mockDelete = vi.mocked(deleteGoogleCalendarEvent);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "org-1",
      status: "Confirmed",
      title: "Weekly sync",
      participantUserIds: ["u2"],
      externalEventId: "gcal-master",
      organizerCalendarLinkId: "link-1",
      organizerCalendarId: "cal-1",
      selectedAt: new Date("2026-09-10T15:00:00Z"),
      durationMinutes: 30,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
      ownerCalendarEmail: "org@dali.dartmouth.edu",
    });
    const mockLink = prisma as unknown as { userCalendarLink: { findUnique: ReturnType<typeof vi.fn> } };
    mockLink.userCalendarLink = { findUnique: vi.fn().mockResolvedValue({ id: "link-1", enabled: true }) };
    const mockExc = prisma as unknown as { meetingException: { upsert: ReturnType<typeof vi.fn> } };
    mockExc.meetingException = { upsert: vi.fn().mockResolvedValue({}) };

    const res = await cancelScheduledMeeting("m1", "org-1", {
      scope: "this",
      occurrenceStart: "2026-09-17T15:00:00.000Z",
      occurrenceEventId: "gcal-instance-123",
    });

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    // Must NOT mark the whole meeting as Cancelled
    expect(mockPrisma.scheduledMeeting.update).not.toHaveBeenCalled();
    // Must upsert exception with cancelled:true
    expect(mockExc.meetingException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ cancelled: true }),
        update: expect.objectContaining({ cancelled: true }),
      }),
    );
    // Must delete the Google INSTANCE
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "gcal-instance-123" }),
    );
  });
});

describe("createScheduledMeeting — where a note is filed", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const labPage = createLabMeetingPage as unknown as ReturnType<typeof vi.fn>;
  const projectPage = createProjectPage as unknown as ReturnType<typeof vi.fn>;
  const projectFolder = ensureMeetingNotesFolder as unknown as ReturnType<typeof vi.fn>;
  const coreFolder = ensureCoreMeetingNotesFolder as unknown as ReturnType<typeof vi.fn>;
  const labFolder = ensureLabMeetingNotesFolder as unknown as ReturnType<typeof vi.fn>;

  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Core sync",
    durationMinutes: 60,
    scope: { type: "None" } as const,
    startTime: "2026-09-10T15:00:00.000Z",
    meetingType: "Other" as const,
    meetingTypeLabel: "Core meeting",
  };

  beforeEach(() => {
    mockPage.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    mockPage.meetingAttendance.createMany.mockResolvedValue({});
  });

  it("files a Core meeting that is also about a project in the project's folder, not Core's", async () => {
    // unified-core-project-meetings: a project team meeting can also be Core.
    // buildMeetingArtifactPage checks projectId first, so the note belongs to
    // the project team; the Core hub still surfaces the meeting via isCoreMeeting.
    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
      meetingType: "Team",
      meetingTypeLabel: null,
      projectId: "proj-7",
    });

    expect(projectFolder).toHaveBeenCalledWith("proj-7", "Team", "org-1");
    expect(projectPage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-7", parentPageId: "folder-project" }),
    );
    expect(coreFolder).not.toHaveBeenCalled();
    expect(labPage).not.toHaveBeenCalled();
  });

  it("files a Core meeting's note in Core's own folder, ignoring a chosen location", async () => {
    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
      // Even an explicit destination doesn't move a Core note — Core's folder
      // is where it belongs, the way a project's note belongs to its project.
      noteLocation: { workspaceType: "Project", workspaceId: "proj-9", parentPageId: null },
    });

    expect(coreFolder).toHaveBeenCalledWith("org-1");
    expect(labPage).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: "folder-core", restricted: true }),
    );
  });

  it("falls back to the Lab root when Core has no drive yet", async () => {
    coreFolder.mockResolvedValueOnce(null);

    await createScheduledMeeting({ ...base, isCoreMeeting: true });

    // Deliberately the root, not the lab-wide Meeting notes folder: a Core note
    // that lost its folder must not land on the communal shelf.
    expect(labPage).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: null, restricted: false }),
    );
    expect(labFolder).not.toHaveBeenCalled();
  });

  it("files a non-Core General note in the Lab's Meeting notes folder", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: false });

    expect(coreFolder).not.toHaveBeenCalled();
    expect(labFolder).toHaveBeenCalledWith("org-1");
    expect(labPage).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: "folder-lab-notes" }),
    );
  });

  it("honours an explicitly chosen Lab folder over the default", async () => {
    // resolveNoteDestination validates the folder before honouring it.
    (
      prisma as unknown as { page: { findUnique: ReturnType<typeof vi.fn> } }
    ).page.findUnique.mockResolvedValue({
      kind: "Folder",
      archivedAt: null,
      workspaceType: "Lab",
      workspaceId: null,
    });

    await createScheduledMeeting({
      ...base,
      isCoreMeeting: false,
      noteLocation: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder-chosen" },
    });

    expect(labPage).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: "folder-chosen" }),
    );
    expect(labFolder).not.toHaveBeenCalled();
  });
});

describe("setMeetingProject", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn> };
    page: { update: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const projectFolder = ensureMeetingNotesFolder as unknown as ReturnType<typeof vi.fn>;

  const baseMeeting = {
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["u2"],
    status: "Confirmed",
    selectedAt: new Date("2026-09-10T15:00:00.000Z"),
    meetingType: null as string | null,
    notePage: null as { id: string; kind: string } | null,
    whiteboardPage: null as { id: string; kind: string } | null,
  };

  beforeEach(() => {
    p.project.findFirst.mockResolvedValue({ id: "proj-7", name: "Cortex" });
    p.scheduledMeeting.update.mockResolvedValue({});
  });

  it("re-files an existing note into the project folder and records the project", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue({
      ...baseMeeting,
      // Already had a type (a Core note), so no attendance backfill.
      meetingType: "Other",
      notePage: { id: "note-1", kind: "FreeForm" },
    });

    const res = await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
      meetingTypeLabel: null,
    });

    expect(res.ok).toBe(true);
    expect(projectFolder).toHaveBeenCalledWith("proj-7", "Team", "org-1");
    expect(p.page.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "note-1" },
        data: expect.objectContaining({
          workspaceType: "Project",
          workspaceId: "proj-7",
          parentPageId: "folder-project",
          linkAccess: "Restricted",
        }),
      }),
    );
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "proj-7", meetingType: "Team" }),
      }),
    );
    // Already had a type → no roster backfill.
    expect(p.meetingAttendance.createMany).not.toHaveBeenCalled();
  });

  it("records the project and fans out attendance for a note-less, type-less meeting", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue({ ...baseMeeting });

    const res = await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
    });

    expect(res.ok).toBe(true);
    expect(p.page.update).not.toHaveBeenCalled(); // nothing to move
    expect(p.meetingAttendance.createMany).toHaveBeenCalled(); // roster created now
  });

  it("rejects a non-organizer who isn't Core", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue({ ...baseMeeting });

    const res = await setMeetingProject({
      meetingId: "m1",
      actorId: "stranger",
      projectId: "proj-7",
      meetingType: "Team",
    });

    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("rejects when the actor can't file under the project", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue({ ...baseMeeting });
    // Organizer passes the meeting gate, but the membership query finds nothing.
    p.project.findFirst.mockResolvedValue(null);

    const res = await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
    });

    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });
});

describe("createScheduledMeeting — attendance roster", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    p.scheduledMeeting.create.mockResolvedValue({
      id: "m1",
      ownerCalendarEmail: "org@dali.dartmouth.edu",
    });
    p.meetingAttendance.createMany.mockResolvedValue({});
    mockNotify.mockResolvedValue({ inApp: 2 });
  });

  it("fans out a roster for a plain meeting with guests (no note, no self check-in)", async () => {
    // The regression this fixes: a Roster meeting with guests but no meeting note
    // used to create zero MeetingAttendance rows, so the wallet scanner rejected
    // every pass as "User was not invited".
    const res = await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "Quick sync",
      durationMinutes: 30,
      scope: { type: "UserList", participantUserIds: ["u2", "u3"] },
    });

    expect(res.ok).toBe(true);
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", userId: "u2" },
        { scheduledMeetingId: "m1", userId: "u3" },
        { scheduledMeetingId: "m1", userId: "org-1" },
      ],
    });
  });

  it("creates no roster for a solo meeting with no guests", async () => {
    await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "Focus block",
      durationMinutes: 60,
      scope: { type: "None" },
    });

    expect(p.meetingAttendance.createMany).not.toHaveBeenCalled();
  });
});

// The regression this covers: the invite form collected a location and a
// description and the create path dropped both, so they reached neither the
// meeting, the Google event, nor the invite that went out to guests.
describe("createScheduledMeeting — location and description", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
    userCalendarLink: { findUnique: ReturnType<typeof vi.fn> };
    user: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  };

  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Design review",
    durationMinutes: 45,
    startTime: "2026-09-22T17:00:00.000Z",
    scope: { type: "UserList" as const, participantUserIds: ["u2"] },
    location: "Baker 101",
    description: "Bring the latest mocks.",
  };

  beforeEach(() => {
    p.scheduledMeeting.create.mockResolvedValue({
      id: "m1",
      ownerCalendarEmail: "org@dali.dartmouth.edu",
    });
    p.scheduledMeeting.update.mockResolvedValue({});
    p.meetingAttendance.createMany.mockResolvedValue({});
    p.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "Ally", lastName: "Kim", daliEmail: "ally@dali.dartmouth.edu" },
    ]);
    p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
    mockNotify.mockResolvedValue({ inApp: 1 });
  });

  it("stores both on the meeting and mirrors them onto the Google event", async () => {
    p.userCalendarLink.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "org-1",
      externalEmail: "org@dali.dartmouth.edu",
      enabled: true,
    });
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({
      eventId: "gcal-1",
      htmlLink: null,
      meetUrl: null,
    });

    const res = await createScheduledMeeting({ ...base, organizerCalendarLinkId: "link-1" });

    expect(res.ok).toBe(true);
    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          location: "Baker 101",
          description: "Bring the latest mocks.",
        }),
      }),
    );
    expect(createGoogleCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "Baker 101",
        description: "Bring the latest mocks.",
      }),
    );
  });

  it("invites email guests through the Google event even with no members invited", async () => {
    p.userCalendarLink.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "org-1",
      externalEmail: "org@dali.dartmouth.edu",
      enabled: true,
    });
    p.user.findMany.mockResolvedValue([]);
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({
      eventId: "gcal-1",
      htmlLink: null,
      meetUrl: null,
    });

    const res = await createScheduledMeeting({
      ...base,
      scope: { type: "None" },
      organizerCalendarLinkId: "link-1",
      guestEmails: ["Partner@Example.com", "not-an-email"],
    });

    expect(res.ok).toBe(true);
    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guestEmails: ["partner@example.com"] }),
      }),
    );
    expect(createGoogleCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ attendees: [{ email: "partner@example.com" }] }),
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("carries both into the ICS and the invite body when we send the invite ourselves", async () => {
    const res = await createScheduledMeeting(base);

    expect(res.ok).toBe(true);
    const call = mockNotify.mock.calls[0]![0];
    expect(call.message.body).toContain("Location: Baker 101");
    expect(call.message.body).toContain("Bring the latest mocks.");
    expect(call.recipients[0].ics).toContain("LOCATION:Baker 101");
    expect(call.recipients[0].ics).toContain("DESCRIPTION:Bring the latest mocks.");
  });

  it("stores null rather than an empty string for a field left blank", async () => {
    await createScheduledMeeting({ ...base, location: "", description: "   " });

    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ location: null, description: null }),
      }),
    );
  });
});

describe("updateScheduledMeeting", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    meetingAttendance: {
      findMany: ReturnType<typeof vi.fn>;
      createMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    userCalendarLink: { findUnique: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  };
  const mockPatch = vi.mocked(patchGoogleCalendarEvent);

  const meetingRow = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizerId: "org-1",
    status: "Confirmed",
    title: "Old title",
    participantUserIds: ["org-1", "u2", "u3"],
    selectedAt: new Date("2026-09-10T15:00:00Z"),
    durationMinutes: 30,
    ownerCalendarEmail: "org@dali.dartmouth.edu",
    externalEventId: null,
    organizerCalendarLinkId: null,
    organizerCalendarId: null,
    meetingType: null,
    attendanceMode: "Roster",
    ...over,
  });

  beforeEach(() => {
    p.scheduledMeeting.update.mockImplementation(async (a: { data: unknown }) => ({
      id: "m1",
      ...(a.data as object),
    }));
    p.meetingAttendance.createMany.mockResolvedValue({});
    p.meetingAttendance.deleteMany.mockResolvedValue({ count: 0 });
    mockNotify.mockResolvedValue({ inApp: 1 });
  });

  it("reconciles the roster, re-syncs Google, and notifies added/removed guests", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        externalEventId: "gcal-1",
        organizerCalendarLinkId: "link-1",
        organizerCalendarId: "cal-1",
      }),
    );
    p.meetingAttendance.findMany.mockResolvedValue([
      { userId: "org-1" },
      { userId: "u2" },
      { userId: "u3" },
    ]);
    p.userCalendarLink.findUnique.mockResolvedValue({ id: "link-1", enabled: true });
    p.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "Bee", lastName: "Two", daliEmail: "u2@dali.dartmouth.edu", dartmouthEmail: null },
      { id: "u4", firstName: "Dee", lastName: "Four", daliEmail: "u4@dali.dartmouth.edu", dartmouthEmail: null },
    ]);
    p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "New title",
      durationMinutes: 45,
      scope: { type: "UserList", participantUserIds: ["u2", "u4"] },
      startTime: "2026-09-11T16:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    // u4 added, u3 removed, u2 + organizer retained (rows untouched).
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [{ scheduledMeetingId: "m1", userId: "u4" }],
      skipDuplicates: true,
    });
    expect(p.meetingAttendance.deleteMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", userId: { in: ["u3"] } },
    });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const patch = mockPatch.mock.calls[0][0];
    expect(patch).toMatchObject({
      eventId: "gcal-1",
      calendarId: "cal-1",
      summary: "New title",
      sendUpdates: "all",
    });
    expect((patch.attendees ?? []).map((a) => a.email).sort()).toEqual([
      "u2@dali.dartmouth.edu",
      "u4@dali.dartmouth.edu",
    ]);
    const events = mockNotify.mock.calls.map((c) => c[0].eventType);
    expect(events).toContain("meeting.invite");
    expect(events).toContain("meeting.cancelled");
  });

  it("stores location and description and passes them through to the Google patch", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        externalEventId: "gcal-1",
        organizerCalendarLinkId: "link-1",
        organizerCalendarId: "cal-1",
      }),
    );
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }, { userId: "u2" }]);
    p.userCalendarLink.findUnique.mockResolvedValue({ id: "link-1", enabled: true });
    p.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "Bee", lastName: "Two", daliEmail: "u2@dali.dartmouth.edu", dartmouthEmail: null },
    ]);
    p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "Synced",
      durationMinutes: 30,
      scope: { type: "UserList", participantUserIds: ["u2"] },
      startTime: "2026-09-11T16:00:00.000Z",
      location: "Room 5",
      description: "Bring laptops",
    });

    expect(res.ok).toBe(true);
    expect(mockPatch.mock.calls[0][0]).toMatchObject({
      location: "Room 5",
      description: "Bring laptops",
    });
    // Also persisted, so reopening the meeting shows what was typed.
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ location: "Room 5", description: "Bring laptops" }),
      }),
    );
  });

  it("leaves a stored location alone when the edit omits it, and clears it on \"\"", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ location: "Room 5" }));
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }, { userId: "u2" }]);

    const edit = {
      title: "Synced",
      durationMinutes: 30,
      scope: { type: "UserList" as const, participantUserIds: ["u2"] },
      startTime: "2026-09-11T16:00:00.000Z",
    };

    await updateScheduledMeeting("m1", "org-1", edit);
    expect(p.scheduledMeeting.update.mock.calls[0]![0].data).not.toHaveProperty("location");

    await updateScheduledMeeting("m1", "org-1", { ...edit, location: "" });
    expect(p.scheduledMeeting.update.mock.calls[1]![0].data).toMatchObject({ location: null });
  });

  it("lets Core edit a meeting they don't organize", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    p.meetingAttendance.findMany.mockResolvedValue([
      { userId: "org-1" },
      { userId: "u2" },
      { userId: "u3" },
    ]);

    const res = await updateScheduledMeeting("m1", "core-9", {
      title: "Renamed",
      durationMinutes: 30,
      scope: { type: "UserList", participantUserIds: ["u2", "u3"] },
      startTime: "2026-09-10T15:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    expect(p.scheduledMeeting.update).toHaveBeenCalled();
    // No Google event to touch, and no roster change → no patch, no notify.
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("403s a non-organizer who isn't Core", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await updateScheduledMeeting("m1", "intruder", {
      title: "Nope",
      durationMinutes: 30,
      scope: { type: "None" },
    });

    expect(res).toEqual({
      ok: false,
      error: "Only the organizer or Core can edit this meeting",
      status: 403,
    });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("refuses to edit a cancelled meeting", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ status: "Cancelled" }));

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "X",
      durationMinutes: 30,
      scope: { type: "None" },
    });

    expect(res).toEqual({ ok: false, error: "This meeting has been cancelled", status: 400 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("surfaces a Google failure without failing the edit", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        externalEventId: "gcal-1",
        organizerCalendarLinkId: "link-1",
        organizerCalendarId: "cal-1",
        participantUserIds: ["org-1", "u2"],
      }),
    );
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }, { userId: "u2" }]);
    p.userCalendarLink.findUnique.mockResolvedValue({ id: "link-1", enabled: true });
    p.user.findMany.mockResolvedValue([
      { id: "u2", firstName: "B", lastName: "T", daliEmail: "u2@dali.dartmouth.edu", dartmouthEmail: null },
    ]);
    p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
    mockPatch.mockRejectedValueOnce(new Error("Google events.patch failed (403): forbidden"));

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "Same",
      durationMinutes: 30,
      scope: { type: "UserList", participantUserIds: ["u2"] },
      startTime: "2026-09-10T15:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gcalError).toContain("events.patch failed");
  });

  it("keeps a Group meeting scoped to its group when guests ride along", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }, { userId: "u2" }]);
    vi.mocked(resolveGroupMembers).mockResolvedValueOnce(["u2", "u3"]);

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "Old title",
      durationMinutes: 30,
      scope: { type: "Group", groupId: "g1", extraUserIds: ["u9", "u2"] },
      startTime: "2026-09-10T15:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    const data = p.scheduledMeeting.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ scopeType: "Group", scopeId: "g1" });
    expect(data.participantUserIds.sort()).toEqual(["u2", "u3", "u9"]);
  });

  it("scope=this writes a MeetingException and patches the Google INSTANCE, not the master row", async () => {
    const baseRow = meetingRow({
      externalEventId: "gcal-master",
      organizerCalendarLinkId: "link-1",
      organizerCalendarId: "cal-1",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
      scopeType: "UserList",
      scopeId: null,
      isCoreMeeting: false,
      meetingTypeLabel: null,
      projectId: null,
    });
    // First call: load meeting for auth check; second call: reload after exception upsert
    p.scheduledMeeting.findUnique
      .mockResolvedValueOnce(baseRow)
      .mockResolvedValueOnce(baseRow);
    p.userCalendarLink.findUnique.mockResolvedValue({ id: "link-1", enabled: true });

    const mockP = p as unknown as {
      meetingException: { upsert: ReturnType<typeof vi.fn> };
    };
    mockP.meetingException = { upsert: vi.fn().mockResolvedValue({}) };

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "This occurrence title",
      durationMinutes: 45,
      scope: { type: "UserList", participantUserIds: ["u2"] },
      startTime: "2026-09-17T15:00:00.000Z",
      editScope: "this",
      occurrenceStart: "2026-09-17T14:00:00.000Z",
      occurrenceEventId: "gcal-instance-1",
    });

    expect(res.ok).toBe(true);
    // Must write a MeetingException (not cancelled)
    expect(mockP.meetingException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          cancelled: false,
          overrideTitle: "This occurrence title",
        }),
        update: expect.objectContaining({
          cancelled: false,
          overrideTitle: "This occurrence title",
        }),
      }),
    );
    // Must patch the INSTANCE event id, not the master
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "gcal-instance-1" }),
    );
    // Must NOT update the master scheduledMeeting row's fields
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("a participant who isn't the organizer or Core is 403'd", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ participantUserIds: ["u-guest"] }));

    const res = await updateScheduledMeeting("m1", "u-guest", {
      title: "Nope",
      durationMinutes: 30,
      scope: { type: "None" },
    });

    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("scope=following truncates master recurrenceRule and calls createGoogleCalendarEvent for new series", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        externalEventId: "gcal-master",
        organizerCalendarLinkId: "link-1",
        organizerCalendarId: "cal-1",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
        participantUserIds: ["org-1", "u2"],
        scopeType: "UserList",
        scopeId: null,
        isCoreMeeting: false,
        meetingTypeLabel: null,
        projectId: null,
      }),
    );
    p.userCalendarLink.findUnique.mockResolvedValue({ id: "link-1", enabled: true, externalEmail: "org@test.com", userId: "org-1" });
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }, { userId: "u2" }]);
    // Return 2 users so googleAttendeesFor produces attendees → Google push fires
    p.user.findMany.mockResolvedValue([
      { id: "org-1", firstName: "Org", lastName: "One", daliEmail: "org@test.com", dartmouthEmail: null },
      { id: "u2", firstName: "U", lastName: "Two", daliEmail: "u2@test.com", dartmouthEmail: null },
    ]);
    p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
    // createScheduledMeeting will call scheduledMeeting.create
    const mockCreate = p as unknown as { scheduledMeeting: { create: ReturnType<typeof vi.fn> } };
    mockCreate.scheduledMeeting.create = vi.fn().mockResolvedValue({
      id: "m-new",
      ownerCalendarEmail: "org@test.com",
      externalEventId: null,
      meetingUrl: null,
    });
    p.meetingAttendance.createMany.mockResolvedValue({});
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({ eventId: "gcal-new", htmlLink: null, meetUrl: null });

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "New series title",
      durationMinutes: 60,
      scope: { type: "UserList", participantUserIds: ["u2"] },
      startTime: "2026-09-24T14:00:00.000Z",
      editScope: "following",
      occurrenceStart: "2026-09-24T14:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    // The master must be updated with a recurrenceRule containing UNTIL=
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrenceRule: expect.stringContaining("UNTIL="),
        }),
      }),
    );
    // A new Google event must be created for the new series
    expect(createGoogleCalendarEvent).toHaveBeenCalled();
  });
});

describe("meetingIsUpcoming", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("is over once a one-off meeting has ended", () => {
    const base = { durationMinutes: 60, recurrenceRule: null };
    expect(meetingIsUpcoming({ ...base, selectedAt: new Date("2026-09-16T10:30:00Z") }, now)).toBe(false);
    // Still in progress counts as upcoming — invitees can still make it.
    expect(meetingIsUpcoming({ ...base, selectedAt: new Date("2026-09-16T11:30:00Z") }, now)).toBe(true);
  });

  it("treats a series or an unscheduled meeting as upcoming", () => {
    const past = new Date("2026-01-01T10:00:00Z");
    expect(meetingIsUpcoming({ selectedAt: past, durationMinutes: 30, recurrenceRule: "FREQ=WEEKLY" }, now)).toBe(true);
    expect(meetingIsUpcoming({ selectedAt: null, durationMinutes: 30, recurrenceRule: null }, now)).toBe(true);
  });
});

describe("attachMeetingNote", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const mockIsCore = isCore as unknown as ReturnType<typeof vi.fn>;

  const meetingRow = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["org-1", "u2"],
    isCoreMeeting: false,
    selectedAt: new Date("2026-09-10T15:00:00Z"),
    status: "Confirmed",
    notePage: null,
    ...over,
  });

  beforeEach(() => {
    mockIsCore.mockResolvedValue(false);
    p.scheduledMeeting.update.mockResolvedValue({});
    p.meetingAttendance.createMany.mockResolvedValue({ count: 0 });
  });

  it("404s a missing meeting", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(null);

    const res = await attachMeetingNote({
      meetingId: "nope",
      actorId: "org-1",
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });

    expect(res).toEqual({ ok: false, error: "Meeting not found", status: 404 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("409s when the meeting already has a note", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notePage: { id: "page-x" } }));

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });

    expect(res).toEqual({ ok: false, error: "This meeting already has a notes doc", status: 409 });
  });

  it("403s a non-organizer who isn't Core", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    mockIsCore.mockResolvedValue(false);

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "intruder",
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });

    expect(res).toEqual({ ok: false, error: "Only the organizer or Core can add notes", status: 403 });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("rejects a Team note with no project", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", meetingType: "Team" });

    expect(res).toEqual({
      ok: false,
      error: "A project is required for Team and Partner meetings",
      status: 400,
    });
  });

  it("creates a General note, records the type, and backfills attendance", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      meetingType: "Other",
      meetingTypeLabel: "All-hands",
    });

    expect(res).toEqual({ ok: true, notePageId: "page-lab" });
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { meetingType: "Other", meetingTypeLabel: "All-hands", projectId: null },
    });
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", userId: "org-1" },
        { scheduledMeetingId: "m1", userId: "u2" },
      ],
      skipDuplicates: true,
    });
  });

  it("lets Core file a Team note under a project they don't belong to", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ participantUserIds: ["org-1"] }));
    mockIsCore.mockResolvedValue(true);
    p.project.findFirst.mockResolvedValue({ id: "proj-9" });
    p.project.findUnique.mockResolvedValue({ name: "Deserto" });

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "core-admin",
      meetingType: "Team",
      projectId: "proj-9",
    });

    expect(res).toEqual({ ok: true, notePageId: "page-project" });
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { meetingType: "Team", meetingTypeLabel: null, projectId: "proj-9" },
    });
  });
});

// The lab's general calendar is authored in Google, so its events arrive with
// no ScheduledMeeting behind them — and therefore no note and no attendance.
// Tracking one creates that missing row without re-pushing the event to Google
// or re-inviting people Google already invited.
describe("trackExternalEventAsMeeting", () => {
  const GOOGLE_EVENT = {
    id: "gcal-evt-1",
    summary: "  All-hands  ",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    startIso: "2026-09-15T18:00:00.000Z",
    startDate: null,
    endIso: "2026-09-15T19:30:00.000Z",
    endDate: null,
    location: "Baker 101",
    description: "Weekly all-hands",
    attendeeEmails: ["ally@dali.dartmouth.edu", "outsider@example.com"],
  };

  function arrange(over: { core?: boolean; event?: Partial<typeof GOOGLE_EVENT> } = {}) {
    vi.mocked(isCore).mockResolvedValue(over.core ?? true);
    vi.mocked(getGoogleEvent).mockResolvedValue({ ...GOOGLE_EVENT, ...over.event });
    const p = mockPrisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.userCalendarLink!.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "core-1",
      externalEmail: "core@dali.dartmouth.edu",
    });
    p.scheduledMeeting!.findFirst.mockResolvedValue(null);
    p.scheduledMeeting!.create.mockImplementation(async (a: { data: unknown }) => ({
      id: "m-new",
      ...(a.data as object),
    }));
    p.user!.findMany.mockResolvedValue([{ id: "u-ally" }]);
    p.meetingAttendance!.createMany.mockResolvedValue({ count: 2 });
    return p;
  }

  const input = {
    actorId: "core-1",
    eventId: "gcal-evt-1",
    linkId: "link-1",
    calendarId: "dali@dartmouth.edu",
  };

  it("refuses anyone who isn't Core", async () => {
    arrange({ core: false });
    expect(await trackExternalEventAsMeeting(input)).toEqual({
      ok: false,
      error: "Only Core can track an event in DALI",
      status: 403,
    });
  });

  it("binds the meeting to the Google event, with title and duration from Google", async () => {
    const p = arrange();

    const res = await trackExternalEventAsMeeting(input);

    expect(res.ok).toBe(true);
    const data = p.scheduledMeeting!.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizerId: "core-1",
      title: "All-hands",
      durationMinutes: 90,
      scopeType: "None",
      status: "Confirmed",
      externalEventId: "gcal-evt-1",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU",
    });
  });

  it("binds a series to its master, so one note covers every occurrence", async () => {
    const p = arrange();

    await trackExternalEventAsMeeting({ ...input, recurringEventId: "gcal-master" });

    expect(p.scheduledMeeting!.create.mock.calls[0][0].data.externalEventId).toBe("gcal-master");
  });

  it("seeds the roster from Google's guests, resolved to members, plus the actor", async () => {
    const p = arrange();

    await trackExternalEventAsMeeting(input);

    // outsider@example.com resolves to nobody and is simply absent.
    expect(p.scheduledMeeting!.create.mock.calls[0][0].data.participantUserIds).toEqual(["u-ally"]);
    expect(p.meetingAttendance!.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { scheduledMeetingId: "m-new", userId: "u-ally" },
          { scheduledMeetingId: "m-new", userId: "core-1" },
        ],
        skipDuplicates: true,
      }),
    );
  });

  it("never re-pushes the event to Google or re-invites its guests", async () => {
    arrange();

    await trackExternalEventAsMeeting(input);

    expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("refuses an event that is already tracked", async () => {
    const p = arrange();
    p.scheduledMeeting!.findFirst.mockResolvedValue({ id: "m-existing" });

    expect(await trackExternalEventAsMeeting(input)).toEqual({
      ok: false,
      error: "This event is already tracked in DALI",
      status: 409,
    });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
  });

  it("refuses a calendar link that isn't the actor's", async () => {
    const p = arrange();
    p.userCalendarLink!.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "someone-else",
      externalEmail: "x@dali.dartmouth.edu",
    });

    expect(await trackExternalEventAsMeeting(input)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("isWithinCheckInWindow", () => {
  const HOUR = 60 * 60_000;
  // A Tuesday 10:00 UTC meeting, one hour long, repeating weekly.
  const firstStart = new Date("2026-09-01T10:00:00.000Z");
  const weekly = {
    selectedAt: firstStart,
    durationMinutes: 60,
    recurrenceRule: "FREQ=WEEKLY;BYDAY=TU",
  };

  it("accepts a check-in during the first occurrence", () => {
    expect(isWithinCheckInWindow(weekly, [], firstStart.getTime() + 10 * 60_000)).toBe(true);
  });

  // The regression: selectedAt never advances, so testing it directly meant
  // every sitting after the first reported "window closed" mid-meeting.
  it("accepts a check-in during a later occurrence of a recurring meeting", () => {
    const fourWeeksLater = firstStart.getTime() + 28 * 24 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], fourWeeksLater + 10 * 60_000)).toBe(true);
  });

  it("still rejects a time between occurrences", () => {
    // Wednesday, a day after an occurrence ended.
    const between = firstStart.getTime() + 25 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], between)).toBe(false);
  });

  it("honours the ±15min grace on either side of an occurrence", () => {
    const third = firstStart.getTime() + 14 * 24 * HOUR;
    expect(isWithinCheckInWindow(weekly, [], third - 10 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(weekly, [], third - 20 * 60_000)).toBe(false);
    expect(isWithinCheckInWindow(weekly, [], third + HOUR + 10 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(weekly, [], third + HOUR + 20 * 60_000)).toBe(false);
  });

  it("judges a rescheduled occurrence at its override time, not its original slot", () => {
    const originalStart = new Date(firstStart.getTime() + 7 * 24 * HOUR);
    const overrideStart = new Date(originalStart.getTime() + 2 * 24 * HOUR);
    const exceptions = [
      { originalStart, overrideStart, overrideDurationMin: null, cancelled: false },
    ];
    expect(isWithinCheckInWindow(weekly, exceptions, overrideStart.getTime() + 5 * 60_000)).toBe(
      true,
    );
    expect(isWithinCheckInWindow(weekly, exceptions, originalStart.getTime() + 5 * 60_000)).toBe(
      false,
    );
  });

  it("rejects a cancelled occurrence", () => {
    const originalStart = new Date(firstStart.getTime() + 7 * 24 * HOUR);
    const exceptions = [
      { originalStart, overrideStart: null, overrideDurationMin: null, cancelled: true },
    ];
    expect(isWithinCheckInWindow(weekly, exceptions, originalStart.getTime() + 5 * 60_000)).toBe(
      false,
    );
  });

  it("handles a one-off meeting, and has no window without a scheduled time", () => {
    const oneOff = { selectedAt: firstStart, durationMinutes: 60, recurrenceRule: null };
    expect(isWithinCheckInWindow(oneOff, [], firstStart.getTime() + 5 * 60_000)).toBe(true);
    expect(isWithinCheckInWindow(oneOff, [], firstStart.getTime() + 3 * HOUR)).toBe(false);
    expect(
      isWithinCheckInWindow({ selectedAt: null, durationMinutes: 60, recurrenceRule: null }, []),
    ).toBe(false);
  });
});
