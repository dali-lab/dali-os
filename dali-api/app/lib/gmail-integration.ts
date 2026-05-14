import { prisma } from "~/lib/db";

// Phase 2: Gmail send-as credentials moved from User.google* to the
// GmailIntegration model. This helper is the single read path for callers
// that previously looked up `User.googleRefreshToken` by daliEmail.

const GMAIL_USER = "applications@dali.dartmouth.edu";

/**
 * Returns the refresh token for the Gmail send-as integration tied to the
 * configured GMAIL_USER (`applications@dali.dartmouth.edu`), or null when
 * the integration isn't linked or has been disabled.
 *
 * Phase 2 note: the migration backfills GmailIntegration rows from any
 * legacy User.google* values during deploy. The encrypted-at-rest token
 * format will eventually replace plaintext; for now the column stores the
 * raw refresh_token as historically used by `lib/gmail.ts:sendEmail`.
 */
export async function getApplicationsGmailRefreshToken(): Promise<string | null> {
  const integration = await prisma.gmailIntegration.findFirst({
    where: { sendAsEmail: GMAIL_USER, enabled: true },
    select: { oauthTokens: true },
  });
  return integration?.oauthTokens ?? null;
}

/**
 * Returns whether the Applications Gmail integration is connected and
 * enabled. Used by the email-templates UI's "Gmail connected" indicator.
 */
export async function isApplicationsGmailConnected(): Promise<boolean> {
  const row = await prisma.gmailIntegration.findFirst({
    where: { sendAsEmail: GMAIL_USER, enabled: true },
    select: { id: true },
  });
  return row !== null;
}
