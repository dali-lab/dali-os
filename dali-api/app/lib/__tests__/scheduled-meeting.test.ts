import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/pages", () => ({
  createProjectPage: vi.fn(async () => ({ id: "page-project" })),
  createLabMeetingPage: vi.fn(async () => ({ id: "page-lab" })),
  createMeetingNotebook: vi.fn(async () => ({ id: "notebook-1" })),
  createNotebookTab: vi.fn(async () => ({ id: "page-tab" })),
  moveIntoNotebook: vi.fn(),
}));
vi.mock("~/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn(),
  projectSlot: (projectId: string) => ({ processType: "Project", processId: projectId, folderType: "Meetings" }),
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: processType.toLowerCase(), folderType }),
}));
vi.mock("~/lib/shortcuts.server", () => {
  class ShortcutError extends Error {}
  return { createShortcut: vi.fn(), ShortcutError };
});
vi.mock("~/lib/terms", () => ({ termWindows: vi.fn(async () => []) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(async () => false) }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn(async () => []) }));
vi.mock("~/lib/general-calendar", () => ({ isGeneralCalendarEvent: vi.fn(() => true) }));
vi.mock("~/lib/google-calendar", () => ({
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
}));
vi.mock("~/lib/page-copy.server", () => ({ copyPageBody: vi.fn() }));
vi.mock("~/lib/notebooks.server", () => {
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
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn(async () => []) }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn(() => "") }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { isCore } from "~/lib/roles";
import { resolveFilingFolder } from "~/lib/drive-receivers.server";
import { resolveGroupMembers } from "~/lib/groups";
import { createShortcut, ShortcutError } from "~/lib/shortcuts.server";
import {
  createProjectPage,
  createLabMeetingPage,
  createMeetingNotebook,
  createNotebookTab,
  moveIntoNotebook,
} from "~/lib/pages";
import {
  createGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  getGoogleEvent,
  deleteGoogleCalendarEvent,
} from "~/lib/google-calendar";
import { copyPageBody } from "~/lib/page-copy.server";
import { NotebookError, createNotebook, loadEditableNotebook } from "~/lib/notebooks.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { hashTemplateText, normalizeTemplateText } from "~/lib/meeting-note-template";
import {
  attachMeetingNote,
  cancelScheduledMeeting,
  createScheduledMeeting,
  isWithinCheckInWindow,
  markMeetingAttendance,
  meetingIsUpcoming,
  resolveMeetingNoteTemplate,
  setMeetingProject,
  trackExternalEventAsMeeting,
  tracksAttendance,
  updateScheduledMeeting,
  folderOfNote,
} from "~/lib/scheduled-meeting";
import { isGeneralCalendarEvent } from "~/lib/general-calendar";

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
  vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: null, viaReceiver: false });
  vi.mocked(prisma.scheduledMeeting.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.scheduledMeeting.findUniqueOrThrow).mockResolvedValue({
    title: "Sync",
    isCoreMeeting: false,
    scopeType: "UserList",
    scopeId: null,
    organizerId: "org-1",
    participantUserIds: ["u2"],
    guestEmails: [],
    notebookId: null,
    notebook: null,
  } as never);
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

describe("createScheduledMeeting — the series notebook", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: {
      create: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const labPage = createLabMeetingPage as unknown as ReturnType<typeof vi.fn>;
  const projectPage = createProjectPage as unknown as ReturnType<typeof vi.fn>;
  const create = createMeetingNotebook as unknown as ReturnType<typeof vi.fn>;

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
  const series = (notebook: Record<string, unknown> | null, notebookId: string | null = "nb-series") => ({
    title: "Sync",
    isCoreMeeting: false,
    scopeType: "UserList",
    scopeId: null,
    organizerId: "org-1",
    participantUserIds: ["u2"],
    guestEmails: [],
    notebookId: notebook ? notebookId : null,
    notebook,
  });

  beforeEach(() => {
    mockPage.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    mockPage.meetingAttendance.createMany.mockResolvedValue({});
  });

  it("creates a notebook and makes it the series notebook when the series has none", async () => {
    const res = await createScheduledMeeting({ ...base, isCoreMeeting: true });

    expect(res).toMatchObject({ ok: true, notePageId: "page-tab", notebookId: "notebook-1", createdNotebook: true });
    expect(mockPage.scheduledMeeting.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", notebookId: null },
      data: { notebookId: "notebook-1" },
    });
    expect(createNotebookTab).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "notebook-1", meetingNoteId: "m1" }),
    );
  });

  it("writes no notebookKey on the notebook it creates", async () => {
    await createScheduledMeeting({ ...base, isCoreMeeting: true });

    expect(create.mock.calls[0]![0]).not.toHaveProperty("key");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("notebookKey");
  });

  it("titles a Team project notebook by kind and a general one by its meeting label", async () => {
    await createScheduledMeeting({ ...base, meetingType: "Team", meetingTypeLabel: null, projectId: "proj-7" });
    expect(create.mock.calls[0]![0]).toMatchObject({ title: "Team meeting note" });

    create.mockClear();
    await createScheduledMeeting({ ...base });
    expect(create.mock.calls[0]![0]).toMatchObject({ title: "Core meeting notes" });
  });

  it("files into the series' notebook without creating another", async () => {
    mockPage.scheduledMeeting.findUniqueOrThrow.mockResolvedValue(
      series({ archivedAt: null, workspaceType: "Lab", workspaceId: null }),
    );

    const res = await createScheduledMeeting({ ...base });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-series", createdNotebook: false });
    expect(create).not.toHaveBeenCalled();
    expect(mockPage.scheduledMeeting.updateMany).not.toHaveBeenCalled();
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-series" }));
  });

  it("replaces a series notebook that is in the trash and repoints the series at the new one", async () => {
    mockPage.scheduledMeeting.findUniqueOrThrow.mockResolvedValue(
      series({ archivedAt: new Date(), workspaceType: "Lab", workspaceId: null }),
    );

    const res = await createScheduledMeeting({ ...base });

    expect(res).toMatchObject({ ok: true, notebookId: "notebook-1", createdNotebook: true });
    expect(mockPage.scheduledMeeting.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", notebookId: "nb-series" },
      data: { notebookId: "notebook-1" },
    });
  });

  it("replaces a series notebook that sits in another workspace than where the note files", async () => {
    mockPage.scheduledMeeting.findUniqueOrThrow.mockResolvedValue(
      series({ archivedAt: null, workspaceType: "Project", workspaceId: "proj-other" }),
    );

    const res = await createScheduledMeeting({ ...base });

    expect(res).toMatchObject({ ok: true, notebookId: "notebook-1", createdNotebook: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab" }));
  });

  it("uses the notebook another request just attached and discards the empty one it made", async () => {
    mockPage.scheduledMeeting.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPage.scheduledMeeting.findUniqueOrThrow
      .mockResolvedValueOnce(series(null))
      .mockResolvedValueOnce({ notebookId: "nb-winner" });
    const del = vi.mocked(prisma.page.delete);

    const res = await createScheduledMeeting({ ...base });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-winner", createdNotebook: false });
    expect(del).toHaveBeenCalledWith({ where: { id: "notebook-1" } });
  });

  it("reports no notebook when the meeting keeps no note", async () => {
    const res = await createScheduledMeeting({ ...base, meetingType: undefined, meetingTypeLabel: undefined });
    expect(res).toMatchObject({ ok: true, notePageId: null, notebookId: null, createdNotebook: false });
  });

  it("files a Core meeting that is also about a project in the project, not Core", async () => {
    vi.mocked(resolveFilingFolder).mockImplementation(async (slot) =>
      slot.processType === "Project"
        ? { folderId: "project-recv", viaReceiver: true }
        : { folderId: "core-meetings", viaReceiver: true },
    );

    await createScheduledMeeting({
      ...base,
      isCoreMeeting: true,
      meetingType: "Team",
      meetingTypeLabel: null,
      projectId: "proj-7",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "project-recv" }),
    );
    expect(projectPage).not.toHaveBeenCalled();
    expect(labPage).not.toHaveBeenCalled();
  });
});

describe("createScheduledMeeting — where a note is filed", () => {
  const mockPage = prisma as unknown as {
    scheduledMeeting: { create: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const notebook = createMeetingNotebook as unknown as ReturnType<typeof vi.fn>;
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

  describe("a Core meeting held for a project", () => {
    const coreProject = { ...base, isCoreMeeting: true, meetingType: "Team" as const, meetingTypeLabel: null, projectId: "proj-7" };
    const page = prisma as unknown as { page: { count: ReturnType<typeof vi.fn> } };

    beforeEach(() => {
      resolve.mockImplementation(async (slot: { processType: string }) =>
        slot.processType === "Core"
          ? { folderId: "core-meetings", viaReceiver: true }
          : { folderId: "recv-1", viaReceiver: true },
      );
      page.page.count.mockResolvedValue(0);
      vi.mocked(createShortcut).mockReset();
    });

    it("puts one shortcut to the new notebook in Core's Meetings receiver, as the note author", async () => {
      await createScheduledMeeting(coreProject);

      expect(resolve).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" }, "org-1");
      expect(createShortcut).toHaveBeenCalledTimes(1);
      expect(createShortcut).toHaveBeenCalledWith({
        targetPageId: "notebook-1",
        dest: { workspaceType: "Lab", workspaceId: null, parentPageId: "core-meetings" },
        actorId: "org-1",
      });
    });

    it("falls back to the Core root when there is no Meetings receiver", async () => {
      resolve.mockImplementation(async (slot: { processType: string }) =>
        slot.processType === "Core" ? { folderId: "core-root", viaReceiver: false } : { folderId: "recv-1", viaReceiver: true },
      );

      await createScheduledMeeting(coreProject);

      expect(createShortcut).toHaveBeenCalledWith(
        expect.objectContaining({ dest: { workspaceType: "Lab", workspaceId: null, parentPageId: "core-root" } }),
      );
    });

    it("does nothing for a later note in a notebook that already has tabs", async () => {
      page.page.count.mockResolvedValue(1);

      await createScheduledMeeting(coreProject);

      expect(createShortcut).not.toHaveBeenCalled();
    });

    it("does nothing for a project meeting that is not a Core meeting", async () => {
      await createScheduledMeeting({ ...coreProject, isCoreMeeting: false });

      expect(createShortcut).not.toHaveBeenCalled();
    });

    it("still files the note when the author can't edit Core's folder", async () => {
      vi.mocked(createShortcut).mockRejectedValue(new ShortcutError("You can't put things in that folder"));

      await expect(createScheduledMeeting(coreProject)).resolves.toMatchObject({ ok: true });
      expect(createNotebookTab).toHaveBeenCalled();
    });

    it("surfaces an unexpected failure instead of hiding it", async () => {
      vi.mocked(createShortcut).mockRejectedValue(new Error("db down"));

      await expect(createScheduledMeeting(coreProject)).rejects.toThrow("db down");
    });
  });

  it("files a Team meeting to the project's Meetings receiver", async () => {
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

  it("lets a chosen Lab folder win over the Lab receiver and never looks the receiver up", async () => {
    resolve.mockResolvedValue({ folderId: "lab-recv", viaReceiver: true });
    (prisma as unknown as { page: { findUnique: ReturnType<typeof vi.fn> } }).page.findUnique.mockResolvedValue({
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

    expect(notebook).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-chosen" }));
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("setMeetingProject", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn> };
    page: { update: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };

  const baseMeeting = {
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["u2"],
    status: "Confirmed",
    selectedAt: new Date("2026-09-10T15:00:00.000Z"),
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    meetingType: null as string | null,
    notePages: [] as { id: string; kind: string; meetingOccurrenceStart: Date | null }[],
    whiteboardPage: null as { id: string; kind: string } | null,
  };

  beforeEach(() => {
    p.project.findFirst.mockResolvedValue({ id: "proj-7", name: "Cortex" });
    p.scheduledMeeting.update.mockResolvedValue({});
  });

  it("re-files an existing note into the project's Meetings receiver and records the project", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "recv-1", viaReceiver: true });
    p.scheduledMeeting.findUnique.mockResolvedValue({
      ...baseMeeting,
      // Already had a type (a Core note), so no attendance backfill.
      meetingType: "Other",
      notePages: [
        { id: "note-1", kind: "FreeForm", meetingOccurrenceStart: new Date("2026-09-10T15:00:00.000Z") },
      ],
    });

    const res = await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
      meetingTypeLabel: null,
    });

    expect(res.ok).toBe(true);
    expect(resolveFilingFolder).toHaveBeenCalledWith(
      { processType: "Project", processId: "proj-7", folderType: "Meetings" },
      "org-1",
    );
    expect(createMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "recv-1" }),
    );
    expect(moveIntoNotebook).toHaveBeenCalledWith(
      "note-1",
      "notebook-1",
      "Cortex Team meeting note (Sep 10, 2026)",
    );
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: "proj-7", meetingType: "Team" }),
      }),
    );
    expect(p.meetingAttendance.createMany).not.toHaveBeenCalled();
  });

  it("re-files to the project top level when no Meetings receiver is marked", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue({
      ...baseMeeting,
      meetingType: "Other",
      notePages: [
        { id: "note-1", kind: "FreeForm", meetingOccurrenceStart: new Date("2026-09-10T15:00:00.000Z") },
      ],
    });

    await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
      meetingTypeLabel: null,
    });

    expect(createMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: null }),
    );
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
});

describe("tracksAttendance", () => {
  const base = { meetingType: null, notebookId: null, attendanceMode: "None", participantUserIds: [] as string[] };

  it("is false for a typeless meeting with nothing else", () => {
    expect(tracksAttendance(base)).toBe(false);
  });

  it("is true with a type", () => {
    expect(tracksAttendance({ ...base, meetingType: "Other" })).toBe(true);
  });

  it("is true with a notebook and no type", () => {
    expect(tracksAttendance({ ...base, notebookId: "nb-1" })).toBe(true);
  });

  it("is true for self check-in", () => {
    expect(tracksAttendance({ ...base, attendanceMode: "SelfCheckIn" })).toBe(true);
  });

  it("is true with invited people", () => {
    expect(tracksAttendance({ ...base, participantUserIds: ["u1"] })).toBe(true);
  });
});

describe("folderOfNote", () => {
  it("is the folder a note sits in directly", () => {
    expect(folderOfNote({ parentPageId: "folder-a", parent: { kind: "Folder", parentPageId: "elsewhere" } })).toBe("folder-a");
    expect(folderOfNote({ parentPageId: "folder-a" })).toBe("folder-a");
  });

  it("is the notebook's folder for a note that is a tab in a notebook", () => {
    expect(
      folderOfNote({ parentPageId: "notebook-1", parent: { kind: "Notebook", parentPageId: "folder-a" } }),
    ).toBe("folder-a");
  });

  it("is null for a note in a notebook at the workspace root", () => {
    expect(
      folderOfNote({ parentPageId: "notebook-1", parent: { kind: "Notebook", parentPageId: null } }),
    ).toBeNull();
  });

  it("is null for a note at the workspace root", () => {
    expect(folderOfNote({ parentPageId: null, parent: null })).toBeNull();
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
    page: { update: ReturnType<typeof vi.fn> };
  };
  const mockIsCore = isCore as unknown as ReturnType<typeof vi.fn>;

  const meetingRow = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["org-1", "u2"],
    isCoreMeeting: false,
    selectedAt: new Date("2026-09-10T15:00:00Z"),
    createdAt: new Date("2026-09-01T12:00:00Z"),
    durationMinutes: 60,
    recurrenceRule: null,
    externalEventId: null,
    status: "Confirmed",
    meetingType: null,
    meetingTypeLabel: null,
    projectId: null,
    notePages: [],
    ...over,
  });

  beforeEach(() => {
    mockIsCore.mockResolvedValue(false);
    p.scheduledMeeting.update.mockResolvedValue({});
    p.meetingAttendance.createMany.mockResolvedValue({ count: 0 });
    // Earlier suites swap this model out for their own stub.
    (prisma as unknown as { meetingException: unknown }).meetingException = {
      findMany: vi.fn().mockResolvedValue([]),
    };
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

  it("reports a notebook it created so the filing toast can undo it", async () => {
    (createMeetingNotebook as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "notebook-new",
    });
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    vi.mocked(prisma.page.findUnique).mockResolvedValue({
      kind: "Folder",
      archivedAt: null,
      workspaceType: "Lab",
      workspaceId: null,
    } as never);
    mockIsCore.mockResolvedValue(true);

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });

    expect(res).toMatchObject({ ok: true, notebookId: "notebook-new", createdNotebook: true });
  });

  it("hands back the note an occurrence already has instead of making another", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        meetingType: "Other",
        notePages: [
          {
            id: "page-x",
            meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: null,
          },
        ],
      }),
    );

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2" });

    expect(res).toEqual({ ok: true, notePageId: "page-x", notebookId: null, createdNotebook: false });
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("gives a later occurrence of a recurring meeting its own note, filed beside the first", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        recurrenceRule: "FREQ=WEEKLY",
        meetingType: "Other",
        meetingTypeLabel: "Standup",
        notebookId: "nb-series",
        notebook: { id: "nb-series", title: "Standup notes", kind: "Notebook", archivedAt: null, templatePageId: null },
        notePages: [
          {
            id: "page-week-1",
            meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: "folder-standups",
          },
        ],
      }),
    );
    vi.mocked(prisma.page.findUnique).mockResolvedValue({
      kind: "Folder",
      archivedAt: null,
      workspaceType: "Lab",
      workspaceId: null,
    } as never);

    // A plain participant (not organizer/Core) opening week 3.
    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "u2",
      occurrence: new Date("2026-09-24T15:00:00Z"),
    });

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "nb-series",
      createdNotebook: false,
      seriesNotebookId: "nb-series",
    });
    expect(createNotebookTab).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId: "nb-series",
        meetingNoteId: "m1",
        meetingOccurrenceStart: new Date("2026-09-24T15:00:00Z"),
      }),
    );
    // The meeting already knew its type; nothing to record.
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", occurrenceStart: new Date("2026-09-24T15:00:00Z"), userId: "org-1" },
        { scheduledMeetingId: "m1", occurrenceStart: new Date("2026-09-24T15:00:00Z"), userId: "u2" },
      ],
      skipDuplicates: true,
    });
  });

  it("files a replacement notebook in the folder the earlier notes' notebook sat in, not under the notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        recurrenceRule: "FREQ=WEEKLY",
        meetingType: "Other",
        meetingTypeLabel: "Standup",
        notePages: [
          {
            id: "page-week-1",
            meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: "notebook-old",
            parent: { kind: "Notebook", parentPageId: "folder-standups" },
          },
        ],
      }),
    );
    vi.mocked(prisma.page.findUnique).mockImplementation((async (args: { where: { id: string } }) =>
      args.where.id === "folder-standups"
        ? { kind: "Folder", archivedAt: null, workspaceType: "Lab", workspaceId: null }
        : { kind: "FreeForm", archivedAt: null, workspaceType: "Lab", workspaceId: null }) as never);

    await attachMeetingNote({
      meetingId: "m1",
      actorId: "u2",
      occurrence: new Date("2026-09-24T15:00:00Z"),
    });

    expect(createMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-standups" }),
    );
  });

  it("keeps a later occurrence's note to people in the meeting", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        recurrenceRule: "FREQ=WEEKLY",
        meetingType: "Other",
        notePages: [
          {
            id: "page-week-1",
            meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: null,
          },
        ],
      }),
    );

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "intruder",
      occurrence: new Date("2026-09-24T15:00:00Z"),
    });

    expect(res).toEqual({ ok: false, error: "Only people in this meeting can add its notes", status: 403 });
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

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "notebook-1",
      createdNotebook: true,
      seriesNotebookId: null,
    });
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { meetingType: "Other", meetingTypeLabel: "All-hands", projectId: null },
    });
    const occurrenceStart = new Date("2026-09-10T15:00:00Z");
    expect(p.meetingAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { scheduledMeetingId: "m1", occurrenceStart, userId: "org-1" },
        { scheduledMeetingId: "m1", occurrenceStart, userId: "u2" },
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

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "notebook-1",
      createdNotebook: true,
      seriesNotebookId: null,
    });
    expect(p.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { meetingType: "Team", meetingTypeLabel: null, projectId: "proj-9" },
    });
  });

  it("seeds the new note from the project's bound template and records the hash", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ participantUserIds: ["org-1"] }));
    p.project.findFirst.mockResolvedValue({ id: "proj-9" });
    p.project.findUnique.mockResolvedValue({ name: "Deserto", meetingNoteTemplateId: "tpl-1" });
    vi.mocked(prisma.page.findUnique).mockResolvedValue({
      id: "tpl-1",
      isTemplate: true,
      archivedAt: null,
    } as never);
    vi.mocked(blocksToPlainText).mockReturnValue("## Agenda\n\n## Notes");

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      meetingType: "Team",
      projectId: "proj-9",
    });

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "notebook-1",
      createdNotebook: true,
      seriesNotebookId: null,
    });
    expect(copyPageBody).toHaveBeenCalledWith("tpl-1", "page-tab");
    expect(p.page.update).toHaveBeenCalledWith({
      where: { id: "page-tab" },
      data: {
        seededFromPageId: "tpl-1",
        seededTemplateHash: hashTemplateText(normalizeTemplateText("## Agenda\n\n## Notes")),
      },
    });
  });

  it("leaves a new note unseeded when no template resolves", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    vi.mocked(prisma.page.findFirst).mockResolvedValue(null);

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      meetingType: "Other",
      meetingTypeLabel: "Standup",
    });

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "notebook-1",
      createdNotebook: true,
      seriesNotebookId: null,
    });
    expect(copyPageBody).not.toHaveBeenCalled();
    expect(p.page.update).not.toHaveBeenCalled();
  });
});

describe("resolveMeetingNoteTemplate", () => {
  const pr = prisma as unknown as {
    project: { findUnique: ReturnType<typeof vi.fn> };
    page: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  };

  it("prefers the project's bound template over the lab default", async () => {
    pr.project.findUnique.mockResolvedValue({ meetingNoteTemplateId: "tpl-project" });
    pr.page.findUnique.mockResolvedValue({ id: "tpl-project", isTemplate: true, archivedAt: null });
    pr.page.findFirst.mockResolvedValue({ id: "tpl-lab-default" });

    const result = await resolveMeetingNoteTemplate("proj-1", "Team");

    expect(result).toEqual({ id: "tpl-project" });
    expect(pr.page.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the lab default when the project has no binding", async () => {
    pr.project.findUnique.mockResolvedValue({ meetingNoteTemplateId: null });
    pr.page.findFirst.mockResolvedValue({ id: "tpl-lab-default" });

    const result = await resolveMeetingNoteTemplate("proj-1", "Team");

    expect(result).toEqual({ id: "tpl-lab-default" });
  });

  it("ignores a bound page that is no longer marked as a template", async () => {
    pr.project.findUnique.mockResolvedValue({ meetingNoteTemplateId: "tpl-project" });
    pr.page.findUnique.mockResolvedValue({ id: "tpl-project", isTemplate: false, archivedAt: null });
    pr.page.findFirst.mockResolvedValue({ id: "tpl-lab-default" });

    const result = await resolveMeetingNoteTemplate("proj-1", "Team");

    expect(result).toEqual({ id: "tpl-lab-default" });
  });

  it("ignores a bound page that has been archived", async () => {
    pr.project.findUnique.mockResolvedValue({ meetingNoteTemplateId: "tpl-project" });
    pr.page.findUnique.mockResolvedValue({ id: "tpl-project", isTemplate: true, archivedAt: new Date() });
    pr.page.findFirst.mockResolvedValue({ id: "tpl-lab-default" });

    const result = await resolveMeetingNoteTemplate("proj-1", "Team");

    expect(result).toEqual({ id: "tpl-lab-default" });
  });

  it("returns none and skips the project lookup for a project-less meeting", async () => {
    pr.page.findFirst.mockResolvedValue(null);

    const result = await resolveMeetingNoteTemplate(null, "Other");

    expect(result).toBeNull();
    expect(pr.project.findUnique).not.toHaveBeenCalled();
  });
});

// The lab's general calendar is authored in Google, so its events arrive with
// no ScheduledMeeting behind them — and therefore no note and no attendance.
// Tracking one creates that missing row without re-pushing the event to Google
// or re-inviting people Google already invited.
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
    p.scheduledMeeting!.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "core-1",
      participantUserIds: [],
    });

    const res = await trackExternalEventAsMeeting(input);

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-existing" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
    expect(p.scheduledMeeting!.update).not.toHaveBeenCalled();
  });

  it("returns the existing meeting without re-adding it when the actor is already a participant", async () => {
    const p = arrange();
    p.scheduledMeeting!.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: ["core-1"],
    });

    const res = await trackExternalEventAsMeeting(input);

    expect(res).toMatchObject({ ok: true, meeting: { id: "m-existing" } });
    expect(p.scheduledMeeting!.create).not.toHaveBeenCalled();
    expect(p.scheduledMeeting!.update).not.toHaveBeenCalled();
  });

  it("joins the actor to an already-tracked event's roster when Google says they're on it", async () => {
    const p = arrange({ event: { viewerInvited: true } });
    p.scheduledMeeting!.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    });
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
    p.scheduledMeeting!.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    });
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
    p.scheduledMeeting!.findFirst.mockResolvedValue({
      id: "m-existing",
      organizerId: "someone-else",
      participantUserIds: [],
    });

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

describe("markMeetingAttendance", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
    meetingAttendance: { findFirst: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    timeEntry: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    p.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      projectId: "proj-1",
      organizerId: "org-1",
      participantUserIds: ["u2"],
      durationMinutes: 60,
      selectedAt: new Date("2026-09-10T15:00:00Z"),
      createdAt: new Date("2026-09-01T12:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY",
      externalEventId: null,
    });
    p.meetingAttendance.upsert.mockResolvedValue({});
    p.timeEntry.upsert.mockResolvedValue({});
    (prisma as unknown as { meetingException: unknown }).meetingException = {
      findMany: vi.fn().mockResolvedValue([]),
    };
  });

  it("marks one week of a recurring meeting and logs that week's hours", async () => {
    const week3 = new Date("2026-09-24T15:00:00Z");
    const res = await markMeetingAttendance("m1", "u2", true, "org-1", week3);

    expect(res).toEqual({ ok: true });
    const key = { scheduledMeetingId: "m1", occurrenceStart: week3, userId: "u2" };
    expect(p.meetingAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scheduledMeetingId_occurrenceStart_userId: key } }),
    );
    expect(p.timeEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduledMeetingId_occurrenceStart_userId: key },
        create: expect.objectContaining({
          ...key,
          source: "Meeting",
          date: week3,
          startTime: week3,
          endTime: new Date("2026-09-24T16:00:00Z"),
          hours: 1,
        }),
      }),
    );
  });

  it("clears only that week's hours when marked absent", async () => {
    const week2 = new Date("2026-09-17T15:00:00Z");
    await markMeetingAttendance("m1", "u2", false, "org-1", week2);

    expect(p.timeEntry.deleteMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", occurrenceStart: week2, userId: "u2" },
    });
  });

  it("refuses someone who isn't on the roster", async () => {
    p.meetingAttendance.findFirst.mockResolvedValue(null);
    const res = await markMeetingAttendance("m1", "stranger", true, "org-1");
    expect(res).toEqual({ ok: false, error: "User was not invited to this meeting", status: 400 });
    expect(p.meetingAttendance.upsert).not.toHaveBeenCalled();
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
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-9", meetingNoteId: "m1" }));
    expect(createMeetingNotebook).not.toHaveBeenCalled();
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("records a project meeting as Team with the project", async () => {
    await createScheduledMeeting({ ...base, projectId: "proj-7", notebook: { existingId: "nb-9" } });

    expect(recorded()).toMatchObject({ meetingType: "Team", meetingTypeLabel: null, projectId: "proj-7", notebookId: "nb-9" });
  });

  it("creates a new notebook at the chosen folder with its template and reports it as created", async () => {
    mockPage.page.findUnique.mockResolvedValue({ id: "tpl-1", isTemplate: true, archivedAt: null });

    const res = await createScheduledMeeting({
      ...base,
      notebook: {
        title: "Standup",
        location: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder-9" },
        templatePageId: "tpl-1",
      },
    });

    expect(createNotebook).toHaveBeenCalledWith({
      title: "Standup",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "folder-9",
      templatePageId: "tpl-1",
      actorId: "org-1",
    });
    expect(res).toMatchObject({ ok: true, notebookId: "nb-new", createdNotebook: true });
    expect(recorded()).toMatchObject({ notebookId: "nb-new", meetingType: "Other", meetingTypeLabel: "Standup" });
    expect(copyPageBody).toHaveBeenCalledWith("tpl-1", "page-tab");
  });

  it("puts a new notebook in the lab's Meetings receiver when no location is chosen", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-lab-notes", viaReceiver: true });

    await createScheduledMeeting({ ...base, notebook: { title: "Standup" } });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-lab-notes" }));
  });

  it("treats the Lab-wide top level as the default location too", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-lab-notes", viaReceiver: true });

    await createScheduledMeeting({
      ...base,
      notebook: { title: "Standup", location: { workspaceType: "Lab", workspaceId: null, parentPageId: null } },
    });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-lab-notes" }));
  });

  it("puts a Core meeting's new notebook in Core's Meetings receiver by default", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-core", viaReceiver: true });

    await createScheduledMeeting({ ...base, isCoreMeeting: true, notebook: { title: "Core sync" } });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-core" }));
  });

  it("puts a project meeting's new notebook in the project", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "folder-project", viaReceiver: true });

    await createScheduledMeeting({ ...base, projectId: "proj-7", notebook: { title: "Team sync" } });

    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "folder-project" }),
    );
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

describe("attachMeetingNote — notebooks", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
  };
  const series = { id: "nb-s", title: "Weekly", kind: "Notebook", archivedAt: null, templatePageId: null };
  const meetingRow = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["org-1", "u2"],
    isCoreMeeting: false,
    selectedAt: new Date("2026-09-10T15:00:00Z"),
    createdAt: new Date("2026-09-01T12:00:00Z"),
    durationMinutes: 60,
    recurrenceRule: null,
    externalEventId: null,
    status: "Confirmed",
    meetingType: null,
    meetingTypeLabel: null,
    projectId: null,
    notebookId: null,
    notebook: null,
    notePages: [],
    ...over,
  });

  beforeEach(() => {
    vi.mocked(isCore).mockResolvedValue(false);
    p.scheduledMeeting.update.mockResolvedValue({});
    p.meetingAttendance.createMany.mockResolvedValue({ count: 0 });
    vi.mocked(loadEditableNotebook).mockResolvedValue({ id: "nb-x", title: "Other notebook", templatePageId: null } as never);
    vi.mocked(createNotebook).mockResolvedValue({ id: "nb-new" });
  });

  it("files a one-tap note into the series' notebook with no type given, and leaves the default alone", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb-s", notebook: series }));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1" });

    expect(res).toEqual({
      ok: true,
      notePageId: "page-tab",
      notebookId: "nb-s",
      createdNotebook: false,
      seriesNotebookId: "nb-s",
    });
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-s" }));
    expect(createMeetingNotebook).not.toHaveBeenCalled();
    const data = p.scheduledMeeting.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ meetingType: "Other", meetingTypeLabel: "Weekly" });
    expect(data).not.toHaveProperty("notebookId");
  });

  it("lets a participant take a later occurrence's note into the series' notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        recurrenceRule: "FREQ=WEEKLY",
        meetingType: "Other",
        notebookId: "nb-s",
        notebook: series,
        notePages: [
          {
            id: "page-week-1",
            meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: "nb-s",
            parent: { kind: "Notebook", parentPageId: "folder-1" },
          },
        ],
      }),
    );
    (prisma as unknown as { meetingException: unknown }).meetingException = { findMany: vi.fn().mockResolvedValue([]) };

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2", occurrence: new Date("2026-09-17T15:00:00Z") });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-s" });
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-s" }));
  });

  it("makes a chosen notebook the series default when the series has none", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { existingId: "nb-x" } });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-x", createdNotebook: false, seriesNotebookId: "nb-x" });
    expect(p.scheduledMeeting.update.mock.calls[0]![0].data).toMatchObject({
      notebookId: "nb-x",
      meetingType: "Other",
      meetingTypeLabel: "Other notebook",
    });
  });

  it("keeps the series' existing default when a different notebook is chosen, and reports both", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ meetingType: "Other", notebookId: "nb-s", notebook: series }));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { existingId: "nb-x" } });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-x", seriesNotebookId: "nb-s" });
    expect(p.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("creates a new notebook from the choice and reports it created", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({
      meetingId: "m1",
      actorId: "org-1",
      projectId: null,
      notebook: { title: "Retro", location: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder-9" } },
    });

    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Retro", workspaceType: "Lab", parentPageId: "folder-9", actorId: "org-1" }),
    );
    expect(res).toMatchObject({ ok: true, notebookId: "nb-new", createdNotebook: true, seriesNotebookId: "nb-new" });
  });

  it("only lets the organizer or Core name a notebook, even for a meeting that has notes", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({
        meetingType: "Other",
        notePages: [
          {
            id: "page-x",
            meetingOccurrenceStart: new Date("2026-09-03T15:00:00Z"),
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: null,
          },
        ],
      }),
    );

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2", notebook: { existingId: "nb-x" } });

    expect(res).toEqual({ ok: false, error: "Only the organizer or Core can add notes", status: 403 });
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("passes a notebook the actor can't edit back as its own error", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    vi.mocked(loadEditableNotebook).mockRejectedValue(new NotebookError("You can't edit this notebook", 403));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { existingId: "nb-x" } });

    expect(res).toEqual({ ok: false, error: "You can't edit this notebook", status: 403 });
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("ignores a series notebook that has been trashed and asks for a type again", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({ notebookId: "nb-s", notebook: { ...series, archivedAt: new Date() } }),
    );

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1" });

    expect(res).toEqual({ ok: false, error: "Choose what this meeting is about", status: 400 });
  });

  it("seeds the new note from the notebook's own template before the project's", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(
      meetingRow({ notebookId: "nb-s", notebook: { ...series, templatePageId: "tpl-nb" } }),
    );
    vi.mocked(prisma.page.findUnique).mockResolvedValue({ id: "tpl-nb", isTemplate: true, archivedAt: null } as never);

    await attachMeetingNote({ meetingId: "m1", actorId: "org-1" });

    expect(copyPageBody).toHaveBeenCalledWith("tpl-nb", "page-tab");
  });
});
