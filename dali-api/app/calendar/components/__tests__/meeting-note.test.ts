import { describe, it, expect } from "vitest";
import {
  emptyMeetingNote,
  meetingNoteActive,
  meetingNoteValid,
  meetingNotePayload,
  notebookChoiceOf,
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  type MeetingNoteLocation,
  type MeetingNoteState,
} from "~/calendar/components/meeting-note";
import { notebookChoiceSchema } from "~/lib/notebook-choice";

const base = (over: Partial<MeetingNoteState> = {}): MeetingNoteState => ({
  ...emptyMeetingNote,
  ...over,
});

const loc = (over: Partial<MeetingNoteLocation> = {}): MeetingNoteLocation => ({
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: null,
  label: "Lab-wide",
  ...over,
});

const existing = { id: "nb_1", title: "Weekly check-in", path: "Core / Meetings" };

describe("meetingNoteActive", () => {
  it("is true for a note, a whiteboard, or both, false for neither", () => {
    expect(meetingNoteActive(base())).toBe(false);
    expect(meetingNoteActive(base({ enabled: true }))).toBe(true);
    expect(meetingNoteActive(base({ whiteboard: true }))).toBe(true);
    expect(meetingNoteActive(base({ enabled: true, whiteboard: true }))).toBe(true);
  });
});

describe("meetingNoteValid", () => {
  it("is valid when the note is off, whatever else is filled in", () => {
    expect(meetingNoteValid(base({ enabled: false, notebookMode: "existing", existing: null }))).toBe(true);
    expect(meetingNoteValid(base({ whiteboard: true }))).toBe(true);
  });

  it("needs a name for a new notebook", () => {
    expect(meetingNoteValid(base({ enabled: true, notebookMode: "new", title: "" }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, notebookMode: "new", title: "   " }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, notebookMode: "new", title: "All-hands" }))).toBe(true);
  });

  it("needs a chosen notebook when adding to an existing one, and ignores the new-notebook name", () => {
    expect(meetingNoteValid(base({ enabled: true, notebookMode: "existing", existing: null, title: "Named" }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, notebookMode: "existing", existing }))).toBe(true);
  });

  it("needs no project name: About is optional in both modes", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "proj_1", title: "Sync" }))).toBe(true);
  });
});

describe("notebookChoiceOf", () => {
  it("is null when no note is requested", () => {
    expect(notebookChoiceOf(base({ whiteboard: true, title: "Sync" }))).toBeNull();
  });

  it("is the existing notebook's id, and nothing else", () => {
    expect(notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing, title: "ignored" }))).toEqual({
      existingId: "nb_1",
    });
  });

  it("is null for existing mode before a notebook is picked", () => {
    expect(notebookChoiceOf(base({ enabled: true, notebookMode: "existing" }))).toBeNull();
  });

  it("carries the trimmed name, template and no location by default", () => {
    expect(
      notebookChoiceOf(base({ enabled: true, notebookMode: "new", title: " Weekly ", templatePageId: "tpl_1" })),
    ).toEqual({ title: "Weekly", location: null, templatePageId: "tpl_1" });
  });

  it("drops the Lab-wide top level, which is the default", () => {
    expect(notebookChoiceOf(base({ enabled: true, title: "Sync", location: loc() }))).toMatchObject({ location: null });
  });

  it("sends a chosen folder without its display label", () => {
    expect(
      notebookChoiceOf(base({ enabled: true, title: "Sync", location: loc({ parentPageId: "f1", label: "Lab / Meetings" }) })),
    ).toMatchObject({ location: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" } });
  });
});

describe("meetingNotePayload", () => {
  it("emits nothing when neither asset is requested", () => {
    expect(meetingNotePayload(base({ about: "proj_1", title: "Sync" }))).toEqual({});
  });

  it("a note into a new notebook", () => {
    expect(meetingNotePayload(base({ enabled: true, title: "Sync" }))).toEqual({
      note: true,
      whiteboard: false,
      notebook: { title: "Sync", location: null, templatePageId: null },
    });
  });

  it("a note into an existing notebook", () => {
    expect(meetingNotePayload(base({ enabled: true, notebookMode: "existing", existing }))).toEqual({
      note: true,
      whiteboard: false,
      notebook: { existingId: "nb_1" },
    });
  });

  it("carries the project the meeting is about", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "proj_1", title: "Sync" }))).toMatchObject({
      projectId: "proj_1",
    });
  });

  it("no longer carries a meeting type", () => {
    const out = meetingNotePayload(base({ enabled: true, about: "proj_1", title: "Sync" }));
    expect(out).not.toHaveProperty("meetingType");
    expect(out).not.toHaveProperty("meetingTypeLabel");
  });

  it("a whiteboard alone has no notebook", () => {
    expect(meetingNotePayload(base({ whiteboard: true, about: "proj_1" }))).toEqual({
      note: false,
      whiteboard: true,
      projectId: "proj_1",
    });
  });

  it("a General whiteboard alone files in the chosen folder via noteLocation", () => {
    const out = meetingNotePayload(base({ whiteboard: true, location: loc({ parentPageId: "f1" }) }));
    expect(out.noteLocation).toEqual({ workspaceType: "Lab", workspaceId: null, parentPageId: "f1" });
  });

  it("never sends noteLocation for the Lab-wide default, for a project, or alongside a note", () => {
    expect(meetingNotePayload(base({ whiteboard: true, location: loc() }))).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(base({ whiteboard: true, about: "proj_1", location: loc({ parentPageId: "f1" }) })),
    ).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(base({ enabled: true, whiteboard: true, title: "Sync", location: loc({ parentPageId: "f1" }) })),
    ).not.toHaveProperty("noteLocation");
  });

  it("every notebook payload satisfies the server's schema", () => {
    const choices = [
      notebookChoiceOf(base({ enabled: true, title: "Sync" })),
      notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing })),
      notebookChoiceOf(
        base({ enabled: true, title: "Sync", location: loc({ workspaceType: "Project", workspaceId: "p1" }), templatePageId: "t" }),
      ),
    ];
    for (const choice of choices) expect(notebookChoiceSchema.safeParse(choice).success).toBe(true);
  });
});

describe("note destination picking", () => {
  const rows = {
    drives: [
      { id: "mine", label: "My Drive" },
      { id: "lab", label: "Lab" },
      { id: "core", label: "Core", rootFolderId: "core-root" },
      { id: "projects", label: "Projects" },
      { id: "education", label: "Education" },
    ],
    folders: [
      { id: "lab-a", driveId: "lab", parentId: null, title: "Ops" },
      { id: "core-m", driveId: "core", parentId: null, title: "Meetings" },
      { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
      { id: "p1-n", driveId: "projects", parentId: "p1", title: "Notes" },
      { id: "o1", driveId: "education", parentId: null, title: "Intro" },
      { id: "mine-a", driveId: "mine", parentId: null, title: "Mine" },
    ],
  };

  it("offers neither My Drive nor Education, which the server cannot file into", () => {
    const out = noteDestinationRows(rows);
    expect(out.drives.map((d) => d.id)).toEqual(["lab", "core", "projects"]);
    expect(out.folders.map((f) => f.id)).toEqual(["lab-a", "core-m", "p1", "p1-n"]);
  });

  it("maps a Lab folder to a Lab location named drive / folder", () => {
    expect(noteLocationFromDest({ driveId: "lab", folderId: "lab-a" }, rows)).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "lab-a",
      label: "Lab-wide / Ops",
    });
  });

  it("maps Core's top level to its root folder", () => {
    expect(noteLocationFromDest({ driveId: "core", folderId: null }, rows)).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "core-root",
      label: "Core",
    });
  });

  it("maps a project's top level and a folder inside it", () => {
    expect(noteLocationFromDest({ driveId: "projects", folderId: "p1" }, rows)).toEqual({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: null,
      label: "Atlas",
    });
    expect(noteLocationFromDest({ driveId: "projects", folderId: "p1-n" }, rows)).toMatchObject({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "p1-n",
      label: "Atlas / Notes",
    });
  });

  it("returns null for places a note cannot go", () => {
    expect(noteLocationFromDest({ driveId: "education", folderId: "o1" }, rows)).toBeNull();
    expect(noteLocationFromDest({ driveId: "projects", folderId: null }, rows)).toBeNull();
    expect(noteLocationFromDest({ driveId: "mine", folderId: null }, rows)).toBeNull();
  });

  it("opens at Lab-wide when no location is chosen", () => {
    expect(noteInitialDest(null, rows)).toEqual({ driveId: "lab", folderId: null });
  });

  it("reopens at a chosen Lab folder, its drive, or a project folder", () => {
    const loc = (over: object) => ({ workspaceType: "Lab" as const, workspaceId: null, parentPageId: null, label: "", ...over });
    expect(noteInitialDest(loc({ parentPageId: "core-m" }), rows)).toEqual({ driveId: "core", folderId: "core-m" });
    expect(noteInitialDest(loc({ parentPageId: "core-root" }), rows)).toEqual({ driveId: "core", folderId: null });
    expect(noteInitialDest(loc({ parentPageId: "gone" }), rows)).toEqual({ driveId: "lab", folderId: null });
    expect(noteInitialDest(loc({ workspaceType: "Project", workspaceId: "p1" }), rows)).toEqual({
      driveId: "projects",
      folderId: "p1",
    });
    expect(noteInitialDest(loc({ workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-n" }), rows)).toEqual({
      driveId: "projects",
      folderId: "p1-n",
    });
  });
});
