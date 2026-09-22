// The `{{...}}` vocabulary education's emails can use, and the slots that can
// carry one. Client-safe (no Prisma) so the editor on the manage page and the
// server both import it.

import { extractPlaceholders } from "~/lib/template-variables";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

// Every status a decision email can fire for. "Submitted" isn't a decision.
export type DecisionSlotStatus = Exclude<EduApplicationStatus, "Submitted">;

export type EducationEmailSlot = `decision:${DecisionSlotStatus}`;

export const decisionSlot = (s: DecisionSlotStatus): EducationEmailSlot => `decision:${s}`;

// Education emails render with the applicant's first name and the course
// title. {{domain}} carries the title — it's the shared email vocabulary's
// "what this application is for" token, which for hiring is a DALI domain.
export const EDUCATION_EMAIL_VARIABLES = ["firstName", "domain"] as const;

export type EducationEmailVariable = (typeof EDUCATION_EMAIL_VARIABLES)[number];

export const DECISION_EMAIL_SLOTS: ReadonlyArray<{
  status: DecisionSlotStatus;
  label: string;
  description: string;
}> = [
  {
    status: "Approved",
    label: "Approved",
    description: "Sent when an applicant gets a seat.",
  },
  {
    status: "Waitlisted",
    label: "Waitlisted",
    description: "Sent when an applicant goes on the waitlist.",
  },
  {
    status: "Rejected",
    label: "Rejected",
    description: "Sent when an application isn't accepted.",
  },
  {
    status: "Withdrawn",
    label: "Withdrawn",
    description: "Sent when a student is withdrawn from the course.",
  },
];

// Soft lint: tokens that aren't part of the vocabulary at all. Nothing blocks
// a save — a warning is enough to catch `{{firstname}}` before it ships.
export function unknownVariables(text: string): string[] {
  const known = new Set<string>(EDUCATION_EMAIL_VARIABLES);
  return [...new Set(extractPlaceholders(text).filter((t) => !known.has(t)))];
}
