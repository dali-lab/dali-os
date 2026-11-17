import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { checkJobLinkAlive } from "~/community/lib/job-link.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASK_SCAN_TAKE = 200;
export const LINK_CHECK_BATCH = 20;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export async function runOpportunitiesFreshness({ now, settings }: JobContext): Promise<JobResult> {
  const { askAfterDays, closeAfterDays, chatAskDays } = settings;

  const askCutoff = daysAgo(now, askAfterDays);
  const candidates = await prisma.opportunityPost.findMany({
    where: {
      kind: "Job",
      closedAt: null,
      stillOpenAskedAt: null,
      authorId: { not: null },
      updatedAt: { lt: askCutoff },
    },
    select: { id: true, authorId: true, role: true, companyName: true },
    orderBy: { updatedAt: "asc" },
    take: ASK_SCAN_TAKE,
  });

  let asked = 0;
  for (const post of candidates) {
    if (!post.authorId) continue;
    const { count } = await prisma.opportunityPost.updateMany({
      where: {
        id: post.id,
        kind: "Job",
        closedAt: null,
        stillOpenAskedAt: null,
        updatedAt: { lt: askCutoff },
      },
      data: { stillOpenAskedAt: now },
    });
    if (count === 0) continue;
    asked += 1;
    const what = [post.role, post.companyName].filter(Boolean).join(" at ") || "your job post";
    await notify({
      eventType: "opportunities.still_open",
      message: {
        vars: {
          itemDetail: `${what}. Let people know if it's still open, or it closes in ${closeAfterDays} days.`,
        },
        link: "/community/opportunities",
        dedupKey: `opportunities-still-open:${post.id}:${now.toISOString()}`,
      },
      recipients: [{ userId: post.authorId }],
    });
  }

  const unanswered = await prisma.opportunityPost.updateMany({
    where: {
      kind: "Job",
      closedAt: null,
      stillOpenAskedAt: { lt: daysAgo(now, closeAfterDays) },
    },
    data: { closedAt: now },
  });

  const linked = await prisma.opportunityPost.findMany({
    where: { kind: "Job", closedAt: null, jobUrl: { not: null } },
    select: { id: true, jobUrl: true },
    orderBy: { updatedAt: "asc" },
    take: LINK_CHECK_BATCH,
  });
  let dead = 0;
  for (const post of linked) {
    if (!post.jobUrl) continue;
    if ((await checkJobLinkAlive(post.jobUrl)) !== "dead") continue;
    const { count } = await prisma.opportunityPost.updateMany({
      where: { id: post.id, closedAt: null },
      data: { closedAt: now },
    });
    dead += count;
  }

  const chats = await prisma.opportunityPost.updateMany({
    where: { kind: "ChatAsk", closedAt: null, createdAt: { lt: daysAgo(now, chatAskDays) } },
    data: { closedAt: now },
  });

  return {
    items: asked + unanswered.count + dead + chats.count,
    note: `asked ${asked}, closed ${unanswered.count}, dead links ${dead}, chat asks ${chats.count}`,
  };
}
