import { prisma } from "~/lib/db.server";
import { defaultReminderMessage } from "~/forms/lib/form-tracker";
import { sendCloseReminder } from "~/forms/lib/form-tracker.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const LEAD_MS = 24 * 60 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60_000;
const LAB_TIME_ZONE = "America/New_York";

/** Reminds people who haven't responded a day before a form closes. Acts when
 *  closesAt minus 24 hours falls inside (lastSuccessAt, now], like form-windows,
 *  and the notification dedupKey (which includes the close time) makes a re-run
 *  send nothing while a moved close time earns one more. */
export async function runFormReminders({
  now,
  lastSuccessAt,
}: JobContext): Promise<JobResult> {
  const since = lastSuccessAt ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  const due = await prisma.form.findMany({
    where: {
      published: true,
      remindBeforeClose: true,
      closesAt: {
        gt: new Date(Math.max(since.getTime() + LEAD_MS, now.getTime())),
        lte: new Date(now.getTime() + LEAD_MS),
      },
    },
    select: { id: true },
  });

  let people = 0;
  for (const { id } of due) {
    people += await sendCloseReminder({
      formId: id,
      message: (form) => defaultReminderMessage(form.name, form.closesAt, LAB_TIME_ZONE),
    });
  }
  return { items: people, note: `forms=${due.length} reminded=${people}` };
}
