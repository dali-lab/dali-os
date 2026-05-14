import { prisma } from "~/lib/db";
import { downloadFile, editMessage, getPermalink, postReply } from "./slack-client";
import type { SlackThreadMessage } from "./slack-client";
import { formatIssue, type UploadedAsset } from "./format-issue";
import { createIssue, uploadIssueAsset } from "./github-app";

// Slack `reaction_added` event payload (subset we need).
export type ReactionAddedEvent = {
  type: "reaction_added";
  user: string;
  reaction: string;
  item: { type: "message"; channel: string; ts: string };
};

const CONFIRM_REACTION = "white_check_mark";
const CANCEL_REACTION = "x";

function allowedReactor(userId: string): boolean {
  const allow = (process.env.SLACK_ALLOWED_REACTOR_IDS ?? "").trim();
  if (!allow) return true;
  return allow.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

export async function handleReactionAdded(event: ReactionAddedEvent): Promise<void> {
  if (event.item.type !== "message") return;
  if (event.reaction !== CONFIRM_REACTION && event.reaction !== CANCEL_REACTION) return;
  if (!allowedReactor(event.user)) return;

  const draft = await prisma.slackBugReportDraft.findUnique({
    where: {
      slackChannelId_previewMessageTs: {
        slackChannelId: event.item.channel,
        previewMessageTs: event.item.ts,
      },
    },
  });
  if (!draft) return;
  // ✅ retries on Failed drafts; everything else is a no-op once not Pending.
  const isRetry = draft.status === "Failed" && event.reaction === CONFIRM_REACTION;
  if (draft.status !== "Pending" && !isRetry) return;

  if (event.reaction === CANCEL_REACTION) {
    await prisma.slackBugReportDraft.update({
      where: { id: draft.id },
      data: { status: "Cancelled" },
    });
    await editMessage(event.item.channel, event.item.ts, `_Cancelled by <@${event.user}>._`);
    return;
  }

  // Confirm: file the issue. Wrap in try/catch so a GitHub or upload failure
  // produces a "Failed" draft + a useful Slack reply instead of silently dying.
  try {
    const thread = draft.threadJson as unknown as SlackThreadMessage[];
    const permalink = await getPermalink(event.item.channel, draft.slackThreadTs).catch(() => null);

    // Try to upload every attached image. Failures per-file are non-fatal —
    // formatIssue will note the missing asset in the issue body.
    const assetsByFileId: Record<string, UploadedAsset> = {};
    for (const msg of thread) {
      for (const f of msg.files ?? []) {
        if (!f.mimetype?.startsWith("image/")) continue;
        try {
          const bytes = await downloadFile(f.urlPrivate);
          assetsByFileId[f.id] = await uploadIssueAsset({ bytes, filename: f.name });
        } catch (err) {
          console.warn("slack: image upload failed", { fileId: f.id, error: errMsg(err) });
        }
      }
    }

    const { title, body } = formatIssue({
      thread,
      permalink,
      requestedBySlackUserId: draft.requestedBySlackUserId,
      assetsByFileId,
    });

    const issue = await createIssue({ title, body });

    await prisma.slackBugReportDraft.update({
      where: { id: draft.id },
      data: { status: "Filed", githubIssueNumber: issue.number, githubIssueUrl: issue.htmlUrl },
    });

    await editMessage(
      event.item.channel,
      event.item.ts,
      `:white_check_mark: Filed by <@${event.user}>.`,
    );
    // Post the URL on its own line so Slack unfurls it into a rich preview
    // card (title, body, labels). Goes into the same thread as the preview.
    await postReply(event.item.channel, draft.slackThreadTs, issue.htmlUrl);
  } catch (err) {
    const message = errMsg(err);
    console.error("slack: filing failed", { draftId: draft.id, error: message });
    await prisma.slackBugReportDraft.update({
      where: { id: draft.id },
      data: { status: "Failed" },
    });
    await editMessage(
      event.item.channel,
      event.item.ts,
      `:warning: Failed to file: ${message}. React :white_check_mark: again to retry once the cause is fixed.`,
    );
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
