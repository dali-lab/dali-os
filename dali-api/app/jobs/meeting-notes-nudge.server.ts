// Post-meeting nudge: once a transcript is Done and hasn't been inserted
// into its note, tell the recorder once. See specs/meeting-notes-model.md
// "5. Post-meeting nudge".
//
// Idempotency: MeetingReminderLog keyed on (meeting, occurrence, user, kind)
// — same ledger as meeting-reminders / meeting-record-prompts, a dedicated
// `kind` so the three don't collide on the unique index.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const MINUTE_MS = 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_TAKE = 500;
const CAP = 200;

function pageIdFromDocumentName(documentName: string): string | null {
  const [entity, id] = documentName.split(":");
  return entity === "doc" && id ? id : null;
}

export async function runMeetingNotesNudge({ now, settings }: JobContext): Promise<JobResult> {
  const delayMs = settings.delayMinutes * MINUTE_MS;

  // Scoped to rows touched in the last week so a very old Done recording
  // (e.g. restored from a DB snapshot) never fires a stale nudge.
  const recordings = await prisma.meetingRecording.findMany({
    where: {
      status: "Done",
      insertedAt: null,
      scheduledMeetingId: { not: null },
      occurrenceStart: { not: null },
      updatedAt: { gte: new Date(now.getTime() - SEVEN_DAYS_MS) },
    },
    select: {
      id: true,
      userId: true,
      documentName: true,
      scheduledMeetingId: true,
      occurrenceStart: true,
      scheduledMeeting: { select: { title: true, durationMinutes: true } },
    },
    take: SCAN_TAKE,
  });

  // The flag is per recorder, not per recording — cache it across this tick.
  const flagByUser = new Map<string, boolean>();
  async function userCanRecord(userId: string): Promise<boolean> {
    const cached = flagByUser.get(userId);
    if (cached !== undefined) return cached;
    const roles = await getUserRoles(userId);
    const enabled = await isFeatureEnabled("ai-meeting-notes", userId, roles);
    flagByUser.set(userId, enabled);
    return enabled;
  }

  let sent = 0;
  for (const rec of recordings) {
    if (sent >= CAP) break;
    // No meeting link (ad-hoc recording) — nothing to nudge about yet.
    if (!rec.scheduledMeetingId || !rec.occurrenceStart || !rec.scheduledMeeting) continue;

    const occurrenceEnd = rec.occurrenceStart.getTime() + rec.scheduledMeeting.durationMinutes * MINUTE_MS;
    if (now.getTime() - occurrenceEnd < delayMs) continue;

    const pageId = pageIdFromDocumentName(rec.documentName);
    if (!pageId) continue;

    if (!(await userCanRecord(rec.userId))) continue;

    // Claim before sending: a unique violation means another machine (or a
    // previous tick) already nudged this (meeting, occurrence, user, kind).
    try {
      await prisma.meetingReminderLog.create({
        data: {
          scheduledMeetingId: rec.scheduledMeetingId,
          occurrenceStart: rec.occurrenceStart,
          userId: rec.userId,
          kind: "TranscriptReady",
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }

    try {
      await notify({
        eventType: "meeting.transcript_ready",
        message: {
          vars: { itemTitle: rec.scheduledMeeting.title },
          link: `/documents/${pageId}?transcript=${rec.id}`,
          scheduledMeetingId: rec.scheduledMeetingId,
          occurrenceStart: rec.occurrenceStart,
        },
        recipients: [{ userId: rec.userId }],
      });
      sent += 1;
    } catch (err) {
      // Log row already exists → this nudge is lost, not duplicated.
      console.error(`[jobs] transcript-ready nudge ${rec.id} failed:`, err);
    }
  }

  return { items: sent };
}
