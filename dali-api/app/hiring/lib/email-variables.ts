// Single source of truth for which `{{...}}` placeholders are valid in email
// templates and which subset each binding slot actually populates at send time.
// The editor (template detail page) and preview modal use this to surface
// unknown placeholders and placeholders that won't be filled for the bound
// slot — so typos like `{{firstname}}` or putting `{{time}}` in a Rejection
// template stop shipping silently.

import type { NotificationType } from "~/generated/prisma/enums";
import { renderEmail, type InterpolationVars } from "~/lib/email";

export const TEMPLATE_VARIABLE_DESCRIPTIONS: Record<keyof InterpolationVars, string> = {
  firstName: "The recipient's first name.",
  domain: "The DALI domain the application is for (e.g. Engineering).",
  time: "Interview start time, formatted in Eastern Time.",
  location: "Interview location (Pod or online).",
  meetingUrl: "Zoom join URL for online interviews.",
};

export type TemplateVariableName = keyof InterpolationVars;

export const ALL_TEMPLATE_VARIABLES: readonly TemplateVariableName[] = [
  "firstName",
  "domain",
  "time",
  "location",
  "meetingUrl",
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

  // Interview invites — interview-emails sends with full vars.
  "notification:InterviewInviteMentor": ["firstName", "domain", "time", "location", "meetingUrl"],
  "notification:InterviewConfirmedApplicant": ["firstName", "domain", "time", "location", "meetingUrl"],

  // Interview cancellations — sendInterviewCancelEmails omits meetingUrl.
  // sendReassignmentEmails reaches InterviewCancelledInterviewer with
  // meetingUrl, but the registry returns the intersection so leads don't
  // rely on a var that's missing in the cancel path.
  "notification:InterviewCancelledApplicant": ["firstName", "domain", "time", "location"],
  "notification:InterviewCancelledInterviewer": ["firstName", "domain", "time", "location"],

  // Location change — sendLocationChangeEmails passes full vars.
  "notification:InterviewLocationChanged": ["firstName", "domain", "time", "location", "meetingUrl"],
};

// Matches the strict shape the interpolator in app/lib/email.ts handles:
// `{{name}}` with no whitespace, ascii-letter-led identifier. Whitespace
// variants like `{{ firstName }}` are intentionally *not* matched here — the
// interpolator can't substitute them either, and treating them as known would
// hide a real bug from the lint surface.
const PLACEHOLDER_RE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.push(m[1]);
  return out;
}

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
