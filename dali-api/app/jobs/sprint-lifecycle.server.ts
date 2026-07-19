// Sprint close-out: Active sprints past endsAt flip to Closed, unfinished
// tasks roll to the project's next Planned sprint (else the backlog), and a
// summary lands in the project's Slack channel.
//
// The Active→Closed flip is the CAS claim — only the machine that wins it
// does the rollover and the post, so a crashed run loses at most one
// close-out rather than duplicating it (same trade as scheduled
// announcements).

import { prisma } from "~/lib/db";
import { getAppEnv } from "~/lib/app-env";
import { postMessage, slackConfigured } from "~/slack/lib/slack-client";
import type { JobContext, JobResult } from "~/jobs/registry";

const BATCH = 20;

// Unattended channel posts are prod-only for the same reason as notify()'s
// Slack-DM gate: staging restores a prod snapshot on every deploy, so real
// project channel ids live there. NOTIFY_SLACK_DM_OVERRIDE=1 covers testing
// all unattended outbound Slack, channel posts included.
export function jobChannelPostAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_SLACK_DM_OVERRIDE === "1";
}

export async function runSprintLifecycle({ now }: JobContext): Promise<JobResult> {
  const due = await prisma.sprint.findMany({
    where: { status: "Active", endsAt: { lte: now } },
    orderBy: { endsAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      name: true,
      projectId: true,
      endsAt: true,
      project: { select: { name: true, slackChannelId: true } },
    },
  });

  let closed = 0;
  let failed = 0;
  for (const sprint of due) {
    const claim = await prisma.sprint.updateMany({
      where: { id: sprint.id, status: "Active" },
      data: { status: "Closed" },
    });
    if (claim.count === 0) continue; // raced with another machine or a manual close

    try {
      const tasks = await prisma.task.findMany({
        where: { sprintId: sprint.id },
        select: { status: true },
      });
      const doneCount = tasks.filter((t) => t.status === "Done").length;

      const next = await prisma.sprint.findFirst({
        where: {
          projectId: sprint.projectId,
          status: "Planned",
          startsAt: { gte: sprint.endsAt },
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, name: true },
      });
      // Done/Cancelled tasks stay on the closed sprint for the record.
      const moved = await prisma.task.updateMany({
        where: { sprintId: sprint.id, status: { notIn: ["Done", "Cancelled"] } },
        data: { sprintId: next?.id ?? null },
      });

      if (
        sprint.project.slackChannelId &&
        slackConfigured() &&
        jobChannelPostAllowed()
      ) {
        const dest = next ? `moved to "${next.name}"` : "moved to the backlog";
        const text = [
          `:checkered_flag: Sprint *${sprint.name}* is closed.`,
          `${doneCount} of ${tasks.length} task${tasks.length === 1 ? "" : "s"} done.`,
          moved.count > 0
            ? `${moved.count} unfinished task${moved.count === 1 ? "" : "s"} ${dest}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ");
        await postMessage(sprint.project.slackChannelId, text).catch((err) =>
          console.error(`[jobs] sprint ${sprint.id}: slack post failed`, err),
        );
      }
      closed++;
    } catch (err) {
      // The sprint is already Closed; losing its rollover beats blocking the
      // rest of the batch. Surfaced via the job row's note.
      failed++;
      console.error(`[jobs] sprint ${sprint.id}: close-out failed`, err);
    }
  }

  return {
    items: closed,
    note: failed > 0 ? `${failed} close-out(s) failed — see logs` : undefined,
  };
}
