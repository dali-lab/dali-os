import { prisma } from "~/lib/db";
import type { EmailSendPurpose } from "~/generated/prisma/client";

// Purpose-keyed Gmail send-as identities (GmailIntegration rows, connected
// via /admin/authorize-gmail?purpose=…). Every outbound-email call site
// resolves its sender here by purpose — Hiring, Education, Partners, or
// General (notify()/digests).

export type ResolvedSender = {
  /** GmailIntegration row id of the identity actually used (own or fallback). */
  id: string;
  /** OAuth refresh token — passed to sendEmail as `refreshToken`. */
  refreshToken: string;
  /** The account the token authenticates as — passed to sendEmail as `from`. */
  sendAsEmail: string;
};

/**
 * Resolves the connected integration that should send a purpose's mail. A
 * purpose with no row of its own falls back to Hiring — the applications@
 * integration predates purposes and is the only one guaranteed connected —
 * so an area's mail keeps flowing until ops links its dedicated account.
 *
 * Returns the sender's own `sendAsEmail` so callers can stamp `from` correctly:
 * sendEmail targets the `me` mailbox, so `from` MUST match the token's account
 * or Gmail rejects the send.
 */
export async function getSender(
  purpose: EmailSendPurpose,
): Promise<ResolvedSender | null> {
  const select = { id: true, oauthTokens: true, sendAsEmail: true } as const;
  const row = await prisma.gmailIntegration.findFirst({
    where: { purpose, enabled: true },
    orderBy: { linkedAt: "desc" },
    select,
  });
  const resolved =
    row ??
    (purpose === "Hiring"
      ? null
      : await prisma.gmailIntegration.findFirst({
          where: { purpose: "Hiring", enabled: true },
          orderBy: { linkedAt: "desc" },
          select,
        }));
  if (!resolved) return null;
  return {
    id: resolved.id,
    refreshToken: resolved.oauthTokens,
    sendAsEmail: resolved.sendAsEmail,
  };
}

/**
 * Refresh token only, for callers that always send as applications@ (the
 * default `from`) and don't need the identity. Thin wrapper over getSender().
 */
export async function getSenderRefreshToken(
  purpose: EmailSendPurpose,
): Promise<string | null> {
  return (await getSender(purpose))?.refreshToken ?? null;
}

/**
 * Best-effort record of whether a sender's last send worked, surfaced on the
 * Admin → Email Senders page. Never throws — a health-write failure must not
 * break (or mask) the actual send.
 */
export async function noteSenderHealth(
  id: string,
  error: string | null,
): Promise<void> {
  await prisma.gmailIntegration
    .update({
      where: { id },
      data: error
        ? { syncError: error.slice(0, 500) }
        : { syncError: null, lastUsedAt: new Date() },
    })
    .catch(() => {});
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
