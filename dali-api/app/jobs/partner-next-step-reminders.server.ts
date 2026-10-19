// Partner next-step reminders: nudges Core the morning a card's next step is
// due (or every tick after, while it stays open and undone). dedupKey keys on
// the due timestamp, so moving nextStepDueAt makes a fresh reminder and the
// old one just goes inert (same convention as task due reminders).

import { prisma } from "~/lib/db";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
import { OPEN_STAGES } from "~/partners/lib/partner-application";
import type { JobContext, JobResult } from "~/jobs/registry";

const CAP = 200;

export async function runPartnerNextStepReminders({ now }: JobContext): Promise<JobResult> {
  // "Due today or past" by UTC calendar day: anything due before tomorrow's
  // UTC midnight.
  const tomorrowUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  const candidates = await prisma.partnerApplication.findMany({
    where: {
      stage: { in: [...OPEN_STAGES] },
      nextStepDueAt: { not: null, lt: tomorrowUtc },
    },
    select: { id: true, title: true, nextStep: true, nextStepDueAt: true },
    orderBy: { nextStepDueAt: "asc" },
    take: CAP,
  });

  let notified = 0;
  for (const app of candidates) {
    if (!app.nextStepDueAt) continue;
    const res = await notifyPartners({
      eventType: "partner.next_step_due",
      title: `Next step due: "${app.title}"`,
      // "" not null: notify() falls back to the registered template's body
      // when the explicit body is nullish, and there's no next-step text to
      // show here.
      body: app.nextStep ?? "",
      link: `/core/partners?application=${app.id}`,
      dedupKey: `partner-next-step:${app.id}:${app.nextStepDueAt.toISOString()}`,
    });
    if (res.inApp > 0) notified += 1;
  }

  return { items: notified };
}
