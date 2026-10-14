import type { PickedNotebook } from "~/components/notebooks/notebook-picker";
import type { NotebookChoice, NotebookSpaceChoice } from "~/lib/notebook-choice";
import type { GroupOption } from "~/calendar/lib/types";
import { PAIR_REASON } from "~/calendar/lib/suggest-filing";

export type NoteSpace = {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  label: string;
  /** Core's own folder inside the Lab workspace. */
  core?: boolean;
};

export const GENERAL_SPACE: NoteSpace = { workspaceType: "Lab", workspaceId: null, label: "General" };
export const CORE_SPACE: NoteSpace = { workspaceType: "Lab", workspaceId: null, label: "Core", core: true };

export function spaceChoiceOf(space: NoteSpace): NotebookSpaceChoice {
  if (space.core) return { kind: "core" };
  if (space.workspaceType === "Project" && space.workspaceId) return { kind: "project", projectId: space.workspaceId };
  return { kind: "lab" };
}

/** The workspace the picker lists and the notebooks API filters by. */
export function pickerSpaceOf(space: NoteSpace): { workspaceType: string; workspaceId: string | null } {
  return space.core
    ? { workspaceType: "Core", workspaceId: null }
    : { workspaceType: space.workspaceType, workspaceId: space.workspaceId };
}

export type PlaceNotebook = Pick<PickedNotebook, "id" | "title" | "path"> & {
  workspaceType: string | null;
  workspaceId: string | null;
};

export type MeetingPlace =
  | { kind: "existing"; notebook: PlaceNotebook }
  | { kind: "new"; title: string; titleEdited: boolean; templatePageId: string | null; space: NoteSpace };

export type MeetingNoteState = {
  enabled: boolean;
  whiteboard: boolean;
  place: MeetingPlace | null;
  reason: string | null;
  auto: boolean;
};

export const emptyMeetingNote: MeetingNoteState = {
  enabled: false,
  whiteboard: false,
  place: null,
  reason: null,
  auto: false,
};

export const SERIES_REASON = "this meeting's notebook";
export const HISTORY_REASON = "last used by this group";
export const PICK_PLACE_COPY = "Pick where the notes go";

export type DefaultNotebookResult = {
  kind: "series" | "history" | "pair" | "new";
  notebook: { id: string; title: string; path: string } | null;
  newPath: string;
};

export type NoteInvite = { projectId: string | null; coreInvited: boolean };

type InvitedGroup = Pick<GroupOption, "projectId" | "systemKey" | "name">;

export function inviteOf(invited: Pick<GroupOption, "projectId" | "systemKey">[]): NoteInvite {
  const only = invited.length === 1 ? invited[0]! : null;
  return {
    projectId: only?.projectId ?? null,
    coreInvited: invited.some((g) => g.systemKey === "core"),
  };
}

export function inviteSpaceOf(invited: InvitedGroup[]): NoteSpace {
  const only = invited.length === 1 ? invited[0]! : null;
  if (only?.projectId) return { workspaceType: "Project", workspaceId: only.projectId, label: only.name };
  if (invited.some((g) => g.systemKey === "core")) return CORE_SPACE;
  return GENERAL_SPACE;
}

export function spaceOfGroup(g: InvitedGroup): NoteSpace | null {
  if (g.systemKey === "core") return CORE_SPACE;
  if (g.projectId) return { workspaceType: "Project", workspaceId: g.projectId, label: g.name };
  return null;
}

export function meetingNoteValid(s: MeetingNoteState): boolean {
  if (!s.enabled) return true;
  if (!s.place) return false;
  return s.place.kind === "existing" || s.place.title.trim().length > 0;
}

export function meetingNoteActive(s: MeetingNoteState): boolean {
  return s.enabled || s.whiteboard;
}

export function notebookChoiceOf(s: MeetingNoteState): NotebookChoice | null {
  if (!s.enabled || !s.place) return null;
  if (s.place.kind === "existing") return { existingId: s.place.notebook.id };
  return { title: s.place.title.trim(), templatePageId: s.place.templatePageId, space: spaceChoiceOf(s.place.space) };
}

function placeProjectId(place: MeetingPlace | null): string | null {
  if (!place) return null;
  if (place.kind === "existing") {
    return place.notebook.workspaceType === "Project" ? place.notebook.workspaceId : null;
  }
  return place.space.workspaceType === "Project" ? place.space.workspaceId : null;
}

export function meetingNotePayload(s: MeetingNoteState, invite: NoteInvite): Record<string, unknown> {
  if (!meetingNoteActive(s)) return {};
  const out: Record<string, unknown> = { note: s.enabled, whiteboard: s.whiteboard };
  const projectId = invite.projectId ?? placeProjectId(s.place);
  if (projectId) out.projectId = projectId;
  if (invite.coreInvited || (s.place?.kind === "new" && s.place.space.core)) out.isCoreMeeting = true;
  const notebook = notebookChoiceOf(s);
  if (notebook) out.notebook = notebook;
  return out;
}

export function placeLine(place: MeetingPlace): string {
  return place.kind === "existing"
    ? `${place.notebook.title} · ${place.notebook.path}`
    : `New notebook “${place.title.trim()}” · ${place.space.label}`;
}

export function placeSpaceLabel(place: MeetingPlace): string {
  return place.kind === "existing" ? place.notebook.path : place.space.label;
}

export function withEnabled(s: MeetingNoteState, enabled: boolean): MeetingNoteState {
  return enabled ? { ...s, enabled } : { ...s, enabled, place: null, reason: null, auto: false };
}

export function withPickedNotebook(
  s: MeetingNoteState,
  notebook: PlaceNotebook,
  reason: string | null = null,
): MeetingNoteState {
  return { ...s, place: { kind: "existing", notebook }, reason, auto: false };
}

export function withNewNotebook(s: MeetingNoteState, space: NoteSpace, title: string): MeetingNoteState {
  return {
    ...s,
    place: { kind: "new", title, titleEdited: false, templatePageId: null, space },
    reason: null,
    auto: false,
  };
}

export function withTitle(s: MeetingNoteState, title: string): MeetingNoteState {
  return s.place?.kind === "new" ? { ...s, place: { ...s.place, title, titleEdited: true } } : s;
}

export function withPrefilledTitle(s: MeetingNoteState, title: string): MeetingNoteState {
  const p = s.place;
  if (p?.kind !== "new" || p.titleEdited || p.title === title) return s;
  return { ...s, place: { ...p, title } };
}

export function withTemplate(s: MeetingNoteState, templatePageId: string | null): MeetingNoteState {
  return s.place?.kind === "new" ? { ...s, place: { ...s.place, templatePageId } } : s;
}

const DEFAULT_REASONS = { series: SERIES_REASON, history: HISTORY_REASON, pair: PAIR_REASON } as const;

export function withDefault(s: MeetingNoteState, def: DefaultNotebookResult): MeetingNoteState {
  if (s.place && !s.auto) return s;
  if (def.kind === "new" || !def.notebook) return s.auto ? { ...s, place: null, reason: null, auto: false } : s;
  return {
    ...s,
    place: { kind: "existing", notebook: { ...def.notebook, workspaceType: null, workspaceId: null } },
    reason: DEFAULT_REASONS[def.kind],
    auto: true,
  };
}

export function clearPlace(s: MeetingNoteState): MeetingNoteState {
  return { ...s, place: null, reason: null, auto: false };
}

export type DefaultNotebookQuery = {
  meetingId?: string | null;
  scopeGroupId: string | null;
  invite: NoteInvite;
  /** The mentee on a 1:1 with the viewer's mentee. */
  pairMenteeId?: string | null;
};

export function defaultNotebookQueryString({
  meetingId,
  scopeGroupId,
  invite,
  pairMenteeId,
}: DefaultNotebookQuery): string {
  const params = new URLSearchParams();
  params.set("scopeType", scopeGroupId ? "Group" : "UserList");
  if (scopeGroupId) params.set("groupId", scopeGroupId);
  if (meetingId) params.set("meetingId", meetingId);
  if (invite.projectId) params.set("projectId", invite.projectId);
  if (invite.coreInvited) params.set("isCoreMeeting", "1");
  if (pairMenteeId) params.set("pairMenteeId", pairMenteeId);
  return params.toString();
}

export async function fetchDefaultNotebook(query: DefaultNotebookQuery): Promise<DefaultNotebookResult> {
  const res = await fetch(`/api/notebooks/default?${defaultNotebookQueryString(query)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return (await res.json()) as DefaultNotebookResult;
}

/** The viewer's pair notebook with this mentee, made if it does not exist yet. */
export async function fetchPairNotebook(menteeId: string): Promise<PlaceNotebook> {
  const res = await fetch("/api/notebooks/mentorship-pair", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menteeId }),
  });
  if (!res.ok) throw new Error("Request failed");
  return (await res.json()) as PlaceNotebook;
}
