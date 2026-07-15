// Meeting reminders: everyone on a Confirmed meeting hears 15 minutes before
// an occurrence starts. First real consumer of MeetingException — cancelled
// occurrences are skipped and overridden ones are retimed.
//
// Idempotency: MeetingReminderLog keyed on (meeting, ORIGINAL occurrence
// start, user). Claim-then-send — the log row is created before notify(), so
// a crash mid-send loses that one reminder rather than duplicating it (the
// right trade-off for a 15-minute-lead ping; task reminders make the
// opposite choice because their windows are hours wide).

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { formatApplicationDateTime } from "~/lib/timezone";
import type { JobContext, JobResult } from "~/jobs/registry";

const MINUTE_MS = 60_000;
const LEAD_MS = 15 * MINUTE_MS;
// Guard band for the expansion scan: overrides can move an occurrence's
// effective start well away from its original start, so expand wide and
// filter effective starts to [now, now+lead] after.
const BAND_BEFORE_MS = 60 * MINUTE_MS;
const BAND_AFTER_MS = 16 * 3_600_000;
const CAP = 200;

export async function runMeetingReminders({ now }: JobContext): Promise<JobResult> {
  const meetings = await prisma.scheduledMeeting.findMany({
    where: { status: "Confirmed", selectedAt: { not: null } },
    select: {
      id: true,
      title: true,
      organizerId: true,
      participantUserIds: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      exceptions: true,
    },
    take: 500,
  });

  const windowStart = new Date(now.getTime() - BAND_BEFORE_MS);
  const windowEnd = new Date(now.getTime() + BAND_AFTER_MS);
  const leadEnd = now.getTime() + LEAD_MS;

  let sent = 0;
  for (const meeting of meetings) {
    if (sent >= CAP) break;
    const occurrences = expandOccurrences(
      meeting,
      meeting.exceptions,
      windowStart,
      windowEnd,
    ).filter((o) => o.start.getTime() >= now.getTime() && o.start.getTime() <= leadEnd);

    for (const occ of occurrences) {
      const recipients = new Set([meeting.organizerId, ...meeting.participantUserIds]);
      for (const userId of recipients) {
        if (sent >= CAP) break;
        // Claim before sending: a unique violation means another machine
        // (or a previous crash) already owns this (meeting, occurrence, user).
        try {
          await prisma.meetingReminderLog.create({
            data: {
              scheduledMeetingId: meeting.id,
              occurrenceStart: occ.originalStart,
              userId,
            },
          });
        } catch (err) {
          if ((err as { code?: string }).code === "P2002") continue;
          throw err;
        }

        try {
          await notify({
            eventType: "meeting.reminder",
            message: {
              kind: "MeetingReminder",
              title: `Starting soon: ${meeting.title}`,
              body: `Starts ${formatApplicationDateTime(occ.start)}.`,
              link: `/calendar?meeting=${meeting.id}`,
              scheduledMeetingId: meeting.id,
            },
            recipients: [{ userId }],
          });
          sent += 1;
        } catch (err) {
          // Log row already exists → this reminder is lost, not duplicated.
          console.error(
            `[jobs] meeting reminder ${meeting.id}/${occ.originalStart.toISOString()}/${userId} failed:`,
            err,
          );
        }
      }
    }
  }

  return { items: sent };
}
