// Single source of truth for which `{{...}}` placeholders are valid in email
// templates and which subset each binding slot actually populates at send time.
// The editor (template detail page) and preview modal use this to surface
// unknown placeholders and placeholders that won't be filled for the bound
// slot — so typos like `{{firstname}}` or putting `{{time}}` in a Rejection
// template stop shipping silently.

import type { NotificationType } from "~/generated/prisma/enums";
import { renderEmail, type InterpolationVars } from "~/lib/email";
import {
  TEMPLATE_VARIABLES_REGISTRY,
  extractPlaceholders,
} from "~/lib/template-variables";

// Re-export so existing importers/tests keep their entry point.
export { extractPlaceholders };

// Descriptions for the email vocabulary, sourced from the shared registry so
// there's one place the copy lives.
export const TEMPLATE_VARIABLE_DESCRIPTIONS: Record<keyof InterpolationVars, string> = {
  firstName: TEMPLATE_VARIABLES_REGISTRY.firstName.description,
  domain: TEMPLATE_VARIABLES_REGISTRY.domain.description,
  time: TEMPLATE_VARIABLES_REGISTRY.time.description,
  location: TEMPLATE_VARIABLES_REGISTRY.location.description,
  meetingUrl: TEMPLATE_VARIABLES_REGISTRY.meetingUrl.description,
  originalCloseDate: TEMPLATE_VARIABLES_REGISTRY.originalCloseDate.description,
  newCloseDate: TEMPLATE_VARIABLES_REGISTRY.newCloseDate.description,
};

export type TemplateVariableName = keyof InterpolationVars;

export const ALL_TEMPLATE_VARIABLES: readonly TemplateVariableName[] = [
  "firstName",
  "domain",
  "time",
  "location",
  "meetingUrl",
  "originalCloseDate",
  "newCloseDate",
];

export type DecisionSlotType = "Rejected" | "InvitedToInterview" | "Accepted" | "Waitlisted";
export type NotificationSlotType = NotificationType;

export type TemplateSlot =
  | `decision:${DecisionSlotType}`
  | `notification:${NotificationSlotType}`;

export const decisionSlot = (t: DecisionSlotType): TemplateSlot => `decision:${t}`;
export const notificationSlot = (t: NotificationSlotType): TemplateSlot => `notification:${t}`;

// Slot → variables actually passed to renderEmail at the call site. When a slot
// is reached from multiple call sites (e.g. InterviewCancelledInterviewer fires
// from both cancel and reassignment paths), this is the *intersection* of vars
// that all paths populate — so leads can rely on the listed vars rendering
// without a content drift on some paths.
export const TEMPLATE_VARIABLES: Record<TemplateSlot, readonly TemplateVariableName[]> = {
  // Decision emails — api.decisions.$id.release passes firstName + domain.
  "decision:Rejected": ["firstName", "domain"],
  "decision:InvitedToInterview": ["firstName", "domain"],
  "decision:Accepted": ["firstName", "domain"],
  "decision:Waitlisted": ["firstName", "domain"],

  // Application confirmation — portal.apply passes firstName only.
  // {{domain}} is intentionally omitted: an applicant may apply to multiple
  // domains in one go, so a single per-application domain is meaningless.
  "notification:ApplicationReceived": ["firstName"],

  // Deadline-extension nudge — sent to applicants with a draft application
  // when the original close passes and an extension is in effect. {{domain}}
  // is omitted for the same reason as ApplicationReceived (a draft can span
  // multiple domains).
  "notification:ApplicationExtensionNotice": ["firstName", "originalCloseDate", "newCloseDate"],

  // Interview invites — interview-emails sends with full vars.
  "notification:InterviewInviteMentor": ["firstName", "domain", "time", "location", "meetingUrl"],
  "notification:InterviewConfirmedApplicant": ["firstName", "domain", "time", "location", "meetingUrl"],

  // Manual "Resend invite" nudge fired from the unscheduled-invites row on
  // the cycle Interviews tab. Same vars as decision:InvitedToInterview since
  // the recipient is the same applicant and no booking has happened yet — the
  // booking link lives in the template body just like the original invite.
  "notification:InterviewInviteReminder": ["firstName", "domain"],

  // Interview cancellations — sendInterviewCancelEmails omits meetingUrl.
  // sendReassignmentEmails reaches InterviewCancelledInterviewer with
  // meetingUrl, but the registry returns the intersection so leads don't
  // rely on a var that's missing in the cancel path.
  "notification:InterviewCancelledApplicant": ["firstName", "domain", "time", "location"],
  "notification:InterviewCancelledInterviewer": ["firstName", "domain", "time", "location"],

  // Location change — sendLocationChangeEmails passes full vars.
  "notification:InterviewLocationChanged": ["firstName", "domain", "time", "location", "meetingUrl"],

  // Scheduled 24h/1h reminders — sendInterviewReminderEmails passes full vars
  // to both audiences.
  "notification:InterviewReminderApplicant": ["firstName", "domain", "time", "location", "meetingUrl"],
  "notification:InterviewReminderInterviewer": ["firstName", "domain", "time", "location", "meetingUrl"],
};

export interface LintResult {
  unknown: string[];
  unfilled: string[];
}

// Soft lint: returns unknown tokens (typos / bogus vars) and tokens that exist
// globally but aren't populated for this slot. Callers render these as warnings;
// nothing blocks save.
// Pass-through wrapper around renderEmail that names the slot at the call
// site. The slot id is documentation: tests pin TEMPLATE_VARIABLES[slot]
// against the keys each call site passes here, so future drift fails CI loudly.
export function renderForSlot(
  _slot: TemplateSlot,
  template: { subject: string; body: string },
  vars: InterpolationVars,
): { subject: string; html: string } {
  return renderEmail(template, vars);
}

export function lintTemplate(text: string, slot?: TemplateSlot): LintResult {
  const tokens = extractPlaceholders(text);
  const known = new Set<string>(ALL_TEMPLATE_VARIABLES);
  const slotVars = slot ? TEMPLATE_VARIABLES[slot] : null;
  const unknown = new Set<string>();
  const unfilled = new Set<string>();
  for (const tok of tokens) {
    if (!known.has(tok)) {
      unknown.add(tok);
      continue;
    }
    if (slotVars && !slotVars.includes(tok as TemplateVariableName)) {
      unfilled.add(tok);
    }
  }
  return { unknown: [...unknown], unfilled: [...unfilled] };
}
