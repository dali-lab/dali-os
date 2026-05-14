import { prisma } from "~/lib/db";
import { fetchThread, getPermalink, postReply } from "./slack-client";

// Slack `app_mention` event payload (subset we need).
export type AppMentionEvent = {
  type: "app_mention";
  user: string;
  text: string;
  ts: string;
  channel: string;
  // Present iff the mention happened in an existing thread.
  thread_ts?: string;
};

// Trigger phrase. We require "file-this" anywhere in the mention text so the
// bot doesn't reply to incidental @-mentions.
const TRIGGER = /\bfile-this\b/i;

export async function handleAppMention(event: AppMentionEvent): Promise<void> {
  if (!TRIGGER.test(event.text)) return;

  // If the mention is on a top-level message (no thread parent), we treat the
  // mention message itself as a single-message "thread."
  const threadTs = event.thread_ts ?? event.ts;
  const thread = await fetchThread(event.channel, threadTs);
  if (thread.length === 0) return;

  const permalink = await getPermalink(event.channel, threadTs).catch(() => null);

  const previewLines = [
    `*Bug report draft from <@${event.user}>* — react with :white_check_mark: to file as a GitHub issue, :x: to cancel.`,
    "",
    `Captured ${thread.length} message${thread.length === 1 ? "" : "s"}` +
      (permalink ? ` (<${permalink}|open thread>)` : "") +
      ".",
  ];
  const previewText = previewLines.join("\n");

  const posted = await postReply(event.channel, threadTs, previewText);

  await prisma.slackBugReportDraft.create({
    data: {
      slackChannelId: event.channel,
      slackThreadTs: threadTs,
      previewMessageTs: posted.ts,
      threadJson: thread as unknown as object,
      requestedBySlackUserId: event.user,
    },
  });
}
