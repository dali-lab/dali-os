// Applicant-facing, so delivery stays on hiring's direct email pipeline
// (interview-emails.ts), outside the member preference layer. The ledger row
// is claimed before sending (MeetingReminderLog pattern): a crash loses a
// reminder, never duplicates.

import { prisma } from "~/lib/db.server";
import { sendInterviewReminderEmails } from "~/hiring/lib/interview-emails";
import type { JobContext, JobResult } from "~/jobs/registry";

const HOUR_MS = 60 * 60_000;

export async function runInterviewReminders({ now }: JobContext): Promise<JobResult> {
  const upcoming = await prisma.interview.findMany({
    where: {
      status: "Scheduled",
      startTime: { gt: now, lte: new Date(now.getTime() + HOUR_MS) },
    },
    select: { id: true },
  });

  let sent = 0;
  for (const interview of upcoming) {
    try {
      await prisma.interviewReminderLog.create({
        data: { interviewId: interview.id, kind: "HourBefore" },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }
    sent += await sendInterviewReminderEmails(interview.id);
  }

  return { items: sent };
}
