// One-time "Email applicants" blast for a domain that joins an already-Open
// cycle with its own close date (domain-windows.ts). Modeled on
// hiring-event-notice.ts: Core always clicks the button, so there's no
// lazy/auto trigger and no thundering-herd marker to claim first. The
// per-recipient outbox dedupKey is still the idempotency guard: a resend after
// a partial failure no-ops for anyone already sent.

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import { APPLICATION_TZ, APPLICATION_TZ_LABEL } from "~/lib/timezone";
import { renderForSlot, notificationSlot } from "./email-variables";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { domainCloseDate } from "./domain-windows";
import { logAuditEvent } from "~/lib/audit";

function formatCloseInstant(d: Date): string {
  return `${d.toLocaleString("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ${APPLICATION_TZ_LABEL}`;
}

interface Recipient {
  applicationId: string;
  email: string;
  firstName: string;
}

// Everyone with an Application row in the cycle that was never Withdrawn
// (Draft and Submitted both included): a domain opening after the fact is
// relevant to anyone still in the applicant pool, whether or not they've
// already submitted. One Application per applicant per cycle, so one email
// each.
async function getRecipients(cycleId: string): Promise<Recipient[]> {
  const applications = await prisma.application.findMany({
    where: {
      applicationCycleId: cycleId,
      statusUpdates: { none: { newStatus: "Withdrawn" } },
    },
    include: {
      user: { select: { firstName: true, dartmouthEmail: true, netId: true } },
    },
  });
  const out: Recipient[] = [];
  for (const app of applications) {
    const email = app.user.dartmouthEmail ?? (app.user.netId ? `${app.user.netId}@dartmouth.edu` : null);
    if (!email) continue;
    out.push({ applicationId: app.id, email, firstName: app.user.firstName });
  }
  return out;
}

/** How many applicants a send would reach right now, for the confirm dialog. */
export async function countDomainAddedRecipients(cycleId: string): Promise<number> {
  return (await getRecipients(cycleId)).length;
}

export interface DomainAddedNoticeResult {
  sent: number;
  alreadySent: number;
  skipped: number;
}

/**
 * Sends the one-time "a domain opened" notice for (cycleId, domainId) to
 * everyone with a non-Withdrawn Application in the cycle. `actorUserId` is
 * attribution for the audit log only — the cycle-admin gate on who may
 * trigger a send, and on the cycle being Open with the domain ready, lives in
 * the route.
 */
export async function sendDomainAddedNotice(
  cycleId: string,
  domainId: string,
  actorUserId: string,
): Promise<DomainAddedNoticeResult> {
  const [cycle, dac] = await Promise.all([
    prisma.applicationCycle.findUnique({ where: { id: cycleId }, select: { closeDate: true } }),
    prisma.domainApplicationCycle.findUnique({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      select: {
        closeDate: true,
        domain: { select: { name: true, displayName: true } },
      },
    }),
  ]);
  const recipients = await getRecipients(cycleId);

  if (!cycle || !dac) {
    await logAuditEvent({
      action: "email.domain_added_notice",
      userId: actorUserId,
      targetId: domainId,
      metadata: { outcome: "not_configured", cycleId },
    });
    return { sent: 0, alreadySent: 0, skipped: recipients.length };
  }

  const binding = await getHiringEmail(notificationSlot("DomainAddedNotice"));
  if (!binding) {
    await logAuditEvent({
      action: "email.domain_added_notice",
      userId: actorUserId,
      targetId: domainId,
      metadata: { outcome: "not_configured", cycleId, attempted: recipients.length },
    });
    return { sent: 0, alreadySent: 0, skipped: recipients.length };
  }

  const domainName = dac.domain.displayName ?? dac.domain.name;
  const closeDate = domainCloseDate(dac, cycle);
  const closeDateLabel = closeDate ? formatCloseInstant(closeDate) : "at the cycle's close";
  const applyUrl = `${getFrontendUrl().replace(/\/+$/, "")}/portal/apply/${cycleId}`;

  let sent = 0;
  let alreadySent = 0;
  let skipped = 0;
  const ids: Array<string | null> = [];
  for (const r of recipients) {
    try {
      const { subject, html } = renderForSlot(
        notificationSlot("DomainAddedNotice"),
        binding,
        { firstName: r.firstName, domain: domainName, closeDate: closeDateLabel, applyUrl },
      );
      const enq = await enqueueOutbound({
        channel: "email",
        purpose: "Hiring",
        dedupKey: `hiring.domain-added:${cycleId}:${domainId}:${r.applicationId}`,
        target: r.email,
        subject,
        bodyHtml: html,
        eventType: "hiring.domain_added_notice",
      });
      if (enq.deduped) {
        alreadySent++;
      } else {
        ids.push(enq.id);
        sent++;
      }
    } catch (err) {
      skipped++;
      console.error(`Failed to send domain-added notice to ${r.email}:`, err);
    }
  }
  await drainNow(ids);

  const result: DomainAddedNoticeResult = { sent, alreadySent, skipped };
  await logAuditEvent({
    action: "email.domain_added_notice",
    userId: actorUserId,
    targetId: domainId,
    metadata: { cycleId, attempted: recipients.length, ...result },
  });
  return result;
}
