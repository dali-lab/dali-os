import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/calendar/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn() }));
vi.mock("~/lib/pages.server", () => ({
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
vi.mock("~/lib/groups.server", () => ({ resolveGroupMembers: vi.fn(async () => []) }));
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
import { resolveGroupMembers } from "~/lib/groups.server";
import {
  createProjectPage,
  createLabMeetingPage,
  ensureMeetingNotebook,
  createNotebookTab,
  moveIntoNotebook,
  trashNotebookIfAbandoned,
} from "~/lib/pages.server";
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
import { hashTemplateText, normalizeTemplateText } from "~/calendar/lib/meeting-note-template";
import { createScheduledMeeting } from "~/calendar/lib/scheduled-meeting.server";
import {
  attachMeetingNote,
  attachMeetingWhiteboard,
  resolveMeetingNoteTemplate,
  setMeetingProject,
} from "~/calendar/lib/meeting-artifacts.server";
import { isGeneralCalendarEvent } from "~/calendar/lib/general-calendar";

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

  it("re-files into the project's Meetings receiver", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "recv-1", viaReceiver: true });
    p.scheduledMeeting.findUnique.mockResolvedValue({
      ...baseMeeting,
      meetingType: "Other",
      notePages: [{ id: "note-1", kind: "FreeForm", meetingOccurrenceStart: new Date("2026-09-10T15:00:00.000Z") }],
    });

    await setMeetingProject({
      meetingId: "m1",
      actorId: "org-1",
      projectId: "proj-7",
      meetingType: "Team",
      meetingTypeLabel: null,
    });

    expect(ensureMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Project", workspaceId: "proj-7", parentPageId: "recv-1" }),
    );
  });

  it("re-files an existing note into the project folder and records the project", async () => {
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
    // The note moves to the project's Team notebook, which lives in that folder.
    expect(ensureMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "project:proj-7:Team:none",
        workspaceType: "Project",
        workspaceId: "proj-7",
        parentPageId: "folder-project",
      }),
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

  describe("notebook pointer and trashed notes", () => {
    const refile = (over: Record<string, unknown> = {}) => {
      p.scheduledMeeting.findUnique.mockResolvedValue({
        ...baseMeeting,
        meetingType: "Other",
        notebookId: "old-nb",
        notePages: [
          { id: "note-new", kind: "FreeForm", meetingOccurrenceStart: new Date("2026-09-17T15:00:00.000Z") },
          { id: "note-old", kind: "FreeForm", meetingOccurrenceStart: new Date("2026-09-10T15:00:00.000Z") },
        ],
        ...over,
      });
      return setMeetingProject({
        meetingId: "m1",
        actorId: "org-1",
        projectId: "proj-7",
        meetingType: "Team",
        meetingTypeLabel: null,
      });
    };

    it("only refiles live notes", async () => {
      await refile();

      const query = p.scheduledMeeting.findUnique.mock.calls[0][0];
      expect(query.select.notePages.where).toEqual({ archivedAt: null });
      expect(query.select.notePages.orderBy).toEqual({ meetingOccurrenceStart: "desc" });
    });

    it("points the series at the notebook its notes moved into", async () => {
      await refile();

      expect(p.scheduledMeeting.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ notebookId: "notebook-1" }) }),
      );
    });

    it("re-syncs the meeting's shares after the pointer changes", async () => {
      await refile();

      expect(syncMeetingShares).toHaveBeenCalledWith("m1");
    });

    it("trashes the old notebook once nothing points at it, and not when it is the same notebook", async () => {
      await refile();
      expect(trashNotebookIfAbandoned).toHaveBeenCalledWith("old-nb");

      vi.mocked(trashNotebookIfAbandoned).mockClear();
      await refile({ notebookId: "notebook-1" });
      expect(trashNotebookIfAbandoned).not.toHaveBeenCalled();
    });

    it("leaves the pointer alone for a meeting with no live notes", async () => {
      await refile({ notePages: [] });

      const data = p.scheduledMeeting.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("notebookId");
      expect(syncMeetingShares).not.toHaveBeenCalled();
      expect(trashNotebookIfAbandoned).not.toHaveBeenCalled();
    });
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
    (ensureMeetingNotebook as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "notebook-new",
      created: true,
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

  it("reads only live notes and makes a trashed one give up the occurrence's key", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ meetingType: "Other", meetingTypeLabel: "Sync" }));
    vi.mocked(prisma.page.findUnique).mockResolvedValue({
      kind: "Folder",
      archivedAt: null,
      workspaceType: "Lab",
      workspaceId: null,
    } as never);
    mockIsCore.mockResolvedValue(true);

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1" });

    expect(res).toMatchObject({ ok: true, notePageId: "page-tab" });
    expect(p.scheduledMeeting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ notePages: expect.objectContaining({ where: { archivedAt: null } }) }),
      }),
    );
    expect(prisma.page.updateMany).toHaveBeenCalledWith({
      where: {
        meetingNoteId: "m1",
        meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"),
        archivedAt: { not: null },
      },
      data: { meetingNoteId: null },
    });
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
      notebookId: "notebook-1",
      createdNotebook: false,
      seriesNotebookId: null,
    });
    expect(createNotebookTab).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId: "notebook-1",
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

  it("files a replacement notebook at the Lab's meeting folder, not where the earlier notes sat", async () => {
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

    await attachMeetingNote({
      meetingId: "m1",
      actorId: "u2",
      occurrence: new Date("2026-09-24T15:00:00Z"),
    });

    expect(ensureMeetingNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceType: "Lab", parentPageId: "folder-lab-notes" }),
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
      createdNotebook: false,
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
      createdNotebook: false,
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
      createdNotebook: false,
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
      createdNotebook: false,
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
    expect(syncMeetingShares).toHaveBeenCalledWith("m1", undefined);
    expect(ensureMeetingNotebook).not.toHaveBeenCalled();
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

  it("lets a participant add the first note once the series has a notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb-s", notebook: series }));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2" });

    expect(res).toMatchObject({ ok: true, notebookId: "nb-s" });
    expect(createNotebookTab).toHaveBeenCalledWith(expect.objectContaining({ notebookId: "nb-s" }));
  });

  it("keeps the first note on a series with no notebook to the organizer or Core", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2" });

    expect(res).toEqual({ ok: false, error: "Only the organizer or Core can add notes", status: 403 });
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("refuses a participant who picks a different notebook on a series that has one", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb-s", notebook: series }));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "u2", notebook: { existingId: "nb-x" } });

    expect(res).toEqual({ ok: false, error: "Only the organizer or Core can add notes", status: 403 });
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("lets the organizer add the first note on a series that has no notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", meetingType: "Other", meetingTypeLabel: "Sync" });

    expect(res).toMatchObject({ ok: true });
  });

  it("refuses someone outside the meeting even when the series has a notebook", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb-s", notebook: series }));

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "intruder" });

    expect(res).toEqual({ ok: false, error: "Only people in this meeting can add its notes", status: 403 });
    expect(createNotebookTab).not.toHaveBeenCalled();
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
      notebook: { title: "Retro" },
    });

    expect(createNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Retro", workspaceType: "Lab", parentPageId: "folder-lab-notes", actorId: "org-1" }),
    );
    expect(res).toMatchObject({ ok: true, notebookId: "nb-new", createdNotebook: true, seriesNotebookId: "nb-new" });
  });

  it("files a new notebook in the chosen folder", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    findFolder({ id: "f-1", kind: "Folder", archivedAt: null, workspaceType: "Lab", workspaceId: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true });
    vi.mocked(driveFolderCrumbs).mockResolvedValue({ scope: "lab", folders: [] });

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { title: "Retro", folderPageId: "f-1" } });

    expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ title: "Retro", parentPageId: "f-1" }));
    expect(res).toMatchObject({ ok: true, createdNotebook: true });
  });

  it("refuses a folder the actor can't edit with a 403", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    findFolder({ id: "f-1", kind: "Folder", archivedAt: null, workspaceType: "Lab", workspaceId: null });
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: false });

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { title: "Retro", folderPageId: "f-1" } });

    expect(res).toEqual({ ok: false, error: "You can't file in that folder", status: 403 });
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("never moves or links the notebook it files into", async () => {
    p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

    const res = await attachMeetingNote({ meetingId: "m1", actorId: "org-1", notebook: { existingId: "nb-x" } });

    expect(movePage).not.toHaveBeenCalled();
    expect(res).not.toHaveProperty("declinedLinks");
    expect(res).not.toHaveProperty("declinedMove");
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

describe("where a whiteboard is filed", () => {
  const p = prisma as unknown as {
    scheduledMeeting: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    meetingAttendance: { createMany: ReturnType<typeof vi.fn> };
    page: { findUnique: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  };
  const labPage = createLabMeetingPage as unknown as ReturnType<typeof vi.fn>;
  const projectPage = createProjectPage as unknown as ReturnType<typeof vi.fn>;

  const base = {
    organizerId: "org-1",
    organizerEmail: "org@dali.dartmouth.edu",
    title: "Weekly check-in",
    durationMinutes: 60,
    scope: { type: "None" } as const,
    startTime: "2026-09-10T15:00:00.000Z",
    createWhiteboard: true,
  };

  beforeEach(() => {
    p.scheduledMeeting.create.mockResolvedValue({ id: "m1", ownerCalendarEmail: base.organizerEmail });
    p.meetingAttendance.createMany.mockResolvedValue({});
    vi.mocked(createNotebook).mockResolvedValue({ id: "nb-new" });
  });

  describe("created with a note", () => {
    it("beside a new notebook in the project's folder", async () => {
      const res = await createScheduledMeeting({
        ...base,
        createNote: true,
        projectId: "proj-7",
        notebook: { title: "Team sync" },
      });

      expect(res).toMatchObject({ ok: true, whiteboardPageId: "page-project" });
      expect(projectPage).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-7", parentPageId: "folder-project", kind: "Whiteboard", meetingWhiteboardId: "m1" }),
      );
      expect(labPage).not.toHaveBeenCalled();
    });

    it("beside a new notebook, in the Lab folder the notebook defaulted to", async () => {
      await createScheduledMeeting({ ...base, createNote: true, notebook: { title: "Standup" } });

      expect(createNotebook).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-lab-notes" }));
      expect(labPage).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-lab-notes" }));
    });

    it("beside an existing notebook, wherever it lives", async () => {
      vi.mocked(loadEditableNotebook).mockResolvedValue({
        id: "nb-9",
        title: "Weekly",
        templatePageId: null,
        workspaceType: "Project",
        workspaceId: "proj-3",
        parentPageId: "folder-atlas",
      } as never);

      await createScheduledMeeting({ ...base, createNote: true, notebook: { existingId: "nb-9" } });

      expect(projectPage).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-3", parentPageId: "folder-atlas", kind: "Whiteboard" }),
      );
      expect(labPage).not.toHaveBeenCalled();
    });

    it("keeps the board's usual title", async () => {
      await createScheduledMeeting({
        ...base,
        createNote: true,
        notebook: { title: "Standup" },
      });

      expect(labPage).toHaveBeenCalledWith(expect.objectContaining({ title: "Standup whiteboard (Sep 10, 2026)" }));
    });
  });

  describe("created without a note", () => {
    it("still files a Team meeting's board in its Meetings notes folder", async () => {
      await createScheduledMeeting({ ...base, createNote: false, projectId: "proj-7", meetingType: "Team" });

      expect(projectPage).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-7", parentPageId: "folder-project" }));
    });
  });

  describe("added to a meeting later", () => {
    const meetingRow = (over: Record<string, unknown> = {}) => ({
      id: "m1",
      organizerId: "org-1",
      participantUserIds: ["org-1"],
      isCoreMeeting: false,
      selectedAt: new Date("2026-09-10T15:00:00Z"),
      createdAt: new Date("2026-09-01T12:00:00Z"),
      status: "Confirmed",
      title: "Weekly check-in",
      meetingType: "Other",
      meetingTypeLabel: "Weekly",
      projectId: null,
      notebook: null,
      whiteboardPage: null,
      notePages: [],
      ...over,
    });

    beforeEach(() => {
      p.scheduledMeeting.update.mockResolvedValue({});
      p.meetingAttendance.createMany.mockResolvedValue({ count: 0 });
    });

    it("files beside the meeting's notebook", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(
        meetingRow({
          projectId: "proj-3",
          notebook: { workspaceType: "Project", workspaceId: "proj-3", parentPageId: "folder-atlas" },
        }),
      );

      const res = await attachMeetingWhiteboard({ meetingId: "m1", actorId: "org-1" });

      expect(res).toEqual({ ok: true, whiteboardPageId: "page-project" });
      expect(projectPage).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-3", parentPageId: "folder-atlas", kind: "Whiteboard" }),
      );
    });

    it("prefers the notebook's place over where the first note sits", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(
        meetingRow({
          notebook: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder-nb" },
          notePages: [
            {
              id: "note-1",
              workspaceType: "Lab",
              workspaceId: null,
              parentPageId: "nb-1",
              parent: { kind: "Notebook", parentPageId: "folder-old" },
            },
          ],
        }),
      );

      await attachMeetingWhiteboard({ meetingId: "m1", actorId: "org-1" });

      expect(labPage).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-nb" }));
    });

    it("keeps filing by the meeting's type when it has no notebook", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());

      await attachMeetingWhiteboard({ meetingId: "m1", actorId: "org-1" });

      expect(labPage).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "folder-lab-notes" }));
    });

    it("files a typeless meeting's board in the chosen project's folder", async () => {
      p.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ meetingType: null, meetingTypeLabel: null }));
      p.project.findFirst.mockResolvedValue({ id: "proj-7" });

      await attachMeetingWhiteboard({ meetingId: "m1", actorId: "org-1", projectId: "proj-7" });

      expect(projectPage).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-7", parentPageId: "folder-project" }));
    });
  });
});
