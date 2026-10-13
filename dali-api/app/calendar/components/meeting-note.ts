// Pure state model + derivation for the meeting-note fields, kept free of React
// so it can be unit-tested and reused. The UI (hook + component) lives in
// MeetingNoteFields.tsx and re-exports these.
//
// The single question is "what is this meeting about?":
//   • a project → project meeting; sub-type Team (default), Partner, or Other
//     with an organizer-typed name. Team/Partner notes are filed in the
//     project's meeting-notes folders; Other notes at the project's top level
//     (server-side).
//   • General   → no project; needs a short name, and the note can be filed at any
//     Drive location the organizer can write to (default: Lab-wide).
// Team/Partner require a project, so "Team + no project" is unreachable.
//
// A Core meeting is a third shape of the same "General" case: Core isn't a
// project, so a project-less Core note files in Core's own folder and draws no
// Team/Partner distinction — the picker shows "Core" for the empty answer.
// A Core meeting may also be about a project, in which case its note is an
// ordinary project note filed in the project — see the `core` prop on
// MeetingNoteFields. Either way this pure model is unchanged: `about` is "" or a
// projectId, and whether "" means General or Core is decided server-side by the
// meeting's isCoreMeeting flag.

import type { Destination } from "~/components/drive/FolderPicker";
import { resolveMoveTarget } from "~/components/drive/move-target";
import type { PickerRows } from "~/components/drive/picker-rows";

export type MeetingNoteLocation = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  parentPageId: string | null;
  label: string;
};

export type MeetingNoteState = {
  /** Create a shared note doc for this meeting. */
  enabled: boolean;
  /** Create a shared whiteboard for this meeting (files alongside the note, uses
   *  the same About/type). Independent of `enabled` — a meeting can have either,
   *  both, or neither. */
  whiteboard: boolean;
  /** "" = General (no project); otherwise a projectId. */
  about: string;
  /** Only meaningful when `about` is a project. */
  subtype: "Team" | "Partner" | "Other";
  /** General or project-"Other" meeting name (persisted as meetingTypeLabel). */
  label: string;
  /** General destination; null → Lab-wide top level (the default/fallback). */
  location: MeetingNoteLocation | null;
};

/** Default name for a Core meeting's note. Core notes take the General path
 *  (meetingType "Other"), which needs a label, so this keeps the field valid
 *  from the moment the Core toggle goes on. */
export const CORE_NOTE_LABEL = "Core meeting";

/** Where a Core meeting's assets are filed, for the read-only destination row.
 *  Mirrors ensureCoreMeetingNotesFolder's placement (the Core drive's "Meeting
 *  assets" folder) — the server does the actual filing, so no location is ever
 *  sent. */
export const CORE_NOTE_FOLDER_LABEL = "Core / Meeting assets";

export const emptyMeetingNote: MeetingNoteState = {
  enabled: false,
  whiteboard: false,
  about: "",
  subtype: "Team",
  label: "",
  location: null,
};

/** Whether at least one asset (note or whiteboard) is requested. */
export function meetingNoteActive(s: MeetingNoteState): boolean {
  return s.enabled || s.whiteboard;
}

/** Whether the shared meeting-asset fields are complete enough to submit. */
export function meetingNoteValid(s: MeetingNoteState): boolean {
  if (!meetingNoteActive(s)) return true;
  if (s.about === "" || s.subtype === "Other") return s.label.trim().length > 0;
  return true;
}

/** The meeting-asset fields to merge into the /api/scheduled-meetings payload.
 *  When either asset is requested, sends the derived meetingType/project plus the
 *  `note`/`whiteboard` flags telling the server which artifacts to create. */
export function meetingNotePayload(s: MeetingNoteState): Record<string, unknown> {
  if (!meetingNoteActive(s)) return {};
  const out: Record<string, unknown> = { note: s.enabled, whiteboard: s.whiteboard };
  if (s.about !== "") {
    if (s.subtype === "Other") {
      out.meetingType = "Other";
      out.meetingTypeLabel = s.label.trim();
      out.projectId = s.about;
    } else {
      out.meetingType = s.subtype;
      out.projectId = s.about;
    }
    return out;
  }
  out.meetingType = "Other";
  out.meetingTypeLabel = s.label.trim();
  // Only send a location when it deviates from the Lab-wide default — an omitted
  // noteLocation lets the server file the assets at the default folder (identical
  // result).
  if (s.location && !(s.location.workspaceType === "Lab" && s.location.parentPageId === null)) {
    out.noteLocation = {
      workspaceType: s.location.workspaceType,
      workspaceId: s.location.workspaceId,
      parentPageId: s.location.parentPageId,
    };
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
