import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/pages", () => ({
  createProjectPage: vi.fn(async () => ({ id: "page-project" })),
  createLabMeetingPage: vi.fn(async () => ({ id: "page-lab" })),
  ensureMeetingNotesFolder: vi.fn(async () => ({ id: "folder-project" })),
  ensureCoreMeetingNotesFolder: vi.fn(async () => "folder-core"),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { createLabMeetingPage, ensureCoreMeetingNotesFolder } from "~/lib/pages";
import {
  adoptEventMeeting,
  cancelScheduledMeeting,
  createScheduledMeeting,
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
});

describe("createScheduledMeeting — where a note is filed", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const labPage = createLabMeetingPage as unknown as ReturnType<typeof vi.fn>;
  const coreFolder = ensureCoreMeetingNotesFolder as unknown as ReturnType<typeof vi.fn>;

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

    expect(labPage).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: null, restricted: false }),
    );
  });

  it("leaves a non-Core General note on the chosen-location path", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: false });

    expect(coreFolder).not.toHaveBeenCalled();
    expect(labPage).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: null }));
  });
});

describe("adoptEventMeeting", () => {
  const db = prisma as unknown as {
    userCalendarLink: { findFirst: ReturnType<typeof vi.fn> };
    scheduledMeeting: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const event = {
    userId: "u1",
    eventId: "gcal-instance-1",
    recurringEventId: null,
    linkId: "link-1",
    title: "Design review",
    startIso: "2026-09-14T15:00:00.000Z",
    endIso: "2026-09-14T16:00:00.000Z",
  };

  beforeEach(() => {
    db.userCalendarLink.findFirst.mockResolvedValue({
      id: "link-1",
      externalEmail: "me@dali.dartmouth.edu",
    });
    db.scheduledMeeting.findFirst.mockResolvedValue(null);
    db.scheduledMeeting.create.mockResolvedValue({ id: "m-new" });
  });

  it("refuses a calendar link that isn't the viewer's", async () => {
    db.userCalendarLink.findFirst.mockResolvedValue(null);

    const res = await adoptEventMeeting(event);

    expect(res).toEqual({ ok: false, error: "Invalid calendar link" });
    expect(db.scheduledMeeting.create).not.toHaveBeenCalled();
  });

  it("opens an unscoped meeting on the event, so adopting invites nobody", async () => {
    const res = await adoptEventMeeting(event);

    expect(res).toEqual({ ok: true, meetingId: "m-new" });
    expect(db.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizerId: "u1",
          scopeType: "None",
          participantUserIds: [],
          durationMinutes: 60,
          externalEventId: "gcal-instance-1",
        }),
      }),
    );
  });

  it("adopts a series through its master, so one occurrence marks the series", async () => {
    await adoptEventMeeting({ ...event, recurringEventId: "gcal-master-1" });

    expect(db.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: "gcal-master-1" }),
      }),
    );
  });

  it("reuses the meeting already on the event rather than opening a second", async () => {
    db.scheduledMeeting.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: ["u1"],
    });

    const res = await adoptEventMeeting(event);

    expect(res).toEqual({ ok: true, meetingId: "m-existing" });
    expect(db.scheduledMeeting.create).not.toHaveBeenCalled();
    expect(db.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("joins the viewer to an existing meeting they aren't on yet", async () => {
    db.scheduledMeeting.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    });

    await adoptEventMeeting(event);

    expect(db.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m-existing" },
      data: { participantUserIds: { push: "u1" } },
    });
  });

  it("rejects an event with no length", async () => {
    const res = await adoptEventMeeting({ ...event, endIso: event.startIso });

    expect(res).toEqual({ ok: false, error: "Invalid event time" });
    expect(db.scheduledMeeting.create).not.toHaveBeenCalled();
  });
});
