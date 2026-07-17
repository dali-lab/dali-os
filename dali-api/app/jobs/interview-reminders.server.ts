// Interview reminders at two lead tiers (24h and 1h before startTime).
// Applicant-facing, so delivery stays on hiring's direct email pipeline
// (interview-emails.ts), outside the member preference layer.
//
// An interview booked inside a tier's window claims every applicable tier at
// once but sends a single reminder — booking 30 minutes out shouldn't yield
// two back-to-back emails. Ledger rows are claimed before sending
// (MeetingReminderLog pattern): a crash loses a reminder, never duplicates.

import { prisma } from "~/lib/db";
import { sendInterviewReminderEmails } from "~/hiring/lib/interview-emails";
import type { JobContext, JobResult } from "~/jobs/registry";
import type { InterviewReminderKind } from "~/generated/prisma/client";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

export async function runInterviewReminders({ now }: JobContext): Promise<JobResult> {
  const upcoming = await prisma.interview.findMany({
    where: {
      status: "Scheduled",
      startTime: { gt: now, lte: new Date(now.getTime() + DAY_MS) },
    },
    select: { id: true, startTime: true },
  });

  let sent = 0;
  for (const interview of upcoming) {
    const withinHour = interview.startTime.getTime() <= now.getTime() + HOUR_MS;
    const kinds: InterviewReminderKind[] = withinHour
      ? ["DayBefore", "HourBefore"]
      : ["DayBefore"];

    let claimed = 0;
    for (const kind of kinds) {
      try {
        await prisma.interviewReminderLog.create({
          data: { interviewId: interview.id, kind },
        });
        claimed++;
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") continue; // already sent
        throw err;
      }
    }
    if (claimed > 0) {
      sent += await sendInterviewReminderEmails(interview.id);
    }
  }

  return { items: sent };
}
