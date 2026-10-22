// Wire contract between the mobile app and dali-api (/api/mobile/*, /api/chat/*).
// Every route takes `Authorization: Bearer <token>` (device-pairing token) and returns
// JSON. Errors are `{ error: string }` with a 4xx/5xx status. Dates are ISO strings.
// All routes 404 `{ error: "Not found" }` when the `mobile-app` feature flag is off for the user.

export type Presence = 'active' | 'away' | 'offline';
export type TaskStatus = 'Backlog' | 'Todo' | 'InProgress' | 'InReview' | 'Done' | 'Cancelled';
export type Rsvp = 'accepted' | 'tentative' | 'declined' | 'needs_action';

/** A lab member as the app shows them (directory entry, chat author, assignee). */
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

// PUT /api/mobile/me/status  body { status: 'active' | 'away' } -> { ok: true }
export interface SetStatusBody {
  status: 'active' | 'away';
}

// GET /api/mobile/projects -> the viewer's active projects (most recent term first)
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
    channelId: string | null; // chat conversation id for the project channel, if one exists
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
}
export interface CalendarResponse {
  events: CalendarEvent[];
}

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

// ---------------- Chat (/api/chat/*) ----------------

export interface Conversation {
  id: string;
  kind: 'channel' | 'dm';
  name: string | null; // channels only, no leading #
  isPrivate: boolean;
  isDefault: boolean;
  topic: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  lastReadAt: string; // viewer's read marker; createdAt if never read / not a member
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  text: string;
  createdAt: string;
  reactions: Reaction[];
  parentId: string | null;
  kind: 'user' | 'system';
}

// GET /api/chat/bootstrap
// conversations: every conversation the viewer is a member of + every public channel.
// messages: for each conversation, the latest 100 root messages and all their replies.
export interface ChatBootstrapResponse {
  meId: string;
  users: MemberSummary[]; // every active lab member (directory)
  conversations: Conversation[];
  messages: Message[];
}

// GET /api/chat/conversations/:id/messages?before=ISO -> { messages: Message[] } (100 older roots + replies)
// POST /api/chat/conversations/:id/messages { text, parentId? } -> { message: Message }
// POST /api/chat/messages/:id/reactions { emoji } -> { message: Message }   (toggles the viewer's reaction)
// POST /api/chat/conversations { name, topic?, isPrivate, memberIds } -> { conversation: Conversation, messages: Message[] }
// POST /api/chat/dms { userIds } -> { conversation: Conversation }          (returns the existing DM for that exact member set)
// POST /api/chat/conversations/:id/join -> { conversation, messages }       (public channels only)
// POST /api/chat/conversations/:id/leave -> { ok: true }                    (not allowed for isDefault channels or DMs)
// POST /api/chat/conversations/:id/members { userIds } -> { conversation, messages }
// POST /api/chat/conversations/:id/read { at } -> { ok: true }              (moves the read marker forward only)
// GET  /api/chat/stream  SSE: `event: message` data {conversationId}; `event: conversation` data {conversationId};
//      `event: sync` every 60s; `: keepalive` every 25s. Client refetches /api/chat/bootstrap on any event.
