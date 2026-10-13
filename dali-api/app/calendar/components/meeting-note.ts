// Pure state model + derivation for the meeting-note fields, kept free of React
// so it can be unit-tested and reused. The UI (hook + component) lives in
// MeetingNoteFields.tsx and re-exports these.
//
// Two questions. "What is this meeting about?" is `about`: "" or a projectId.
// Whether "" means General or Core is decided server-side by the meeting's
// isCoreMeeting flag, and `about` still picks the default location of a new
// notebook. "Which notebook?" is the notebook choice: an existing one, or a new
// one with a name, an optional location and an optional template. The server
// derives the legacy meeting type from the choice.

import type { Destination } from "~/components/drive/FolderPicker";
import { resolveMoveTarget } from "~/components/drive/move-target";
import type { PickerRows } from "~/components/drive/picker-rows";
import type { NotebookChoice } from "~/lib/notebook-choice";

export type MeetingNoteLocation = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  parentPageId: string | null;
  label: string;
};

export type ExistingNotebook = { id: string; title: string; path: string };

export type MeetingNoteState = {
  /** Create a shared note doc for this meeting. */
  enabled: boolean;
  /** Create a shared whiteboard for this meeting (files by About, and in the
   *  chosen folder for a General meeting). Independent of `enabled`: a meeting
   *  can have either, both, or neither. */
  whiteboard: boolean;
  /** "" = General (no project); otherwise a projectId. */
  about: string;
  notebookMode: "existing" | "new";
  /** The notebook picked in "Add to existing" mode. */
  existing: ExistingNotebook | null;
  /** The new notebook's name. */
  title: string;
  /** True once the organizer typed a name, which stops the meeting-title prefill. */
  titleEdited: boolean;
  /** New notebook location; null files it where About says (Lab-wide, Core, or the project). */
  location: MeetingNoteLocation | null;
  /** New notebook template; null uses the project or lab default. */
  templatePageId: string | null;
};

/** Where a Core meeting's notes are filed by default, for the location row. */
export const CORE_NOTE_FOLDER_LABEL = "Core / Meeting assets";

export const emptyMeetingNote: MeetingNoteState = {
  enabled: false,
  whiteboard: false,
  about: "",
  notebookMode: "new",
  existing: null,
  title: "",
  titleEdited: false,
  location: null,
  templatePageId: null,
};

/** Whether at least one asset (note or whiteboard) is requested. */
export function meetingNoteActive(s: MeetingNoteState): boolean {
  return s.enabled || s.whiteboard;
}

/** Whether the shared meeting-asset fields are complete enough to submit. */
export function meetingNoteValid(s: MeetingNoteState): boolean {
  if (!s.enabled) return true;
  return s.notebookMode === "existing" ? s.existing !== null : s.title.trim().length > 0;
}

function isLabTop(l: MeetingNoteLocation): boolean {
  return l.workspaceType === "Lab" && l.parentPageId === null;
}

function locationPayload(l: MeetingNoteLocation) {
  return { workspaceType: l.workspaceType, workspaceId: l.workspaceId, parentPageId: l.parentPageId };
}

/** The notebook the note files into, as the create payloads carry it. A
 *  Lab-wide top-level location is the default, so it is left out. */
export function notebookChoiceOf(s: MeetingNoteState): NotebookChoice | null {
  if (!s.enabled) return null;
  if (s.notebookMode === "existing") return s.existing ? { existingId: s.existing.id } : null;
  return {
    title: s.title.trim(),
    location: s.location && !isLabTop(s.location) ? locationPayload(s.location) : null,
    templatePageId: s.templatePageId,
  };
}

/** The meeting-asset fields to merge into the /api/scheduled-meetings payload.
 *  Sends the `note`/`whiteboard` flags telling the server which artifacts to
 *  create, the project the meeting is about, and the notebook choice. A
 *  whiteboard without a note has no notebook, so a General meeting's chosen
 *  folder rides as `noteLocation`. */
export function meetingNotePayload(s: MeetingNoteState): Record<string, unknown> {
  if (!meetingNoteActive(s)) return {};
  const out: Record<string, unknown> = { note: s.enabled, whiteboard: s.whiteboard };
  if (s.about !== "") out.projectId = s.about;
  const notebook = notebookChoiceOf(s);
  if (notebook) out.notebook = notebook;
  if (!s.enabled && s.about === "" && s.location && !isLabTop(s.location)) {
    out.noteLocation = locationPayload(s.location);
  }
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

/** Where the picker opens for the note's current location (Lab-wide by default). */
export function noteInitialDest(location: MeetingNoteLocation | null, rows: PickerRows): Destination {
  const lab: Destination = { driveId: "lab", folderId: null };
  if (!location) return lab;
  if (location.workspaceType === "Project") {
    const driveId = "projects";
    const folderId = location.parentPageId ?? location.workspaceId;
    return folderId && rows.folders.some((f) => f.driveId === driveId && f.id === folderId)
      ? { driveId, folderId }
      : lab;
  }
  const parent = location.parentPageId;
  if (!parent) return lab;
  const folder = rows.folders.find((f) => f.id === parent);
  if (folder) return { driveId: folder.driveId, folderId: folder.id };
  const root = rows.drives.find((d) => d.rootFolderId === parent);
  return root ? { driveId: root.id, folderId: null } : lab;
}
