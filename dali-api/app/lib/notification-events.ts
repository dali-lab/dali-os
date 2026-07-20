// Registry of typed notification events. Every Notification row carries an
// `eventType` from this table; notify() (app/lib/notify.server.ts) resolves
// each recipient's channels from their NotificationPreference row, falling
// back to the `defaults` here when no row exists. Defaults are chosen so a
// user with zero preference rows behaves exactly as the app did before the
// preference layer existed — the only Instant email defaults are flows that
// already emailed members.
//
// Client-safe on purpose (no process.env, no server imports): the settings
// page renders its matrix from this table.

import type { NotificationKind } from "~/generated/prisma/client";

export type EmailDefault = "Instant" | "Daily" | "Weekly" | "Off";

export type EventDef = {
  // Default NotificationKind stamped on rows (a caller may override, e.g.
  // the admin composer's kind picker). `kind` stays the UI discriminator;
  // eventType is the preference/digest key.
  kind: NotificationKind;
  // Settings-page section and digest grouping.
  area:
    | "Meetings"
    | "Tasks"
    | "Staffing"
    | "Documents"
    | "Hiring"
    | "Education"
    | "Announcements"
    | "Forms"
    | "Onboarding";
  label: string;
  description: string;
  // The in-app row IS the workflow surface (RSVP buttons, form todo,
  // interview tile) — not muteable; dispatch ignores inApp:false rows and
  // the settings page renders the toggle disabled.
  lockedInApp?: boolean;
  // Email for this event is owned by a feature-specific template pipeline
  // (e.g. education decision emails); notify() never emails these and the
  // settings page shows no email control.
  externalEmail?: boolean;
  // Loses its value if seen late (meeting starting, spontaneous lab event).
  // The desktop app surfaces these with sound and pins them in its tray.
  timeSensitive?: boolean;
  // `desktop` gates the native banner the desktop app raises for an in-app
  // row — it is a sub-preference of inApp (no row, no banner), resolved at
  // feed-read time so a preference change applies to unseen rows too.
  defaults: { inApp: boolean; desktop: boolean; slackDm: boolean; email: EmailDefault };
};

export const EVENT_TYPES = {
  "meeting.invite": {
    kind: "MeetingInvite",
    area: "Meetings",
    label: "Meeting invites",
    description: "When someone schedules a meeting with you.",
    lockedInApp: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "meeting.reminder": {
    kind: "MeetingReminder",
    area: "Meetings",
    label: "Meeting reminders",
    description: "15 minutes before a meeting you're in starts.",
    timeSensitive: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "meeting.cancelled": {
    kind: "General",
    area: "Meetings",
    label: "Meeting cancellations",
    description: "When a meeting you were invited to is cancelled.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "task.due_reminder": {
    kind: "General",
    area: "Tasks",
    label: "Task deadline reminders",
    description: "A day before and at the moment a task you're assigned is due.",
    defaults: { inApp: true, desktop: true, slackDm: true, email: "Off" },
  },
  "task.assigned": {
    kind: "General",
    area: "Tasks",
    label: "Task assignments",
    description: "When someone assigns you to a task.",
    defaults: { inApp: true, desktop: true, slackDm: true, email: "Off" },
  },
  "task.comment": {
    kind: "General",
    area: "Tasks",
    label: "Task comments",
    description: "New comments on tasks you're assigned.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "task.status_changed": {
    kind: "General",
    area: "Tasks",
    label: "Task status changes",
    description: "When someone moves a task you're assigned to a new status.",
    defaults: { inApp: true, desktop: false, slackDm: false, email: "Off" },
  },
  "task.github_update": {
    kind: "General",
    area: "Tasks",
    label: "GitHub task updates",
    description: "When a linked GitHub issue closes or reopens one of your tasks.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "collab.comment_reply": {
    kind: "General",
    area: "Documents",
    label: "Comment replies",
    description: "Replies in document and file comment threads you're part of.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "file.comment": {
    kind: "General",
    area: "Documents",
    label: "File feedback",
    description: "New comments on files you uploaded or are working on via a task.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "file.new_version": {
    kind: "General",
    area: "Documents",
    label: "New file versions",
    description: "When a new version of a file you commented on or are working on is uploaded.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "pagedoc.mention": {
    kind: "General",
    area: "Documents",
    label: "Mentions",
    description: "When someone @mentions you in a document, guide, or comment.",
    defaults: { inApp: true, desktop: true, slackDm: true, email: "Off" },
  },
  "pagedoc.maintainer_assigned": {
    kind: "General",
    area: "Documents",
    label: "Guide maintainer role",
    description: "When you're made the maintainer of a page's guide.",
    defaults: { inApp: true, desktop: true, slackDm: true, email: "Off" },
  },
  "staffing.assigned": {
    kind: "General",
    area: "Staffing",
    label: "Staffing assignments",
    description: "When your project assignment for a term is confirmed.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "hiring.interview_assigned": {
    kind: "General",
    area: "Hiring",
    label: "Interview assignments",
    description: "When you're assigned to conduct an interview.",
    lockedInApp: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "hiring.fellowship_invite": {
    kind: "General",
    area: "Hiring",
    label: "Fellowship invitations",
    description: "When an intern-to-full application window opens for you.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  announcement: {
    kind: "SystemAnnouncement",
    area: "Announcements",
    label: "Lab announcements",
    description: "Announcements and action items sent by Core.",
    lockedInApp: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "member.onboarding": {
    kind: "SystemAnnouncement",
    area: "Onboarding",
    label: "Onboarding steps",
    description: "Your onboarding checklist when you join the lab.",
    lockedInApp: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "form.submission": {
    kind: "General",
    area: "Forms",
    label: "Form responses",
    description: "When someone submits a form you created (per-form toggle).",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "education.announcement": {
    kind: "Education",
    area: "Education",
    label: "Course announcements",
    description: "Announcements from instructors of your offerings.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Instant" },
  },
  "education.decision": {
    kind: "Education",
    area: "Education",
    label: "Application decisions",
    description: "Decisions on your education applications.",
    externalEmail: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "education.assignment": {
    kind: "Education",
    area: "Education",
    label: "New assignments",
    description: "When an instructor posts an assignment.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "education.discussion": {
    kind: "Education",
    area: "Education",
    label: "Discussion replies",
    description: "Replies in discussion threads you're part of.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "education.feedback_request": {
    kind: "SystemAnnouncement",
    area: "Education",
    label: "Feedback requests",
    description: "Session feedback and exit-survey forms to fill.",
    lockedInApp: true,
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
  "education.certificate": {
    kind: "Education",
    area: "Education",
    label: "Certificates",
    description: "When you're issued a certificate of completion.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Instant" },
  },
  // Fallback stamped on rows that predate the registry (schema column
  // default). Never emitted by code; hidden from the settings page.
  general: {
    kind: "General",
    area: "Announcements",
    label: "Other",
    description: "Everything else.",
    defaults: { inApp: true, desktop: true, slackDm: false, email: "Off" },
  },
} as const satisfies Record<string, EventDef>;

export type EventType = keyof typeof EVENT_TYPES;

export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as EventType[];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && value in EVENT_TYPES;
}
