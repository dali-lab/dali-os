// Sprint lifecycle. Per project: materialize sprints (and run the one-time
// task backfill), close sprints whose last day has passed (snapshot, rollover,
// wrap-up), and nudge assignees on the morning of a sprint's last day.
//
// Idempotency: closing is a closedAt CAS (closeEndedSprints); wrap-ups and
// nudges go through notify() dedupKeys, and the Slack post rides the fresh
// in-app dispatch so a re-fired tick posts nothing.

import { prisma } from "~/lib/db";
import { postMessage, slackConfigured } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import { jobChannelPostAllowed } from "~/jobs/job-slack";
import { closeEndedSprints, ensureSprints, type ClosedSprint } from "~/projects/lib/sprints.server";
import { labHour, labTodayUtcDay } from "~/lib/timezone";
import type { JobContext, JobResult } from "~/jobs/registry";

const BATCH = 200;
export const NUDGE_HOUR = 9;

export function wrapUpSummary(s: Pick<ClosedSprint, "planned" | "completed" | "carried">): string {
  const base = `${s.completed} of ${s.planned} task${s.planned === 1 ? "" : "s"} done.`;
  return s.carried > 0 ? `${base} ${s.carried} rolled to the next sprint.` : base;
}

async function postWrapUp(
  project: { id: string; name: string; slackChannelId: string | null },
  sprint: ClosedSprint,
): Promise<boolean> {
  if (sprint.planned === 0) return false;
  const summary = wrapUpSummary(sprint);
  const label = `Sprint ${sprint.number}`;
  const memberIds = await currentProjectParticipantIds(project.id);
  if (memberIds.size === 0) return false;
  const res = await notify({
    eventType: "project.sprint_closed",
    message: {
      vars: { itemTitle: label, contextName: project.name, itemDetail: summary },
      link: `/projects/${project.id}?tab=board&sprint=${sprint.id}`,
      dedupKey: `sprint-closed:${project.id}:${sprint.id}`,
    },
    recipients: [...memberIds].map((userId) => ({ userId })),
  });
  const fresh = res.inApp > 0;
  if (fresh && project.slackChannelId && slackConfigured() && jobChannelPostAllowed()) {
    await postMessage(
      project.slackChannelId,
      `:checkered_flag: *${label}* wrapped up. ${summary}`,
    ).catch((err) => console.error(`[jobs] project ${project.id}: slack post failed`, err));
  }
  return fresh;
}

async function nudgeEndingSprint(
  project: { id: string; name: string },
  todayUtc: number,
): Promise<number> {
  const sprint = await prisma.sprint.findFirst({
    where: { projectId: project.id, closedAt: null, endsOn: new Date(todayUtc) },
    select: {
      id: true,
      number: true,
      tasks: {
        where: { archivedAt: null, status: { notIn: ["Done", "Cancelled"] } },
        select: { assignees: { select: { userId: true } } },
      },
    },
  });
  if (!sprint) return 0;
  const open = new Map<string, number>();
  for (const t of sprint.tasks) {
    for (const a of t.assignees) open.set(a.userId, (open.get(a.userId) ?? 0) + 1);
  }
  let sent = 0;
  for (const [userId, count] of open) {
    const res = await notify({
      eventType: "project.sprint_ending",
      message: {
        vars: {
          itemTitle: `Sprint ${sprint.number}`,
          contextName: project.name,
          itemDetail: `Ends today — ${count} unfinished task${count === 1 ? "" : "s"}.`,
        },
        link: `/projects/${project.id}?tab=board&sprint=${sprint.id}&mine=1`,
        dedupKey: `sprint-ending:${sprint.id}:${userId}`,
      },
      recipients: [{ userId }],
    });
    sent += res.inApp > 0 ? 1 : 0;
  }
  return sent;
}

export async function runSprintLifecycle({ now }: JobContext): Promise<JobResult> {
  const todayUtc = labTodayUtcDay(now);
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { status: "Active", projectTerms: { some: { term: { endDate: { gte: new Date(todayUtc) } } } } },
        { sprintsBackfilledAt: null },
        { sprints: { some: { closedAt: null, endsOn: { lt: new Date(todayUtc) } } } },
      ],
    },
    take: BATCH,
    orderBy: { sprintsBackfilledAt: { sort: "asc", nulls: "first" } },
    select: { id: true, name: true, status: true, slackChannelId: true },
  });

  let wrapped = 0;
  let nudged = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      await ensureSprints(project.id, now);
      const closed = await closeEndedSprints(project.id, now);
      if (project.status === "Active") {
        // Only the most recent close is news; older ones closed here are catch-up.
        const latest = closed.at(-1);
        if (latest && (await postWrapUp(project, latest))) wrapped++;
        if (labHour(now) >= NUDGE_HOUR) nudged += await nudgeEndingSprint(project, todayUtc);
      }
    } catch (err) {
      failed++;
      console.error(`[jobs] project ${project.id}: sprint lifecycle failed`, err);
    }
  }

  return {
    items: wrapped + nudged,
    note: failed > 0 ? `${failed} project(s) failed — see logs` : undefined,
  };
}
