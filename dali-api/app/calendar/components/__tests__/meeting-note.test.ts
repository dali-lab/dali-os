import { describe, it, expect } from "vitest";
import {
  addPlace,
  defaultPlaceFor,
  emptyMeetingNote,
  groupFilingDest,
  hasPlace,
  linkPlaces,
  makePrimaryPlace,
  MAX_FILING_LINKS,
  meetingNoteActive,
  meetingNoteValid,
  meetingNotePayload,
  notebookChoiceOf,
  noteDestinationRows,
  noteInitialDest,
  noteLocationFromDest,
  placeFromDest,
  placesFromPicker,
  receiverDest,
  removePlace,
  type FilingPlace,
  type MeetingNoteLocation,
  type MeetingNoteState,
} from "~/calendar/components/meeting-note";
import type { Destination } from "~/components/drive/FolderPicker";
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

const place = (key: string, over: Partial<MeetingNoteLocation> = {}): FilingPlace => ({
  dest: { driveId: "lab", folderId: key },
  location: loc({ parentPageId: key, label: key, ...over }),
  path: `Lab / ${key}`,
});
const labTop: FilingPlace = {
  dest: { driveId: "lab", folderId: null },
  location: loc({ label: "Lab-wide" }),
  path: "Lab",
};
const inState = (...places: FilingPlace[]) => base({ enabled: true, title: "Sync", places });
const locationOf = (p: FilingPlace) => ({
  workspaceType: p.location.workspaceType,
  workspaceId: p.location.workspaceId,
  parentPageId: p.location.parentPageId,
});

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

  it("allows up to the server's link limit and no more", () => {
    const places = (n: number) => Array.from({ length: n }, (_, i) => place(`f${i}`));
    expect(meetingNoteValid(inState(...places(1 + MAX_FILING_LINKS)))).toBe(true);
    expect(meetingNoteValid(inState(...places(2 + MAX_FILING_LINKS)))).toBe(false);
    const existingWith = (n: number) => base({ enabled: true, notebookMode: "existing", existing, places: places(n) });
    expect(meetingNoteValid(existingWith(MAX_FILING_LINKS))).toBe(true);
    expect(meetingNoteValid(existingWith(MAX_FILING_LINKS + 1))).toBe(false);
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

  it("drops a Lab-wide top-level primary, which is the default", () => {
    expect(notebookChoiceOf(inState(labTop))).toMatchObject({ location: null });
  });

  it("sends the primary place without its display label", () => {
    expect(notebookChoiceOf(inState(place("f1")))).toEqual({
      title: "Sync",
      location: { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" },
      templatePageId: null,
    });
  });

  it("sends every place after the primary as a link", () => {
    const proj = place("p1-m", { workspaceType: "Project", workspaceId: "p1" });
    expect(notebookChoiceOf(inState(place("f1"), proj, labTop))).toMatchObject({
      location: locationOf(place("f1")),
      links: [locationOf(proj), locationOf(labTop)],
    });
  });

  it("keeps a Lab-wide top level as a link, where there is no default to omit it for", () => {
    expect(notebookChoiceOf(inState(place("f1"), labTop))).toMatchObject({ links: [locationOf(labTop)] });
  });

  it("omits links when only the primary is chosen", () => {
    expect(notebookChoiceOf(inState(place("f1")))).not.toHaveProperty("links");
  });

  it("sends an existing notebook with every place as a link, since it has its own location", () => {
    expect(
      notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing, places: [place("f1"), place("f2")] })),
    ).toEqual({ existingId: "nb_1", links: [locationOf(place("f1")), locationOf(place("f2"))] });
  });

  it("an existing notebook with no places has no links key", () => {
    expect(notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing }))).toEqual({ existingId: "nb_1" });
  });
});

describe("linkPlaces", () => {
  it("is everything after the primary for a new notebook", () => {
    expect(linkPlaces(inState(place("a"), place("b"), place("c"))).map((p) => p.dest.folderId)).toEqual(["b", "c"]);
    expect(linkPlaces(inState())).toEqual([]);
  });

  it("is every place for an existing notebook", () => {
    expect(
      linkPlaces(base({ enabled: true, notebookMode: "existing", places: [place("a"), place("b")] })).map((p) => p.dest.folderId),
    ).toEqual(["a", "b"]);
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

  it("a note carries its primary and links in one notebook object", () => {
    const out = meetingNotePayload(base({ enabled: true, whiteboard: true, about: "p1", title: "Sync", places: [place("f1"), place("f2")] }));
    expect(out).toEqual({
      note: true,
      whiteboard: true,
      projectId: "p1",
      notebook: {
        title: "Sync",
        location: locationOf(place("f1")),
        templatePageId: null,
        links: [locationOf(place("f2"))],
      },
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
      meetingNotePayload(base({ enabled: true, whiteboard: true, title: "Sync", places: [place("f1")] })),
    ).not.toHaveProperty("noteLocation");
  });

  it("every notebook payload satisfies the server's schema", () => {
    const choices = [
      notebookChoiceOf(base({ enabled: true, title: "Sync" })),
      notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing })),
      notebookChoiceOf(
        inState({ ...place("p1-m", { workspaceType: "Project", workspaceId: "p1" }) }, place("f2"), labTop),
      ),
      notebookChoiceOf(base({ enabled: true, notebookMode: "existing", existing, places: [place("f2")] })),
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

describe("filing places", () => {
  const rows = {
    drives: [
      { id: "mine", label: "My Drive" },
      { id: "lab", label: "Lab" },
      { id: "core", label: "Core", rootFolderId: "core-root" },
      { id: "projects", label: "Projects" },
      { id: "education", label: "Education" },
    ],
    folders: [
      { id: "lab-m", driveId: "lab", parentId: null, title: "Meeting assets", folderType: "Meetings" },
      { id: "core-a", driveId: "core", parentId: null, title: "Agreements", folderType: "Agreements" },
      { id: "core-m", driveId: "core", parentId: null, title: "Meetings", folderType: "Meetings" },
      { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
      { id: "p1-n", driveId: "projects", parentId: "p1", title: "Notes" },
      { id: "p1-m", driveId: "projects", parentId: "p1", title: "Meetings", folderType: "Meetings" },
      { id: "p2", driveId: "projects", parentId: null, title: "Borealis" },
      { id: "p2-x", driveId: "projects", parentId: "p2", title: "Docs" },
      { id: "p2-x-m", driveId: "projects", parentId: "p2-x", title: "Weekly", folderType: "Meetings" },
      { id: "p3", driveId: "projects", parentId: null, title: "Cygnus" },
      { id: "o1", driveId: "education", parentId: null, title: "Intro" },
    ],
  };
  const labM: Destination = { driveId: "lab", folderId: "lab-m" };
  const coreM: Destination = { driveId: "core", folderId: "core-m" };
  const atlasM: Destination = { driveId: "projects", folderId: "p1-m" };
  const at = (d: Destination) => placeFromDest(d, rows)!;

  describe("placeFromDest", () => {
    it("carries the destination, its database location and the real path", () => {
      expect(at(atlasM)).toEqual({
        dest: atlasM,
        location: { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m", label: "Atlas / Meetings" },
        path: "Projects / Atlas / Meetings",
      });
      expect(at(coreM).path).toBe("Core / Meetings");
      expect(at({ driveId: "core", folderId: null }).location.parentPageId).toBe("core-root");
    });

    it("is null where a note cannot be filed", () => {
      expect(placeFromDest({ driveId: "education", folderId: "o1" }, rows)).toBeNull();
      expect(placeFromDest({ driveId: "mine", folderId: null }, rows)).toBeNull();
    });
  });

  describe("receiverDest", () => {
    it("finds a project's Meetings receiver", () => {
      expect(receiverDest(rows, { kind: "project", projectId: "p1" })).toEqual(atlasM);
    });

    it("finds a receiver nested below the project's top level", () => {
      expect(receiverDest(rows, { kind: "project", projectId: "p2" })).toEqual({ driveId: "projects", folderId: "p2-x-m" });
    });

    it("falls back to the project root when it has no receiver", () => {
      expect(receiverDest(rows, { kind: "project", projectId: "p3" })).toEqual({ driveId: "projects", folderId: "p3" });
    });

    it("is null for a project the viewer's rows do not include", () => {
      expect(receiverDest(rows, { kind: "project", projectId: "gone" })).toBeNull();
    });

    it("finds Core's Meetings receiver, else its root, else nothing", () => {
      expect(receiverDest(rows, { kind: "core" })).toEqual(coreM);
      const noReceiver = { ...rows, folders: rows.folders.filter((f) => f.id !== "core-m") };
      expect(receiverDest(noReceiver, { kind: "core" })).toEqual({ driveId: "core", folderId: null });
      const noCore = { drives: rows.drives.filter((d) => d.id !== "core"), folders: rows.folders.filter((f) => f.driveId !== "core") };
      expect(receiverDest(noCore, { kind: "core" })).toBeNull();
    });
  });

  describe("groupFilingDest", () => {
    it("maps a project group and the Core group, and nothing else", () => {
      expect(groupFilingDest({ projectId: "p1", systemKey: null }, rows)).toEqual(atlasM);
      expect(groupFilingDest({ projectId: null, systemKey: "core" }, rows)).toEqual(coreM);
      expect(groupFilingDest({ projectId: null, systemKey: "offering:o1" }, rows)).toBeNull();
      expect(groupFilingDest({ projectId: null, systemKey: null }, rows)).toBeNull();
    });
  });

  describe("defaultPlaceFor", () => {
    it("is the project's Meetings receiver, and nothing for General", () => {
      expect(defaultPlaceFor("p1", rows)?.dest).toEqual(atlasM);
      expect(defaultPlaceFor("", rows)).toBeNull();
      expect(defaultPlaceFor("gone", rows)).toBeNull();
    });
  });

  describe("adding, removing and ranking", () => {
    it("the first place is primary and later ones are links", () => {
      const places = addPlace(addPlace([], at(labM)), at(coreM));
      expect(places.map((p) => p.dest)).toEqual([labM, coreM]);
    });

    it("adding a place twice is a no-op", () => {
      const once = addPlace([], at(labM));
      expect(addPlace(once, at(labM))).toEqual(once);
    });

    it("making a link primary moves it to the front and keeps the rest in order", () => {
      const places = [at(labM), at(coreM), at(atlasM)];
      expect(makePrimaryPlace(places, atlasM).map((p) => p.dest)).toEqual([atlasM, labM, coreM]);
    });

    it("making an unknown place primary changes nothing", () => {
      const places = [at(labM), at(coreM)];
      expect(makePrimaryPlace(places, atlasM)).toEqual(places);
    });

    it("removing a link keeps the primary", () => {
      expect(removePlace([at(labM), at(coreM), at(atlasM)], coreM).map((p) => p.dest)).toEqual([labM, atlasM]);
    });

    it("removing the primary promotes the next place", () => {
      expect(removePlace([at(labM), at(coreM), at(atlasM)], labM).map((p) => p.dest)).toEqual([coreM, atlasM]);
    });

    it("removing the only place leaves none", () => {
      expect(removePlace([at(labM)], labM)).toEqual([]);
    });

    it("hasPlace matches on drive and folder", () => {
      expect(hasPlace([at(labM)], labM)).toBe(true);
      expect(hasPlace([at(labM)], coreM)).toBe(false);
    });
  });

  describe("placesFromPicker", () => {
    it("puts the picked primary first and keeps the picked order after it", () => {
      const out = placesFromPicker({ destinations: [labM, coreM, atlasM], primaryIndex: 2 }, [], rows);
      expect(out.map((p) => p.dest)).toEqual([atlasM, labM, coreM]);
    });

    it("reuses places it already has", () => {
      const previous = [{ ...at(labM), path: "Custom path" }];
      expect(placesFromPicker({ destinations: [labM], primaryIndex: 0 }, previous, rows)[0]!.path).toBe("Custom path");
    });

    it("drops destinations a note cannot be filed in", () => {
      const out = placesFromPicker(
        { destinations: [{ driveId: "education", folderId: "o1" }, labM, coreM], primaryIndex: 0 },
        [],
        rows,
      );
      expect(out.map((p) => p.dest)).toEqual([labM, coreM]);
    });

    it("hands the primary to the first place left when the primary is dropped", () => {
      const out = placesFromPicker(
        { destinations: [{ driveId: "education", folderId: "o1" }, coreM, labM], primaryIndex: 0 },
        [],
        rows,
      );
      expect(out[0]!.dest).toEqual(coreM);
    });

    it("is empty when nothing can be filed", () => {
      expect(placesFromPicker({ destinations: [{ driveId: "mine", folderId: null }], primaryIndex: 0 }, [], rows)).toEqual([]);
    });
  });
});
