import { describe, it, expect } from "vitest";
import {
  CORE_NOTE_LABEL,
  emptyMeetingNote,
  meetingNoteValid,
  meetingNotePayload,
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  type MeetingNoteState,
} from "~/calendar/components/meeting-note";

const base = (over: Partial<MeetingNoteState> = {}): MeetingNoteState => ({
  ...emptyMeetingNote,
  ...over,
});

describe("meetingNoteValid", () => {
  it("is valid when the note is disabled, regardless of other fields", () => {
    expect(meetingNoteValid(base({ enabled: false, about: "", label: "" }))).toBe(true);
  });

  it("requires a name for a General (no-project) note", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "" }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "  " }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, about: "", label: "All-hands" }))).toBe(true);
  });

  it("needs no name for a Team/Partner project note", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "proj_1", label: "" }))).toBe(true);
  });

  it("requires a name for an Other project note", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "proj_1", subtype: "Other", label: " " }))).toBe(false);
    expect(meetingNoteValid(base({ enabled: true, about: "proj_1", subtype: "Other", label: "Review" }))).toBe(true);
  });
});

describe("meetingNotePayload", () => {
  it("emits nothing when the note is disabled", () => {
    expect(meetingNotePayload(base({ enabled: false, about: "proj_1" }))).toEqual({});
  });

  it("project path → Team/Partner + projectId, no label/location", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "proj_1", subtype: "Team" }))).toEqual({
      note: true,
      whiteboard: false,
      meetingType: "Team",
      projectId: "proj_1",
    });
    expect(
      meetingNotePayload(base({ enabled: true, about: "proj_9", subtype: "Partner" })),
    ).toEqual({ note: true, whiteboard: false, meetingType: "Partner", projectId: "proj_9" });
  });

  it("project Other → Other + trimmed label + projectId", () => {
    expect(
      meetingNotePayload(base({ enabled: true, about: "proj_1", subtype: "Other", label: " Review " })),
    ).toEqual({
      note: true,
      whiteboard: false,
      meetingType: "Other",
      meetingTypeLabel: "Review",
      projectId: "proj_1",
    });
  });

  it("General path → Other + trimmed label, no projectId", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "", label: "  Sync  " }))).toEqual({
      note: true,
      whiteboard: false,
      meetingType: "Other",
      meetingTypeLabel: "Sync",
    });
  });

  it("sets the whiteboard flag when only the board is requested", () => {
    expect(
      meetingNotePayload(base({ enabled: false, whiteboard: true, about: "proj_1", subtype: "Team" })),
    ).toEqual({ note: false, whiteboard: true, meetingType: "Team", projectId: "proj_1" });
  });

  it("omits noteLocation for the Lab-wide default (null or Lab top level)", () => {
    expect(
      meetingNotePayload(base({ enabled: true, about: "", label: "Sync", location: null })),
    ).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(
        base({
          enabled: true,
          about: "",
          label: "Sync",
          location: { workspaceType: "Lab", workspaceId: null, parentPageId: null, label: "Lab-wide" },
        }),
      ),
    ).not.toHaveProperty("noteLocation");
  });

  it("sends noteLocation for a chosen Lab folder", () => {
    const out = meetingNotePayload(
      base({
        enabled: true,
        about: "",
        label: "Sync",
        location: { workspaceType: "Lab", workspaceId: null, parentPageId: "folder_1", label: "Lab-wide / Meetings" },
      }),
    );
    expect(out.noteLocation).toEqual({ workspaceType: "Lab", workspaceId: null, parentPageId: "folder_1" });
  });

  it("sends noteLocation for a project destination", () => {
    const out = meetingNotePayload(
      base({
        enabled: true,
        about: "",
        label: "Sync",
        location: { workspaceType: "Project", workspaceId: "proj_2", parentPageId: null, label: "Fireflies" },
      }),
    );
    expect(out.noteLocation).toEqual({ workspaceType: "Project", workspaceId: "proj_2", parentPageId: null });
    // General notes never carry a projectId — filing location is not project association.
    expect(out).not.toHaveProperty("projectId");
  });
});

describe("the Core shape", () => {
  // A Core meeting's note takes the General path — Core isn't a project, so
  // there's nothing to file it under and no Team/Partner split to draw. The
  // default name is what keeps it submittable the moment the toggle goes on.
  it("is valid as soon as the default Core name is in place", () => {
    expect(meetingNoteValid(base({ enabled: true, about: "", label: CORE_NOTE_LABEL }))).toBe(true);
  });

  it("emits the General payload, never a project one", () => {
    expect(meetingNotePayload(base({ enabled: true, about: "", label: CORE_NOTE_LABEL }))).toEqual({
      note: true,
      whiteboard: false,
      meetingType: "Other",
      meetingTypeLabel: CORE_NOTE_LABEL,
    });
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
