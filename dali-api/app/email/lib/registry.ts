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

import type { TemplateVariableName } from "~/lib/template-variables";

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

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[];

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so "toString" and
  // "constructor" would pass the guard and then resolve to an undefined def.
  // Both the admin route and the MCP tool run request input through here.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value);
}

export function emailTemplateDef(key: EmailTemplateKey): EmailTemplateDef {
  return EMAIL_TEMPLATES[key];
}

// Grouped for the admin page, areas in registry order.
export function emailTemplatesByArea(): { area: string; keys: EmailTemplateKey[] }[] {
  const out: { area: string; keys: EmailTemplateKey[] }[] = [];
  for (const key of EMAIL_TEMPLATE_KEYS) {
    const area = EMAIL_TEMPLATES[key].area;
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
