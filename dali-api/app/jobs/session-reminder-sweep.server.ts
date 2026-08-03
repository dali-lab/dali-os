// Reminds approved enrollees before each education session starts. Idempotent
// via EducationSession.reminderSentAt — a session is reminded at most once,
// so re-ticks/retries never double-send. Fires for sessions starting within
// leadHours (default 24) that are still in the future.

import { prisma } from "~/lib/db";
import { notifySessionReminder } from "~/education/lib/notifications.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const HOUR_MS = 3_600_000;
const BATCH = 50;

export async function runSessionReminderSweep({ now, settings }: JobContext): Promise<JobResult> {
  const sessions = await prisma.educationSession.findMany({
    where: {
      reminderSentAt: null,
      datetime: {
        gt: now,
        lte: new Date(now.getTime() + settings.leadHours * HOUR_MS),
      },
      offering: { status: "Published", closedOutAt: null },
    },
    select: {
      id: true,
      sequence: true,
      title: true,
      datetime: true,
      location: true,
      offeringId: true,
      offering: { select: { title: true } },
    },
    take: BATCH,
  });

  let sent = 0;
  for (const session of sessions) {
    try {
      await notifySessionReminder({
        offeringId: session.offeringId,
        offeringTitle: session.offering.title,
        sequence: session.sequence,
        sessionTitle: session.title,
        datetime: session.datetime,
        location: session.location,
      });
      // Stamp after a successful fan-out so a mid-batch failure re-tries next tick.
      await prisma.educationSession.update({
        where: { id: session.id },
        data: { reminderSentAt: now },
      });
      sent += 1;
    } catch (err) {
      console.error(`[jobs] session reminder for session ${session.id} failed:`, err);
    }
  }

  return { items: sent };
}
