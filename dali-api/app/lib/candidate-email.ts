import { getAppEnv } from "~/lib/app-env";

// Candidate-facing emails (decision + welcome) must never reach real applicants
// from dev/staging. This centralizes the redirect: in prod the email goes to the
// intended recipient; otherwise it goes to a single test inbox, and callers add
// a banner naming who it WOULD have gone to in prod.

export const TEST_INBOX =
  process.env.ONBOARDING_EMAIL_OVERRIDE ?? "sophie.park@dali.dartmouth.edu";

export type ResolvedRecipient = {
  // Where the email is actually sent.
  to: string | null;
  // In non-prod, the real intended recipient (for the banner); null in prod.
  redirectedFrom: string | null;
};

// Resolve the actual send target for a candidate email.
export function resolveCandidateEmail(intended: string | null): ResolvedRecipient {
  if (getAppEnv() === "prod") {
    return { to: intended, redirectedFrom: null };
  }
  return { to: TEST_INBOX, redirectedFrom: intended };
}

// A small HTML banner shown on redirected (non-prod) emails naming the real
// recipient. Empty string in prod (redirectedFrom is null there).
export function redirectBannerHtml(redirectedFrom: string | null): string {
  if (redirectedFrom === null) return "";
  return `<div style="background:#fff3cd;border:1px solid #ffe69c;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;color:#664d03;">
    ⚠️ <strong>Test environment.</strong> In production this email would have been sent to:
    <strong>${redirectedFrom || "(no address on file)"}</strong>
  </div>`;
}
