import { prisma } from "~/lib/db";
import { fetchThread, getPermalink, postReply } from "./slack-client";
import type { SlackThreadMessage } from "./slack-client";
import { formatIssue } from "./format-issue";
import { createIssue } from "~/lib/github";

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

// Trigger word: we file an issue when the mention text contains "bug"
// (any case, any morphology — "bug", "bugs", "debugging" all count). Loose on
// purpose because the @-mention itself is the explicit signal; "bug" just
// disambiguates "I want to file" from incidental chatter.
const TRIGGER = /bug/i;

export async function handleAppMention(event: AppMentionEvent): Promise<void> {
  if (!TRIGGER.test(event.text)) return;

  // If the mention is on a top-level message (no thread parent), we file just
  // that one message and the bot reply starts a new thread under it. If the
  // mention is in an existing thread, the whole thread becomes the issue body.
  const threadTs = event.thread_ts ?? event.ts;
  const thread = await fetchThread(event.channel, threadTs);
  if (thread.length === 0) return;

  const permalink = await getPermalink(event.channel, threadTs).catch(() => null);

  try {
    const { title, body } = formatIssue({
      thread: thread as SlackThreadMessage[],
      permalink,
      requestedBySlackUserId: event.user,
    });

    const issue = await createIssue({ title, body });

    await prisma.slackBugReportDraft.create({
      data: {
        slackChannelId: event.channel,
        slackThreadTs: threadTs,
        // Re-use previewMessageTs to store the mention message ts. Keeps the
        // unique index meaningful as a "one issue per mention" guard.
        previewMessageTs: event.ts,
        threadJson: thread as unknown as object,
        requestedBySlackUserId: event.user,
        status: "Filed",
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.htmlUrl,
      },
    });

    // Post the URL on its own line so Slack unfurls into a rich preview card.
    await postReply(event.channel, threadTs, issue.htmlUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("slack: filing failed", { channel: event.channel, ts: event.ts, error: message });
    await postReply(
      event.channel,
      threadTs,
      `:warning: Couldn't file issue: ${message}`,
    );
  }
}
