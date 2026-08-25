// Weekday standup prompt in each Active project's Slack channel. Rides the
// digest wall-clock gate (once per day at sendHourEt, lastSuccessAt as the
// posted-today cursor) plus a weekend skip; channel posts are prod-gated
// like every unattended Slack send.

import { prisma } from "~/lib/db";
import { slackConfigured } from "~/slack/lib/slack-client";
import { shouldRunDigest, weekdayInZone } from "~/lib/notification-digest.server";
import { jobChannelPostAllowed } from "~/jobs/sprint-lifecycle.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const PROMPT =
  ":sunny: Standup time! What did you get done yesterday, what's up next, and is anything blocking you?";

export async function runStandupPrompts({
  now,
  lastSuccessAt,
  settings,
}: JobContext): Promise<JobResult> {
  const weekday = weekdayInZone(now);
  if (weekday === 0 || weekday === 6) {
    return { items: 0, note: "weekend — skipped" };
  }
  if (!shouldRunDigest("Daily", lastSuccessAt, now, { sendHourEt: settings.sendHourEt })) {
    return { items: 0, note: "outside send window" };
  }
  if (!slackConfigured() || !jobChannelPostAllowed()) {
    return { items: 0, note: "slack unavailable or non-prod" };
  }

  const projects = await prisma.project.findMany({
    where: { status: "Active", slackChannelId: { not: null } },
    select: { id: true, slackChannelId: true },
  });

  const utcDay = new Date(now).toISOString().slice(0, 10);
  const ids: Array<string | null> = [];
  for (const project of projects) {
    try {
      const { id } = await enqueueOutbound({
        channel: "slack_channel",
        target: project.slackChannelId!,
        slackText: PROMPT,
        dedupKey: `slack.standup:${project.id}:${utcDay}`,
        eventType: "standup",
      });
      ids.push(id);
    } catch (err) {
      console.error(`[jobs] standup enqueue for ${project.id} failed:`, err);
    }
  }
  await drainNow(ids);
  // Count non-deduped enqueues (id non-null = newly enqueued this run).
  return { items: ids.filter(Boolean).length };
}
