// Manual "Send announcement" blast for a hiring-cycle application event
// (help hour, social, info session) to everyone who started an application
// in the cycle. Modeled on extension-notice.ts, but there is no lazy/auto
// trigger here — Core always clicks the button, so there's no thundering-herd
// marker to claim first. The per-recipient outbox dedupKey is still the
// idempotency guard: a resend after a partial failure no-ops for anyone
// already sent.

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { APPLICATION_TZ, APPLICATION_TZ_LABEL } from "~/lib/timezone";
import { renderForSlot, notificationSlot } from "./email-variables";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { buildHiringEventIcs, type IcsAttendee } from "./hiring-event-ics";
import { logAuditEvent } from "~/lib/audit";

const ORGANIZER: IcsAttendee = {
  email: "applications@dali.dartmouth.edu",
  name: "DALI Lab",
};

function formatEventTime(d: Date): string {
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

interface AnnouncementRecipient {
  applicationId: string;
  email: string;
  firstName: string;
}

// Everyone who started an application in the cycle: an Application row that
// was never Withdrawn (Draft and Submitted both included — "started", not
// "finished"). One Application per applicant per cycle, so one email each.
async function getAnnouncementRecipients(cycleId: string): Promise<AnnouncementRecipient[]> {
  const applications = await prisma.application.findMany({
    where: {
      applicationCycleId: cycleId,
      domainApplications: { some: { selected: true } },
      statusUpdates: { none: { newStatus: "Withdrawn" } },
    },
    include: {
      user: { select: { firstName: true, dartmouthEmail: true, netId: true } },
    },
  });
  const out: AnnouncementRecipient[] = [];
  for (const app of applications) {
    const email = app.user.dartmouthEmail ?? (app.user.netId ? `${app.user.netId}@dartmouth.edu` : null);
    if (!email) continue;
    out.push({ applicationId: app.id, email, firstName: app.user.firstName });
  }
  return out;
}

export interface EventAnnouncementSendResult {
  attempted: number;
  succeeded: number;
  failed: number;
  alreadySent: number;
}

export type SendEventAnnouncementResult =
  | { outcome: "not_configured" }
  | ({ outcome: "sent" } & EventAnnouncementSendResult);

/**
 * Sends the announcement for one event to every recipient, attaches a
 * calendar invite, and stamps HiringEvent.announcementSentAt so the cycle
 * page can show "Sent to N" / "Announced <date>" and relabel the button
 * "Resend". `actorId` is attribution for the audit log only — the Core gate
 * on who may trigger a send lives in the API route.
 */
export async function sendEventAnnouncement(
  eventId: string,
  actorId: string,
): Promise<SendEventAnnouncementResult> {
  const event = await prisma.hiringEvent.findUnique({ where: { id: eventId } });
  if (!event) return { outcome: "not_configured" };

  const refreshToken = await getApplicationsGmailRefreshToken();
  const binding = refreshToken
    ? await getHiringEmail(notificationSlot("ApplicationEventAnnouncement"))
    : null;
  if (!refreshToken || !binding) {
    await logAuditEvent({
      action: "email.event_announcement",
      userId: actorId,
      targetId: eventId,
      metadata: { outcome: "not_configured" },
    });
    return { outcome: "not_configured" };
  }

  const recipients = await getAnnouncementRecipients(event.applicationCycleId);
  const eventTitle = event.title;
  const time = formatEventTime(event.startsAt);
  const location = event.location ?? "DALI Lab";

  let succeeded = 0;
  let failed = 0;
  let alreadySent = 0;
  const ids: Array<string | null> = [];
  for (const r of recipients) {
    try {
      const { subject, html } = renderForSlot(
        notificationSlot("ApplicationEventAnnouncement"),
        binding,
        { firstName: r.firstName, eventTitle, time, location },
      );
      const ics = buildHiringEventIcs({
        eventId,
        summary: eventTitle,
        startTime: event.startsAt,
        endTime: event.endsAt,
        location: event.location,
        organizer: ORGANIZER,
        attendee: { email: r.email, name: r.firstName },
      });
      const enq = await enqueueOutbound({
        channel: "email",
        purpose: "Hiring",
        dedupKey: `hiring.event_announce:${eventId}:${r.applicationId}`,
        target: r.email,
        subject,
        bodyHtml: html,
        ics,
        eventType: "hiring.event_announcement",
      });
      if (enq.deduped) {
        alreadySent++;
      } else {
        ids.push(enq.id);
        succeeded++;
      }
    } catch (err) {
      failed++;
      console.error(`Failed to send event announcement to ${r.email}:`, err);
    }
  }
  await drainNow(ids);

  await prisma.hiringEvent.update({
    where: { id: eventId },
    data: { announcementSentAt: new Date() },
  });

  const result: EventAnnouncementSendResult = {
    attempted: recipients.length,
    succeeded,
    failed,
    alreadySent,
  };
  await logAuditEvent({
    action: "email.event_announcement",
    userId: actorId,
    targetId: eventId,
    metadata: { ...result },
  });
  return { outcome: "sent", ...result };
}
