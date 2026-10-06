// Every operator-editable email in one registry, shaped like jobs/registry.ts
// and lib/notification-events.ts so it reads as house style.
//
// This generalizes what the hiring refactor got right — a slot as the key, one
// shared row per slot edited in place, the slot's variable contract declared in
// code — and applies it to every area instead of one. The DB row owns the words;
// this file owns the structure: which variables exist, which sender identity it
// goes out as, which footer it ends with, and what happens when no row exists.
//
// Client-safe: no prisma, no server imports, so the admin editor can import it.
//
// Adding an email is one entry here plus a call to getEmailTemplate(key).

import { EVENT_TYPES } from "~/lib/notification-events";
import type { TemplateVariableName } from "~/lib/template-variables";

import {
  NOTIFICATION_COPY_KEYS,
  isNotificationCopyKey,
  notificationCopyDef,
  notificationSample,
  type NotificationCopyKey,
} from "~/email/lib/notification-copy";

// What to do when no row exists for a key. Hiring's rule was "no row means that
// slot sends nothing", which is right for a lead who hasn't written a rejection
// letter yet — we must not invent one. It is wrong for mail a member relies on,
// where clearing a row would silently switch off a channel, so those fall back
// to the registry's own copy instead.
export type WhenMissing =
  // Send nothing. The in-app notification, if any, still fires.
  | "skip"
  // Refuse the action that would have sent it, so the operator finds out before
  // an applicant doesn't.
  | "error"
  // Fall back to `defaults`, which must then be present.
  | "default";

export type EmailFooterKind = "notifications" | "transactional" | "none";

export type EmailSendPurposeKey = "Hiring" | "Education" | "Partners" | "General";

export type EmailTemplateDef = {
  area: string;
  label: string;
  description: string;
  purpose: EmailSendPurposeKey;
  // The variables the call site actually populates. Where a key is reached from
  // several call sites this is their INTERSECTION, so an operator can rely on
  // every listed variable rendering on every path.
  variables: readonly TemplateVariableName[];
  // Shown in the editor preview and the test send.
  sample: Record<string, string>;
  footer: EmailFooterKind;
  whenMissing: WhenMissing;
  defaults?: { subject: string; body: string };
};

const APPLICANT_SAMPLE = { firstName: "Alex", domain: "Engineering" };
const INTERVIEW_SAMPLE = {
  firstName: "Alex",
  domain: "Engineering",
  time: "Tuesday, April 8 at 2:00 PM ET",
  location: "Pod Appa, DALI Lab",
  meetingUrl: "https://dartmouth.zoom.us/j/000000",
};

export const EMAIL_TEMPLATES = {
  // ── Hiring: decisions ────────────────────────────────────────────────────
  // whenMissing "error" preserves today's behaviour: releasing a decision with
  // no email written fails with a 409 rather than releasing silently.
  "hiring:decision:Rejected": {
    area: "Hiring",
    label: "Decision: not accepted",
    description: "Sent when a lead releases a Rejected decision.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],
    sample: APPLICANT_SAMPLE,
    footer: "transactional",
    whenMissing: "error",
  },
  "hiring:decision:InvitedToInterview": {
    area: "Hiring",
    label: "Decision: invited to interview",
    description: "Sent when a lead releases an InvitedToInterview decision. Carries the booking link.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],
    sample: APPLICANT_SAMPLE,
    footer: "transactional",
    whenMissing: "error",
  },
  "hiring:decision:Accepted": {
    area: "Hiring",
    label: "Decision: accepted",
    description:
      "Sent when a lead releases an Accepted decision, and when an applicant is accepted off the waitlist. The onboarding and credentials block is appended to it.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],
    sample: APPLICANT_SAMPLE,
    footer: "transactional",
    whenMissing: "error",
  },
  "hiring:decision:Waitlisted": {
    area: "Hiring",
    label: "Decision: waitlisted",
    description: "Sent when a lead releases a Waitlisted decision.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],
    sample: APPLICANT_SAMPLE,
    footer: "transactional",
    whenMissing: "error",
  },

  // Appended to the Accepted letter above, so an accepted applicant gets one
  // email rather than two. It exists as its own template because its content and
  // the decision letter's have different owners and different lifetimes: the
  // letter is cycle-specific prose a lead rewrites, this is the standing "here's
  // what happens next" that changes when the dates change.
  //
  // Code keeps two pieces deliberately. The credentials paragraph is conditional
  // (new account / existing password / still provisioning) and carries a live
  // password, so an operator deleting the wrong line would ship a member a login
  // they can't use. The logo is an <img>, which no email sanitizer allows through.
  // Everything that goes stale — the deadline, the required-event day, the term,
  // the sign-off — is here.
  "hiring:onboarding:NextSteps": {
    area: "Hiring",
    label: "Accepted: onboarding and next steps",
    description:
      "Appended to the Accepted decision email. Holds the acceptance deadline, the required-event date and the sign-off, so they change here rather than in a deploy.",
    purpose: "Hiring",
    variables: ["slackUrl"],
    sample: { slackUrl: "https://dali-lab.slack.com" },
    footer: "transactional",
    // Clearing it would strip the next-steps half of every acceptance email, so
    // it falls back rather than vanishing.
    whenMissing: "default",
    defaults: {
      // Unused: this template is appended to the Accepted letter, which carries
      // the subject. Kept non-empty because a blank subject reads as a bug.
      subject: "Next steps",
      body: [
        "Once you're in, finish setting up by completing your member profile and onboarding steps.",
        "<strong>The deadline to accept your offer and complete onboarding is June 8th, 2026.</strong>",
        'We use Slack day-to-day at <a href="{{slackUrl}}">DALI Studios</a>. A teammate will add you to the workspace shortly.',
        "We also have a special event planned for all day Sunday, September 13th. This is a required event. If there is any concern with this requirement, please reach out.",
        "We are very excited to welcome you to DALI soon and look forward to an incredible 26F together. Please reach out with any questions.",
        "Best,\nSean Noh and DALI Hiring",
      ].join("\n\n"),
    },
  },

  // ── Hiring: application lifecycle ────────────────────────────────────────
  "hiring:notification:ApplicationReceived": {
    area: "Hiring",
    label: "Application received",
    description: "Confirmation sent when an applicant submits. No {{domain}} — one submission can span several.",
    purpose: "Hiring",
    variables: ["firstName"],
    sample: { firstName: "Alex" },
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:ApplicationExtensionNotice": {
    area: "Hiring",
    label: "Deadline extended",
    description:
      "Nudge to applicants with an unsubmitted draft once the original close date passes and an extension is in effect.",
    purpose: "Hiring",
    variables: ["firstName", "originalCloseDate", "newCloseDate"],
    sample: {
      firstName: "Alex",
      originalCloseDate: "Friday, April 4",
      newCloseDate: "Monday, April 7",
    },
    footer: "transactional",
    whenMissing: "skip",
  },

  // ── Hiring: interviews ───────────────────────────────────────────────────
  "hiring:notification:InterviewInviteReminder": {
    area: "Hiring",
    label: "Interview: booking reminder",
    description: "Manual 'Resend invite' nudge to an applicant who hasn't booked yet.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],
    sample: APPLICANT_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewConfirmedApplicant": {
    area: "Hiring",
    label: "Interview booked (applicant)",
    description: "Sent to the applicant once they book, and again if their interviewers change. Carries the calendar invite.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location", "meetingUrl"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewInviteMentor": {
    area: "Hiring",
    label: "Interview booked (interviewer)",
    description: "Sent to each assigned interviewer when an interview is booked. Carries the calendar invite.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location", "meetingUrl"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewCancelledApplicant": {
    area: "Hiring",
    label: "Interview cancelled (applicant)",
    description: "Sent to the applicant when their interview is cancelled.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewCancelledInterviewer": {
    area: "Hiring",
    label: "Interview cancelled (interviewer)",
    description:
      "Sent to an interviewer when the interview is cancelled, and when they are swapped off one. One body covers both.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewLocationChanged": {
    area: "Hiring",
    label: "Interview location changed",
    description: "Sent to the applicant and the interviewers when an interview moves. One body serves both audiences.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location", "meetingUrl"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewReminderApplicant": {
    area: "Hiring",
    label: "Interview reminder (applicant)",
    description: "Sent 24 hours and 1 hour before the interview.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location", "meetingUrl"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },
  "hiring:notification:InterviewReminderInterviewer": {
    area: "Hiring",
    label: "Interview reminder (interviewer)",
    description: "Sent 24 hours and 1 hour before the interview.",
    purpose: "Hiring",
    variables: ["firstName", "domain", "time", "location", "meetingUrl"],
    sample: INTERVIEW_SAMPLE,
    footer: "transactional",
    whenMissing: "skip",
  },

  // ── Education: application decisions ─────────────────────────────────────
  // {{domain}} carries the course title here. That reuse predates this registry
  // and is kept so existing bodies keep rendering.
  "education:decision:Approved": {
    area: "Education",
    label: "Approved",
    description: "Sent when an applicant gets a seat, including off the waitlist.",
    purpose: "Education",
    variables: ["firstName", "domain"],
    sample: { firstName: "Alex", domain: "Intro to UX" },
    footer: "transactional",
    whenMissing: "skip",
  },
  // Waitlist promotion. The in-app row has said "a seat opened up" for a while,
  // but the email was keyed on status alone, so a promoted student got the plain
  // Approved letter — reading like a first-round acceptance. Absent, this falls
  // back to the Approved copy, which is exactly today's behaviour.
  "education:decision:Promoted": {
    area: "Education",
    label: "Promoted off the waitlist",
    description:
      "Sent when a seat frees up and a waitlisted applicant gets it. Falls back to the Approved email when left empty.",
    purpose: "Education",
    variables: ["firstName", "domain"],
    sample: { firstName: "Alex", domain: "Intro to UX" },
    footer: "transactional",
    whenMissing: "skip",
  },
  "education:decision:Waitlisted": {
    area: "Education",
    label: "Waitlisted",
    description: "Sent when an applicant goes on the waitlist.",
    purpose: "Education",
    variables: ["firstName", "domain"],
    sample: { firstName: "Alex", domain: "Intro to UX" },
    footer: "transactional",
    whenMissing: "skip",
  },
  "education:decision:Rejected": {
    area: "Education",
    label: "Not accepted",
    description: "Sent when an application isn't accepted.",
    purpose: "Education",
    variables: ["firstName", "domain"],
    sample: { firstName: "Alex", domain: "Intro to UX" },
    footer: "transactional",
    whenMissing: "skip",
  },
  "education:decision:Withdrawn": {
    area: "Education",
    label: "Withdrawn",
    description: "Sent when a student is withdrawn from the course.",
    purpose: "Education",
    variables: ["firstName", "domain"],
    sample: { firstName: "Alex", domain: "Intro to UX" },
    footer: "transactional",
    whenMissing: "skip",
  },
} as const satisfies Record<string, EmailTemplateDef>;

// ── Notification templates ──────────────────────────────────────────────────
// The ~55 messages notify() sends live in app/email/lib/notification-copy.ts,
// keyed per message. They are projected in here under a `notify:` prefix so the
// store, the editor, the MCP tools and the version history treat them exactly
// like the feature templates — one editor, not two.
//
// They differ in two ways, both deliberate:
//   * `whenMissing: "default"`, so an untouched notification keeps today's
//     wording byte-for-byte and the 55 rows are opt-in. Clearing a row falls
//     back to the registry rather than silently switching off a channel people
//     rely on, which is what hiring's "no row means send nothing" would have done.
//   * `purpose: "General"` (unless the copy entry overrides it) and the
//     notifications footer, since these are the member-facing mail the settings
//     page governs.

export const NOTIFY_KEY_PREFIX = "notify:" as const;

export type NotifyTemplateKey = `${typeof NOTIFY_KEY_PREFIX}${NotificationCopyKey}`;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES | NotifyTemplateKey;

export function notifyTemplateKey(copyKey: NotificationCopyKey): NotifyTemplateKey {
  return `${NOTIFY_KEY_PREFIX}${copyKey}`;
}

function notifyDefToEmailDef(copyKey: NotificationCopyKey): EmailTemplateDef {
  const copy = notificationCopyDef(copyKey);
  const event = EVENT_TYPES[copy.eventType];
  return {
    area: event.area,
    label: copy.label,
    description: copy.description,
    purpose: copy.purpose ?? "General",
    variables: copy.variables,
    sample: notificationSample(copy.variables),
    footer: "notifications",
    whenMissing: "default",
    defaults: { subject: copy.subject, body: copy.body ?? "" },
  };
}

export const EMAIL_TEMPLATE_KEYS: EmailTemplateKey[] = [
  ...(Object.keys(EMAIL_TEMPLATES) as (keyof typeof EMAIL_TEMPLATES)[]),
  ...NOTIFICATION_COPY_KEYS.map(notifyTemplateKey),
];

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so "toString" and
  // "constructor" would pass the guard and then resolve to an undefined def.
  // Both the admin route and the MCP tool run request input through here.
  if (typeof value !== "string") return false;
  if (Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value)) return true;
  return (
    value.startsWith(NOTIFY_KEY_PREFIX) &&
    isNotificationCopyKey(value.slice(NOTIFY_KEY_PREFIX.length))
  );
}

export function emailTemplateDef(key: EmailTemplateKey): EmailTemplateDef {
  if (key.startsWith(NOTIFY_KEY_PREFIX)) {
    return notifyDefToEmailDef(key.slice(NOTIFY_KEY_PREFIX.length) as NotificationCopyKey);
  }
  return EMAIL_TEMPLATES[key as keyof typeof EMAIL_TEMPLATES];
}

// Grouped for the admin page, areas in registry order.
export function emailTemplatesByArea(): { area: string; keys: EmailTemplateKey[] }[] {
  const out: { area: string; keys: EmailTemplateKey[] }[] = [];
  for (const key of EMAIL_TEMPLATE_KEYS) {
    const area = emailTemplateDef(key).area;
    const bucket = out.find((b) => b.area === area);
    if (bucket) bucket.keys.push(key);
    else out.push({ area, keys: [key] });
  }
  return out;
}

// ── Mapping from the pre-collapse slot vocabulary ──────────────────────────
// The two stores this replaced keyed on a bare slot, which collided across
// areas ("decision:Rejected" existed in both). Keys are the slot prefixed with
// its area, so the migration is a concat and existing call sites can keep
// passing a slot.

export function hiringKey(slot: string): EmailTemplateKey {
  const key = `hiring:${slot}`;
  if (!isEmailTemplateKey(key)) throw new Error(`unknown hiring email slot: ${slot}`);
  return key;
}

export function educationKey(slot: string): EmailTemplateKey {
  const key = `education:${slot}`;
  if (!isEmailTemplateKey(key)) throw new Error(`unknown education email slot: ${slot}`);
  return key;
}
