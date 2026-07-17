// Fires ScheduledAnnouncement rows whose sendAt has passed, through the same
// shared fan-out the composer uses. The row's sentAt is CAS-claimed BEFORE
// fanning out: for a lab-wide blast a rare drop beats a double-send. A fire
// that then fails (audience resolves empty, form got unpublished) records
// lastError on the claimed row — visible in the composer's scheduled list —
// and deliberately does NOT send; the admin re-composes.

import { prisma } from "~/lib/db";
import { sendAnnouncement } from "~/lib/announcements.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const BATCH = 20;

export async function runScheduledAnnouncements({ now }: JobContext): Promise<JobResult> {
  const due = await prisma.scheduledAnnouncement.findMany({
    where: { sentAt: null, canceledAt: null, sendAt: { lte: now } },
    orderBy: { sendAt: "asc" },
    take: BATCH,
  });

  let fired = 0;
  for (const row of due) {
    const claimed = await prisma.scheduledAnnouncement.updateMany({
      where: { id: row.id, sentAt: null, canceledAt: null },
      data: { sentAt: now },
    });
    if (claimed.count === 0) continue; // raced with another machine or a cancel

    try {
      const result = await sendAnnouncement({
        createdByUserId: row.createdByUserId,
        title: row.title,
        body: row.body,
        link: row.link,
        kind: row.kind,
        isTodo: row.isTodo,
        dueAt: row.dueAt,
        formId: row.formId,
        allMembers: row.allMembers,
        groupIds: row.groupIds,
        userIds: row.userIds,
      });
      if (result.ok) {
        await prisma.scheduledAnnouncement.update({
          where: { id: row.id },
          data: { sentCount: result.count, lastError: null },
        });
        fired += 1;
      } else {
        await prisma.scheduledAnnouncement.update({
          where: { id: row.id },
          data: { lastError: result.error },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.scheduledAnnouncement
        .update({ where: { id: row.id }, data: { lastError: message.slice(0, 1000) } })
        .catch(() => {});
      console.error(`[jobs] scheduled announcement ${row.id} failed:`, err);
    }
  }

  return { items: fired };
}
