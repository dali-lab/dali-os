// Wire contract between the mobile app and dali-api (/api/mobile/*, /api/meeting-recordings/*).
// Every route takes `Authorization: Bearer <token>` (device-pairing token) and returns
// JSON. Errors are `{ error: string }` with a 4xx/5xx status. Dates are ISO strings.
// All routes 404 `{ error: "Not found" }` when the `mobile-app` feature flag is off for the user.

export type Presence = 'active' | 'away' | 'offline';
export type TaskStatus = 'Backlog' | 'Todo' | 'InProgress' | 'InReview' | 'Done' | 'Cancelled';
export type Rsvp = 'accepted' | 'tentative' | 'declined' | 'needs_action';

/** A lab member as the app shows them (attendee, assignee, teammate). */
export interface MemberSummary {
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null; // resolved, fetchable URL
  presence: Presence;
  title: string; // e.g. "Fullstack Dev · Delivery Lead"; "" if none
  term: string; // current term code e.g. "26F", or "Staff"
  roles: string[]; // domain names + "Core" etc.
}

// GET /api/mobile/me
export interface MeResponse {
  user: MemberSummary;
  netId: string | null;
  classYear: number | null;
  basedIn: string | null; // currentLocation
  timeZone: string | null;
  emails: string[]; // dali first, then dartmouth, then personal; deduped
  phone: string | null;
  github: string | null;
  leadRoles: string[]; // e.g. "Core — Delivery Lead"
  domainLevels: { domain: string; level: string }[]; // level "P1" | "P2" | "P3"
  groups: string[];
}

// PUT /api/mobile/me  body { status: 'active' | 'away' } -> { ok: true }
export interface SetStatusBody {
  status: 'active' | 'away';
}

// GET /api/mobile/projects -> the projects the viewer is staffed on this term (not archived)
export interface ProjectSummary {
  id: string;
  name: string;
  status: 'Active' | 'Paused' | 'Archived';
  terms: string[];
  myRole: string | null; // domain name of the viewer's assignment
  myLeadRole: string | null;
}
export interface ProjectsResponse {
  projects: ProjectSummary[];
}

// GET /api/mobile/projects/:id -> board for one project
export interface Task {
  id: string;
  title: string;
  description: string | null; // plain text
  status: TaskStatus;
  assigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  role: string | null; // domain name
  epicId: string | null;
  commentCount: number;
  attachmentCount: number;
  linkRef: string | null; // linked GitHub PR/issue number
}
export interface Epic {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}
export interface ProjectBoardResponse {
  project: ProjectSummary & {
    roles: string[]; // domains on the project
    memberIds: string[];
    sprint: { number: number; startDate: string; endDate: string } | null;
    doneCount: number;
    totalCount: number;
  };
  members: MemberSummary[];
  epics: Epic[];
  tasks: Task[]; // excludes archived; includes Done
}

// POST /api/tasks/:id/move { status, position: 0 } (existing route) -> { ok: true }

// GET /api/mobile/calendar?from=ISO&to=ISO (max 62 days)
export type EventCategory = 'dali' | 'interview' | 'class' | 'personal';
export interface CalendarEvent {
  id: string; // unique per occurrence
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  category: EventCategory; // dali = DALI meetings, interview = hiring interviews, others from external calendars
  rsvp: Rsvp;
  rsvpNotificationId: string | null; // pass to POST /api/notifications/:id/rsvp
  calendar: string; // source calendar label (email or "DALI OS")
  attendeeIds: string[];
  description: string | null;
  link: string | null; // web path on DALI OS
  scheduledMeetingId: string | null; // DALI meetings only
  occurrenceStart: string | null; // the occurrence's original start, DALI meetings only
}
export interface CalendarResponse {
  events: CalendarEvent[];
  people: MemberSummary[]; // every attendee across `events`
}

// POST /api/mobile/calendar -> { id, addedToGoogle, googleError } : a DALI meeting you organize
export interface CreateEventBody {
  title: string;
  startTime: string;
  durationMinutes: number; // 5-480
  participantUserIds: string[]; // others to invite; empty = just you
  location?: string | null;
  description?: string | null;
  addToGoogle: boolean; // put it on your linked Google calendar (with invites)
  addMeet: boolean; // attach a Google Meet link (needs addToGoogle)
}

// GET /api/mobile/people?q= -> { people: MemberSummary[] } : current-term members to invite (q >= 2 chars)

// GET /api/mobile/pass
export interface PassResponse {
  passId: string; // display id
  qrPayload: string; // the signed wallet token (same as the Apple Wallet barcode)
  name: string;
  memberSince: string | null; // term code e.g. "25W"
  accessLevel: string; // e.g. "Core · 24/7 lab access" / "Member"
  validThrough: string | null; // display date
  checkIns: { id: string; location: string; at: string }[]; // latest 20 present attendances
}

// ---------------- Time (/api/mobile/time) ----------------

export type AssignmentType = 'Project' | 'Core' | 'Instructor' | 'DomainLead' | 'Admin' | 'Custom';

/** A paid role hours can bill to. */
export interface Role {
  assignmentType: AssignmentType;
  roleRefId: string;
  label: string; // e.g. "DALI OS Fullstack Dev", "Delivery Lead"
  detail: string; // the kind of role, e.g. "Project", "Core"
  projectId: string | null;
}

export interface TimeEntry {
  id: string;
  source: 'Meeting' | 'Manual';
  day: string; // yyyy-MM-dd in the member's zone
  hours: number;
  note: string | null;
  startTime: string | null;
  endTime: string | null;
  assignmentType: AssignmentType | null;
  roleRefId: string | null;
  projectId: string | null;
  scheduledMeetingId: string | null;
  occurrenceStart: string | null;
  meetingTitle: string | null;
}

// GET /api/mobile/time?date=yyyy-MM-dd (default today) -> the pay period containing that day
export interface TimeResponse {
  today: string;
  period: { start: string; end: string }; // inclusive yyyy-MM-dd
  roles: Role[];
  entries: TimeEntry[];
}

// POST /api/mobile/time -> { id }. `hours` must match the start/end span (<= 24h).
// With scheduledMeetingId the hours link to that meeting occurrence (one per member).
export interface AddTimeEntryBody {
  date: string; // yyyy-MM-dd
  hours: number;
  assignmentType: AssignmentType;
  roleRefId: string;
  note?: string | null;
  startTime: string;
  endTime: string;
  scheduledMeetingId?: string;
}
// PATCH /api/mobile/time/:id { any AddTimeEntryBody field except scheduledMeetingId } -> { ok: true }
// DELETE /api/mobile/time/:id -> { ok: true }

// ---------------- Meeting notes ----------------

export type RecordingStatus = 'Pending' | 'Recording' | 'Stopped' | 'Processing' | 'Done' | 'Failed';

export interface NoteSummary {
  id: string; // MeetingRecording id
  title: string;
  status: RecordingStatus;
  createdAt: string;
  recordedSeconds: number;
  scheduledMeetingId: string | null;
  occurrenceStart: string | null;
  enhancedAt: string | null;
  actionItemCount: number;
  tasksCreated: number;
}

/** A note the member typed (no recording): a personal note or a page in a notebook. */
export interface TypedNote {
  id: string; // page id
  title: string;
  updatedAt: string;
  notebook: string | null; // the notebook it's filed in; null for a personal note
}

// GET /api/mobile/notes[?cursor=] -> a page of up to 30 recordings and 30 typed notes, newest first
export interface NotesResponse {
  recordingEnabled: boolean; // AI meeting notes flag on and transcription configured
  notes: NoteSummary[];
  pages: TypedNote[];
  /** Pass as ?cursor= for the next page. Absent from older servers; null on the last page. */
  nextCursor?: string | null;
}
// POST /api/mobile/notes { title } | { scheduledMeetingId, occurrenceStart } -> { pageId, documentName }
//   a new personal note, or a calendar meeting occurrence's notes page
export interface NotePage {
  pageId: string;
  documentName: string; // the collab room a recording writes into
}

// GET /api/notebooks?q=&meetingId= (existing web route) -> notebooks the member can edit, suggested first
export interface Notebook {
  id: string;
  title: string;
  path: string;
  tabCount: number;
  lastNoteAt: string | null;
  suggested: boolean;
}
// POST /api/notebooks/:id { intent: 'new-note' } -> { ok, id } : a new note (tab) in that notebook

// POST /api/mobile/webview { pageId } -> { url } : a one-time sign-in link that opens the page's editor

export type OutlineItem =
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'text'; text: string; depth: number }
  | { kind: 'bullet'; text: string; depth: number }
  | { kind: 'check'; text: string; depth: number; checked: boolean };

export interface ActionItem {
  index: number;
  text: string;
  ownerUserId: string | null;
  ownerName: string | null;
  due: string | null;
  taskId: string | null;
}

// GET /api/mobile/notes/:id
export interface NoteDetail {
  id: string;
  title: string;
  status: RecordingStatus;
  error: string | null;
  createdAt: string;
  recordedSeconds: number;
  isOwner: boolean;
  canEdit: boolean;
  enhancedAt: string | null; // set once the AI notes were written into the page
  pageId: string | null; // the notes page, editable in the app
  pagePath: string | null; // web path of the notes page
  project: { id: string; name: string } | null;
  meeting: {
    id: string;
    title: string;
    start: string;
    end: string;
    occurrenceStart: string;
    timeEntry: { id: string; hours: number; roleRefId: string | null } | null;
  } | null;
  outline: OutlineItem[]; // the notes page, flattened
  actionItems: ActionItem[];
  speakerNames: Record<string, string>; // "mic:1" -> display name
  lines: { at: number; end: number; text: string; speaker: string | null }[];
}
// POST /api/mobile/notes/:id { action: 'enhance' } -> { ok: true } : writes AI notes into the page

// Recording itself uses the same routes as the web recorder (Bearer auth):
// POST /api/meeting-recordings { scheduledMeetingId, occurrenceStart } | { documentName } -> { id }
//   409 { error: 'alreadyRecording', ownerIsYou, ... } | 403 { error: 'recordingDisabled' | 'Not available' }
// POST /api/meeting-recordings/:id/chunks?channel=mic&segment=N&seq=N  body: 20s of 16kHz mono s16le PCM
//   -> { stopRequested }
// POST /api/meeting-recordings/:id { action: 'finish', seconds } (end a session: Stopped)
//                                  { action: 'resume' } (next segment) | { action: 'stop', final: true } (transcribe)
//                                  { action: 'createTasks', items: [{ index, title, assigneeId?, dueAt? }] }
// GET /api/meeting-recordings/:id -> { status, error, progress, ... }
// DELETE /api/meeting-recordings/:id (discard)
export interface RecordingState {
  status: RecordingStatus;
  error: string | null;
  progress: { stage: 'fetching' | 'transcribing' | 'labeling'; completed: number; total: number } | null;
}
