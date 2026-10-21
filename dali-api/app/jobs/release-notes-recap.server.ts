import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import type { JobContext, JobResult } from "~/jobs/registry";
import {
  buildRecap,
  channelAudience,
  isoWeekKey,
  isStaleDraft,
  recapIsEmpty,
  recapPost,
  shouldRunRecap,
} from "~/lib/release-notes-recap";
import { releaseNotesSlackChannel } from "~/lib/release-notes.server";

export async function runReleaseNotesRecap({
  now,
  lastSuccessAt,
  settings,
}: JobContext): Promise<JobResult> {
  if (!shouldRunRecap(now, lastSuccessAt, { weekday: settings.weekday, hour: settings.hour })) {
    return { items: 0, note: "not due" };
  }
  const week = isoWeekKey(now);

  const [drafts, published] = await Promise.all([
    prisma.releaseNote.findMany({ where: { status: "Draft" } }),
    prisma.releaseNote.findMany({
      where: { status: "Published", recapWeek: null },
      orderBy: { publishedAt: "asc" },
    }),
  ]);
  const stale = drafts.filter((d) => isStaleDraft(d.draftedAt, now));
  if (stale.length === 0 && published.length === 0) return { items: 0, note: "nothing to recap" };

  const channel = releaseNotesSlackChannel();
  const recap = buildRecap(published, stale, channelAudience);
  if (channel && !recapIsEmpty(recap)) {
    const post = recapPost(recap, week, getFrontendUrl());
    const { id } = await enqueueOutbound({
      channel: "slack_channel",
      target: channel,
      dedupKey: `release-notes-recap:${week}`,
      slackText: post.text,
      slackBlocks: post.blocks,
      eventType: "release.recap",
    });
    await drainNow([id]);
  }

  await prisma.releaseNote.updateMany({
    where: { id: { in: stale.map((d) => d.id) }, status: "Draft" },
    data: { status: "Dismissed" },
  });
  await prisma.releaseNote.updateMany({
    where: { id: { in: published.map((n) => n.id) }, recapWeek: null },
    data: { recapWeek: week },
  });
  return { items: published.length, note: `${week}, ${stale.length} stale drafts dismissed` };
}
