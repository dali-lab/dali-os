// Sends the deadline-extension nudge to applicants who started but did not
// submit before a cycle's original close. Modeled on autoCloseIfExpired in
// cycles.ts: lazy, idempotent, request-time. There is no scheduler — the
// trigger fires the first time something hits a request path after the
// original close has passed.

import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { renderForSlot, notificationSlot } from "./email-variables";

const GMAIL_USER = "applications@dali.dartmouth.edu";

function formatCloseInstant(d: Date): string {
  return `${d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

async function getGmailRefreshToken(): Promise<string | null> {
  const gmailUser = await prisma.user.findUnique({
    where: { daliEmail: GMAIL_USER },
    select: { googleRefreshToken: true },
  });
  return gmailUser?.googleRefreshToken ?? null;
}

interface DraftRecipient {
  email: string;
  firstName: string;
}

// Applicants whose latest status is not Submitted and not Withdrawn — i.e.,
// either no status updates yet (still in Draft) or an explicit Draft entry.
// Withdrawn applicants are explicitly excluded so we don't nudge people who
// pulled out.
async function getDraftRecipients(cycleId: string): Promise<DraftRecipient[]> {
  const applications = await prisma.application.findMany({
    where: { applicationCycleId: cycleId },
    include: {
      user: { select: { firstName: true, dartmouthEmail: true, netId: true } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const out: DraftRecipient[] = [];
  for (const app of applications) {
    const latest = app.statusUpdates[0]?.newStatus;
    if (latest === "Submitted" || latest === "Withdrawn") continue;
    const email = app.user.dartmouthEmail ?? (app.user.netId ? `${app.user.netId}@dartmouth.edu` : null);
    if (!email) continue;
    out.push({ email, firstName: app.user.firstName });
  }
  return out;
}

interface SendResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// Core sender — does not check the idempotency flag, so callers must gate.
// Used by both the lazy trigger and the manual resend button. Best-effort
// per recipient: a single failed send doesn't block the rest.
async function blastExtensionNotice(
  cycleId: string,
  cycle: { originalCloseDate: Date; closeDate: Date },
): Promise<SendResult> {
  const refreshToken = await getGmailRefreshToken();
  if (!refreshToken) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  const binding = await prisma.cycleNotificationEmail.findUnique({
    where: {
      applicationCycleId_notificationType: {
        applicationCycleId: cycleId,
        notificationType: "ApplicationExtensionNotice",
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const recipients = await getDraftRecipients(cycleId);
  const originalCloseDate = formatCloseInstant(cycle.originalCloseDate);
  const newCloseDate = formatCloseInstant(cycle.closeDate);

  let succeeded = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      const { subject, html } = renderForSlot(
        notificationSlot("ApplicationExtensionNotice"),
        binding.emailTemplateVersion,
        { firstName: r.firstName, originalCloseDate, newCloseDate },
      );
      await sendEmail({ refreshToken, to: r.email, subject, html });
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`Failed to send extension notice to ${r.email}:`, err);
    }
  }
  return { attempted: recipients.length, succeeded, failed };
}

/**
 * Lazy trigger: send the extension-notice blast if the original close has
 * passed and we haven't already sent. Idempotent — the
 * `extensionNoticeSentAt` column is set under a transaction guard so two
 * concurrent loaders can't double-blast.
 *
 * Conditions for firing:
 *   - originalCloseDate is set (i.e. an extension was applied)
 *   - now > originalCloseDate
 *   - now < closeDate (extension is still in effect — past it, the regular
 *     "applications closed" view takes over)
 *   - extensionNoticeSentAt is null
 *
 * Best-effort: errors are swallowed so loaders never fail because of email.
 */
export async function sendExtensionNoticeIfDue(cycleId: string): Promise<void> {
  try {
    const cycle = await prisma.applicationCycle.findUnique({
      where: { id: cycleId },
      select: {
        originalCloseDate: true,
        closeDate: true,
        extensionNoticeSentAt: true,
      },
    });
    if (!cycle) return;
    if (!cycle.originalCloseDate || !cycle.closeDate) return;
    if (cycle.extensionNoticeSentAt) return;
    const now = Date.now();
    if (now <= cycle.originalCloseDate.getTime()) return;
    if (now >= cycle.closeDate.getTime()) return;

    // Claim the send slot atomically. Only the request that successfully
    // flips the marker from null → now() is allowed to actually send;
    // others see a 0-row update and bail out.
    const claimed = await prisma.applicationCycle.updateMany({
      where: { id: cycleId, extensionNoticeSentAt: null },
      data: { extensionNoticeSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    await blastExtensionNotice(cycleId, {
      originalCloseDate: cycle.originalCloseDate,
      closeDate: cycle.closeDate,
    });
  } catch (err) {
    console.error("sendExtensionNoticeIfDue failed:", err);
  }
}

/**
 * Manual resend triggered from the lead cycle page. Bypasses the
 * idempotency check and the time-window check, but still requires an
 * extension to be configured (originalCloseDate + closeDate set, with
 * close after original). Updates extensionNoticeSentAt to now().
 */
export async function resendExtensionNotice(cycleId: string): Promise<SendResult> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: { originalCloseDate: true, closeDate: true },
  });
  if (!cycle?.originalCloseDate || !cycle.closeDate) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  if (cycle.closeDate.getTime() <= cycle.originalCloseDate.getTime()) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { extensionNoticeSentAt: new Date() },
  });
  return blastExtensionNotice(cycleId, {
    originalCloseDate: cycle.originalCloseDate,
    closeDate: cycle.closeDate,
  });
}
