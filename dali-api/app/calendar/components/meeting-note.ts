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
// project, so its note has no project to file under and no Team/Partner
// distinction to draw. The About question has one answer there, so the picker
// collapses to a fixed "Core" — see the `core` prop on MeetingNoteFields.

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
