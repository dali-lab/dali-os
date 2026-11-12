import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/calendar/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn() }));
vi.mock("~/lib/pages", () => ({
  createProjectPage: vi.fn(async () => ({ id: "page-project" })),
  createLabMeetingPage: vi.fn(async () => ({ id: "page-lab" })),
  ensureMeetingNotebook: vi.fn(async () => ({ id: "notebook-1" })),
  createNotebookTab: vi.fn(async () => ({ id: "page-tab" })),
  moveIntoNotebook: vi.fn(),
  trashNotebookIfAbandoned: vi.fn(),
}));
vi.mock("~/drive/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn(),
  projectSlot: (projectId: string) => ({ processType: "Project", processId: projectId, folderType: "Meetings" }),
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: processType.toLowerCase(), folderType }),
}));
vi.mock("~/lib/terms", () => ({ termWindows: vi.fn(async () => []) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(async () => false) }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn(async () => []) }));
vi.mock("~/calendar/lib/general-calendar", () => ({ isGeneralCalendarEvent: vi.fn(() => true) }));
vi.mock("~/calendar/lib/google-calendar.server", () => ({
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
}));
vi.mock("~/drive/lib/page-copy.server", () => ({ copyPageBody: vi.fn() }));
vi.mock("~/drive/lib/page-move.server", () => ({ movePage: vi.fn() }));
vi.mock("~/calendar/lib/notebooks.server", () => {
  class NotebookError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  return { NotebookError, createNotebook: vi.fn(), loadEditableNotebook: vi.fn() };
});
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: { id: true }, getPageAccess: vi.fn() }));
vi.mock("~/drive/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn(async () => []) }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn(() => "") }));

import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { driveFolderCrumbs } from "~/drive/lib/drive-crumbs.server";
import { notify } from "~/lib/notify.server";
import { isCore } from "~/lib/roles";
import { resolveFilingFolder } from "~/drive/lib/drive-receivers.server";
import { resolveGroupMembers } from "~/lib/groups";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotebook,
  createNotebookTab,
  moveIntoNotebook,
  trashNotebookIfAbandoned,
} from "~/lib/pages";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  getGoogleEvent,
  deleteGoogleCalendarEvent,
} from "~/calendar/lib/google-calendar.server";
import { copyPageBody } from "~/drive/lib/page-copy.server";
import { movePage } from "~/drive/lib/page-move.server";
import { NotebookError, createNotebook, loadEditableNotebook } from "~/calendar/lib/notebooks.server";
import { syncMeetingShares } from "~/calendar/lib/meeting-shares.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import {
  cancelScheduledMeeting,
  createScheduledMeeting,
  trackExternalEventAsMeeting,
  updateScheduledMeeting,
} from "~/calendar/lib/scheduled-meeting.server";
import { isGeneralCalendarEvent } from "~/calendar/lib/general-calendar";

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
  vi.mocked(resolveFilingFolder).mockImplementation(async (slot) => ({
    folderId:
      slot.processType === "Project" ? "folder-project" : slot.processType === "Core" ? "folder-core" : "folder-lab-notes",
    viaReceiver: true,
  }));
  // What a note's notebook is keyed on (see meeting-notebook.ts).
  vi.mocked(prisma.scheduledMeeting.findUniqueOrThrow).mockResolvedValue({
    title: "Sync",
    isCoreMeeting: false,
    scopeType: "UserList",
    scopeId: null,
    organizerId: "org-1",
    participantUserIds: ["u2"],
    guestEmails: [],
  } as never);
});

const findFolder = (row: unknown) => vi.mocked(prisma.page.findUnique).mockResolvedValue(row as never);

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
    expect(call.message.copyKey).toBe("meeting.cancelled.series");
    expect(call.message.vars).toEqual({ itemTitle: "Sprint sync" });
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

describe("cancelScheduledMeeting — Google ownership", () => {
  const link = prisma as unknown as { userCalendarLink: { findUnique: ReturnType<typeof vi.fn> } };
  const exc = prisma as unknown as { meetingException: { upsert: ReturnType<typeof vi.fn> } };

  const row = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizerId: "org-1",
    status: "Confirmed",
    title: "Weekly sync",
    participantUserIds: ["u2"],
    selectedAt: new Date("2026-09-10T15:00:00Z"),
    durationMinutes: 30,
    recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
    ownerCalendarEmail: "org@dali.dartmouth.edu",
    externalEventId: "gcal-master",
    organizerCalendarLinkId: "link-1",
    organizerCalendarId: "cal-1",
    googleEventOrigin: "Created",
    ...over,
  });

  beforeEach(() => {
    link.userCalendarLink = { findUnique: vi.fn().mockResolvedValue({ id: "link-1", enabled: true }) };
    exc.meetingException = { upsert: vi.fn().mockResolvedValue({}) };
    mockPrisma.scheduledMeeting.update.mockResolvedValue({});
  });

  it.each([
    ["Created", "gcal-master"],
    [null, "gcal-master"],
  ])("scope=all deletes the Google event and notifies for origin %s", async (googleEventOrigin, externalEventId) => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(row({ googleEventOrigin, externalEventId }));

    await cancelScheduledMeeting("m1", "org-1");

    expect(deleteGoogleCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: "gcal-master" }));
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("scope=all on a tracked meeting cancels in DALI only: no Google delete, no notices", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(row({ googleEventOrigin: "Tracked" }));

    const res = await cancelScheduledMeeting("m1", "org-1");

    expect(res).toEqual({ ok: true, alreadyCancelled: false });
    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "Cancelled" },
    });
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("scope=all on a legacy row whose id is a split series is never deleted from Google", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(
      row({ googleEventOrigin: null, externalEventId: "gcal-master_R20260928T130000" }),
    );

    await cancelScheduledMeeting("m1", "org-1");

    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("scope=this on a tracked meeting writes the exception but not to Google", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(row({ googleEventOrigin: "Tracked" }));

    await cancelScheduledMeeting("m1", "org-1", {
      scope: "this",
      occurrenceStart: "2026-09-17T15:00:00.000Z",
      occurrenceEventId: "gcal-instance-1",
    });

    expect(exc.meetingException.upsert).toHaveBeenCalled();
    expect(deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("scope=following on a tracked meeting truncates the DALI rule but not the Google series", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(row({ googleEventOrigin: "Tracked" }));

    await cancelScheduledMeeting("m1", "org-1", { scope: "following", occurrenceStart: "2026-09-24T15:00:00.000Z" });

    expect(mockPrisma.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recurrenceRule: expect.stringContaining("UNTIL=") } }),
    );
    expect(patchGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("scope=following on a created meeting still truncates the Google series", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(row());

    await cancelScheduledMeeting("m1", "org-1", { scope: "following", occurrenceStart: "2026-09-24T15:00:00.000Z" });

    expect(patchGoogleCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "gcal-master", recurrenceRule: expect.stringContaining("UNTIL=") }),
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
  // A note is a tab of its notebook; these assert where a new notebook goes.
  const notebook = ensureMeetingNotebook as unknown as ReturnType<typeof vi.fn>;
  const filing = resolveFilingFolder as unknown as ReturnType<typeof vi.fn>;

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

  it("reports the notebook the note went into and that it reused it", async () => {
    const res = await createScheduledMeeting({ ...base, isCoreMeeting: true });
    expect(res).toMatchObject({
      ok: true,
      notePageId: "page-tab",
      notebookId: "notebook-1",
      createdNotebook: false,
    });
  });

  it("reports a notebook this call created, so the filing toast can undo it", async () => {
    notebook.mockResolvedValueOnce({ id: "notebook-new", created: true });
    const res = await createScheduledMeeting({ ...base, isCoreMeeting: true });
    expect(res).toMatchObject({ ok: true, notebookId: "notebook-new", createdNotebook: true });
  });

  it("reports no notebook when the meeting keeps no note", async () => {
    const res = await createScheduledMeeting({ ...base, meetingType: undefined, meetingTypeLabel: undefined });
    expect(res).toMatchObject({ ok: true, notePageId: null, notebookId: null, createdNotebook: false });
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

    expect(filing).toHaveBeenCalledWith({ processType: "Project", processId: "proj-7", folderType: "Meetings" }, "org-1");
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "project:proj-7:Team:none",
        workspaceType: "Project",
        workspaceId: "proj-7",
        parentPageId: "folder-project",
      }),
    );
    expect(createNotebookTab).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "notebook-1", meetingNoteId: "m1" }),
    );
    expect(filing).not.toHaveBeenCalledWith(expect.objectContaining({ processType: "Core" }), expect.anything());
    // The note itself is never a loose page any more.
    expect(projectPage).not.toHaveBeenCalled();
    expect(labPage).not.toHaveBeenCalled();
  });

  it("files a Core meeting's note in Core's own folder", async () => {
    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
    });

    expect(filing).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" }, "org-1");
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-core", restricted: true }),
    );
  });

  it("falls back to the Lab root when Core has no drive yet", async () => {
    filing.mockResolvedValueOnce({ folderId: null, viaReceiver: false });

    await createScheduledMeeting({ ...base, isCoreMeeting: true });

    // Deliberately the root, not the lab-wide Meeting notes folder: a Core note
    // that lost its folder must not land on the communal shelf.
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: null, restricted: false }),
    );
    expect(filing).toHaveBeenCalledTimes(1);
  });

  it("files a non-Core General note in the Lab's Meeting notes folder", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: false });

    expect(filing).toHaveBeenCalledTimes(1);
    expect(filing).toHaveBeenCalledWith({ processType: "Lab", processId: "lab", folderType: "Meetings" }, "org-1");
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-lab-notes" }),
    );
  });
});

describe("createScheduledMeeting — where a note is filed through receiver folders", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const notebook = ensureMeetingNotebook as unknown as ReturnType<typeof vi.fn>;
  const resolve = resolveFilingFolder as unknown as ReturnType<typeof vi.fn>;

  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Sync",
    durationMinutes: 60,
    scope: { type: "None" } as const,
    startTime: "2026-09-10T15:00:00.000Z",
    meetingType: "Other" as const,
    meetingTypeLabel: "Sync",
  };

  beforeEach(() => {
    mockPage.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    mockPage.meetingAttendance.createMany.mockResolvedValue({});
    resolve.mockResolvedValue({ folderId: null, viaReceiver: false });
  });

  it("files a new notebook at the project's Meetings receiver, with the project from the caller", async () => {
    resolve.mockResolvedValue({ folderId: "recv-1", viaReceiver: true });
    vi.mocked(createNotebook).mockResolvedValue({ id: "nb-new" });

    await createScheduledMeeting({ ...base, meetingType: undefined, meetingTypeLabel: undefined, projectId: "proj-7", notebook: { title: "Team sync" } });

    expect(resolve).toHaveBeenCalledWith({ processType: "Project", processId: "proj-7", folderType: "Meetings" }, "org-1");
    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "recv-1" }),
    );
  });

  describe("a Core meeting held for a project", () => {
    const coreProject = { ...base, isCoreMeeting: true, meetingType: "Team" as const, meetingTypeLabel: null, projectId: "proj-7" };

    beforeEach(() => {
      resolve.mockResolvedValue({ folderId: "recv-1", viaReceiver: true });
    });

    it("keeps isCoreMeeting on the meeting row", async () => {
      await createScheduledMeeting(coreProject);

      expect(mockPage.scheduledMeeting.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isCoreMeeting: true }) }),
      );
    });

    it("files the notebook only in the project, never in Core's Meetings folder", async () => {
      await createScheduledMeeting(coreProject);

      expect(resolve).not.toHaveBeenCalledWith(expect.objectContaining({ processType: "Core" }), expect.anything());
      expect(createNotebookTab).toHaveBeenCalledTimes(1);
    });
  });

  it("files a Team meeting to the project's Meetings receiver and creates no Team folder", async () => {
    resolve.mockResolvedValue({ folderId: "recv-1", viaReceiver: true });

    await createScheduledMeeting({ ...base, meetingType: "Team", meetingTypeLabel: null, projectId: "proj-7" });

    expect(resolve).toHaveBeenCalledWith(
      { processType: "Project", processId: "proj-7", folderType: "Meetings" },
      "org-1",
    );
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "recv-1" }),
    );
  });

  it.each(["Team", "Partner", "Other"] as const)("files a %s project meeting at the project top level with no receiver", async (meetingType) => {
    await createScheduledMeeting({
      ...base,
      meetingType,
      meetingTypeLabel: meetingType === "Other" ? "Retro" : null,
      projectId: "proj-7",
    });

    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: null }),
    );
  });

  it("files a Core meeting to Core's Meetings receiver else the Core root", async () => {
    resolve.mockResolvedValue({ folderId: "core-root", viaReceiver: false });

    await createScheduledMeeting({ ...base, isCoreMeeting: true });

    expect(resolve).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" }, "org-1");
    expect(notebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", parentPageId: "core-root", restricted: true }),
    );
  });

  it("files a General meeting to the Lab Meetings receiver", async () => {
    resolve.mockResolvedValue({ folderId: "lab-recv", viaReceiver: true });

    await createScheduledMeeting({ ...base, isCoreMeeting: false });

    expect(resolve).toHaveBeenCalledWith({ processType: "Lab", processId: "lab", folderType: "Meetings" }, "org-1");
    expect(notebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "lab-recv" }));
  });

  it("files a General meeting at the Lab top level when no receiver is marked", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: false });

    expect(notebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: null }));
  });
});

describe("createScheduledMeeting — a new notebook files by the space it was started in", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const resolve = resolveFilingFolder as unknown as ReturnType<typeof vi.fn>;
  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Sync",
    durationMinutes: 60,
    scope: { type: "None" } as const,
    startTime: "2026-09-10T15:00:00.000Z",
  };
  const createdMeeting = () => mockPage.scheduledMeeting.create.mock.calls[0]![0].data;

  beforeEach(() => {
    mockPage.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    mockPage.meetingAttendance.createMany.mockResolvedValue({});
    vi.mocked(createNotebook).mockResolvedValue({ id: "nb-new" });
    resolve.mockImplementation(async (slot: { processType: string; processId: string }) => ({
      folderId: `${slot.processType}-${slot.processId}-recv`,
      viaReceiver: true,
    }));
  });

  it("files a core space in Core's Meetings receiver, with no Core group on the invite", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: true, notebook: { title: "Core sync", space: { kind: "core" } } });

    expect(resolve).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" }, "org-1");
    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", workspaceId: null, parentPageId: "Core-core-recv" }),
    );
    expect(createdMeeting()).toMatchObject({ isCoreMeeting: true });
  });

  it("files a core space in Core's Meetings receiver even for a meeting held for a project, and keeps the project", async () => {
    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
      projectId: "proj-7",
      meetingType: "Team",
      notebook: { title: "Core sync", space: { kind: "core" } },
    });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "Core-core-recv" }));
    expect(createdMeeting()).toMatchObject({ isCoreMeeting: true, projectId: "proj-7" });
  });

  it("refuses a core space for a meeting that is not a Core meeting, and creates nothing", async () => {
    const res = await createScheduledMeeting({ ...base, notebook: { title: "Core sync", space: { kind: "core" } } });

    expect(res).toEqual({ ok: false, error: "Only Core can start a notebook in Core" });
    expect(createNotebook).not.toHaveBeenCalled();
    expect(mockPage.scheduledMeeting.create).not.toHaveBeenCalled();
  });

  it("files a project space in that project's receiver and gives the meeting that project", async () => {
    await createScheduledMeeting({ ...base, notebook: { title: "Atlas sync", space: { kind: "project", projectId: "proj-9" } } });

    expect(resolve).toHaveBeenCalledWith({ processType: "Project", processId: "proj-9", folderType: "Meetings" }, "org-1");
    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-9", parentPageId: "Project-proj-9-recv" }),
    );
    expect(createdMeeting()).toMatchObject({ projectId: "proj-9", isCoreMeeting: false });
  });

  it("prefers the space's project over the one the caller gave", async () => {
    await createScheduledMeeting({
      ...base,
      projectId: "proj-1",
      notebook: { title: "Atlas sync", space: { kind: "project", projectId: "proj-9" } },
    });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "proj-9" }));
    expect(createdMeeting()).toMatchObject({ projectId: "proj-9" });
  });

  it("files a lab space in the General Meetings receiver, not the project or Core the meeting would use", async () => {
    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
      projectId: "proj-1",
      notebook: { title: "General sync", space: { kind: "lab" } },
    });

    expect(resolve).toHaveBeenCalledWith({ processType: "Lab", processId: "lab", folderType: "Meetings" }, "org-1");
    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", workspaceId: null, parentPageId: "Lab-lab-recv" }),
    );
  });

  it("files by the meeting's own flags when the choice names no space", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: true, notebook: { title: "Core sync" } });

    expect(resolve).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" }, "org-1");
  });

  describe("a folder the organizer picked", () => {
    const folderRow = (over: Record<string, unknown> = {}) => ({
      id: "f-1",
      kind: "Folder",
      archivedAt: null,
      workspaceType: "Lab",
      workspaceId: null,
      ...over,
    });
    const mayEdit = (canEdit: boolean) =>
      vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit, canComment: canEdit });
    const inScope = (scope: string) => vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope, folders: [] });

    it("files the notebook in that folder, not the space's receiver", async () => {
      findFolder(folderRow());
      mayEdit(true);
      inScope("lab");

      await createScheduledMeeting({ ...base, notebook: { title: "Sync", folderPageId: "f-1" } });

      expect(resolve).not.toHaveBeenCalled();
      expect(createNotebook).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceType: "Lab", workspaceId: null, parentPageId: "f-1" }),
      );
      expect(createdMeeting()).toMatchObject({ isCoreMeeting: false, projectId: null });
    });

    it("makes the meeting Core when the folder sits under the Core root", async () => {
      findFolder(folderRow());
      mayEdit(true);
      inScope("core");

      await createScheduledMeeting({ ...base, notebook: { title: "Sync", folderPageId: "f-1" } });

      expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "f-1" }));
      expect(createdMeeting()).toMatchObject({ isCoreMeeting: true });
    });

    it("gives the meeting the project of a project folder", async () => {
      findFolder(folderRow({ workspaceType: "Project", workspaceId: "proj-9" }));
      mayEdit(true);

      await createScheduledMeeting({ ...base, notebook: { title: "Sync", folderPageId: "f-1" } });

      expect(createNotebook).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-9", parentPageId: "f-1" }),
      );
      expect(createdMeeting()).toMatchObject({ projectId: "proj-9" });
    });

    it("lets the folder decide over a space the caller also sent", async () => {
      findFolder(folderRow({ workspaceType: "Project", workspaceId: "proj-9" }));
      mayEdit(true);

      await createScheduledMeeting({
        ...base,
        notebook: { title: "Sync", folderPageId: "f-1", space: { kind: "project", projectId: "proj-1" } },
      });

      expect(createdMeeting()).toMatchObject({ projectId: "proj-9" });
    });

    it.each([
      ["one the organizer can't edit", () => { findFolder(folderRow()); mayEdit(false); }],
      ["one that does not exist", () => { findFolder(null); }],
      ["an archived one", () => { findFolder(folderRow({ archivedAt: new Date() })); mayEdit(true); }],
      ["a page that is not a folder", () => { findFolder(folderRow({ kind: "Notebook" })); mayEdit(true); }],
    ])("refuses %s and creates nothing", async (_name, arrange) => {
      arrange();

      const res = await createScheduledMeeting({ ...base, notebook: { title: "Sync", folderPageId: "f-1" } });

      expect(res).toEqual({ ok: false, error: "You can't file in that folder" });
      expect(createNotebook).not.toHaveBeenCalled();
      expect(mockPage.scheduledMeeting.create).not.toHaveBeenCalled();
    });
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
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
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
    // Unscheduled, so the roster sits on the meeting's only key: its createdAt.
    const occurrenceStart = new Date("2026-09-01T12:00:00.000Z");
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", occurrenceStart, userId: "u2" },
        { scheduledMeetingId: "m1", occurrenceStart, userId: "u3" },
        { scheduledMeetingId: "m1", occurrenceStart, userId: "org-1" },
      ],
      skipDuplicates: true,
    });
  });

  it("stamps every member of a Group-scoped meeting's calendar as changed, not only the organizer", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValueOnce(["g1", "g2"]);
    p.scheduledMeeting.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "m1",
      ownerCalendarEmail: "org@dali.dartmouth.edu",
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      ...data,
    }));
    const updateMany = prisma.user.updateMany as ReturnType<typeof vi.fn>;
    updateMany.mockClear();

    await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "Group sync",
      durationMinutes: 30,
      scope: { type: "Group", groupId: "grp-1" },
    });

    const stamped = updateMany.mock.calls.flatMap(([arg]) => arg.where.id.in as string[]);
    expect(new Set(stamped)).toEqual(new Set(["org-1", "g1", "g2"]));
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

describe("createScheduledMeeting — recordPrompt default", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    p.scheduledMeeting.create.mockResolvedValue({
      id: "m1",
      ownerCalendarEmail: "org@dali.dartmouth.edu",
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    p.meetingAttendance.createMany.mockResolvedValue({});
    mockNotify.mockResolvedValue({ inApp: 0 });
  });

  function manyIds(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `u${i}`);
  }

  it("defaults recordPrompt to false for a SelfCheckIn event with more than 30 participants", async () => {
    await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "All-lab kickoff",
      durationMinutes: 60,
      scope: { type: "UserList", participantUserIds: manyIds(31) },
      attendanceMode: "SelfCheckIn",
    });

    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordPrompt: false }) }),
    );
  });

  it("keeps recordPrompt true for a SelfCheckIn event with 30 or fewer participants", async () => {
    await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "Team standup",
      durationMinutes: 30,
      scope: { type: "UserList", participantUserIds: manyIds(30) },
      attendanceMode: "SelfCheckIn",
    });

    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordPrompt: true }) }),
    );
  });

  it("keeps recordPrompt true for a large Roster meeting (the cap is SelfCheckIn-only)", async () => {
    await createScheduledMeeting({
      organizerId: "org-1",
      organizerEmail: "org@dali.dartmouth.edu",
      title: "Big roster meeting",
      durationMinutes: 60,
      scope: { type: "UserList", participantUserIds: manyIds(40) },
    });

    expect(p.scheduledMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordPrompt: true }) }),
    );
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
      {
        id: "u2",
        firstName: "Ally",
        lastName: "Kim",
        daliEmail: "ally@dali.dartmouth.edu",
        timeZone: "America/Los_Angeles",
      },
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
      iCalUID: "gcal-1@google.com",
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

  it("marks a meeting it pushed to Google as Created", async () => {
    p.userCalendarLink.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "org-1",
      externalEmail: "org@dali.dartmouth.edu",
      enabled: true,
    });
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({
      eventId: "gcal-1",
      iCalUID: "gcal-1@google.com",
      htmlLink: null,
      meetUrl: null,
    });

    await createScheduledMeeting({ ...base, organizerCalendarLinkId: "link-1" });

    expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: "gcal-1", googleEventOrigin: "Created" }),
      }),
    );
  });

  it("pushes nothing to Google when skipGoogle is set", async () => {
    p.userCalendarLink.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "org-1",
      externalEmail: "org@dali.dartmouth.edu",
      enabled: true,
    });

    await createScheduledMeeting({ ...base, organizerCalendarLinkId: "link-1", skipGoogle: true });

    expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
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
      iCalUID: "gcal-1@google.com",
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
    // The invite's when-where-and-what lines reach the template as one detail
    // value, because the in-app feed and the Slack DM have no attachment. It is
    // per-recipient so the start reads in that person's own zone — u2 is on
    // Pacific, and 17:00 UTC is 10:00 AM there — rather than as a raw instant.
    expect(call.recipients[0].vars.itemDetail).toContain(
      "Starts Tue, Sep 22, 10:00 AM PT",
    );
    expect(call.recipients[0].vars.itemDetail).toContain("Location: Baker 101");
    expect(call.recipients[0].vars.itemDetail).toContain("Bring the latest mocks.");
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
      data: [
        {
          scheduledMeetingId: "m1",
          occurrenceStart: new Date("2026-09-11T16:00:00.000Z"),
          userId: "u4",
        },
      ],
      skipDuplicates: true,
    });
    expect(p.meetingAttendance.deleteMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", userId: { in: ["u3"] } },
    });
    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
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

  it("keeps the organizer on the roster of a typeless meeting that has a notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({ participantUserIds: [], notebookId: "nb-1", attendanceMode: "None" }),
    );
    p.meetingAttendance.findMany.mockResolvedValue([]);

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "Solo",
      durationMinutes: 30,
      scope: { type: "None" },
      startTime: "2026-09-10T15:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ userId: "org-1" })] }),
    );
  });

  it("drops the roster of a typeless meeting with no notebook once its guests go", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({ participantUserIds: [], notebookId: null, attendanceMode: "None" }),
    );
    p.meetingAttendance.findMany.mockResolvedValue([{ userId: "org-1" }]);

    await updateScheduledMeeting("m1", "org-1", {
      title: "Solo",
      durationMinutes: 30,
      scope: { type: "None" },
      startTime: "2026-09-10T15:00:00.000Z",
    });

    expect(p.meetingAttendance.createMany).not.toHaveBeenCalled();
    expect(p.meetingAttendance.deleteMany).toHaveBeenCalled();
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
        rooms: [{ id: "room-1" }],
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
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({ eventId: "gcal-new", iCalUID: "gcal-new@google.com", htmlLink: null, meetUrl: null });

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
    // The new series keeps the rooms the original occupied.
    expect(mockCreate.scheduledMeeting.create.mock.calls[0]![0].data.rooms).toEqual({
      connect: [{ id: "room-1" }],
    });
  });

  describe("Google ownership", () => {
    const mockP = p as unknown as { meetingException: { upsert: ReturnType<typeof vi.fn> } };
    const owned = (over: Record<string, unknown> = {}) =>
      meetingRow({
        externalEventId: "gcal-master",
        organizerCalendarLinkId: "link-1",
        organizerCalendarId: "cal-1",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
        scopeType: "UserList",
        scopeId: null,
        isCoreMeeting: false,
        meetingTypeLabel: null,
        projectId: null,
        rooms: [],
        guestEmails: [],
        ...over,
      });

    beforeEach(() => {
      mockP.meetingException = { upsert: vi.fn().mockResolvedValue({}) };
      p.userCalendarLink.findUnique.mockResolvedValue({
        id: "link-1",
        enabled: true,
        externalEmail: "org@test.com",
        userId: "org-1",
      });
      p.meetingAttendance.findMany.mockResolvedValue([]);
      p.user.findMany.mockResolvedValue([]);
      p.user.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
    });

    it.each([["Tracked", "gcal-master"], [null, "gcal-master_R20260928T130000"]])(
      "scope=this writes the exception but not to Google (origin %s, id %s)",
      async (googleEventOrigin, externalEventId) => {
        const row = owned({ googleEventOrigin, externalEventId });
        p.scheduledMeeting.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row);

        await updateScheduledMeeting("m1", "org-1", {
          title: "Moved",
          durationMinutes: 30,
          scope: { type: "UserList", participantUserIds: ["u2"] },
          startTime: "2026-09-17T16:00:00.000Z",
          editScope: "this",
          occurrenceStart: "2026-09-17T15:00:00.000Z",
          occurrenceEventId: "gcal-instance-1",
        });

        expect(mockP.meetingException.upsert).toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
      },
    );

    it("scope=this still patches Google for a legacy (null origin) row", async () => {
      const row = owned({ googleEventOrigin: null });
      p.scheduledMeeting.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row);

      await updateScheduledMeeting("m1", "org-1", {
        title: "Moved",
        durationMinutes: 30,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: "2026-09-17T16:00:00.000Z",
        editScope: "this",
        occurrenceStart: "2026-09-17T15:00:00.000Z",
        occurrenceEventId: "gcal-instance-1",
      });

      expect(mockPatch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "gcal-instance-1" }));
    });

    it("scope=all on a tracked meeting saves in DALI without patching Google", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(owned({ googleEventOrigin: "Tracked" }));

      const res = await updateScheduledMeeting("m1", "org-1", {
        title: "Renamed",
        durationMinutes: 30,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: "2026-09-10T15:00:00.000Z",
      });

      expect(res).toMatchObject({ ok: true, gcalError: null });
      expect(p.scheduledMeeting.update).toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it("scope=all on a created meeting still patches Google", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(owned({ googleEventOrigin: "Created" }));

      await updateScheduledMeeting("m1", "org-1", {
        title: "Renamed",
        durationMinutes: 30,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: "2026-09-10T15:00:00.000Z",
      });

      expect(mockPatch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "gcal-master" }));
    });

    it("scope=following on a tracked meeting pushes no Google event and truncates nothing there", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(owned({ googleEventOrigin: "Tracked", participantUserIds: ["org-1", "u2"] }));
      p.user.findMany.mockResolvedValue([
        { id: "org-1", firstName: "Org", lastName: "One", daliEmail: "org@test.com", dartmouthEmail: null },
        { id: "u2", firstName: "U", lastName: "Two", daliEmail: "u2@test.com", dartmouthEmail: null },
      ]);
      const mockCreate = p as unknown as { scheduledMeeting: { create: ReturnType<typeof vi.fn> } };
      mockCreate.scheduledMeeting.create = vi.fn().mockResolvedValue({ id: "m-new", ownerCalendarEmail: "org@test.com" });
      p.meetingAttendance.createMany.mockResolvedValue({});

      const res = await updateScheduledMeeting("m1", "org-1", {
        title: "New series",
        durationMinutes: 60,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: "2026-09-24T14:00:00.000Z",
        editScope: "following",
        occurrenceStart: "2026-09-24T14:00:00.000Z",
      });

      expect(res.ok).toBe(true);
      expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { recurrenceRule: expect.stringContaining("UNTIL=") } }),
      );
      expect(mockPatch).not.toHaveBeenCalled();
      expect(createGoogleCalendarEvent).not.toHaveBeenCalled();
    });
  });

  it("scope=following keeps filing into the master's notebook and mints no note at the cut", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
        participantUserIds: ["org-1", "u2"],
        scopeType: "UserList",
        scopeId: null,
        meetingType: "Other",
        meetingTypeLabel: "Sync",
        projectId: null,
        notebookId: "nb-1",
        rooms: [],
      }),
    );
    vi.mocked(loadEditableNotebook).mockResolvedValue({
      id: "nb-1",
      title: "Sync notes",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      templatePageId: null,
    } as never);
    p.user.findMany.mockResolvedValue([]);
    const mockCreate = p as unknown as { scheduledMeeting: { create: ReturnType<typeof vi.fn> } };
    mockCreate.scheduledMeeting.create = vi.fn().mockResolvedValue({
      id: "m-new",
      ownerCalendarEmail: "org@test.com",
      externalEventId: null,
      meetingUrl: null,
    });
    p.meetingAttendance.createMany.mockResolvedValue({});

    const res = await updateScheduledMeeting("m1", "org-1", {
      title: "Sync",
      durationMinutes: 60,
      scope: { type: "UserList", participantUserIds: ["u2"] },
      startTime: "2026-09-24T14:00:00.000Z",
      editScope: "following",
      occurrenceStart: "2026-09-24T14:00:00.000Z",
    });

    expect(res.ok).toBe(true);
    expect(loadEditableNotebook).toHaveBeenCalledWith("nb-1", "org-1");
    expect(mockCreate.scheduledMeeting.create.mock.calls[0]![0].data.notebookId).toBe("nb-1");
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  describe("scope=following and the series notebook", () => {
    const pg = prisma as unknown as { page: { updateMany: ReturnType<typeof vi.fn> } };
    const cut = "2026-09-24T14:00:00.000Z";
    const split = () =>
      updateScheduledMeeting("m1", "org-1", {
        title: "Sync",
        durationMinutes: 60,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: cut,
        editScope: "following",
        occurrenceStart: cut,
      });

    beforeEach(() => {
      p.scheduledMeeting.findUnique.mockResolvedValue(
        meetingRow({
          recurrenceRule: "FREQ=WEEKLY;BYDAY=TH",
          participantUserIds: ["org-1", "u2"],
          scopeType: "UserList",
          scopeId: null,
          meetingType: "Other",
          meetingTypeLabel: "Sync",
          projectId: null,
          notebookId: "nb-1",
          rooms: [],
        }),
      );
      p.user.findMany.mockResolvedValue([]);
      (p as unknown as { scheduledMeeting: { create: ReturnType<typeof vi.fn> } }).scheduledMeeting.create = vi
        .fn()
        .mockResolvedValue({ id: "m-new", ownerCalendarEmail: "org@test.com", externalEventId: null, meetingUrl: null });
      p.meetingAttendance.createMany.mockResolvedValue({});
      pg.page.updateMany.mockResolvedValue({ count: 0 });
    });

    it("splits cleanly, keeps the old series' notebook, and files the new one nowhere when the notebook is in Trash", async () => {
      vi.mocked(loadEditableNotebook).mockRejectedValueOnce(new NotebookError("Notebook not found", 404));

      const res = await split();

      expect(res.ok).toBe(true);
      expect(p.scheduledMeeting.update).toHaveBeenCalledTimes(1);
      expect(p.scheduledMeeting.update.mock.calls[0][0].data).toEqual({
        recurrenceRule: expect.stringContaining("UNTIL="),
      });
      const created = (p as any).scheduledMeeting.create.mock.calls[0][0].data;
      expect(created.notebookId).toBeNull();
      expect(createNotebookTab).not.toHaveBeenCalled();
    });

    it("rethrows anything that is not a notebook problem, before touching the old series", async () => {
      vi.mocked(loadEditableNotebook).mockRejectedValueOnce(new Error("db down"));

      await expect(split()).rejects.toThrow("db down");
      expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
    });

    it("hands the cut occurrence's note to the new series so none is minted twice", async () => {
      vi.mocked(loadEditableNotebook).mockResolvedValueOnce({ id: "nb-1" } as never);
      pg.page.updateMany.mockResolvedValueOnce({ count: 1 });

      await split();

      expect(pg.page.updateMany).toHaveBeenCalledWith({
        where: { meetingNoteId: "m1", meetingOccurrenceStart: new Date(cut), archivedAt: null },
        data: { meetingNoteId: "m-new", meetingOccurrenceStart: new Date(cut) },
      });
      expect(syncMeetingShares).toHaveBeenCalledWith("m1");
      expect(syncMeetingShares).toHaveBeenCalledWith("m-new");
    });

    it("keys the handed-over note to the new series' first occurrence when the time moved", async () => {
      vi.mocked(loadEditableNotebook).mockResolvedValueOnce({ id: "nb-1" } as never);
      const moved = "2026-09-24T16:00:00.000Z";

      await updateScheduledMeeting("m1", "org-1", {
        title: "Sync",
        durationMinutes: 60,
        scope: { type: "UserList", participantUserIds: ["u2"] },
        startTime: moved,
        editScope: "following",
        occurrenceStart: cut,
      });

      expect(pg.page.updateMany.mock.calls[0][0]).toMatchObject({
        where: { meetingOccurrenceStart: new Date(cut) },
        data: { meetingOccurrenceStart: new Date(moved) },
      });
    });
  });
});

describe("trackExternalEventAsMeeting", () => {
  const GOOGLE_EVENT = {
    id: "gcal-evt-1",
    iCalUID: "gcal-evt-1@google.com",
    summary: "  All-hands  ",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    startIso: "2026-09-15T18:00:00.000Z",
    startDate: null,
    endIso: "2026-09-15T19:30:00.000Z",
    endDate: null,
    location: "Baker 101",
    description: "Weekly all-hands",
    attendeeEmails: ["ally@dali.dartmouth.edu", "outsider@example.com"],
    viewerInvited: false,
    organizerEmail: null as string | null,
    creatorEmail: null as string | null,
    status: "confirmed" as string | null,
  };

  function arrange(
    over: { core?: boolean; general?: boolean; event?: Partial<typeof GOOGLE_EVENT> } = {},
  ) {
    vi.mocked(isCore).mockResolvedValue(over.core ?? true);
    vi.mocked(isGeneralCalendarEvent).mockReturnValue(over.general ?? true);
    vi.mocked(getGoogleEvent).mockResolvedValue({ ...GOOGLE_EVENT, ...over.event });
    const p = mockPrisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.userCalendarLink!.findUnique.mockResolvedValue({
      id: "link-1",
      userId: "core-1",
      externalEmail: "core@dali.dartmouth.edu",
    });
    p.scheduledMeeting!.findMany.mockResolvedValue([]);
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

  it("refuses someone who is neither Core nor on the event", async () => {
    arrange({ core: false });
    expect(await trackExternalEventAsMeeting(input)).toEqual({
      ok: false,
      error: "Only someone on this event can track it in DALI",
      status: 403,
    });
  });

  it("lets a non-Core member track an event they're on, visible to its guests only", async () => {
    const p = arrange({ core: false, general: false, event: { viewerInvited: true } });

    const res = await trackExternalEventAsMeeting(input);

    expect(res.ok).toBe(true);
    expect(p.scheduledMeeting!.create.mock.calls[0][0].data.scopeType).toBe("UserList");
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

  it("stores the event's iCalUID, so the grid matches it by the stable key", async () => {
    const p = arrange();

    await trackExternalEventAsMeeting(input);

    expect(p.scheduledMeeting!.create.mock.calls[0][0].data.iCalUID).toBe("gcal-evt-1@google.com");
  });

  it("finds an existing meeting by iCalUID as well as by event id", async () => {
    const p = arrange();

    await trackExternalEventAsMeeting({ ...input, recurringEventId: "gcal-master" });

    expect(p.scheduledMeeting!.findMany.mock.calls[0][0].where).toEqual({
      status: { not: "Cancelled" },
      OR: [{ externalEventId: "gcal-master" }, { iCalUID: "gcal-evt-1@google.com" }],
    });
  });

  describe("split series lineage", () => {
    const BASE = "6b1uc1q7omn5duodshtuoohpts";
    const SPLIT = `${BASE}_R20260928T130000`;

    it("also looks for the base event id and base iCalUID of a split", async () => {
      const p = arrange({ event: { id: `${BASE}_20261019T130000Z`, iCalUID: `${SPLIT}@google.com` } });

      await trackExternalEventAsMeeting({ ...input, eventId: `${BASE}_20261019T130000Z`, recurringEventId: SPLIT });

      expect(p.scheduledMeeting!.findMany.mock.calls[0][0].where).toEqual({
        status: { not: "Cancelled" },
        OR: [
          { externalEventId: SPLIT },
          { externalEventId: BASE },
          { iCalUID: `${SPLIT}@google.com` },
          { iCalUID: `${BASE}@google.com` },
        ],
      });
    });

    it("returns the parent lineage instead of minting a sibling for a split", async () => {
      const p = arrange({ event: { iCalUID: `${SPLIT}@google.com`, viewerInvited: true } });
      p.scheduledMeeting!.findMany.mockResolvedValue([{
        id: "m-parent",
        organizerId: "someone-else",
        participantUserIds: ["core-1"],
      }]);

      const res = await trackExternalEventAsMeeting({ ...input, recurringEventId: SPLIT });

      expect(res).toMatchObject({ ok: true, meeting: { id: "m-parent" } });
      expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
    });
  });

  it("marks the meeting Tracked and stores the calendar it lives on", async () => {
    const p = arrange();

    await trackExternalEventAsMeeting(input);

    expect(p.scheduledMeeting!.create.mock.calls[0][0].data).toMatchObject({
      googleEventOrigin: "Tracked",
      organizerCalendarId: "dali@dartmouth.edu",
    });
  });

  it("matches by event id alone when Google returns no iCalUID", async () => {
    const p = arrange({ event: { iCalUID: null as unknown as string } });

    await trackExternalEventAsMeeting(input);

    expect(p.scheduledMeeting!.findMany.mock.calls[0][0].where).toEqual({
      status: { not: "Cancelled" },
      OR: [{ externalEventId: "gcal-evt-1" }],
    });
  });

  it("returns a DALI meeting already pushed to Google under a different event id instead of tracking a second", async () => {
    const p = arrange({ event: { viewerInvited: true } });
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-dali-series",
      organizerId: "someone-else",
      participantUserIds: ["core-1"],
    }]);

    const res = await trackExternalEventAsMeeting(input);

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-dali-series" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
  });

  it("prefers the meeting bound to the split series itself over its parent lineage", async () => {
    const p = arrange({ event: { iCalUID: "base_R20260928T130000@google.com" } });
    p.scheduledMeeting!.findMany.mockResolvedValue([
      { id: "m-parent", organizerId: "core-1", participantUserIds: [], externalEventId: "base", iCalUID: "base@google.com" },
      {
        id: "m-split",
        organizerId: "core-1",
        participantUserIds: [],
        externalEventId: "base_R20260928T130000",
        iCalUID: "base_R20260928T130000@google.com",
      },
    ]);

    const res = await trackExternalEventAsMeeting({ ...input, recurringEventId: "base_R20260928T130000" });

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-split" } });
  });

  it("falls back to the parent lineage when only it exists", async () => {
    const p = arrange({ event: { iCalUID: "base_R20260928T130000@google.com" } });
    p.scheduledMeeting!.findMany.mockResolvedValue([
      { id: "m-parent", organizerId: "core-1", participantUserIds: [], externalEventId: "base", iCalUID: "base@google.com" },
    ]);

    const res = await trackExternalEventAsMeeting({ ...input, recurringEventId: "base_R20260928T130000" });

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-parent" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
  });

  it("binds a series to its master, so every occurrence finds the one meeting", async () => {
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
          {
            scheduledMeetingId: "m-new",
            occurrenceStart: new Date("2026-09-15T18:00:00.000Z"),
            userId: "u-ally",
          },
          {
            scheduledMeetingId: "m-new",
            occurrenceStart: new Date("2026-09-15T18:00:00.000Z"),
            userId: "core-1",
          },
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

  it("puts the Google organizer on the roster even when Google doesn't list them as a guest", async () => {
    const p = arrange({ event: { organizerEmail: "Organizer@dali.dartmouth.edu" } });

    await trackExternalEventAsMeeting(input);

    const where = p.user!.findMany.mock.calls[0][0].where as {
      OR: [{ daliEmail: { in: string[] } }, { dartmouthEmail: { in: string[] } }];
    };
    expect(where.OR[0].daliEmail.in).toEqual(
      expect.arrayContaining([
        "organizer@dali.dartmouth.edu",
        "ally@dali.dartmouth.edu",
        "outsider@example.com",
      ]),
    );
    expect(where.OR[0].daliEmail.in).toHaveLength(3);
    expect(where.OR[1].dartmouthEmail.in).toEqual(where.OR[0].daliEmail.in);
  });

  it("does not duplicate an organizer who is also a guest", async () => {
    const p = arrange({ event: { organizerEmail: "ally@dali.dartmouth.edu" } });

    await trackExternalEventAsMeeting(input);

    const where = p.user!.findMany.mock.calls[0][0].where as {
      OR: [{ daliEmail: { in: string[] } }, { dartmouthEmail: { in: string[] } }];
    };
    expect(where.OR[0].daliEmail.in).toEqual(["ally@dali.dartmouth.edu", "outsider@example.com"]);
  });

  it("returns the existing meeting without re-adding it when the actor is already its organizer", async () => {
    const p = arrange();
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-existing",
      organizerId: "core-1",
      participantUserIds: [],
    }]);

    const res = await trackExternalEventAsMeeting(input);

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-existing" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
    expect(p.scheduledMeeting!.update).not.toHaveBeenCalled();
  });

  it("returns the existing meeting without re-adding it when the actor is already a participant", async () => {
    const p = arrange();
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: ["core-1"],
    }]);

    const res = await trackExternalEventAsMeeting(input);

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-existing" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
    expect(p.scheduledMeeting!.update).not.toHaveBeenCalled();
  });

  it("joins the actor to an already-tracked event's roster when Google says they're on it", async () => {
    const p = arrange({ event: { viewerInvited: true } });
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    }]);
    p.scheduledMeeting!.update.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: ["core-1"],
      selectedAt: new Date("2026-09-15T18:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    p.meetingAttendance!.findFirst.mockResolvedValue({ id: "att-1" });

    const res = await trackExternalEventAsMeeting(input);

    expect(p.scheduledMeeting!.update).toHaveBeenCalledWith({
      where: { id: "m-existing" },
      data: { participantUserIds: { push: "core-1" } },
    });
    expect(syncMeetingShares).toHaveBeenCalledWith("m-existing");
    expect(p.meetingAttendance!.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            scheduledMeetingId: "m-existing",
            occurrenceStart: new Date("2026-09-15T18:00:00.000Z"),
            userId: "core-1",
          }),
        ]),
      }),
    );
    expect(res).toEqual({ ok: true, meeting: { id: "m-existing" } });
  });

  it("joins the actor to the roster without seeding attendance when the meeting has none yet", async () => {
    const p = arrange({ event: { viewerInvited: true } });
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    }]);
    p.scheduledMeeting!.update.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: ["core-1"],
      selectedAt: new Date("2026-09-15T18:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    p.meetingAttendance!.findFirst.mockResolvedValue(null);

    const res = await trackExternalEventAsMeeting(input);

    expect(p.meetingAttendance!.createMany).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, meeting: { id: "m-existing" } });
  });

  it("refuses an event that is already tracked when the actor isn't on it and it isn't lab-wide", async () => {
    const p = arrange({ general: false, event: { viewerInvited: false } });
    p.scheduledMeeting!.findMany.mockResolvedValue([{
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    }]);

    expect(await trackExternalEventAsMeeting(input)).toEqual({
      ok: false,
      error: "This event is already tracked in DALI",
      status: 409,
    });
    expect(p.scheduledMeeting!.update).not.toHaveBeenCalled();
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

describe("createScheduledMeeting — filing the first note through a notebook choice", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
    page: { findUnique: ReturnType<typeof vi.fn> };
  };
  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Weekly check-in",
    durationMinutes: 60,
    scope: { type: "None" } as const,
    startTime: "2026-09-10T15:00:00.000Z",
    createNote: true,
  };
  const recorded = () => mockPage.scheduledMeeting.create.mock.calls[0]![0].data;

  beforeEach(() => {
    mockPage.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    mockPage.meetingAttendance.createMany.mockResolvedValue({});
    vi.mocked(loadEditableNotebook).mockResolvedValue({ id: "nb-9", title: "Weekly", templatePageId: null } as never);
    vi.mocked(createNotebook).mockResolvedValue({ id: "nb-new" });
  });

  it("files into an existing notebook, makes it the series default, and skips the type-keyed notebook", async () => {
    const res = await createScheduledMeeting({ ...base, notebook: { existingId: "nb-9" } });

    expect(res).toMatchObject({ ok: true, notePageId: "page-tab", notebookId: "nb-9", createdNotebook: false });
    expect(loadEditableNotebook).toHaveBeenCalledWith("nb-9", "org-1");
    expect(recorded()).toMatchObject({ notebookId: "nb-9", meetingType: "Other", meetingTypeLabel: "Weekly", projectId: null });
    expect(syncMeetingShares).toHaveBeenCalledWith("m1", undefined);
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-9", meetingNoteId: "m1" }));
    expect(ensureMeetingNotebook).not.toHaveBeenCalled();
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("records a project meeting as Team with the project", async () => {
    await createScheduledMeeting({ ...base, projectId: "proj-7", notebook: { existingId: "nb-9" } });

    expect(recorded()).toMatchObject({ meetingType: "Team", meetingTypeLabel: null, projectId: "proj-7", notebookId: "nb-9" });
  });

  it("creates a new notebook at the space's folder with its template and reports it as created", async () => {
    mockPage.page.findUnique.mockResolvedValue({ id: "tpl-1", isTemplate: true, archivedAt: null });

    const res = await createScheduledMeeting({
      ...base,
      notebook: { title: "Standup", templatePageId: "tpl-1" },
    });

    expect(createNotebook).toHaveBeenCalledWith({
      title: "Standup",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "folder-lab-notes",
      templatePageId: "tpl-1",
      actorId: "org-1",
    });
    expect(res).toMatchObject({ ok: true, notebookId: "nb-new", createdNotebook: true });
    expect(recorded()).toMatchObject({ notebookId: "nb-new", meetingType: "Other", meetingTypeLabel: "Standup" });
    expect(copyPageBody).toHaveBeenCalledWith("tpl-1", "page-tab");
  });

  it("puts a new notebook in the lab's Meeting assets folder", async () => {
    await createScheduledMeeting({ ...base, notebook: { title: "Standup" } });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-lab-notes" }));
  });

  it("puts a Core meeting's new notebook in Core's folder by default", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: true, notebook: { title: "Core sync" } });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-core" }));
  });

  it("puts a project meeting's new notebook in the project", async () => {
    await createScheduledMeeting({ ...base, projectId: "proj-7", notebook: { title: "Team sync" } });

    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "folder-project" }),
    );
  });

  it("never moves or links an existing notebook", async () => {
    await createScheduledMeeting({ ...base, notebook: { existingId: "nb-9" } });

    expect(movePage).not.toHaveBeenCalled();
  });

  it("answers without declined links or moves", async () => {
    const res = await createScheduledMeeting({ ...base, notebook: { title: "Standup" } });

    expect(res).not.toHaveProperty("declinedLinks");
    expect(res).not.toHaveProperty("declinedMove");
  });

  it("refuses without creating the meeting when the notebook can't be used", async () => {
    vi.mocked(loadEditableNotebook).mockRejectedValue(new NotebookError("You can't edit this notebook", 403));

    const res = await createScheduledMeeting({ ...base, notebook: { existingId: "nb-9" } });

    expect(res).toEqual({ ok: false, error: "You can't edit this notebook" });
    expect(mockPage.scheduledMeeting.create).not.toHaveBeenCalled();
  });

  it("still derives a type for a whiteboard-only meeting that names no notebook", async () => {
    const res = await createScheduledMeeting({ ...base, createNote: false, createWhiteboard: true, projectId: "proj-7" });

    expect(res).toMatchObject({ ok: true, notePageId: null });
    expect(recorded()).toMatchObject({ meetingType: "Team", projectId: "proj-7", notebookId: null });
  });
});
