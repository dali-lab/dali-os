// Pure state model + derivation for the meeting-note fields, kept free of React
// so it can be unit-tested and reused. The UI (hook + component) lives in
// MeetingNoteFields.tsx and re-exports these.
//
// The single question is "what is this meeting about?":
//   • a project → project meeting; sub-type Team (default) or Partner. The note
//     is filed in that project's meeting-notes folder (server-side).
//   • General   → no project; needs a short name, and the note can be filed at any
//     Drive location the organizer can write to (default: Lab-wide).
// Type is derived from the project choice, so the old illegal combos ("Other + a
// project", "Team + no project") are unreachable.

export type MeetingNoteLocation = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  parentPageId: string | null;
  label: string;
};

export type MeetingNoteState = {
  enabled: boolean;
  /** "" = General (no project); otherwise a projectId. */
  about: string;
  /** Only meaningful when `about` is a project. */
  subtype: "Team" | "Partner";
  /** General meeting name (persisted as meetingTypeLabel). */
  label: string;
  /** General note destination; null → Lab-wide top level (the default/fallback). */
  location: MeetingNoteLocation | null;
};

export const emptyMeetingNote: MeetingNoteState = {
  enabled: false,
  about: "",
  subtype: "Team",
  label: "",
  location: null,
};

/** Whether the note fields are complete enough to submit. */
export function meetingNoteValid(s: MeetingNoteState): boolean {
  if (!s.enabled) return true;
  if (s.about === "") return s.label.trim().length > 0; // General needs a name
  return true; // project path is always valid (Team/Partner + project)
}

/** The note-related fields to merge into the /api/scheduled-meetings payload. */
export function meetingNotePayload(s: MeetingNoteState): Record<string, unknown> {
  if (!s.enabled) return {};
  if (s.about !== "") {
    return { meetingType: s.subtype, projectId: s.about };
  }
  const out: Record<string, unknown> = {
    meetingType: "Other",
    meetingTypeLabel: s.label.trim(),
  };
  // Only send a location when it deviates from the Lab-wide default — an omitted
  // noteLocation lets the server file the note at the Lab root (identical result).
  if (s.location && !(s.location.workspaceType === "Lab" && s.location.parentPageId === null)) {
    out.noteLocation = {
      workspaceType: s.location.workspaceType,
      workspaceId: s.location.workspaceId,
      parentPageId: s.location.parentPageId,
    };
  }
  return out;
}
