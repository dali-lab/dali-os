// Loader and actions for /email, the unified inbox.

import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAiEnabled } from "~/lib/ai.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { deleteObject, getObjectBytes } from "~/lib/s3";
import { isBlockedUpload } from "~/lib/file-validation";
import { getUserRoles, type UserRoles } from "~/lib/roles";
import { demoEmailAction, demoEmailPage, isEmailDemo } from "~/email/lib/demo-data.server";
import {
  categoriesForUser,
  findReadableAccount,
  mailAccountLabel,
  readableMailAccounts,
  type ReadableMailAccount,
} from "~/email/lib/access.server";
import {
  getMailboxToken,
  getThread,
  inboxUnreadCount,
  listThreads,
  MailboxError,
  modifyThread,
  sendMessage,
  type MailMessage,
  type ThreadSummary,
} from "~/email/lib/gmail-mailbox.server";

const THREADS_PER_INBOX = 20;
const DEFAULT_QUERY = "in:inbox";
// Keep the whole message comfortably under Gmail's simple-send ceiling once
// base64 inflates the bytes by ~33%.
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_KEY_PREFIX = "uploads/email-attachments/";

export type FeedThread = ThreadSummary & { accountId: string };

async function requireEmailUser(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (auth.user.type === "applicant" || auth.user.type === "dartmouth") throw redirect("/portal");
  if (isEmailDemo(request)) return { userId: auth.user.sub, roles: null, demo: true as const };
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("email", auth.user.sub, roles, request))) throw redirect("/");
  return { userId: auth.user.sub, roles, demo: false as const };
}

// Threads are addressed as "<accountId>~<threadId>" in the URL.
export function parseThreadRef(ref: string | null): { accountId: string; threadId: string } | null {
  const [accountId, threadId] = (ref ?? "").split("~");
  return accountId && threadId ? { accountId, threadId } : null;
}

function draftVisibleTo(userId: string) {
  return { sentAt: null, OR: [{ shared: true }, { createdById: userId }] };
}

// Per-inbox unread totals for the inbox rail. An inbox that can't be reached
// is left out rather than shown as zero.
async function loadUnreadCounts(accounts: ReadableMailAccount[]): Promise<Record<string, number>> {
  const counts = await Promise.all(
    accounts.map(async (a) => {
      try {
        return [a.id, await inboxUnreadCount(await getMailboxToken(a))] as const;
      } catch (err) {
        if (!(err instanceof MailboxError)) throw err;
        return null;
      }
    }),
  );
  return Object.fromEntries(counts.filter((c) => c !== null));
}

async function loadFeed(accounts: ReadableMailAccount[], query: string) {
  const errors: string[] = [];
  const lists = await Promise.all(
    accounts.map(async (a) => {
      try {
        const token = await getMailboxToken(a);
        const threads = await listThreads(token, { query, max: THREADS_PER_INBOX });
        return threads.map((t) => ({ ...t, accountId: a.id }));
      } catch (err) {
        if (!(err instanceof MailboxError)) throw err;
        errors.push(a.id);
        return [];
      }
    }),
  );
  const threads: FeedThread[] = lists.flat().sort((x, y) => y.date.localeCompare(x.date));
  return { threads, errors };
}

// Unread total across every inbox the user can read, for the sidebar badge.
export async function loadUnreadTotal(request: Request, userId: string): Promise<number> {
  const accounts = (await readableMailAccounts(userId, request)).filter((a) => a.oauthTokens && !a.archived);
  const counts = await loadUnreadCounts(accounts);
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

export async function loadEmailPage(request: Request): Promise<EmailPageData> {
  const user = await requireEmailUser(request);
  if (user.demo) return demoEmailPage(request);
  return loadLiveEmailPage(request, user.userId, user.roles);
}

async function loadLiveEmailPage(request: Request, userId: string, roles: UserRoles) {
  const url = new URL(request.url);
  const inbox = url.searchParams.get("inbox");
  const view = url.searchParams.get("view") === "drafts" ? "drafts" : "inbox";
  const query = url.searchParams.get("q")?.trim() || DEFAULT_QUERY;
  const searchAccounts = url.searchParams.get("in")?.split(",").filter(Boolean) ?? [];
  const selectedRef = parseThreadRef(url.searchParams.get("t"));

  const accounts = await readableMailAccounts(userId, request);
  const connected = accounts.filter((a) => a.oauthTokens && !a.archived);
  const feedAccounts = connected.filter((a) =>
    inbox ? a.id === inbox : searchAccounts.length === 0 || searchAccounts.includes(a.id),
  );

  const selectedAccount = selectedRef
    ? connected.find((a) => a.id === selectedRef.accountId) ?? null
    : null;

  const [feed, selected, drafts, categories, myConnections, unread] = await Promise.all([
    view === "inbox" ? loadFeed(feedAccounts, query) : { threads: [], errors: [] },
    selectedAccount && selectedRef
      ? loadThread(userId, selectedAccount, selectedRef.threadId)
      : null,
    prisma.mailDraft.findMany({
      where: { accountId: { in: connected.map((a) => a.id) }, ...draftVisibleTo(userId) },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, contentType: true, sizeBytes: true } },
      },
    }),
    categoriesForUser(userId),
    prisma.mailAccountConnection.findMany({ where: { userId }, select: { accountId: true, syncError: true } }),
    loadUnreadCounts(connected),
  ]);

  if (selected && selectedRef) {
    for (const t of feed.threads) {
      if (t.accountId === selectedRef.accountId && t.id === selectedRef.threadId) t.unread = false;
    }
  }

  return {
    userId,
    view,
    inbox,
    query: query === DEFAULT_QUERY ? "" : query,
    ask: url.searchParams.get("ask") ?? "",
    aiEnabled: isAiEnabled(),
    isAdmin: roles.isAdmin,
    accounts: accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      address: a.address,
      label: mailAccountLabel(a),
      projectId: a.projectId,
      connected: Boolean(a.oauthTokens),
      syncError: a.syncError,
      archived: a.archived,
    })),
    feed: { threads: feed.threads, errors: feed.errors },
    unread,
    selected,
    drafts: drafts.map((d) => ({
      id: d.id,
      accountId: d.accountId,
      threadId: d.threadId,
      to: d.to,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      body: d.body,
      shared: d.shared,
      mine: d.createdById === userId,
      author: `${d.createdBy.firstName} ${d.createdBy.lastName}`.trim(),
      updatedAt: d.updatedAt.toISOString(),
      // s3Key stays server-side; the client only needs to label and remove.
      attachments: d.attachments,
    })),
    // Shared-inbox categories open to this user. Signing in to an inbox is
    // each subscriber's own step, so its status is theirs alone.
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      subscribed: c.subscriptions.length > 0,
      inboxes: c.accounts.map(({ account }) => {
        const mine = myConnections.find((m) => m.accountId === account.id);
        return {
          id: account.id,
          address: account.address,
          label: account.displayName ?? account.address,
          connected: Boolean(mine),
          syncError: mine?.syncError ?? null,
        };
      }),
    })),
  };
}

async function loadThread(userId: string, account: ReadableMailAccount, threadId: string) {
  let messages: MailMessage[];
  try {
    const token = await getMailboxToken(account);
    messages = await getThread(token, threadId);
    await modifyThread(token, threadId, { remove: ["UNREAD"] });
  } catch (err) {
    if (err instanceof MailboxError) return { accountId: account.id, threadId, error: true as const };
    throw err;
  }
  const comments = await prisma.mailComment.findMany({
    where: { accountId: account.id, threadId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
  });
  return {
    accountId: account.id,
    threadId,
    error: false as const,
    messages,
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      author: {
        id: c.author.id,
        name: `${c.author.firstName} ${c.author.lastName}`.trim(),
        photoUrl: c.author.photoUrl,
      },
      mine: c.authorId === userId,
    })),
  };
}

export type EmailPageData = Awaited<ReturnType<typeof loadLiveEmailPage>>;

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function fromHeader(name: string | null, address: string): string {
  const safe = (name ?? "").replace(/["\\\r\n]/g, "");
  return safe ? `"${safe}" <${address}>` : address;
}

// Create or update the draft from the compose form. Shared by save/send and by
// attach, so a not-yet-saved compose gets a draft row before a file is pinned
// to it.
async function upsertDraftFromForm(form: FormData, accountId: string, userId: string) {
  const data = {
    accountId,
    threadId: field(form, "threadId") || null,
    to: field(form, "to"),
    cc: field(form, "cc"),
    bcc: field(form, "bcc"),
    subject: field(form, "subject"),
    body: String(form.get("body") ?? ""),
    shared: form.get("shared") === "on",
    updatedById: userId,
  };
  const draftId = field(form, "draftId");
  const existing = draftId
    ? await prisma.mailDraft.findFirst({ where: { id: draftId, accountId, ...draftVisibleTo(userId) } })
    : null;
  return existing
    ? prisma.mailDraft.update({ where: { id: existing.id }, data })
    : prisma.mailDraft.create({ data: { ...data, createdById: userId } });
}

function draftAttachments(draftId: string) {
  return prisma.mailDraftAttachment.findMany({
    where: { draftId },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, contentType: true, sizeBytes: true },
  });
}

export async function submitEmailAction(request: Request) {
  const user = await requireEmailUser(request);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (user.demo) return demoEmailAction(intent, field(form, "draftId"));
  const { userId, roles } = user;

  if (intent === "subscribe" || intent === "unsubscribe") {
    const categoryId = field(form, "categoryId");
    const open = await categoriesForUser(userId);
    if (!open.some((c) => c.id === categoryId)) {
      return Response.json({ error: "That category isn't available to you." }, { status: 404 });
    }
    if (intent === "subscribe") {
      await prisma.mailSubscription.upsert({
        where: { categoryId_userId: { categoryId, userId } },
        create: { categoryId, userId },
        update: {},
      });
    } else {
      await prisma.mailSubscription.deleteMany({ where: { categoryId, userId } });
      // Drop your sign-ins to inboxes you can no longer open, so no unused
      // Google tokens linger. One still reachable through another category stays.
      const stillReadable = new Set((await readableMailAccounts(userId, request)).map((a) => a.id));
      const leaving = open.find((c) => c.id === categoryId)!.accounts.map((a) => a.accountId);
      await prisma.mailAccountConnection.deleteMany({
        where: { userId, accountId: { in: leaving.filter((id) => !stillReadable.has(id)) } },
      });
    }
    return { ok: true };
  }

  if (intent === "deleteComment") {
    await prisma.mailComment.deleteMany({ where: { id: field(form, "commentId"), authorId: userId } });
    return { ok: true };
  }

  const account = await findReadableAccount(userId, field(form, "accountId"), request);
  if (!account) return Response.json({ error: "Inbox not found." }, { status: 404 });
  const threadId = field(form, "threadId") || null;

  if (intent === "deleteDraft") {
    const where = { id: field(form, "draftId"), accountId: account.id, ...draftVisibleTo(userId) };
    const rows = await prisma.mailDraftAttachment.findMany({ where: { draft: where }, select: { s3Key: true } });
    await prisma.mailDraft.deleteMany({ where });
    await Promise.all(rows.map((r) => deleteObject(r.s3Key).catch(() => {})));
    return { ok: true };
  }

  if (intent === "attach") {
    const s3Key = field(form, "s3Key");
    const filename = field(form, "filename");
    const contentType = field(form, "contentType") || "application/octet-stream";
    const sizeBytes = Number(field(form, "sizeBytes")) || 0;
    if (!s3Key.startsWith(ATTACHMENT_KEY_PREFIX) || isBlockedUpload(filename, contentType)) {
      return Response.json({ error: "That file can't be attached." }, { status: 400 });
    }
    const draft = await upsertDraftFromForm(form, account.id, userId);
    await prisma.mailDraftAttachment.create({ data: { draftId: draft.id, s3Key, filename, contentType, sizeBytes } });
    return Response.json({ ok: true, draftId: draft.id, attachments: await draftAttachments(draft.id) });
  }

  if (intent === "detach") {
    const draft = await prisma.mailDraft.findFirst({
      where: { id: field(form, "draftId"), accountId: account.id, ...draftVisibleTo(userId) },
    });
    if (!draft) return Response.json({ error: "Draft not found." }, { status: 404 });
    const row = await prisma.mailDraftAttachment.findFirst({
      where: { id: field(form, "attachmentId"), draftId: draft.id },
    });
    if (row) {
      await prisma.mailDraftAttachment.delete({ where: { id: row.id } });
      await deleteObject(row.s3Key).catch(() => {});
    }
    return Response.json({ ok: true, draftId: draft.id, attachments: await draftAttachments(draft.id) });
  }

  if (intent === "disconnect") {
    // Only your own sign-in; teammates keep theirs.
    await prisma.mailAccountConnection.deleteMany({ where: { accountId: account.id, userId } });
    return { ok: true };
  }

  if (intent === "archiveInbox") {
    await prisma.mailInboxArchive.upsert({
      where: { accountId_userId: { accountId: account.id, userId } },
      create: { accountId: account.id, userId },
      update: {},
    });
    return { ok: true };
  }

  if (intent === "restoreInbox") {
    await prisma.mailInboxArchive.deleteMany({ where: { accountId: account.id, userId } });
    return { ok: true };
  }

  if (intent === "comment") {
    const body = field(form, "body");
    if (!threadId || !body) return Response.json({ error: "Write a comment first." }, { status: 400 });
    await prisma.mailComment.create({
      data: { accountId: account.id, threadId, authorId: userId, body: body.slice(0, 5000) },
    });
    return { ok: true };
  }

  if (intent === "archive" || intent === "markUnread") {
    if (!threadId) return Response.json({ error: "No thread." }, { status: 400 });
    try {
      await modifyThread(
        await getMailboxToken(account),
        threadId,
        intent === "archive" ? { remove: ["INBOX"] } : { add: ["UNREAD"] },
      );
    } catch (err) {
      if (err instanceof MailboxError) return Response.json({ error: "Gmail didn't respond. Try again." }, { status: 502 });
      throw err;
    }
    return { ok: true };
  }

  if (intent === "saveDraft" || intent === "send") {
    const draft = await upsertDraftFromForm(form, account.id, userId);

    if (intent === "saveDraft") return { ok: true, draftId: draft.id };

    if (!draft.to) return Response.json({ error: "Add a recipient.", draftId: draft.id }, { status: 400 });

    const attachmentRows = await prisma.mailDraftAttachment.findMany({ where: { draftId: draft.id } });
    if (attachmentRows.reduce((sum, a) => sum + a.sizeBytes, 0) > MAX_ATTACHMENTS_BYTES) {
      return Response.json({ error: "Attachments are too large to send.", draftId: draft.id }, { status: 400 });
    }
    let attachments: { filename: string; contentType: string; bytes: Buffer }[];
    try {
      attachments = await Promise.all(
        attachmentRows.map(async (a) => ({
          filename: a.filename,
          contentType: a.contentType,
          bytes: (await getObjectBytes(a.s3Key)).body,
        })),
      );
    } catch {
      return Response.json({ error: "Couldn't load an attachment. Your draft is saved.", draftId: draft.id }, { status: 502 });
    }

    try {
      const token = await getMailboxToken(account);
      let inReplyTo: string | undefined;
      let references: string | undefined;
      let subject = draft.subject;
      if (draft.threadId) {
        const last = (await getThread(token, draft.threadId)).at(-1);
        inReplyTo = last?.messageId || undefined;
        references = last?.references;
        if (!subject && last) subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`;
      }
      await sendMessage(token, {
        from: fromHeader(mailAccountLabel(account), account.address),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject,
        body: draft.body,
        threadId: draft.threadId,
        inReplyTo,
        references,
        attachments,
      });
    } catch (err) {
      if (err instanceof MailboxError) {
        return Response.json({ error: "Couldn't send. Your draft is saved.", draftId: draft.id }, { status: 502 });
      }
      throw err;
    }
    await prisma.mailDraft.update({ where: { id: draft.id }, data: { sentAt: new Date() } });
    return { ok: true, sent: true };
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
