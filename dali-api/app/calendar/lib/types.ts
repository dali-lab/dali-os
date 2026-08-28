// Shared calendar DTOs and view types.
//
// These live in a client-safe module (no server-only imports) so the calendar
// components extracted out of the monolithic route — and the new unified
// calendar screen — can share one set of types without importing the route
// module (which pulls in prisma / google-calendar and would leak server code
// into the client bundle).

import type { RoleInstance } from "~/lib/roles";
import type { GeneralCalendarState } from "~/lib/general-calendar";

/** The unified calendar's three views. */
export type CalendarView = "day" | "week" | "month" | "agenda";

export type WhSegment = {
  id: string;
  startMinute: number;
  endMinute: number;
  location: "InPerson" | "Remote";
};

export type WhDay = {
  dayOfWeek: number;
  segments: WhSegment[];
};

export type ManualBlockDTO = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  recurrenceRule: string | null;
  isWork: boolean;
  assignmentType: RoleInstance["assignmentType"] | null;
  roleRefId: string | null;
  /** The timesheet entry's own description (distinct from the block title),
   *  when this block logs to the timesheet. */
  workNote: string | null;
};

export type SubCalendarDTO = {
  id: string;
  summary: string;
  primary: boolean;
  color: string | null;
  enabled: boolean;
  /** The viewer can create/edit events here (accessRole owner/writer) — the
   *  composer only offers writable calendars as destinations. */
  writable?: boolean;
};

export type CalendarLinkDTO = {
  id: string;
  provider: "Google" | "Outlook";
  externalEmail: string;
  displayName: string | null;
  enabled: boolean;
  primary: boolean;
  syncError: string | null;
  // null when the upstream list call failed; the UI shows a degraded card.
  subCalendars: SubCalendarDTO[] | null;
};

export type GroupOption = {
  id: string;
  name: string;
  // Resolved members for this group at load time (either explicit static list
  // or the resolved Dynamic membership). The picker treats both uniformly.
  memberIds: string[];
  // Derived from dynamicQuery ("project:<id>") for system-managed project
  // groups (see ensureProjectGroup in ~/lib/groups.ts). Lets the Schedule
  // Meeting form prefill the Project picker when such a group is selected.
  projectId: string | null;
  // Stable identifier for system groups (e.g. "core"). Lets the meeting form
  // mark a meeting as a Core meeting when the Core group is invited, instead of
  // a manual checkbox.
  systemKey: string | null;
};

export type UserOption = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
};

export type ProjectOption = { id: string; name: string };

// ── Classes this term ────────────────────────────────────────────────────────

/** One resolved weekly meeting pattern of a class (the main block or its
 *  x-hour). Mirrors PeriodMeeting in dartmouth-periods.ts; days use getDay(). */
export type ClassMeetingDTO = {
  kind: "main" | "xhour";
  days: number[];
  startMin: number;
  endMin: number;
};

/** A member's class this term, for the manager list. */
export type MemberClassDTO = {
  id: string;
  title: string;
  /** Dartmouth period code when picked from the schedule; null for custom. */
  periodCode: string | null;
  meetings: ClassMeetingDTO[];
  location: string | null;
  storage: "Google" | "Local";
  /** Google destination pointers, so the manager can pre-select the same
   *  calendar when editing. Null for Local classes. */
  linkId: string | null;
  calendarId: string | null;
  /** Where it lives, e.g. "Google · Classes" or "In DALI only". */
  destinationLabel: string;
};

/** A single expanded class occurrence for the "Classes" layer. Only Local
 *  classes are expanded here; Google-stored classes ride the external layer. */
export type ClassOccurrenceDTO = {
  classId: string;
  title: string;
  startIso: string;
  endIso: string;
  kind: "main" | "xhour";
};

/** A destination the add-class form can target. `local` renders in DALI only;
 *  the Google kinds write real recurring events to a linked account. */
export type ClassDestinationDTO =
  | { kind: "local"; label: string }
  | { kind: "google-dedicated"; linkId: string; label: string }
  | { kind: "google-primary"; linkId: string; label: string }
  | { kind: "google-calendar"; linkId: string; calendarId: string; label: string };

export type TimeEntryDTO = {
  id: string;
  source: "Meeting" | "Manual" | "Block";
  scheduledMeetingId: string | null;
  manualBlockId: string | null;
  meetingNotePageId: string | null;
  assignmentType: RoleInstance["assignmentType"] | null;
  roleRefId: string | null;
  projectId: string | null;
  date: string;
  hours: number;
  note: string | null;
  // Set when this entry has a precise time range (meeting-sourced, or a
  // manual entry created by dragging on the Timesheet week grid). Null for
  // entries added via the plain date+hours form — those don't render as a
  // grid block.
  startTime: string | null;
  endTime: string | null;
};

/** One invitee row in an event's detail popover, from either source. */
export type EventAttendeeDTO = {
  name: string;
  status: "Accepted" | "Declined" | "Tentative" | "Pending";
  organizer?: boolean;
  optional?: boolean;
};

export type EventLinkDTO = { label: string; href: string };

/** One external (Google/Outlook) event for display, from events.list. Carries
 *  CRUD identity (eventId/linkId/writable) behind the calendar-google-crud flag
 *  so the calendar can edit/delete Google events it's allowed to. */
export type ExternalEventDTO = {
  startIso: string;
  endIso: string;
  title: string;
  color: string | null;
  /** The linked sub-calendar this event came from, so the Calendars popover
   *  can hide individual calendars on the grid (client-side display only). */
  calendarId?: string | null;
  // ── Google Calendar CRUD identity (calendar-google-crud flag) ──
  /** The Google event id — target of edit/delete. */
  eventId?: string | null;
  /** Which UserCalendarLink this event belongs to (for the write token). */
  linkId?: string | null;
  /** Date-only (all-day) event — rendered in the all-day band, not the grid. */
  allDay?: boolean;
  /** The viewer can edit/delete this event (calendar accessRole owner/writer,
   *  and not Outlook). Gates all write affordances. */
  writable?: boolean;
  /** Master event id when this is one instance of a recurring event. */
  recurringEventId?: string | null;
  // ── In-app (DALI) block editing ──
  /** When set, this "event" is a ManualBlock edited through the same composer —
   *  its writes target the block (destination = local), not Google. */
  manualBlockId?: string | null;
  isWork?: boolean;
  assignmentType?: RoleInstance["assignmentType"] | null;
  roleRefId?: string | null;
  /** The block's timesheet description (distinct from the event description). */
  workNote?: string | null;
  description?: string;
  location?: string;
  organizerName?: string;
  attendees?: EventAttendeeDTO[];
  /** { label, href } pairs for the detail popover (Meet link, Google page). */
  links?: EventLinkDTO[];
};

export type MeetingInviteDTO = {
  notificationId: string;
  meetingId: string;
  title: string;
  startIso: string;
  endIso: string;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
  notePageId: string | null;
  organizerName: string | null;
  attendees: EventAttendeeDTO[];
  /** Drives the detail popover's "Core meeting" checkbox (Core viewers only). */
  isCoreMeeting: boolean;
};

export type LoaderData = {
  timezone: string;
  defaultEventBufferMin: number;
  workingHours: WhDay[];
  // True once the user has saved any working-hours state (even "all off"). The
  // client uses this to (a) show the master toggle as off for brand-new users
  // and (b) seed the full week on first edit so unsaved defaults aren't lost.
  hasPersistedWorkingHours: boolean;
  manualBlocks: ManualBlockDTO[];
  calendarLinks: CalendarLinkDTO[];
  generalCalendar: GeneralCalendarState;
  weekStartIso: string;
  weekEndIso: string;
  // The unified screen's active view + the exact range the loader fetched for
  // it. `weekStartIso`/`weekEndIso` stay the containing-week window for the
  // legacy three-tab grids; `rangeStartIso`/`rangeEndIso` widen to the month in
  // month view (and narrow to the day in day view). Equal to the week window in
  // week view, so the legacy path is unchanged.
  view: CalendarView;
  rangeStartIso: string;
  rangeEndIso: string;
  // External (Google) events for display: real titles + per-calendar colour,
  // straight from events.list (not the merged availability intervals, which
  // drop titles). Manual blocks render separately from data.manualBlocks.
  externalEvents: ExternalEventDTO[];
  ingestionError: string | null;
  groups: GroupOption[];
  users: UserOption[];
  currentUserId: string;
  myProjects: ProjectOption[];
  myRoles: RoleInstance[];
  timeEntries: TimeEntryDTO[];
  /** Core, Admin, or Instructor — can enable Self check-in (QR) on meetings. */
  canSetSelfCheckIn: boolean;
  /** Core — can mark a meeting as a Core meeting (shows on the Core hub calendar). */
  canMarkCoreMeeting: boolean;
  // Scheduled meetings the viewer was invited to whose start falls in the
  // visible week. Rendered as RSVP-able blocks on the My Availability grid so
  // Accept/Maybe/Decline is available in the calendar, not just in tasks.
  // notificationId targets the RSVP endpoint (RSVP lives on the MeetingInvite
  // Notification, not on MeetingAttendance).
  meetingInvites: MeetingInviteDTO[];
  // Classes this term (behind the calendar-classes flag). classesEnabled gates
  // the whole surface; classTerm names the term classes are scoped to;
  // memberClasses feeds the manager; classOccurrences are the Local classes
  // expanded across the fetched range for the "Classes" layer (Google-stored
  // classes ride the external layer instead); classDestinations are the add
  // form's target options (Local + any linked Google calendars).
  classesEnabled: boolean;
  classTerm: { id: string; code: string } | null;
  memberClasses: MemberClassDTO[];
  classOccurrences: ClassOccurrenceDTO[];
  classDestinations: ClassDestinationDTO[];
  // Google Calendar CRUD (calendar-google-crud flag): when on, the calendar can
  // create/edit/delete Google events. defaultEventDest is the last-used write
  // calendar (from the dali_event_dest cookie), "linkId:calendarId".
  crudEnabled: boolean;
  defaultEventDest: string | null;
  /** New-event default length in minutes (dali_event_duration cookie; 60 when
   *  unset). Used by quick-create and a single click on the grid. */
  defaultEventDurationMin: number;
};

/** A positioned block on the week/day grid. Every layer builder emits these. */
export type EventBlock = {
  startHour: number;
  duration: number;
  label: string;
  /** Tailwind classes for the colored body (bg + text). */
  className: string;
  /** Arbitrary hex background (e.g. a Google calendar colour). Overrides the
   *  className background when set; text flips to a readable on-colour shade. */
  bgColor?: string;
  /** Border color class for the outer wrapper (defaults to matching the body). */
  borderClassName?: string;
  /** Background tint for the buffer strip + frame (e.g. "bg-accent-coral/25"). */
  bufferClassName?: string;
  /** Hours of buffer above the event body. */
  bufferBefore?: number;
  /** Hours of buffer below the event body. */
  bufferAfter?: number;
  location?: string;
  description?: string;
  organizerName?: string;
  /** Invitees + their response, shown in the click-opened detail popover. */
  attendees?: EventAttendeeDTO[];
  /** Outbound links for the popover (video call, source calendar, notes). */
  links?: EventLinkDTO[];
  /** When set, the block is clickable (e.g. Timesheet entries opening an edit
   *  popover). Stops the mousedown from bubbling to the column's drag-select
   *  handler so a click doesn't also start a new drag selection. */
  onClick?: () => void;
  /** When set, the event's detail popover shows an "Edit" action — a writable
   *  Google event or in-app block under the calendar-google-crud flag. Opens the
   *  composer, anchored to the block's on-screen rect (passed through so the
   *  composer pops up next to the event, Google-Calendar style). */
  onEdit?: (anchor?: DOMRect) => void;
  /** Detail-popover "Duplicate" — clones this event into a fresh composer
   *  (create mode) anchored to the block. */
  onDuplicate?: (anchor?: DOMRect) => void;
  /** Detail-popover "Delete" — removes the event. Recurring events route through
   *  the composer (for the this/following/all scope prompt); the caller decides. */
  onDelete?: () => void;
  /** Which calendar this event lives on ("DALI calendar", a Google account +
   *  sub-calendar) — shown as a source line in the detail popover. */
  calendarLabel?: string;
  /** A recurring-series instance — the detail popover routes its Delete through
   *  the composer so the this/following/all scope prompt is shown. */
  recurring?: boolean;
  /** When set, the block can be dragged to move (whole block, keeping duration)
   *  or resized by its top/bottom edges; fires on drop with the new start/end
   *  hours. A body-move can also cross day columns — `dayIdx` is the target
   *  column when it changed (omitted for a resize / same-day move). Writable
   *  Google events + in-app blocks. */
  onMoveResize?: (startHour: number, endHour: number, dayIdx?: number) => void;
  /** When this on-grid event (a meeting or manual block) is *also* logged as
   *  work, the role accent shown ON the block — a right-edge stripe in the role
   *  colour + "logged Nh" — instead of drawing a duplicate logged-time block on
   *  top of it. `color` is a CSS colour (the role palette's `dot`). */
  loggedAccent?: { color: string; hours: number };
  /** When set, the block is a meeting invite: clicking opens a persistent
   *  popover with Accept/Maybe/Decline (RSVP lives on the invite Notification,
   *  so notificationId targets the RSVP endpoint). */
  meeting?: {
    notificationId: string;
    /** ScheduledMeeting id — target of the timesheet / Core-meeting toggles. */
    meetingId: string;
    rsvp: "Accepted" | "Declined" | "Tentative" | null;
    notePageId: string | null;
    /** Whether the viewer already has a TimeEntry for this meeting. */
    onTimesheet: boolean;
    isCoreMeeting: boolean;
    /** Core only — hides the "Core meeting" checkbox for everyone else. */
    canMarkCoreMeeting: boolean;
  };
};

// Group availability (POST /api/calendar/group-availability) — shared by the
// scheduling grid and the useGroupAvailability hook.
export type GroupAvailDay = {
  dayKey: string;
  dayOfWeek: number;
  dayOfMonth: number;
  matches: { startHour: number; durationHours: number }[];
  busy: { startHour: number; durationHours: number }[];
};

export type PerUserFree = { userId: string; free: { startIso: string; endIso: string }[] };

export type GroupAvailResponse = { days: GroupAvailDay[]; perUser: PerUserFree[] };
