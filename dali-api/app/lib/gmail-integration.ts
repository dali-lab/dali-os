import { prisma } from "~/lib/db";
import type { EmailSendPurpose } from "~/generated/prisma/client";

// Purpose-keyed Gmail send-as identities (GmailIntegration rows, connected
// via /admin/authorize-gmail?purpose=…). Every outbound-email call site
// resolves its sender here by purpose — Hiring, Education, Partners, or
// General (notify()/digests).

/**
 * Returns the refresh token for the purpose's connected integration. A
 * purpose with no row of its own falls back to Hiring — the applications@
 * integration predates purposes and is the only one guaranteed connected —
 * so an area's mail keeps flowing until ops links its dedicated account.
 */
export async function getSenderRefreshToken(
  purpose: EmailSendPurpose,
): Promise<string | null> {
  const row = await prisma.gmailIntegration.findFirst({
    where: { purpose, enabled: true },
    orderBy: { linkedAt: "desc" },
    select: { oauthTokens: true },
  });
  if (row) return row.oauthTokens;
  if (purpose === "Hiring") return null;
  const fallback = await prisma.gmailIntegration.findFirst({
    where: { purpose: "Hiring", enabled: true },
    orderBy: { linkedAt: "desc" },
    select: { oauthTokens: true },
  });
  return fallback?.oauthTokens ?? null;
}

/**
 * The Hiring identity (applications@dali.dartmouth.edu). Kept under its
 * historical name — hiring call sites read as "the applications sender".
 */
export async function getApplicationsGmailRefreshToken(): Promise<string | null> {
  return getSenderRefreshToken("Hiring");
}

/** Whether a purpose has its own connected, enabled integration (no fallback). */
export async function isSenderConnected(purpose: EmailSendPurpose): Promise<boolean> {
  const row = await prisma.gmailIntegration.findFirst({
    where: { purpose, enabled: true },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Returns whether the Applications Gmail integration is connected and
 * enabled. Used by the email-templates UI's "Gmail connected" indicator.
 */
export async function isApplicationsGmailConnected(): Promise<boolean> {
  return isSenderConnected("Hiring");
}

/** All integrations for the admin Email Senders page, newest first. */
export async function listSenderIntegrations() {
  return prisma.gmailIntegration.findMany({
    orderBy: { linkedAt: "desc" },
    select: {
      id: true,
      purpose: true,
      sendAsEmail: true,
      enabled: true,
      linkedAt: true,
      lastUsedAt: true,
      syncError: true,
    },
  });
}
