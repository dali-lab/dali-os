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
  noteLocationFromDest,
  notebookHomePlace,
  placeFromDest,
  placesFromPicker,
  projectIdOf,
  receiverDest,
  removePlace,
  reorderPlaces,
  withHomeOnTop,
  withoutPlace,
  locationPlace,
  type FilingPlace,
  type MeetingNoteLocation,
  type MeetingNoteState,
} from "~/calendar/components/meeting-note";
import type { PickedNotebook } from "~/components/notebooks/notebook-picker";
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

const existing: PickedNotebook = {
  id: "nb_1",
  title: "Weekly check-in",
  path: "Core / Meetings",
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: "core-m",
};
const projectNotebook: PickedNotebook = { ...existing, workspaceType: "Project", workspaceId: "proj_1" };
const projectPlace = (key: string, projectId = "proj_1") =>
  place(key, { workspaceType: "Project", workspaceId: projectId });

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

  it("needs nothing more for a whiteboard alone, with or without a place", () => {
    expect(meetingNoteValid(base({ whiteboard: true }))).toBe(true);
    expect(meetingNoteValid(base({ whiteboard: true, places: [place("f1")] }))).toBe(true);
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

describe("projectIdOf", () => {
  it("is the project of a new notebook's primary place, not of its links", () => {
    expect(projectIdOf(inState(projectPlace("f1", "a"), projectPlace("f2", "b")))).toBe("a");
    expect(projectIdOf(inState(place("f1"), projectPlace("f2")))).toBeNull();
  });

  it("is the chosen notebook's project in existing mode, whatever the links are", () => {
    const existingIn = (nb: PickedNotebook | null, ...places: FilingPlace[]) =>
      base({ enabled: true, notebookMode: "existing", existing: nb, places });
    expect(projectIdOf(existingIn(projectNotebook))).toBe("proj_1");
    expect(projectIdOf(existingIn(projectNotebook, projectPlace("f1", "other")))).toBe("proj_1");
    expect(projectIdOf(existingIn(existing, projectPlace("f1")))).toBeNull();
    expect(projectIdOf(existingIn(null, projectPlace("f1")))).toBeNull();
  });

  it("is the place's project for a whiteboard with no note, even after an existing-notebook choice", () => {
    expect(projectIdOf(base({ whiteboard: true, places: [projectPlace("f1")] }))).toBe("proj_1");
    expect(
      projectIdOf(base({ whiteboard: true, notebookMode: "existing", existing: projectNotebook })),
    ).toBeNull();
  });

  it("is null with nothing chosen", () => {
    expect(projectIdOf(base())).toBeNull();
  });
});

describe("meetingNotePayload", () => {
  it("emits nothing when neither asset is requested", () => {
    expect(meetingNotePayload(base({ title: "Sync", places: [projectPlace("f1")] }))).toEqual({});
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

  it("carries the project of the new notebook's primary place", () => {
    expect(meetingNotePayload(inState(projectPlace("f1")))).toMatchObject({ projectId: "proj_1" });
  });

  it("carries the project of the chosen existing notebook", () => {
    const out = meetingNotePayload(base({ enabled: true, notebookMode: "existing", existing: projectNotebook }));
    expect(out).toMatchObject({ projectId: "proj_1", notebook: { existingId: "nb_1" } });
  });

  it("sends no project for a lab-wide notebook, existing or new", () => {
    expect(meetingNotePayload(inState(place("f1")))).not.toHaveProperty("projectId");
    expect(meetingNotePayload(base({ enabled: true, notebookMode: "existing", existing }))).not.toHaveProperty("projectId");
    expect(meetingNotePayload(base({ enabled: true, title: "Sync" }))).not.toHaveProperty("projectId");
  });

  it("no longer carries a meeting type", () => {
    const out = meetingNotePayload(inState(projectPlace("f1")));
    expect(out).not.toHaveProperty("meetingType");
    expect(out).not.toHaveProperty("meetingTypeLabel");
  });

  it("a whiteboard alone has no notebook and, with no place, files by the server default", () => {
    expect(meetingNotePayload(base({ whiteboard: true }))).toEqual({ note: false, whiteboard: true });
  });

  it("a note carries its primary and links in one notebook object", () => {
    const out = meetingNotePayload(
      base({ enabled: true, whiteboard: true, title: "Sync", places: [projectPlace("f1", "p1"), place("f2")] }),
    );
    expect(out).toEqual({
      note: true,
      whiteboard: true,
      projectId: "p1",
      notebook: {
        title: "Sync",
        location: locationOf(projectPlace("f1", "p1")),
        templatePageId: null,
        links: [locationOf(place("f2"))],
      },
    });
  });

  it("a whiteboard alone files at its place via noteLocation", () => {
    const out = meetingNotePayload(base({ whiteboard: true, places: [place("f1")] }));
    expect(out.noteLocation).toEqual({ workspaceType: "Lab", workspaceId: null, parentPageId: "f1" });
    expect(out).not.toHaveProperty("projectId");
  });

  it("a whiteboard alone in a project folder sends the project and the folder", () => {
    const out = meetingNotePayload(base({ whiteboard: true, places: [projectPlace("f1")] }));
    expect(out).toMatchObject({
      note: false,
      whiteboard: true,
      projectId: "proj_1",
      noteLocation: { workspaceType: "Project", workspaceId: "proj_1", parentPageId: "f1" },
    });
  });

  it("a whiteboard alone uses only the first place", () => {
    const out = meetingNotePayload(base({ whiteboard: true, places: [place("f1"), place("f2")] }));
    expect(out.noteLocation).toEqual({ workspaceType: "Lab", workspaceId: null, parentPageId: "f1" });
  });

  it("never sends noteLocation for the Lab-wide default or alongside a note", () => {
    expect(meetingNotePayload(base({ whiteboard: true, places: [labTop] }))).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(base({ enabled: true, whiteboard: true, title: "Sync", places: [place("f1")] })),
    ).not.toHaveProperty("noteLocation");
    expect(
      meetingNotePayload(base({ enabled: true, whiteboard: true, notebookMode: "existing", existing, places: [place("f1")] })),
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
    it("is the project's Meetings receiver, and nothing without a project", () => {
      expect(defaultPlaceFor("p1", rows)?.dest).toEqual(atlasM);
      expect(defaultPlaceFor(null, rows)).toBeNull();
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

describe("reorderPlaces", () => {
  const [a, b, c] = [place("a"), place("b"), place("c")];
  const ids = (ps: FilingPlace[]) => ps.map((p) => p.dest.folderId);

  it("moves a shortcut to the top, making it the location", () => {
    expect(ids(reorderPlaces([a, b, c], 2, 0))).toEqual(["c", "a", "b"]);
  });

  it("moves the location down, promoting the next place", () => {
    expect(ids(reorderPlaces([a, b, c], 0, 1))).toEqual(["b", "a", "c"]);
  });

  it("reorders shortcuts among themselves and leaves the location", () => {
    expect(ids(reorderPlaces([a, b, c], 1, 2))).toEqual(["a", "c", "b"]);
  });

  it("returns the same list for no move or an index out of range", () => {
    const places = [a, b, c];
    expect(reorderPlaces(places, 1, 1)).toBe(places);
    expect(reorderPlaces(places, -1, 0)).toBe(places);
    expect(reorderPlaces(places, 0, 3)).toBe(places);
    expect(reorderPlaces(places, 3, 0)).toBe(places);
  });

  it("does not change the list it was given", () => {
    const places = [a, b, c];
    reorderPlaces(places, 2, 0);
    expect(ids(places)).toEqual(["a", "b", "c"]);
  });
});

describe("withHomeOnTop and withoutPlace", () => {
  const [a, b, c] = [place("a"), place("b"), place("c")];
  const ids = (ps: FilingPlace[]) => ps.map((p) => p.dest.folderId);

  it("puts the home first and drops another copy of it", () => {
    expect(ids(withHomeOnTop([a, b, c], c))).toEqual(["c", "a", "b"]);
    expect(ids(withHomeOnTop([a, b], c))).toEqual(["c", "a", "b"]);
  });

  it("leaves the list alone when the home can't be shown", () => {
    const places = [a, b];
    expect(withHomeOnTop(places, null)).toBe(places);
    expect(withoutPlace(places, null)).toBe(places);
  });

  it("removes a place wherever it sits", () => {
    expect(ids(withoutPlace([a, b, c], b))).toEqual(["a", "c"]);
  });
});

describe("an existing notebook's own place", () => {
  const rows = {
    drives: [
      { id: "lab", label: "Lab" },
      { id: "core", label: "Core", rootFolderId: "core-root" },
      { id: "projects", label: "Projects" },
    ],
    folders: [
      { id: "core-m", driveId: "core", parentId: null, title: "Meetings", folderType: "Meetings" },
      { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
      { id: "p1-m", driveId: "projects", parentId: "p1", title: "Meetings", folderType: "Meetings" },
    ],
  };
  const inCore: PickedNotebook = { ...existing, parentPageId: "core-m" };
  const inAtlas: PickedNotebook = {
    ...existing,
    workspaceType: "Project",
    workspaceId: "p1",
    parentPageId: "p1-m",
  };
  const home = notebookHomePlace(inCore, rows)!;
  const atlasHome = notebookHomePlace(inAtlas, rows)!;
  const other = place("other");

  const state = (over: Partial<MeetingNoteState> = {}) =>
    base({ enabled: true, notebookMode: "existing", existing: inCore, existingHome: home, places: [home], ...over });

  describe("notebookHomePlace", () => {
    it("finds the folder it sits in among the pickable folders, with the picker's path", () => {
      expect(home).toEqual({
        dest: { driveId: "core", folderId: "core-m" },
        location: { workspaceType: "Lab", workspaceId: null, parentPageId: "core-m", label: "Core / Meetings" },
        path: "Core / Meetings",
      });
      expect(atlasHome.location).toMatchObject({ workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m" });
    });

    it("finds the top of the Lab drive for a notebook with no folder", () => {
      expect(notebookHomePlace({ ...existing, parentPageId: null }, rows)?.dest).toEqual({ driveId: "lab", folderId: null });
    });

    it("is null when its folder is not one the viewer can pick", () => {
      expect(notebookHomePlace({ ...existing, parentPageId: "hidden" }, rows)).toBeNull();
    });

    it("is null when the folder found is in a different workspace than the notebook says", () => {
      expect(notebookHomePlace({ ...existing, workspaceType: "Project", workspaceId: "p9" }, rows)).toBeNull();
    });

    it("is null for a notebook that lives where a note can't be filed", () => {
      expect(notebookHomePlace({ ...existing, workspaceType: "Member", workspaceId: "u1" }, rows)).toBeNull();
    });
  });

  describe("the location and shortcuts", () => {
    it("treats the top row as the location and the rest as shortcuts", () => {
      const s = state({ places: [home, other] });
      expect(locationPlace(s)).toBe(home);
      expect(linkPlaces(s)).toEqual([other]);
    });

    it("treats every place as a shortcut when the notebook's own place is not shown", () => {
      const s = state({ existingHome: null, places: [other] });
      expect(locationPlace(s)).toBeNull();
      expect(linkPlaces(s)).toEqual([other]);
    });

    it("treats every place as a shortcut before a notebook is picked", () => {
      const s = state({ existing: null, existingHome: null, places: [other] });
      expect(locationPlace(s)).toBeNull();
      expect(linkPlaces(s)).toEqual([other]);
    });
  });

  describe("the payload", () => {
    it("sends no location while the notebook stays where it is", () => {
      expect(notebookChoiceOf(state())).toEqual({ existingId: "nb_1" });
    });

    it("sends the shortcuts below the notebook's own place", () => {
      expect(notebookChoiceOf(state({ places: [home, other] }))).toEqual({
        existingId: "nb_1",
        links: [locationOf(other)],
      });
    });

    it("sends the new top row as a location to move to, and the old place as a shortcut", () => {
      expect(notebookChoiceOf(state({ places: [other, home] }))).toEqual({
        existingId: "nb_1",
        location: locationOf(other),
        links: [locationOf(home)],
      });
    });

    it("never sends a location for a notebook whose own place is not shown", () => {
      expect(notebookChoiceOf(state({ existingHome: null, places: [other] }))).toEqual({
        existingId: "nb_1",
        links: [locationOf(other)],
      });
    });

    it("never sends a location for a notebook that lives where a note can't be filed", () => {
      const member: PickedNotebook = { ...existing, workspaceType: "Member", workspaceId: "u1" };
      expect(notebookChoiceOf(state({ existing: member, existingHome: null, places: [other] }))).not.toHaveProperty("location");
    });

    it("sends no location when the list is empty", () => {
      expect(notebookChoiceOf(state({ places: [] }))).toEqual({ existingId: "nb_1" });
    });

    it("is accepted by the server's schema, moved or not", () => {
      for (const places of [[home], [other, home], [home, other]]) {
        expect(notebookChoiceSchema.safeParse(notebookChoiceOf(state({ places }))).success).toBe(true);
      }
    });

    it("lands in the meetings payload", () => {
      expect(meetingNotePayload(state({ places: [other, home] }))).toMatchObject({
        note: true,
        notebook: { existingId: "nb_1", location: locationOf(other) },
      });
    });
  });

  describe("the project", () => {
    it("is the notebook's own project while it stays", () => {
      expect(projectIdOf(state({ existing: inAtlas, existingHome: atlasHome, places: [atlasHome] }))).toBe("p1");
    });

    it("follows the notebook to the project it is moved into, or out of one", () => {
      const toProject = state({ places: [atlasHome, home] });
      expect(projectIdOf(toProject)).toBe("p1");
      const outOfProject = state({ existing: inAtlas, existingHome: atlasHome, places: [home, atlasHome] });
      expect(projectIdOf(outOfProject)).toBeNull();
    });
  });

  describe("validity", () => {
    it("counts only shortcuts toward the limit", () => {
      const shortcuts = Array.from({ length: MAX_FILING_LINKS }, (_, i) => place(`s${i}`));
      expect(meetingNoteValid(state({ places: [home, ...shortcuts] }))).toBe(true);
      expect(meetingNoteValid(state({ places: [home, ...shortcuts, place("one-more")] }))).toBe(false);
    });
  });
});
