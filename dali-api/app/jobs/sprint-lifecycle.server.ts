// Sprint lifecycle: a per-sprint wrap-up.
//
// Sprints are not stored rows — a sprint is a fixed one-week band anchored to
// each term a project runs (Sprint 1..N per term), the same grid the board and
// timeline draw. So there is nothing to "activate" or "close": a sprint simply
// ends when its last day passes. On the day after a sprint's last day, this job
// posts a wrap-up (done/total of the tasks that were due in it) to the project's
// members (in-app + desktop banner, preference-gated) and Slack channel.
//
// Idempotency comes from notify()'s dedupKey (sprint-closed:<projectId>:<key>),
// not a CAS row-claim: a re-fired tick creates no new in-app rows, and the Slack
// post is gated on that fresh dispatch so it fires exactly once per sprint.

import { prisma } from "~/lib/db";
import { postMessage, slackConfigured } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import { jobChannelPostAllowed } from "~/jobs/job-slack";
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

      // In-app + desktop first: its dedupKey is the source of once-only truth.
      const memberIds = await currentProjectParticipantIds(project.id);
      let fresh = false;
      if (memberIds.size > 0) {
        const res = await notify({
          eventType: "project.sprint_closed",
          message: {
            title: `${band.label} wrapped up`,
            body: `${project.name} — ${summary}`,
            link: `/projects/${project.id}?tab=board`,
            dedupKey: `sprint-closed:${project.id}:${band.key}`,
          },
          recipients: [...memberIds].map((userId) => ({ userId })),
        });
        fresh = res.inApp > 0;
      }

      // Slack channel post rides the same fresh dispatch, so a re-fired tick
      // (dedupKey already claimed → no new in-app rows) posts nothing.
      if (fresh && project.slackChannelId && slackConfigured() && jobChannelPostAllowed()) {
        const text = `:checkered_flag: *${band.label}* wrapped up. ${summary}`;
        await postMessage(project.slackChannelId, text).catch((err) =>
          console.error(`[jobs] project ${project.id}: slack post failed`, err),
        );
      }

      if (fresh) closed++;
    } catch (err) {
      failed++;
      console.error(`[jobs] project ${project.id}: sprint wrap-up failed`, err);
    }
  }

  return {
    items: closed,
    note: failed > 0 ? `${failed} wrap-up(s) failed — see logs` : undefined,
  };
}
