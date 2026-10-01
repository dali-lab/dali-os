import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions";
import { findReadableAccount, mailAccountLabel, type ReadableMailAccount } from "~/email/lib/access.server";

/** Notify the members "@handle"-mentioned in a private thread comment. Comments
 * are only visible to people with the inbox, so a mention of anyone else drops. */
export async function notifyMailCommentMentions(args: {
  account: ReadableMailAccount;
  threadId: string;
  authorId: string;
  body: string;
  request: Request;
}): Promise<void> {
  const mentioned = await resolveHandles(extractHandlesFromText(args.body));
  const readers: string[] = [];
  for (const userId of mentioned) {
    if (userId === args.authorId) continue;
    if (await findReadableAccount(userId, args.account.id, args.request)) readers.push(userId);
  }
  await notifyMentions({
    recipientUserIds: readers,
    actorId: args.authorId,
    link: `/email?t=${args.account.id}~${args.threadId}`,
    title: `You were mentioned in ${mailAccountLabel(args.account)}`,
    preview: args.body,
  });
}
