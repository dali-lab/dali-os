import { prisma } from "~/lib/db.server";
import { mailAccountLabel } from "~/email/lib/access.server";
import { draftVisibleTo, loadFeed, loadUnreadCounts } from "~/email/lib/email.server";
import { folderQuery, mailFolder } from "~/email/lib/folders";
import { parseFeedCursor } from "~/email/lib/feed";
import { htmlToText } from "~/email/lib/ai-prompts";
import { getMailboxToken, getThread, listLabels, MailboxError } from "~/email/lib/gmail-mailbox.server";
import { loadThreadAnnotations } from "~/email/lib/thread-annotations.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError } from "../../errors";
import { labelNamer, mcpMailAccount, mcpMailAccounts, UNTRUSTED_NOTE, withGmail } from "./shared";

export const MAX_MESSAGE_CHARS = 20_000;

export const LIST_MAIL_INBOXES_DEF = {
  name: "list_mail_inboxes",
  description:
    "List the project and shared inboxes you can open in the Email tab, with their address, whether you have connected them, and unread counts. Personal inboxes are never listed. An inbox that is not connected needs you to connect it in the Email tab before the other mail tools can read it.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  requiredScope: "mcp:read" as const,
};

export async function runListMailInboxes(ctx: McpCtx) {
  const accounts = await mcpMailAccounts(ctx);
  const unread = await loadUnreadCounts(accounts.filter((a) => a.oauthTokens));
  return {
    inboxes: accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: mailAccountLabel(a),
      address: a.address,
      connected: Boolean(a.oauthTokens),
      syncError: a.syncError,
      archived: a.archived,
      ...(unread[a.id] !== undefined ? { unread: unread[a.id] } : {}),
    })),
  };
}

export const LIST_MAIL_LABELS_DEF = {
  name: "list_mail_labels",
  description:
    "List the Gmail labels of one inbox, with ids, names and whether each is a system label (INBOX, UNREAD, STARRED, SENT and so on) or one you created. Use the names with search_mail (label:name) and label_mail_thread.",
  inputSchema: {
    type: "object" as const,
    properties: { accountId: { type: "string", minLength: 1 } },
    required: ["accountId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMailLabels(ctx: McpCtx, args: Record<string, unknown>) {
  const account = await mcpMailAccount(ctx, args.accountId);
  const labels = await withGmail(async () => listLabels(await getMailboxToken(account)));
  return { labels: labels.map((l) => ({ ...l, system: l.type === "system" })) };
}

export const SEARCH_MAIL_DEF = {
  name: "search_mail",
  description:
    "Search mail threads across your connected project and shared inboxes, or in one inbox. folder is inbox (default), sent, all, spam or trash. query uses Gmail search syntax, such as from:ada@example.edu, label:foo or after:2026/11/01. Returns 20 threads per inbox per page; pass the returned next value as cursor for the following page. errors lists inboxes that could not be read. " +
    UNTRUSTED_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      accountId: { type: "string", minLength: 1 },
      folder: { type: "string", enum: ["inbox", "sent", "all", "spam", "trash"] },
      query: { type: "string" },
      cursor: { type: "string" },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

async function namesFor(accounts: { id: string; oauthTokens: string | null; connectionId?: string | null }[]) {
  const entries = await Promise.all(
    accounts.map(async (a) => {
      try {
        return [a.id, labelNamer(await listLabels(await getMailboxToken(a)))] as const;
      } catch (err) {
        if (!(err instanceof MailboxError)) throw err;
        return [a.id, labelNamer([])] as const;
      }
    }),
  );
  return new Map(entries);
}

export async function runSearchMail(ctx: McpCtx, args: Record<string, unknown>) {
  const all = await mcpMailAccounts(ctx);
  const accounts =
    args.accountId === undefined
      ? all.filter((a) => a.oauthTokens && !a.archived)
      : [await mcpMailAccount(ctx, args.accountId)];
  let cursor: Record<string, string> | undefined;
  if (args.cursor !== undefined) {
    cursor = parseFeedCursor(args.cursor as string) ?? undefined;
    if (!cursor) throw new McpInvalidError("cursor is not valid. Use the next value from a previous search_mail.");
  }
  const folder = mailFolder((args.folder as string | undefined) ?? "inbox");
  const query = ((args.query as string | undefined) ?? "").trim();
  const feed = await loadFeed(accounts, folderQuery(folder, query), folder.spamTrash, cursor);
  const namers = await namesFor(accounts.filter((a) => feed.threads.some((t) => t.accountId === a.id)));
  return {
    threads: feed.threads.map((t) => ({
      accountId: t.accountId,
      id: t.id,
      subject: t.subject,
      from: t.from,
      to: t.to,
      snippet: t.snippet,
      date: t.date,
      unread: t.unread,
      messageCount: t.messageCount,
      labels: namers.get(t.accountId)?.(t.labelIds) ?? t.labelIds,
    })),
    errors: feed.errors,
    next: Object.keys(feed.next).length > 0 ? JSON.stringify(feed.next) : null,
  };
}

export const GET_MAIL_THREAD_DEF = {
  name: "get_mail_thread",
  description:
    "Read one mail thread: its labels, every message as plain text (long messages are cut and marked truncated), attachment names and sizes only, internal comments, the linked applicant on shared inboxes, and drafts you can see. Does not mark the thread read. " +
    UNTRUSTED_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      accountId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
    },
    required: ["accountId", "threadId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export async function runGetMailThread(ctx: McpCtx, args: Record<string, unknown>) {
  const account = await mcpMailAccount(ctx, args.accountId);
  const threadId = args.threadId as string;
  const { messages, labels } = await withGmail(async () => {
    const token = await getMailboxToken(account);
    const [messages, labels] = await Promise.all([getThread(token, threadId), listLabels(token)]);
    return { messages, labels };
  });
  const [{ comments, linkedUser }, drafts] = await Promise.all([
    loadThreadAnnotations(account, threadId),
    prisma.mailDraft.findMany({
      where: { accountId: account.id, threadId, ...draftVisibleTo(ctx.user.id) },
      orderBy: { updatedAt: "desc" },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const applicantLink = linkedUser ? { name: fullName(linkedUser), source: linkedUser.source } : null;
  const name = labelNamer(labels);
  return {
    subject: messages[0]?.subject ?? "",
    labels: name([...new Set(messages.flatMap((m) => m.labelIds))]),
    messages: messages.map((m) => {
      const text = m.text ?? htmlToText(m.html ?? "");
      return {
        id: m.id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        date: m.date,
        text: text.slice(0, MAX_MESSAGE_CHARS),
        truncated: text.length > MAX_MESSAGE_CHARS,
        attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.mimeType, size: a.size })),
      };
    }),
    comments: comments.map((c) => ({
      id: c.id,
      author: fullName(c.author),
      body: c.body,
      date: c.createdAt.toISOString(),
    })),
    applicantLink,
    drafts: drafts.map((d) => ({
      id: d.id,
      to: d.to,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      body: d.body,
      shared: d.shared,
      mine: d.createdById === ctx.user.id,
      author: fullName(d.createdBy),
      updatedAt: d.updatedAt.toISOString(),
    })),
  };
}
