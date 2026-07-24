// Meeting reminders: everyone on a Confirmed meeting hears `leadMinutes`
// (admin-configurable, default 15) before an occurrence starts. First real
// consumer of MeetingException — cancelled occurrences are skipped and
// overridden ones are retimed.
//
// Idempotency: MeetingReminderLog keyed on (meeting, ORIGINAL occurrence
// start, user). Claim-then-send — the log row is created before notify(), so
// a crash mid-send loses that one reminder rather than duplicating it (the
// right trade-off for a 15-minute-lead ping; task reminders make the
// opposite choice because their windows are hours wide).

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { APPLICATION_TZ, formatInstantWithZoneLabel, resolveUserTimeZone } from "~/lib/timezone";
import type { JobContext, JobResult } from "~/jobs/registry";

const MINUTE_MS = 60_000;
// Guard band for the expansion scan: overrides can move an occurrence's
// effective start well away from its original start, so expand wide and
// filter effective starts to [now, now+lead] after. 16h forward covers the
// max configurable lead (12h) plus override drift.
const BAND_BEFORE_MS = 60 * MINUTE_MS;
const BAND_AFTER_MS = 16 * 3_600_000;
const CAP = 200;

export async function runMeetingReminders({ now, settings }: JobContext): Promise<JobResult> {
  const leadMs = settings.leadMinutes * MINUTE_MS;
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
  const leadEnd = now.getTime() + leadMs;

  let sent = 0;
  for (const meeting of meetings) {
    if (sent >= CAP) break;
    const occurrences = expandOccurrences(
      meeting,
      meeting.exceptions,
      windowStart,
      windowEnd,
    ).filter((o) => o.start.getTime() >= now.getTime() && o.start.getTime() <= leadEnd);
    if (occurrences.length === 0) continue;

    // A Declined RSVP (on the invite notification) mutes reminders for that
    // person; flipping back to Accepted/Tentative un-mutes.
    const declinedRows = await prisma.notification.findMany({
      where: { scheduledMeetingId: meeting.id, rsvp: "Declined" },
      select: { recipientUserId: true },
    });
    const declined = new Set(declinedRows.map((r) => r.recipientUserId));

    // Resolve each recipient's display zone once so the reminder body reads in
    // their own local time (with a zone label), not a hardcoded ET.
    const recipientIds = Array.from(
      new Set([meeting.organizerId, ...meeting.participantUserIds]),
    );
    const tzRows = await prisma.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, timeZone: true },
    });
    const tzByUser = new Map(tzRows.map((r) => [r.id, resolveUserTimeZone(r)]));

    for (const occ of occurrences) {
      const recipients = new Set([meeting.organizerId, ...meeting.participantUserIds]);
      for (const userId of recipients) {
        if (declined.has(userId)) continue;
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
              body: `Starts ${formatInstantWithZoneLabel(occ.start, tzByUser.get(userId) ?? APPLICATION_TZ)}.`,
              link: `/calendar?meeting=${meeting.id}`,
              scheduledMeetingId: meeting.id,
              // Stamp the occurrence start so past reminders drop off Tasks
              // once the meeting has begun (see listOpenTasks).
              dueAt: occ.start,
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
