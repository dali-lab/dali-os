// Sprint lifecycle: a per-sprint wrap-up.
//
// Sprints are not stored rows: a sprint is a fixed one-week band anchored to
// each term a project runs, the same grid the board and timeline draw. On the
// day after a sprint's last day, this job posts a wrap-up (done/total of the
// tasks that were due in it) to the project's members and Slack channel.

import { prisma } from "~/lib/db.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { sprintClosedSlackKey } from "~/lib/outbound-keys";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import { slackSendAllowed } from "~/slack/lib/send-gate";
import { DAY, SPRINT_DAYS, utcDayOf, localTodayUtcDay } from "~/projects/lib/timeline-days";
import type { JobContext, JobResult } from "~/jobs/registry";

const SPRINT_STEP = SPRINT_DAYS * DAY;
const BATCH = 50;

type TermWindow = { startsAt: string; endsAt: string };

/**
 * The sprint band that ended *yesterday* for a project, given its term windows —
 * the sprint that just closed and is worth a wrap-up today. Numbered from 1 off
 * its term's start (matching the timeline). Null when no band ended yesterday.
 */
export function sprintClosedYesterday(
  terms: TermWindow[],
  todayUtc: number,
): { key: number; label: string; start: number; end: number } | null {
  const yesterday = todayUtc - DAY;
  for (const t of terms) {
    const start = utcDayOf(t.startsAt);
    const end = utcDayOf(t.endsAt);
    if (yesterday < start || yesterday > end) continue;
    const n = Math.floor((yesterday - start) / SPRINT_STEP);
    const key = start + n * SPRINT_STEP;
    const bandEnd = Math.min(key + SPRINT_STEP - DAY, end);
    if (bandEnd === yesterday) return { key, label: `Sprint ${n + 1}`, start: key, end: bandEnd };
  }
  return null;
}

export async function runSprintLifecycle({ now }: JobContext): Promise<JobResult> {
  const todayUtc = localTodayUtcDay(now);
  const projects = await prisma.project.findMany({
    where: { status: "Active" },
    take: BATCH,
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      projectTerms: {
        select: { term: { select: { startDate: true, endDate: true } } },
      },
    },
  });

  let closed = 0;
  let failed = 0;
  const slackIds: Array<string | null> = [];
  for (const project of projects) {
    const terms = project.projectTerms.map((pt) => ({
      startsAt: pt.term.startDate.toISOString(),
      endsAt: pt.term.endDate.toISOString(),
    }));
    const band = sprintClosedYesterday(terms, todayUtc);
    if (!band) continue;

    try {
      // Tasks whose anchor date (due, else start) fell in the closed sprint —
      // the same "which sprint is this in" rule the board uses.
      const from = new Date(band.start);
      const to = new Date(band.end + DAY);
      const tasks = await prisma.task.findMany({
        where: {
          projectId: project.id,
          status: { not: "Cancelled" },
          OR: [
            { dueAt: { gte: from, lt: to } },
            { AND: [{ dueAt: null }, { startsAt: { gte: from, lt: to } }] },
          ],
        },
        select: { status: true },
      });
      if (tasks.length === 0) continue; // an empty sprint isn't worth a ping

      const doneCount = tasks.filter((t) => t.status === "Done").length;
      const summary = `${doneCount} of ${tasks.length} task${tasks.length === 1 ? "" : "s"} done.`;

      const memberIds = await currentProjectParticipantIds(project.id);
      let fresh = false;
      if (memberIds.size > 0) {
        const res = await notify({
          eventType: "project.sprint_closed",
          message: {
            vars: { itemTitle: band.label, contextName: project.name, itemDetail: summary },
            link: `/projects/${project.id}?tab=board`,
            dedupKey: `sprint-closed:${project.id}:${band.key}`,
          },
          recipients: [...memberIds].map((userId) => ({ userId })),
        });
        fresh = res.inApp > 0;
      }

      if (memberIds.size > 0 && project.slackChannelId && slackConfigured() && slackSendAllowed()) {
        const { id } = await enqueueOutbound({
          channel: "slack_channel",
          target: project.slackChannelId,
          slackText: `:checkered_flag: *${band.label}* wrapped up. ${summary}`,
          dedupKey: sprintClosedSlackKey(project.id, band.key),
          eventType: "project.sprint_closed",
        });
        slackIds.push(id);
      }

      if (fresh) closed++;
    } catch (err) {
      failed++;
      console.error(`[jobs] project ${project.id}: sprint wrap-up failed`, err);
    }
  }

  await drainNow(slackIds);

  return {
    items: closed,
    note: failed > 0 ? `${failed} wrap-up(s) failed — see logs` : undefined,
  };
}
