// The words of every notification, as editable templates.
//
// Keyed per MESSAGE, not per event type, because several event types carry more
// than one: `meeting.cancelled` says three different things (this occurrence, the
// whole series, you personally were removed), `education.decision` says five, and
// `pagedoc.mention` says four depending on what you were mentioned in. One
// template per event type would have forced those to share a sentence, or left
// the extras hardcoded — which is the thing this is here to end.
//
// `eventType` ties each message back to app/lib/notification-events.ts, which
// still owns the preference matrix, the digest grouping and the settings page.
// This file owns only the copy.
//
// Client-safe: no prisma, no server imports, so the admin editor imports it.
//
// Every template renders to BOTH the in-app row and the email, so an operator
// editing a sentence changes it everywhere it appears rather than letting the
// feed and the inbox drift apart.
//
// Call sites pass variables already formatted — see the `notification` section of
// app/lib/template-variables.ts for why.

import type { EmailPurposeKey } from "~/lib/email-identities";
import type { EventType } from "~/lib/notification-events";
import type { TemplateVariableName } from "~/lib/template-variables";

export type NotificationCopyDef = {
  eventType: EventType;
  // More specific than the event type's own label, since one event can hold
  // several messages.
  label: string;
  description: string;
  variables: readonly TemplateVariableName[];
  subject: string;
  // Omit for messages whose body is authored per send (lab and course
  // announcements) — the caller's body passes through untouched.
  body?: string;
  linkLabel?: string;
  // Sender identity. Defaults to General (the lab-notifications account) since
  // notify() mail goes to members; hiring-cycle messages set Hiring so they
  // arrive from applications@ like the rest of the cycle's mail.
  purpose?: EmailPurposeKey;
};

export const NOTIFICATION_COPY = {
  // ── Meetings ─────────────────────────────────────────────────────────────
  "meeting.invite": {
    eventType: "meeting.invite",
    label: "Meeting invite",
    description: "Sent when someone is invited to a meeting.",
    variables: ["itemTitle", "itemDetail"],
    subject: "Meeting invite: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "meeting.proposal_accepted": {
    eventType: "meeting.invite",
    label: "Proposed time accepted",
    description: "Sent to the person whose proposed time the organizer accepted.",
    variables: ["itemTitle"],
    subject: "Your proposed time was accepted for {{itemTitle}}",
    body: "",
  },
  "meeting.time_proposed": {
    eventType: "meeting.time_proposed",
    label: "New time proposed",
    description: "Sent to the organizer when an invitee proposes a different time.",
    variables: ["personName", "itemTitle"],
    subject: "{{personName}} proposed a new time for {{itemTitle}}",
    body: "",
  },
  "meeting.reminder": {
    eventType: "meeting.reminder",
    label: "Meeting starting soon",
    description: "Sent shortly before a meeting starts.",
    variables: ["itemTitle", "when"],
    subject: "Starting soon: {{itemTitle}}",
    body: "Starts {{when}}.",
  },
  "meeting.cancelled.occurrence": {
    eventType: "meeting.cancelled",
    label: "One occurrence cancelled",
    description: "Sent when a single occurrence of a recurring meeting is cancelled.",
    variables: ["itemTitle"],
    subject: "Meeting occurrence cancelled: {{itemTitle}}",
    body: "",
  },
  "meeting.cancelled.series": {
    eventType: "meeting.cancelled",
    label: "Meeting cancelled",
    description: "Sent when a meeting, or a whole recurring series, is cancelled.",
    variables: ["itemTitle"],
    subject: "Meeting cancelled: {{itemTitle}}",
    body: "",
  },
  "meeting.removed": {
    eventType: "meeting.cancelled",
    label: "Removed from a meeting",
    description: "Sent to a guest dropped from a meeting that still goes ahead.",
    variables: ["itemTitle"],
    subject: "Removed from meeting: {{itemTitle}}",
    body: "",
  },
  "room.booking_bumped": {
    eventType: "room.booking_bumped",
    label: "Room bumped for interviews",
    description: "Sent when a hiring cycle's interview hold takes over a room you'd booked.",
    variables: ["itemTitle", "itemDetail"],
    subject: "Your room was released for interviews: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "class.schedule_changed": {
    eventType: "class.schedule_changed",
    label: "Class schedule changed",
    description: "Sent when the Dartmouth timetable moves a class a member is enrolled in.",
    variables: ["itemTitle", "itemDetail"],
    subject: "{{itemTitle}} schedule changed",
    body: "{{itemDetail}}. Open your calendar to update it.",
  },

  // ── Tasks and projects ───────────────────────────────────────────────────
  "task.assigned": {
    eventType: "task.assigned",
    label: "Task assigned",
    description: "Sent to each assignee when a task is assigned to them.",
    variables: ["itemTitle", "contextName"],
    subject: "Task assigned: {{itemTitle}}",
    body: "In {{contextName}}.",
  },
  "task.comment": {
    eventType: "task.comment",
    label: "New task comment",
    description: "Sent to a task's assignees when someone comments on it.",
    variables: ["itemTitle", "itemDetail"],
    subject: "New comment on: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "task.status_changed": {
    eventType: "task.status_changed",
    label: "Task status changed",
    description: "Sent when a task moves to a different column.",
    variables: ["itemTitle", "contextName", "statusLabel"],
    subject: "Task moved to {{statusLabel}}: {{itemTitle}}",
    body: "In {{contextName}}.",
  },
  "task.github_closed": {
    eventType: "task.github_update",
    label: "Task closed from GitHub",
    description: "Sent when the linked GitHub issue is closed.",
    variables: ["itemTitle", "statusLabel"],
    subject: "Task closed from GitHub: {{itemTitle}}",
    body: "The linked issue was closed, so the status is now {{statusLabel}}.",
  },
  "task.github_reopened": {
    eventType: "task.github_update",
    label: "Task reopened from GitHub",
    description: "Sent when the linked GitHub issue is reopened.",
    variables: ["itemTitle", "statusLabel"],
    subject: "Task reopened from GitHub: {{itemTitle}}",
    body: "The linked issue was reopened, so the status is now {{statusLabel}}.",
  },
  "task.due_tomorrow": {
    eventType: "task.due_reminder",
    label: "Task due tomorrow",
    description: "Sent the day before a task is due.",
    variables: ["itemTitle", "when"],
    subject: "Task due tomorrow: {{itemTitle}}",
    body: "Due {{when}}.",
  },
  "task.due_now": {
    eventType: "task.due_reminder",
    label: "Task due now",
    description: "Sent when a task reaches its deadline.",
    variables: ["itemTitle", "when"],
    subject: "Task due now: {{itemTitle}}",
    body: "Due {{when}}.",
  },
  "project.sprint_closed": {
    eventType: "project.sprint_closed",
    label: "Sprint wrapped up",
    description: "Sent to a project's members when a sprint ends.",
    variables: ["itemTitle", "contextName", "itemDetail"],
    subject: "{{itemTitle}} wrapped up",
    body: "{{contextName}} — {{itemDetail}}",
  },

  // ── Documents and files ──────────────────────────────────────────────────
  "collab.comment_reply": {
    eventType: "collab.comment_reply",
    label: "Reply to your comment",
    description: "Sent when someone replies in a comment thread you're in.",
    variables: ["itemTitle", "itemDetail"],
    subject: "New reply on: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "file.comment": {
    eventType: "file.comment",
    label: "Feedback on a file",
    description: "Sent when someone comments on a project file.",
    variables: ["itemTitle", "itemDetail"],
    subject: "New feedback on: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "file.new_version": {
    eventType: "file.new_version",
    label: "New file version",
    description: "Sent when a new version of a project file is uploaded.",
    variables: ["itemTitle", "count"],
    subject: "V{{count}} uploaded: {{itemTitle}}",
    body: "",
  },
  "mention.document": {
    eventType: "pagedoc.mention",
    label: "Mentioned in a document",
    description: "Sent when someone @mentions you in a document or page guide.",
    variables: ["itemTitle", "itemDetail"],
    subject: "You were mentioned in: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "mention.task": {
    eventType: "pagedoc.mention",
    label: "Mentioned on a task",
    description: "Sent when someone @mentions you on a task.",
    variables: ["itemTitle", "itemDetail"],
    subject: "You were mentioned on: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "mention.comment": {
    eventType: "pagedoc.mention",
    label: "Mentioned in a comment",
    description: "Sent when someone @mentions you in a comment.",
    variables: ["itemDetail"],
    subject: "You were mentioned in a comment",
    body: "{{itemDetail}}",
  },
  "mention.mailbox": {
    eventType: "pagedoc.mention",
    label: "Mentioned in a shared inbox",
    description: "Sent when someone @mentions you on a message in a shared inbox.",
    variables: ["itemTitle", "itemDetail"],
    subject: "You were mentioned in {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "pagedoc.maintainer_assigned": {
    eventType: "pagedoc.maintainer_assigned",
    label: "You maintain a guide",
    description: "Sent when someone is made the maintainer of a page guide.",
    variables: ["itemTitle"],
    subject: "You're now the maintainer of: {{itemTitle}}",
    body: "You can edit this page's guide — sections, video, walkthrough, and FAQ.",
  },
  "document.shared_with_you": {
    eventType: "document.shared_with_you",
    label: "Document shared with you",
    description: "Sent when someone shares a document with you directly.",
    variables: ["itemTitle"],
    subject: "Shared with you: {{itemTitle}}",
    body: "",
  },
  "document.sign_request": {
    eventType: "document.sign_request",
    label: "Document to sign",
    description: "Sent when an agreement is put in force and you're in its audience.",
    variables: ["itemTitle"],
    subject: "You have a new document to sign",
    body: "{{itemTitle}}",
  },
  "document.countersign_request": {
    eventType: "document.countersign_request",
    label: "Agreement to countersign",
    description: "Sent to a mentee once their mentor has signed the shared agreement.",
    variables: ["itemTitle"],
    subject: "Countersign your mentorship agreement",
    body: "{{itemTitle}}",
  },

  // ── Staffing, hiring, membership ─────────────────────────────────────────
  "staffing.assigned": {
    eventType: "staffing.assigned",
    label: "Staffed on a project",
    description: "Sent to each member when staffing is finalized.",
    variables: ["itemTitle", "itemDetail"],
    subject: "You're on {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "hiring.interview_assigned": {
    purpose: "Hiring",
    eventType: "hiring.interview_assigned",
    label: "Interview assigned",
    description: "Sent to an interviewer when they're assigned an interview.",
    variables: ["personName", "itemDetail"],
    subject: "Interview assigned: {{personName}}",
    body: "{{itemDetail}}",
  },
  "hiring.fellowship_invite": {
    purpose: "Hiring",
    eventType: "hiring.fellowship_invite",
    label: "Fellowship applications open",
    description: "Sent to eligible interns when a fellowship cycle opens.",
    variables: ["itemTitle", "itemDetail"],
    subject: "Fellowship application is open",
    body: "{{itemTitle}} is accepting fellowship applications.{{itemDetail}}",
  },
  "hiring.core_invite": {
    purpose: "Hiring",
    eventType: "hiring.core_invite",
    label: "Core applications open",
    description: "Sent to lab members when a Core cycle opens.",
    variables: ["itemTitle", "itemDetail"],
    subject: "Core application is open",
    body: "{{itemTitle}} is accepting Core applications.{{itemDetail}}",
  },
  "hiring.core_decision.accepted": {
    purpose: "Hiring",
    eventType: "hiring.core_decision",
    label: "Core decision: accepted",
    description: "Sent in-app when a member is accepted into Core.",
    variables: [],
    subject: "You've been added to Core",
    body: "Welcome to Core. Your assignment is active for this cycle.",
  },
  "hiring.core_decision.waitlisted": {
    purpose: "Hiring",
    eventType: "hiring.core_decision",
    label: "Core decision: waitlisted",
    description: "Sent in-app when a member is waitlisted for Core.",
    variables: [],
    subject: "Core application update",
    body: "You've been placed on the Core waitlist.",
  },
  "hiring.core_decision.other": {
    purpose: "Hiring",
    eventType: "hiring.core_decision",
    label: "Core decision: released",
    description: "Sent in-app for any other released Core decision.",
    variables: [],
    subject: "Core application update",
    body: "A decision on your Core application has been released.",
  },
  "member.promotion": {
    eventType: "member.promotion",
    label: "Member promoted",
    description: "Sent to admins when a member's level changes.",
    variables: ["personName", "itemDetail"],
    subject: "{{personName}} {{itemDetail}}",
    body: "",
  },
  "blog.submitted": {
    eventType: "blog.submitted",
    label: "Blog post submitted",
    description: "Sent to admins when a member submits a blog post for approval.",
    variables: ["personName", "itemTitle"],
    subject: "{{personName}} submitted a blog post: {{itemTitle}}",
    body: "Review it and approve to publish.",
    linkLabel: "Review post",
  },
  "blog.approved": {
    eventType: "blog.approved",
    label: "Blog post approved",
    description: "Sent to the author when an admin approves their blog post.",
    variables: ["itemTitle"],
    subject: "Your blog post was published: {{itemTitle}}",
    body: "",
  },

  // ── Onboarding ───────────────────────────────────────────────────────────
  "member.onboarding": {
    eventType: "member.onboarding",
    label: "Welcome and onboarding",
    description: "Sent when a new member's account is created.",
    variables: [],
    subject: "Welcome to DALI. Finish onboarding",
    body: "Complete a few quick steps to finish setting up your account.",
  },
  "member.onboarding.reminder.email": {
    eventType: "member.onboarding.reminder",
    label: "Reminder: DALI email",
    description: "Nudge when a new member's DALI email still isn't set up.",
    variables: [],
    subject: "Onboarding reminder: DALI email",
    body: "Your DALI email isn't set up yet. Check for an invite, or reach out to Core if you still can't sign in.",
  },
  "member.onboarding.reminder.slack": {
    eventType: "member.onboarding.reminder",
    label: "Reminder: Slack",
    description: "Nudge when a new member isn't in the Slack workspace yet.",
    variables: [],
    subject: "Onboarding reminder: Slack",
    body: "You're not in the DALI Slack workspace yet. A teammate will add you — reply to Core if you're still waiting.",
  },
  "member.onboarding.reminder.figma": {
    eventType: "member.onboarding.reminder",
    label: "Reminder: Figma",
    description: "Nudge when a new member hasn't been added to Figma.",
    variables: [],
    subject: "Onboarding reminder: Figma",
    body: "You haven't been added to Figma yet. Core will invite you — ping them if it's been a while.",
  },
  "member.onboarding.reminder.profile": {
    eventType: "member.onboarding.reminder",
    label: "Reminder: profile form",
    description: "Nudge when a new member hasn't finished their profile.",
    variables: [],
    subject: "Onboarding reminder: profile form",
    body: "Finish your member profile so we can complete your onboarding.",
  },

  // ── Mentorship and forms ─────────────────────────────────────────────────
  "mentorship.note_reminder": {
    eventType: "mentorship.note_reminder",
    label: "Mentorship notes missing",
    description: "Sent to a mentor who hasn't filled in their notes.",
    variables: ["itemDetail"],
    subject: "Fill in your mentorship notes",
    body: "{{itemDetail}}",
  },
  "form.submission": {
    eventType: "form.submission",
    label: "New form response",
    description: "Sent to a form's creator when someone submits it.",
    variables: ["itemTitle", "personName"],
    subject: "New response: {{itemTitle}}",
    body: "From {{personName}}",
  },

  // ── Announcements ────────────────────────────────────────────────────────
  // No `body`: Core and instructors author these per send, so only the framing
  // is template-owned.
  announcement: {
    eventType: "announcement",
    label: "Lab announcement",
    description:
      "Sent by Core to a chosen audience. The subject and body are written per announcement; only the frame around them comes from here.",
    variables: ["itemTitle"],
    subject: "{{itemTitle}}",
  },
  "education.announcement": {
    eventType: "education.announcement",
    label: "Course announcement",
    description:
      "Sent by an instructor to a course's enrollees. The body is written per announcement.",
    variables: ["itemTitle"],
    subject: "Announcement — {{itemTitle}}",
  },

  // ── Education ────────────────────────────────────────────────────────────
  // education.decision is externalEmail, so these govern the in-app row and the
  // Slack DM; the email itself is the operator-editable education:decision:*
  // template on its own pipeline.
  "education.decision.approved": {
    eventType: "education.decision",
    label: "Course decision: approved",
    description: "Sent when an applicant gets a seat.",
    variables: ["itemTitle"],
    subject: "You're in: {{itemTitle}}",
    body: "Your spot in {{itemTitle}} is confirmed. Open the course hub for sessions and materials.",
  },
  "education.decision.promoted": {
    eventType: "education.decision",
    label: "Course decision: promoted off the waitlist",
    description: "Sent when a seat frees up and a waitlisted applicant gets it.",
    variables: ["itemTitle"],
    subject: "A seat opened up: you're in {{itemTitle}}",
    body: "You've been moved off the waitlist and enrolled in {{itemTitle}}.",
  },
  "education.decision.waitlisted": {
    eventType: "education.decision",
    label: "Course decision: waitlisted",
    description: "Sent when a course is full and the applicant joins the waitlist.",
    variables: ["itemTitle"],
    subject: "Waitlisted for {{itemTitle}}",
    body: "{{itemTitle}} is currently full. You're on the waitlist — if a seat opens you'll be enrolled automatically.",
  },
  "education.decision.rejected": {
    eventType: "education.decision",
    label: "Course decision: not accepted",
    description: "Sent when an application isn't accepted.",
    variables: ["itemTitle"],
    subject: "Update on {{itemTitle}}",
    body: "Your application to {{itemTitle}} wasn't accepted this time. We'd love to see you at a future offering.",
  },
  "education.decision.withdrawn": {
    eventType: "education.decision",
    label: "Course decision: withdrawn",
    description: "Sent when a student is withdrawn from a course.",
    variables: ["itemTitle"],
    subject: "Withdrawn from {{itemTitle}}",
    body: "You've been withdrawn from {{itemTitle}}.",
  },
  "education.assignment": {
    eventType: "education.assignment",
    label: "New assignment",
    description: "Sent to enrollees when an instructor publishes an assignment.",
    variables: ["itemTitle", "contextName", "itemDetail"],
    subject: "New assignment in {{contextName}}: {{itemTitle}}",
    body: "{{itemDetail}}",
  },
  "education.session_reminder": {
    eventType: "education.session_reminder",
    label: "Session starting soon",
    description: "Sent to enrollees before a course session.",
    variables: ["itemTitle", "contextName", "when", "itemDetail"],
    subject: "Upcoming: {{itemTitle}}",
    // itemDetail is the room, which arrives with its own leading separator
    // because it is often absent.
    body: "{{contextName}} · {{when}}{{itemDetail}}",
  },
  "education.grade": {
    eventType: "education.grade",
    label: "Submission graded",
    description: "Sent when an instructor grades a submission.",
    variables: ["itemTitle"],
    subject: "Feedback on {{itemTitle}}",
    body: "Your instructor graded your submission — open the assignment to see it.",
  },
  "education.discussion.post": {
    eventType: "education.discussion",
    label: "New discussion post",
    description: "Sent when someone starts a discussion thread in a course.",
    variables: ["contextName", "itemDetail"],
    subject: "New post in {{contextName}}",
    body: "{{itemDetail}}",
  },
  "education.discussion.reply": {
    eventType: "education.discussion",
    label: "New discussion reply",
    description: "Sent when someone replies in a course discussion.",
    variables: ["contextName", "itemDetail"],
    subject: "New reply in {{contextName}}",
    body: "{{itemDetail}}",
  },
  "education.feedback_request.session": {
    eventType: "education.feedback_request",
    label: "Session feedback request",
    description: "Sent after a session to the people who attended.",
    variables: ["contextName", "count"],
    subject: "Session feedback — {{contextName}}, session {{count}}",
    body: "Two minutes of feedback helps the instructors improve the next session.",
  },
  "education.feedback_request.instructor_exit": {
    eventType: "education.feedback_request",
    label: "Instructor exit survey",
    description: "Sent to instructors when a course closes out.",
    variables: ["itemTitle"],
    subject: "Instructor exit survey — {{itemTitle}}",
    body: "The course is closed out — tell the education team how it went.",
  },
  "education.certificate": {
    eventType: "education.certificate",
    label: "Certificate ready",
    description: "Sent when a certificate is issued for a completed course.",
    variables: ["itemTitle"],
    subject: "Certificate: {{itemTitle}}",
    body: "Congratulations on completing the course — your certificate is ready.",
  },
  "education.ce_reminder": {
    eventType: "education.ce_reminder",
    label: "CE credit reminder",
    description: "Sent to members who still owe a continuing-education credit.",
    variables: ["itemTitle"],
    subject: "You still owe a CE credit for {{itemTitle}}",
    body: "Attend a workshop or miniseries session to earn it, or complete the async CEC check-in.",
  },
} as const satisfies Record<string, NotificationCopyDef>;

export type NotificationCopyKey = keyof typeof NOTIFICATION_COPY;

export const NOTIFICATION_COPY_KEYS = Object.keys(
  NOTIFICATION_COPY,
) as NotificationCopyKey[];

export function isNotificationCopyKey(value: unknown): value is NotificationCopyKey {
  // hasOwnProperty, not `in` — see isEmailTemplateKey for the same reason.
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NOTIFICATION_COPY, value)
  );
}

export function notificationCopyDef(key: NotificationCopyKey): NotificationCopyDef {
  return NOTIFICATION_COPY[key];
}

// Sample values for the admin preview and test send, by token. Shared across all
// notification templates rather than written per entry — these messages are
// generic by design, so one plausible value per token is enough to see the shape.
export const NOTIFICATION_SAMPLES: Record<TemplateVariableName, string> = {
  firstName: "Alex",
  itemTitle: "Weekly Core sync",
  itemDetail: "Tuesday, April 8 at 2:00 PM ET · Pod Appa",
  contextName: "Course Scheduler",
  personName: "Ada Lovelace",
  when: "Tuesday, April 8 at 2:00 PM ET",
  statusLabel: "In Review",
  count: "3",
  // Not offered to notification templates, but the type demands every token.
  domain: "Engineering",
  time: "2:00 PM ET",
  location: "Pod Appa",
  meetingUrl: "https://dartmouth.zoom.us/j/000000",
  originalCloseDate: "Friday, April 4",
  newCloseDate: "Monday, April 7",
  slackUrl: "https://dali-lab.slack.com",
  term: "26F",
  upcomingTerm: "27W",
  today: "April 8, 2026",
  memberName: "Alex Rivera",
  supervisorName: "Sean Noh",
  menteeName: "Jordan Lee",
};

export function notificationSample(
  variables: readonly TemplateVariableName[],
): Record<string, string> {
  return Object.fromEntries(variables.map((v) => [v, NOTIFICATION_SAMPLES[v]]));
}
