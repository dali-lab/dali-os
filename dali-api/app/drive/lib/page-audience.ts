// Client-safe shape of the "who can see this" summary. Computed server-side by
// summarizeAudience (page-audience.server.ts) and carried on DriveItem.

export type AudienceKind = "private" | "people" | "group" | "project" | "lab" | "public";
export type AudiencePermission = "View" | "Comment" | "Edit";

export interface AudiencePerson {
  id: string;
  name: string;
  photoUrl: string | null;
}

export interface Audience {
  kind: AudienceKind;
  label: string;
  /** Named share principals (people plus groups) on the page itself. */
  count?: number;
  /** The folder whose scope governs this page, when it is not the page itself. */
  inheritedFrom?: { id: string; title: string } | null;
  permission: AudiencePermission;
  /** First few named people. Only present for viewers who can manage sharing. */
  people?: AudiencePerson[];
  /** The viewer may manage sharing on this page. */
  canManage?: boolean;
  /** People a meeting's roster lets edit this page; present only when there are some. */
  meetingEditors?: number;
}

export const AUDIENCE_PERMISSION_LABEL: Record<AudiencePermission, string> = {
  View: "Can view",
  Comment: "Can comment",
  Edit: "Can edit",
};

/** The folder scope a page inherits, for the Share dialog's "Inherited from" block. */
export interface InheritedScope {
  folderId: string;
  title: string;
  scopeKind: "Private" | "Lab" | "Group";
  groupName: string | null;
  permission: AudiencePermission;
}

/** One line of "who has access by default", for the Share dialog. */
export function audienceLine(audience: Audience): string {
  const base = baseAudienceLine(audience);
  const n = audience.meetingEditors;
  return n ? `${base} · ${n} meeting ${n === 1 ? "attendee" : "attendees"} can edit` : base;
}

function baseAudienceLine(audience: Audience): string {
  if (audience.kind !== "group" && audience.kind !== "lab" && audience.kind !== "public") {
    return audience.label;
  }
  const perm = AUDIENCE_PERMISSION_LABEL[audience.permission];
  return `${audience.label} · ${perm.charAt(0).toLowerCase()}${perm.slice(1)}`;
}
