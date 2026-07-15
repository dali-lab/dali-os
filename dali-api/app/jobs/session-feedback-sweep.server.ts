// Backstop for education session feedback: today requestSessionFeedback()
// fires only when an instructor marks attendance — a session whose attendance
// never gets marked collects no feedback. This sweep asks once the session is
// over.
//
// "Over" is a heuristic: EducationSession has no end time, so datetime + 2h
// grace. The 14-day lookback stops the first prod deploy from blasting
// requests for ancient un-swept sessions.
//
// Recipients: attendees already marked Present when some attendance exists;
// with ZERO attendance marked, all Approved enrollees — the helper dedupes
// per (user, form, session), skips submitters, and composes cleanly with a
// later attendance save. Over-asking an enrolled no-show once beats never
// collecting feedback. requestSessionFeedback also no-ops (without stamping
// feedbackRequestedAt) when no published feedback form is bound, so such
// sessions simply re-scan until they age out.

import { prisma } from "~/lib/db";
import { requestSessionFeedback } from "~/education/lib/feedback.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const HOUR_MS = 3_600_000;
const GRACE_MS = 2 * HOUR_MS;
const LOOKBACK_MS = 14 * 24 * HOUR_MS;
const BATCH = 50;

export async function runSessionFeedbackSweep({ now }: JobContext): Promise<JobResult> {
  const sessions = await prisma.educationSession.findMany({
    where: {
      feedbackRequestedAt: null,
      datetime: {
        lte: new Date(now.getTime() - GRACE_MS),
        gte: new Date(now.getTime() - LOOKBACK_MS),
      },
      offering: { status: "Published", closedOutAt: null },
    },
    select: {
      id: true,
      offeringId: true,
      attendances: {
        where: { status: "Present" },
        select: { application: { select: { applicantUserId: true } } },
      },
    },
    take: BATCH,
  });

  let swept = 0;
  for (const session of sessions) {
    try {
      let userIds = session.attendances.map((a) => a.application.applicantUserId);
      if (userIds.length === 0) {
        const enrollees = await prisma.educationApplication.findMany({
          where: { offeringId: session.offeringId, status: "Approved" },
          select: { applicantUserId: true },
        });
        userIds = enrollees.map((e) => e.applicantUserId);
      }
      if (userIds.length === 0) continue;

      await requestSessionFeedback({
        offeringId: session.offeringId,
        sessionId: session.id,
        presentUserIds: userIds,
      });
      swept += 1;
    } catch (err) {
      console.error(`[jobs] feedback sweep for session ${session.id} failed:`, err);
    }
  }

  return { items: swept };
}
