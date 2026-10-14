// Pure state model + derivation for the meeting-note fields, kept free of React
// so it can be unit-tested and reused. The UI (hook + component) lives in
// MeetingNoteFields.tsx and re-exports these.
//
// "Which notebook?" is the notebook choice: an existing one, or a new one with
// a name and an optional template. Where it is filed is `places`, one ordered
// list: the first is the location, the rest are shortcuts. An existing
// notebook already lives somewhere, so its own place seeds the top; putting a
// different place on top moves it there. A whiteboard with no note is filed at
// the first place alone. The meeting's project is derived from where the assets
// go (projectIdOf); the server derives the legacy meeting type from the choice.

import { destinationPath, type Destination, type MultiResult } from "~/components/drive/FolderPicker";
import { resolveMoveTarget } from "~/components/drive/move-target";
import {
  addSelection,
  destinationKey,
  primaryOf,
  removeSelection,
  selectionFrom,
  setPrimary,
  type MultiSelection,
} from "~/components/drive/picker-multi";
import type { PickerRows } from "~/components/drive/picker-rows";
import type { PickedNotebook } from "~/components/notebooks/notebook-picker";
import type { NotebookChoice } from "~/lib/notebook-choice";

export type MeetingNoteLocation = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  parentPageId: string | null;
  label: string;
};

/** A place the notebook is filed: the picker destination, where it lands in the
 *  database, and the path shown on its chip. */
export type FilingPlace = { dest: Destination; location: MeetingNoteLocation; path: string };

/** The most shortcuts the server accepts alongside a notebook's own location. */
export const MAX_FILING_LINKS = 8;

export type ExistingNotebook = PickedNotebook;

export type MeetingNoteState = {
  /** Create a shared note doc for this meeting. */
  enabled: boolean;
  /** Also start a shared whiteboard: beside the notebook, or at the first
   *  place when there is no note. */
  whiteboard: boolean;
  notebookMode: "existing" | "new";
  /** The notebook picked in "Add to existing" mode. */
  existing: ExistingNotebook | null;
  /** The new notebook's name. */
  title: string;
  /** True once the organizer typed a name, which stops the meeting-title prefill. */
  titleEdited: boolean;
  /** The picked notebook's own place, as a row in `places`. Null while none is
   *  picked, or when its folder is not one the viewer can pick (it then stays
   *  put and every place is a shortcut). */
  existingHome: FilingPlace | null;
  /** Where the notebook is filed: the location first, then shortcuts. */
  places: FilingPlace[];
  /** True once the organizer added, removed or re-ranked a place, which stops the invited project from choosing one. */
  placesTouched: boolean;
  /** New notebook template; null uses the project or lab default. */
  templatePageId: string | null;
};

export const emptyMeetingNote: MeetingNoteState = {
  enabled: false,
  whiteboard: false,
  notebookMode: "new",
  existing: null,
  existingHome: null,
  title: "",
  titleEdited: false,
  places: [],
  placesTouched: false,
  templatePageId: null,
};

/** Whether at least one asset (note or whiteboard) is requested. */
export function meetingNoteActive(s: MeetingNoteState): boolean {
  return s.enabled || s.whiteboard;
}

/** Whether the shared meeting-asset fields are complete enough to submit. */
export function meetingNoteValid(s: MeetingNoteState): boolean {
  if (!s.enabled) return true;
  if (linkPlaces(s).length > MAX_FILING_LINKS) return false;
  return s.notebookMode === "existing" ? s.existing !== null : s.title.trim().length > 0;
}

function isLabTop(l: MeetingNoteLocation): boolean {
  return l.workspaceType === "Lab" && l.parentPageId === null;
}

function locationPayload(l: MeetingNoteLocation) {
  return { workspaceType: l.workspaceType, workspaceId: l.workspaceId, parentPageId: l.parentPageId };
}

/** How many leading places make up the location: none when the notebook's own
 *  place cannot be shown (or none is picked yet), else the first. */
function locationCount(s: MeetingNoteState): number {
  if (s.notebookMode === "existing" && (!s.existing || !s.existingHome)) return 0;
  return Math.min(1, s.places.length);
}

/** The place the notebook is filed at, when the list says so. */
export function locationPlace(s: MeetingNoteState): FilingPlace | null {
  return locationCount(s) > 0 ? s.places[0]! : null;
}

/** The places filed as shortcuts: every place but the location. */
export function linkPlaces(s: MeetingNoteState): FilingPlace[] {
  return s.places.slice(locationCount(s));
}

const placementKey = (l: { workspaceType: string; workspaceId: string | null; parentPageId: string | null }) =>
  `${l.workspaceType}:${l.workspaceId ?? ""}:${l.parentPageId ?? ""}`;

/** The picked notebook's own placement, in the shape the payloads carry. Null
 *  for a notebook that lives where a note cannot be filed. */
function ownLocation(nb: ExistingNotebook): ReturnType<typeof locationPayload> | null {
  if (nb.workspaceType !== "Lab" && nb.workspaceType !== "Project") return null;
  return { workspaceType: nb.workspaceType, workspaceId: nb.workspaceId, parentPageId: nb.parentPageId };
}

/** The notebook the note files into, as the create payloads carry it. A
 *  Lab-wide top-level primary is the default, so it is left out. */
export function notebookChoiceOf(s: MeetingNoteState): NotebookChoice | null {
  if (!s.enabled) return null;
  const links = linkPlaces(s).map((p) => locationPayload(p.location));
  const withLinks = links.length > 0 ? { links } : {};
  if (s.notebookMode === "existing") {
    if (!s.existing) return null;
    const top = locationPlace(s);
    const own = ownLocation(s.existing);
    const move = top && own && placementKey(top.location) !== placementKey(own) ? { location: locationPayload(top.location) } : {};
    return { existingId: s.existing.id, ...move, ...withLinks };
  }
  const primary = s.places[0]?.location;
  return {
    title: s.title.trim(),
    location: primary && !isLabTop(primary) ? locationPayload(primary) : null,
    templatePageId: s.templatePageId,
    ...withLinks,
  };
}

/** The project the meeting's assets belong to: the one the chosen notebook
 *  will be in, or the project the location is in. Null files them lab-wide. */
export function projectIdOf(s: MeetingNoteState): string | null {
  if (s.enabled && s.notebookMode === "existing") {
    const moved = locationPlace(s)?.location;
    if (moved) return moved.workspaceType === "Project" ? moved.workspaceId : null;
    return s.existing?.workspaceType === "Project" ? s.existing.workspaceId : null;
  }
  const primary = s.places[0]?.location;
  return primary?.workspaceType === "Project" ? primary.workspaceId : null;
}

/** The meeting-asset fields to merge into the /api/scheduled-meetings payload.
 *  Sends the `note`/`whiteboard` flags telling the server which artifacts to
 *  create, the project the assets belong to, and the notebook choice. A
 *  whiteboard without a note has no notebook, so the place it is filed rides
 *  as `noteLocation`. */
export function meetingNotePayload(s: MeetingNoteState): Record<string, unknown> {
  if (!meetingNoteActive(s)) return {};
  const out: Record<string, unknown> = { note: s.enabled, whiteboard: s.whiteboard };
  const projectId = projectIdOf(s);
  if (projectId) out.projectId = projectId;
  const notebook = notebookChoiceOf(s);
  if (notebook) out.notebook = notebook;
  const boardPlace = s.enabled ? undefined : s.places[0]?.location;
  if (boardPlace && !isLabTop(boardPlace)) out.noteLocation = locationPayload(boardPlace);
  return out;
}

/** Drives a note can be filed in: the server files into Lab or Project
 *  workspaces, so My Drive and Education are not offered. */
export function noteDestinationRows(rows: PickerRows): PickerRows {
  const drives = rows.drives.filter((d) => d.id !== "mine" && d.id !== "education");
  const ids = new Set(drives.map((d) => d.id));
  return { drives, folders: rows.folders.filter((f) => ids.has(f.driveId)) };
}

/** A picked destination as the location the create payload carries; null when
 *  it is not somewhere a note can be filed. */
export function noteLocationFromDest(dest: Destination, rows: PickerRows): MeetingNoteLocation | null {
  const target = resolveMoveTarget(dest, rows);
  if (!target || target.workspaceType === "EducationOffering") return null;
  const folder = dest.folderId ? rows.folders.find((f) => f.id === dest.folderId) : undefined;
  const inFolder = !!folder && target.parentPageId === dest.folderId;
  return {
    workspaceType: target.workspaceType,
    workspaceId: target.workspaceId,
    parentPageId: target.parentPageId,
    label: inFolder ? `${target.label} / ${folder.title}` : target.label,
  };
}

/** A picked destination as a filing place; null when it is not somewhere a
 *  note can be filed. `rows` are the rows the destination came from. */
export function placeFromDest(dest: Destination, rows: PickerRows): FilingPlace | null {
  const location = noteLocationFromDest(dest, rows);
  if (!location) return null;
  const path = destinationPath(
    dest,
    new Map(rows.drives.map((d) => [d.id, d])),
    new Map(rows.folders.map((f) => [f.id, f])),
  ).join(" / ");
  return { dest, location, path };
}

function selectionOf(places: FilingPlace[]): MultiSelection {
  return selectionFrom(places.map((p) => p.dest));
}

function orderedBy(places: FilingPlace[], sel: MultiSelection): FilingPlace[] {
  const byKey = new Map(places.map((p) => [destinationKey(p.dest), p]));
  const ordered = sel.items.flatMap((d) => byKey.get(destinationKey(d)) ?? []);
  const primary = primaryOf(sel);
  if (!primary) return ordered;
  const key = destinationKey(primary);
  return [
    ...ordered.filter((p) => destinationKey(p.dest) === key),
    ...ordered.filter((p) => destinationKey(p.dest) !== key),
  ];
}

export function hasPlace(places: FilingPlace[], dest: Destination): boolean {
  const key = destinationKey(dest);
  return places.some((p) => destinationKey(p.dest) === key);
}

/** The first place added is the primary; later ones are links. */
export function addPlace(places: FilingPlace[], place: FilingPlace): FilingPlace[] {
  return orderedBy([...places, place], addSelection(selectionOf(places), place.dest));
}

/** Removing the primary promotes the next place. */
export function removePlace(places: FilingPlace[], dest: Destination): FilingPlace[] {
  return orderedBy(places, removeSelection(selectionOf(places), dest));
}

export function makePrimaryPlace(places: FilingPlace[], dest: Destination): FilingPlace[] {
  return orderedBy(places, setPrimary(selectionOf(places), dest));
}

/** Moves the place at `from` to `to`, shifting the ones between. The top of
 *  the list is the location, so moving a place there makes it the location. */
export function reorderPlaces(places: FilingPlace[], from: number, to: number): FilingPlace[] {
  if (from === to || from < 0 || to < 0 || from >= places.length || to >= places.length) return places;
  const next = [...places];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** An existing notebook's own place as a row, found among the folders the viewer
 *  can pick. Null when its folder is not one of them. */
export function notebookHomePlace(nb: ExistingNotebook, rows: PickerRows): FilingPlace | null {
  const own = ownLocation(nb);
  if (!own) return null;
  const folder = nb.parentPageId ? rows.folders.find((f) => f.id === nb.parentPageId) : undefined;
  const dest: Destination | null = folder
    ? { driveId: folder.driveId, folderId: folder.id }
    : own.workspaceType === "Lab" && own.parentPageId === null
      ? { driveId: "lab", folderId: null }
      : null;
  const place = dest ? placeFromDest(dest, rows) : null;
  return place && placementKey(place.location) === placementKey(own) ? place : null;
}

/** `places` with `home` as the location and any other copy of it removed. */
export function withHomeOnTop(places: FilingPlace[], home: FilingPlace | null): FilingPlace[] {
  return home ? [home, ...withoutPlace(places, home)] : places;
}

/** `places` without `place`, wherever it sits. */
export function withoutPlace(places: FilingPlace[], place: FilingPlace | null): FilingPlace[] {
  if (!place) return places;
  const key = destinationKey(place.dest);
  return places.filter((p) => destinationKey(p.dest) !== key);
}

/** The places a multi-mode FolderPicker confirmed. Places the picker could not
 *  resolve to a notebook location are dropped, and a primary that is dropped
 *  hands the role to the first place left. */
export function placesFromPicker(result: MultiResult, previous: FilingPlace[], rows: PickerRows): FilingPlace[] {
  const known = new Map(previous.map((p) => [destinationKey(p.dest), p]));
  const picked: FilingPlace[] = [];
  let primaryAt = 0;
  result.destinations.forEach((dest, i) => {
    const place = known.get(destinationKey(dest)) ?? placeFromDest(dest, rows);
    if (!place) return;
    if (i === result.primaryIndex) primaryAt = picked.length;
    picked.push(place);
  });
  return orderedBy(picked, selectionFrom(picked.map((p) => p.dest), primaryAt));
}

export type FilingTarget = { kind: "project"; projectId: string } | { kind: "core" };

/** A project's or Core's Meetings receiver, else the project or Core root.
 *  Null when the viewer's rows do not include it. */
export function receiverDest(rows: PickerRows, target: FilingTarget): Destination | null {
  if (target.kind === "core") {
    if (!rows.drives.some((d) => d.id === "core")) return null;
    const meetings = rows.folders
      .filter((f) => f.driveId === "core" && f.folderType === "Meetings")
      .sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null))[0];
    return { driveId: "core", folderId: meetings?.id ?? null };
  }
  if (!rows.folders.some((f) => f.driveId === "projects" && f.id === target.projectId)) return null;
  let level = [target.projectId];
  const seen = new Set(level);
  while (level.length > 0) {
    const children = rows.folders.filter((f) => f.driveId === "projects" && f.parentId !== null && level.includes(f.parentId) && !seen.has(f.id));
    const meetings = children.find((f) => f.folderType === "Meetings");
    if (meetings) return { driveId: "projects", folderId: meetings.id };
    children.forEach((f) => seen.add(f.id));
    level = children.map((f) => f.id);
  }
  return { driveId: "projects", folderId: target.projectId };
}

/** Where a group's meetings belong: its project or Core. Offerings have no
 *  place a notebook can be filed, so they get none. */
export function groupFilingDest(
  group: { projectId: string | null; systemKey: string | null },
  rows: PickerRows,
): Destination | null {
  if (group.systemKey === "core") return receiverDest(rows, { kind: "core" });
  if (group.projectId) return receiverDest(rows, { kind: "project", projectId: group.projectId });
  return null;
}

/** The place a project's meetings are filed in by default; null without a project, where the server's default applies. */
export function defaultPlaceFor(projectId: string | null, rows: PickerRows): FilingPlace | null {
  if (!projectId) return null;
  const dest = receiverDest(rows, { kind: "project", projectId });
  return dest ? placeFromDest(dest, rows) : null;
}
