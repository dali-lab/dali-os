// Sends the deadline-extension nudge to applicants who started but did not
// submit before a cycle's original close. Modeled on autoCloseIfExpired in
// cycles.ts: lazy, idempotent, request-time. There is no scheduler — the
// trigger fires the first time something hits a request path after the
// original close has passed.
//
// Idempotency has two layers:
//   1) ApplicationCycle.extensionNoticeSentAt — cycle-level marker. Set the
//      first time a blast is initiated. Prevents thundering-herd: 50
//      concurrent loaders all hitting the trigger at once result in exactly
//      one running the loop (the rest see the marker and bail).
//   2) CycleNotificationSend rows — per-recipient ledger. Created after a
//      successful send. The blast loop skips any recipient with an existing
//      row, so a partial-failure-then-resend cannot duplicate to recipients
//      who already received the email.

import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, notificationSlot } from "./email-variables";
import { logAuditEvent } from "~/lib/audit";

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
  return getApplicationsGmailRefreshToken();
}

interface DraftRecipient {
  applicationId: string;
  email: string;
  firstName: string;
}

// Recipients are applicants in this cycle who:
//   - have an Application row (one per applicant per cycle, by unique constraint)
//   - have at least one DomainApplication selected (i.e. they meaningfully
//     engaged beyond just clicking "Start Application")
//   - have no Submitted or Withdrawn status update (i.e. still a draft)
//
// One Application per applicant means one email per applicant regardless
// of how many DomainApplications they have.
async function getDraftRecipients(cycleId: string): Promise<DraftRecipient[]> {
  const applications = await prisma.application.findMany({
    where: {
      applicationCycleId: cycleId,
      // Skip applicants who never picked a domain — clicked Start, didn't
      // engage. They aren't really "drafts" in any meaningful sense.
      domainApplications: { some: { selected: true } },
      // Exclude any application that has *ever* been Submitted or Withdrawn
      // (not just whose latest status is Submitted/Withdrawn). Defensive
      // against future state machines that might re-enter Draft.
      statusUpdates: {
        none: { newStatus: { in: ["Submitted", "Withdrawn"] } },
      },
    },
    include: {
      user: { select: { firstName: true, dartmouthEmail: true, netId: true } },
    },
  });
  const out: DraftRecipient[] = [];
  for (const app of applications) {
    const email = app.user.dartmouthEmail ?? (app.user.netId ? `${app.user.netId}@dartmouth.edu` : null);
    if (!email) continue;
    out.push({ applicationId: app.id, email, firstName: app.user.firstName });
  }
  return out;
}

interface SendResult {
  attempted: number;
  succeeded: number;
  failed: number;
  alreadySent: number;
}

interface BlastContext {
  cycleId: string;
  refreshToken: string;
  binding: { emailTemplateVersion: { subject: string; body: string } };
  originalCloseDate: Date;
  closeDate: Date;
}

// Core sender. Caller is responsible for having validated preflight
// (gmail token + binding) — those are passed in so we don't double-fetch
// and to keep the preflight-then-blast contract clear.
async function blastExtensionNotice(ctx: BlastContext): Promise<SendResult> {
  const recipients = await getDraftRecipients(ctx.cycleId);

  // Prefetch existing send rows so we skip in-loop without a roundtrip per
  // recipient. The cycle-level marker prevents concurrent blasts in the
  // common case, so this snapshot is normally accurate for the duration of
  // the loop. The post-send create() also acts as a final guard via the
  // unique constraint — race-loser writes throw and we count as alreadySent.
  const existing = await prisma.cycleNotificationSend.findMany({
    where: {
      applicationCycleId: ctx.cycleId,
      notificationType: "ApplicationExtensionNotice",
    },
    select: { applicationId: true },
  });
  const alreadySentIds = new Set(existing.map((r) => r.applicationId));

  const originalCloseDate = formatCloseInstant(ctx.originalCloseDate);
  const newCloseDate = formatCloseInstant(ctx.closeDate);

  let succeeded = 0;
  let failed = 0;
  let alreadySent = 0;
  for (const r of recipients) {
    if (alreadySentIds.has(r.applicationId)) {
      alreadySent++;
      continue;
    }
    try {
      const { subject, html } = renderForSlot(
        notificationSlot("ApplicationExtensionNotice"),
        ctx.binding.emailTemplateVersion,
        { firstName: r.firstName, originalCloseDate, newCloseDate },
      );
      await sendEmail({ refreshToken: ctx.refreshToken, to: r.email, subject, html });
      try {
        await prisma.cycleNotificationSend.create({
          data: {
            applicationCycleId: ctx.cycleId,
            notificationType: "ApplicationExtensionNotice",
            applicationId: r.applicationId,
          },
        });
      } catch (err) {
        // Unique-constraint race with a concurrent blast — the email did
        // go out, but treat as already-sent for the counters so the audit
        // log doesn't claim a "fresh" send.
        alreadySent++;
        continue;
      }
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`Failed to send extension notice to ${r.email}:`, err);
    }
  }
  return { attempted: recipients.length, succeeded, failed, alreadySent };
}

// Returns the cycle's send-relevant fields if an extension is currently
// configured (originalCloseDate set, closeDate after it). Returns null
// otherwise. Used by both lazy and manual paths to check before claiming.
async function loadExtensionContext(cycleId: string): Promise<{
  originalCloseDate: Date;
  closeDate: Date;
  extensionNoticeSentAt: Date | null;
} | null> {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: {
      originalCloseDate: true,
      closeDate: true,
      extensionNoticeSentAt: true,
    },
  });
  if (!cycle) return null;
  if (!cycle.originalCloseDate || !cycle.closeDate) return null;
  if (cycle.closeDate.getTime() <= cycle.originalCloseDate.getTime()) return null;
  return {
    originalCloseDate: cycle.originalCloseDate,
    closeDate: cycle.closeDate,
    extensionNoticeSentAt: cycle.extensionNoticeSentAt,
  };
}

// Validates gmail token + cycle template binding without writing anything.
// Returns the validated values for the caller to pass into blast, or null
// if either is missing — in which case the caller MUST NOT claim the
// cycle marker (otherwise the auto-fire is permanently disabled until
// someone manually clears it).
async function preflight(cycleId: string): Promise<{
  refreshToken: string;
  binding: { emailTemplateVersion: { subject: string; body: string } };
} | null> {
  const refreshToken = await getGmailRefreshToken();
  if (!refreshToken) return null;
  const binding = await prisma.cycleNotificationEmail.findUnique({
    where: {
      applicationCycleId_notificationType: {
        applicationCycleId: cycleId,
        notificationType: "ApplicationExtensionNotice",
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding) return null;
  return { refreshToken, binding };
}

/**
 * Lazy trigger: send the extension-notice blast if the original close has
 * passed and we haven't already sent. Idempotent — preflight runs first
 * (so a missing template/token doesn't poison the marker), then a single
 * atomic `updateMany` claims the right to run the blast.
 *
 * Conditions for firing:
 *   - originalCloseDate is set (i.e. an extension was applied)
 *   - now > originalCloseDate
 *   - now < closeDate (extension is still in effect — past it, the regular
 *     "applications closed" view takes over)
 *   - extensionNoticeSentAt is null (no prior blast attempt)
 *   - gmail refresh token is configured AND a template is bound to the slot
 *
 * Best-effort: errors are swallowed so loaders never fail because of email.
 */
export async function sendExtensionNoticeIfDue(cycleId: string): Promise<void> {
  try {
    const ctx = await loadExtensionContext(cycleId);
    if (!ctx) return;
    if (ctx.extensionNoticeSentAt) return;
    const now = Date.now();
    if (now <= ctx.originalCloseDate.getTime()) return;
    if (now >= ctx.closeDate.getTime()) return;

    // Preflight BEFORE claim. If gmail token / binding is missing, skip
    // without setting the marker — the next request can retry once the
    // lead bound a template (or the gmail user's refresh token was set).
    // No audit log here: the auto path runs on every loader request, and
    // a misconfigured cycle would otherwise spam the audit table once per
    // page load. The manual resend path does log preflight failures.
    const pf = await preflight(cycleId);
    if (!pf) return;

    // Atomic claim — only the request that flips the marker from null to
    // now() proceeds. Concurrent loaders see count === 0 and bail.
    const claimed = await prisma.applicationCycle.updateMany({
      where: { id: cycleId, extensionNoticeSentAt: null },
      data: { extensionNoticeSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    const result = await blastExtensionNotice({
      cycleId,
      refreshToken: pf.refreshToken,
      binding: pf.binding,
      originalCloseDate: ctx.originalCloseDate,
      closeDate: ctx.closeDate,
    });
    await logAuditEvent({
      action: "email.extension_notice",
      targetId: cycleId,
      metadata: { mode: "auto", ...result },
    });
  } catch (err) {
    console.error("sendExtensionNoticeIfDue failed:", err);
    await logAuditEvent({
      action: "email.extension_notice",
      targetId: cycleId,
      metadata: {
        mode: "auto",
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Manual resend triggered from the lead cycle page. Bypasses the marker
 * idempotency check (so leads can re-send after a partial failure) but
 * relies on per-recipient `CycleNotificationSend` rows to skip recipients
 * who already received the email. Still requires preflight — caller gets
 * an `outcome: "preflight_skipped"` result if gmail/template isn't ready.
 */
export async function resendExtensionNotice(cycleId: string): Promise<SendResult & { outcome: "ok" | "no_extension" | "preflight_skipped" }> {
  const ctx = await loadExtensionContext(cycleId);
  if (!ctx) {
    await logAuditEvent({
      action: "email.extension_notice",
      targetId: cycleId,
      metadata: { mode: "manual", outcome: "no_extension" },
    });
    return { attempted: 0, succeeded: 0, failed: 0, alreadySent: 0, outcome: "no_extension" };
  }
  const pf = await preflight(cycleId);
  if (!pf) {
    await logAuditEvent({
      action: "email.extension_notice",
      targetId: cycleId,
      metadata: { mode: "manual", outcome: "preflight_skipped" },
    });
    return { attempted: 0, succeeded: 0, failed: 0, alreadySent: 0, outcome: "preflight_skipped" };
  }
  // Set the marker so any in-flight or future auto-fire loaders see "already
  // started" and bail. Doesn't gate the manual path itself — leads can
  // resend repeatedly to retry failures.
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { extensionNoticeSentAt: new Date() },
  });
  const result = await blastExtensionNotice({
    cycleId,
    refreshToken: pf.refreshToken,
    binding: pf.binding,
    originalCloseDate: ctx.originalCloseDate,
    closeDate: ctx.closeDate,
  });
  await logAuditEvent({
    action: "email.extension_notice",
    targetId: cycleId,
    metadata: { mode: "manual", ...result },
  });
  return { ...result, outcome: "ok" };
}
