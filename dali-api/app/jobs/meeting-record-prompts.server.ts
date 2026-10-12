// "Record this meeting?" notification: one minute (configurable) before a
// Confirmed occurrence starts, offered to its ORGANIZER only — see
// specs/meeting-transcription.md "Record this meeting? prompt" (1). The
// in-page banner and the desktop one-tap surface are separate; this job only
// owns the bell/desktop-banner/Slack notification.
//
// Idempotency: MeetingReminderLog keyed on (meeting, ORIGINAL occurrence
// start, user, kind) — same ledger as meeting-reminders.server.ts, a
// different `kind` so the two reminders don't collide on the unique index.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { expandOccurrences, noteForOccurrence } from "~/lib/meeting-occurrences";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const MINUTE_MS = 60_000;
// Guard band for the expansion scan, same reasoning as meeting-reminders: an
// override can move an occurrence's effective start well away from its
// original start, so expand wide and filter effective starts to
// [now, now+lead] after. The configurable lead tops out at 10 minutes, so the
// band is much narrower than meeting-reminders' (whose lead goes to 12h).
const BAND_BEFORE_MS = 15 * MINUTE_MS;
const BAND_AFTER_MS = 60 * MINUTE_MS;
const CAP = 200;

export async function runMeetingRecordPrompts({ now, settings }: JobContext): Promise<JobResult> {
  const leadMs = settings.leadMinutes * MINUTE_MS;
  const meetings = await prisma.scheduledMeeting.findMany({
    where: { status: "Confirmed", selectedAt: { not: null }, recordPrompt: true },
    select: {
      id: true,
      title: true,
      organizerId: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      exceptions: true,
      meetingType: true,
      meetingUrl: true,
      notePages: { select: { id: true, meetingOccurrenceStart: true } },
      project: { select: { recordingPolicy: true } },
    },
    take: 500,
  });

  const windowStart = new Date(now.getTime() - BAND_BEFORE_MS);
  const windowEnd = new Date(now.getTime() + BAND_AFTER_MS);
  const leadEnd = now.getTime() + leadMs;

  // The flag is per organizer, not per occurrence — cache it across every
  // meeting this organizer runs in this tick.
  const flagByOrganizer = new Map<string, boolean>();
  async function organizerCanRecord(organizerId: string): Promise<boolean> {
    const cached = flagByOrganizer.get(organizerId);
    if (cached !== undefined) return cached;
    const roles = await getUserRoles(organizerId);
    const enabled = await isFeatureEnabled("ai-meeting-notes", organizerId, roles);
    flagByOrganizer.set(organizerId, enabled);
    return enabled;
  }

  let sent = 0;
  for (const meeting of meetings) {
    if (sent >= CAP) break;
    if (meeting.project?.recordingPolicy === "Disabled") continue;
    // Nothing to record into: a meeting with no type and no existing note
    // can't resolve one here (attachMeetingNote needs an interactive type
    // pick), so there's no reasonable "Record" destination to offer yet.
    if (!meeting.meetingType && meeting.notePages.length === 0) continue;
    if (!(await organizerCanRecord(meeting.organizerId))) continue;

    const occurrences = expandOccurrences(
      meeting,
      meeting.exceptions,
      windowStart,
      windowEnd,
    ).filter((o) => o.start.getTime() >= now.getTime() && o.start.getTime() <= leadEnd);
    if (occurrences.length === 0) continue;

    for (const occ of occurrences) {
      if (sent >= CAP) break;

      const existingRecording = await prisma.meetingRecording.findFirst({
        where: {
          scheduledMeetingId: meeting.id,
          occurrenceStart: occ.originalStart,
          status: { notIn: ["Failed"] },
        },
        select: { id: true },
      });
      if (existingRecording) continue;

      // Claim before sending: a unique violation means another machine (or a
      // previous crash) already owns this (meeting, occurrence, user, kind).
      try {
        await prisma.meetingReminderLog.create({
          data: {
            scheduledMeetingId: meeting.id,
            occurrenceStart: occ.originalStart,
            userId: meeting.organizerId,
            kind: "RecordPrompt",
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") continue;
        throw err;
      }

      const notePageId = noteForOccurrence(meeting.notePages, occ.originalStart)?.id ?? null;
      const link = notePageId
        ? `/documents/${notePageId}?record=1`
        : meetingOccurrenceHref(meeting.id, occ.originalStart.toISOString());

      try {
        await notify({
          eventType: "meeting.record_prompt",
          message: {
            vars: { itemTitle: meeting.title },
            link,
            scheduledMeetingId: meeting.id,
            occurrenceStart: occ.originalStart,
          },
          recipients: [{ userId: meeting.organizerId }],
        });
        sent += 1;
      } catch (err) {
        // Log row already exists → this prompt is lost, not duplicated.
        console.error(
          `[jobs] record prompt ${meeting.id}/${occ.originalStart.toISOString()} failed:`,
          err,
        );
      }
    }
  }

  return { items: sent };
}
