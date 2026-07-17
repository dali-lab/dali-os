// Registry of outbound email send purposes. Each purpose maps to a connected
// Gmail send-as integration (GmailIntegration row); resolution lives in
// lib/gmail-integration.ts. Client-safe on purpose: the admin Email Senders
// page renders from this table.

export const EMAIL_PURPOSES = {
  Hiring: {
    label: "Hiring / Applications",
    description:
      "Applicant-facing mail: decisions, interview invites and reminders, application confirmations. Historically applications@dali.dartmouth.edu.",
  },
  Education: {
    label: "Education",
    description:
      "Course announcements, feedback requests, certificates, and application decisions for education offerings.",
  },
  Partners: {
    label: "Partners",
    description: "Partner-portal invitations and partner-facing transactional mail.",
  },
  General: {
    label: "Lab notifications",
    description:
      "Everything notify() emails members: instant notification emails, daily and weekly digests, meeting invites.",
  },
} as const satisfies Record<string, { label: string; description: string }>;

export type EmailPurposeKey = keyof typeof EMAIL_PURPOSES;

export const EMAIL_PURPOSE_KEYS = Object.keys(EMAIL_PURPOSES) as EmailPurposeKey[];

export function isEmailPurpose(value: unknown): value is EmailPurposeKey {
  return typeof value === "string" && value in EMAIL_PURPOSES;
}
