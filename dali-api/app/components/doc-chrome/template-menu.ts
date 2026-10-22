import type { SelectOption } from "~/components/ui/floating";

export type MeetingNoteType = "Team" | "Partner" | "Other";

export const MEETING_NOTE_DEFAULT_LABEL: Record<MeetingNoteType, string> = {
  Team: "Project notebooks",
  Other: "Other notebooks",
  Partner: "Partner meetings (retired)",
};

// Notebook filing records a project note as Team and every other note as
// Other, so those are the two defaults worth offering. Partner only appears
// while a page still holds it, so Core can see it and clear it.
export function labMeetingNoteDefaultOptions(
  current: MeetingNoteType | null,
): SelectOption<"none" | MeetingNoteType>[] {
  return [
    { value: "none", label: "No default" },
    { value: "Team", label: MEETING_NOTE_DEFAULT_LABEL.Team },
    { value: "Other", label: MEETING_NOTE_DEFAULT_LABEL.Other },
    ...(current === "Partner" ? [{ value: "Partner" as const, label: MEETING_NOTE_DEFAULT_LABEL.Partner }] : []),
  ];
}

export function templateToggleLabel(marked: boolean, workspaceType: string): string {
  if (marked) return "Unmark as template";
  return workspaceType === "Member" ? "Mark as private template" : "Mark as template";
}
