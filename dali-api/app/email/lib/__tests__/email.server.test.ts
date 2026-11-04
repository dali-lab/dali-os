import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    mailDraft: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    mailDraftAttachment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    mailAccountConnection: { findMany: vi.fn(), deleteMany: vi.fn() },
    mailSubscription: { upsert: vi.fn(), deleteMany: vi.fn() },
    mailInboxArchive: { upsert: vi.fn(), deleteMany: vi.fn() },
    mailComment: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    mailMessageIndex: { count: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isImpersonating: vi.fn(),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: vi.fn(() => false) }));
vi.mock("~/lib/s3", () => ({ deleteObject: vi.fn(), getObjectBytes: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/email/lib/demo-data.server", () => ({
  isEmailDemo: vi.fn(() => false),
  demoEmailPage: vi.fn(),
  demoEmailAction: vi.fn(),
}));
vi.mock("~/email/lib/access.server", () => ({
  categoriesForUser: vi.fn(),
  findReadableAccount: vi.fn(),
  hasPersonalMailConsent: vi.fn(),
  mailAccountLabel: vi.fn((a: { address: string }) => a.address),
  readableMailAccounts: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/email/lib/comment-mentions.server", () => ({ notifyMailCommentMentions: vi.fn(async () => {}) }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => u) }));
vi.mock("~/lib/user-email.server", () => ({ recordUserEmail: vi.fn() }));
vi.mock("~/email/lib/mail-index.server", () => ({
  getThreadLink: vi.fn(),
  indexMessages: vi.fn(),
  setThreadLink: vi.fn(),
}));
vi.mock("~/email/lib/gmail-mailbox.server", () => {
  class MailboxError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message);
    }
  }
  return {
    MailboxError,
    getMailboxToken: vi.fn(),
    getThread: vi.fn(),
    inboxUnreadCount: vi.fn(),
    listThreads: vi.fn(),
    modifyThread: vi.fn(),
    sendMessage: vi.fn(),
  };
});

import { prisma } from "~/lib/db.server";
import { requireAuth, isImpersonating, isNonMember } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { deleteObject, getObjectBytes } from "~/lib/s3";
import { logAuditEvent } from "~/lib/audit";
import { recordUserEmail } from "~/lib/user-email.server";
import { PERSONAL_MAIL_NOTICE_VERSION } from "~/email/lib/personal-notice";
import { demoEmailAction, demoEmailPage, isEmailDemo } from "~/email/lib/demo-data.server";
import { notifyMailCommentMentions } from "~/email/lib/comment-mentions.server";
import {
  categoriesForUser,
  findReadableAccount,
  hasPersonalMailConsent,
  readableMailAccounts,
} from "~/email/lib/access.server";
import { getThreadLink, indexMessages, setThreadLink } from "~/email/lib/mail-index.server";
import {
  MailboxError,
  getMailboxToken,
  getThread,
  inboxUnreadCount,
  listThreads,
  modifyThread,
  sendMessage,
} from "~/email/lib/gmail-mailbox.server";
import {
  loadEmailPage,
  loadMoreThreads,
  loadUnreadTotal,
  parseThreadRef,
  submitEmailAction,
} from "~/email/lib/email.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

const acct = (o: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "Shared",
  address: "inbox@example.edu",
  projectId: null,
  oauthTokens: "enc",
  archived: false,
  syncError: null,
  ...o,
});

const memberAuth = (o: Record<string, unknown> = {}) => ({
  ok: true,
  user: { sub: "u1", type: "member" },
  ...o,
});

const post = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/email", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
};

const thread = (id: string, date: string, unread = true) => ({ id, date, unread, subject: id });

beforeEach(() => {
  vi.resetAllMocks();
  m(requireAuth).mockResolvedValue(memberAuth());
  m(isImpersonating).mockReturnValue(false);
  m(isNonMember).mockResolvedValue(false);
  m(isEmailDemo).mockReturnValue(false);
  m(getUserRoles).mockResolvedValue({ isAdmin: false });
  m(readableMailAccounts).mockResolvedValue([acct()]);
  m(findReadableAccount).mockResolvedValue(acct());
  m(getMailboxToken).mockResolvedValue("tok");
  m(categoriesForUser).mockResolvedValue([]);
  m(logAuditEvent).mockResolvedValue(undefined);
  m(notifyMailCommentMentions).mockResolvedValue(undefined);
  m(deleteObject).mockResolvedValue(undefined);
  db.mailDraft.findMany.mockResolvedValue([]);
  db.mailAccountConnection.findMany.mockResolvedValue([]);
});

describe("parseThreadRef", () => {
  it("splits accountId~threadId", () => {
    expect(parseThreadRef("a1~t9")).toEqual({ accountId: "a1", threadId: "t9" });
  });
  it.each([null, "", "a1", "a1~", "~t9", "~"])("rejects malformed ref %j", (ref) => {
    expect(parseThreadRef(ref)).toBeNull();
  });
});

describe("requireEmailUser gate", () => {
  it("sends signed-out users to login", async () => {
    m(requireAuth).mockResolvedValue({ ok: false });
    await expect(loadEmailPage(new Request("http://localhost/email"))).rejects.toBeInstanceOf(Response);
  });
  it("sends Dartmouth (portal) users away from the inbox", async () => {
    m(requireAuth).mockResolvedValue(memberAuth({ user: { sub: "u1", type: "dartmouth" } }));
    await expect(loadEmailPage(new Request("http://localhost/email"))).rejects.toMatchObject({
      status: 302,
      headers: expect.any(Headers),
    });
    expect(readableMailAccounts).not.toHaveBeenCalled();
  });
  it("sends non-members to the portal", async () => {
    m(isNonMember).mockResolvedValue(true);
    await expect(submitEmailAction(post({ intent: "archive" }))).rejects.toBeInstanceOf(Response);
    expect(findReadableAccount).not.toHaveBeenCalled();
  });
  it("serves demo data without touching Gmail", async () => {
    m(isEmailDemo).mockReturnValue(true);
    m(demoEmailPage).mockResolvedValue({ demo: true });
    await expect(loadEmailPage(new Request("http://localhost/email"))).resolves.toEqual({ demo: true });
    expect(readableMailAccounts).not.toHaveBeenCalled();
    m(demoEmailAction).mockReturnValue({ ok: true });
    await submitEmailAction(post({ intent: "send", draftId: "d1" }));
    expect(demoEmailAction).toHaveBeenCalledWith("send", "d1");
    expect(db.mailDraft.create).not.toHaveBeenCalled();
  });
});

describe("loadMoreThreads", () => {
  const url = (qs: string) => new Request(`http://localhost/api/email/threads?${qs}`);
  const cursor = (c: object) => encodeURIComponent(JSON.stringify(c));

  it("returns nothing without a valid cursor", async () => {
    const res = await loadMoreThreads(url("cursor=garbage"));
    expect(res).toEqual({ threads: [], errors: [], next: {} });
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("returns nothing while impersonating, so the admin never reads the member's mail", async () => {
    m(requireAuth).mockResolvedValue(memberAuth({ impersonatedBy: "admin" }));
    m(isImpersonating).mockReturnValue(true);
    const res = await loadMoreThreads(url(`cursor=${cursor({ a1: "p2" })}`));
    expect(res.threads).toEqual([]);
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("only reads inboxes named in the cursor, skipping archived and unconnected ones", async () => {
    m(readableMailAccounts).mockResolvedValue([
      acct({ id: "a1" }),
      acct({ id: "a2" }),
      acct({ id: "a3", oauthTokens: null }),
      acct({ id: "a4", archived: true }),
    ]);
    m(listThreads).mockResolvedValue({ threads: [thread("t1", "2026-01-01")], nextPageToken: "p3" });
    const res = await loadMoreThreads(url(`cursor=${cursor({ a1: "p2", a3: "x", a4: "y" })}`));
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listThreads).toHaveBeenCalledWith("tok", {
      query: "in:inbox",
      max: 20,
      includeSpamTrash: false,
      pageToken: "p2",
    });
    expect(res.next).toEqual({ a1: "p3" });
    expect(res.threads).toEqual([{ ...thread("t1", "2026-01-01"), accountId: "a1" }]);
  });

  it("honours the inbox, folder and search scope from the URL", async () => {
    m(readableMailAccounts).mockResolvedValue([acct({ id: "a1" }), acct({ id: "a2" })]);
    m(listThreads).mockResolvedValue({ threads: [] });
    await loadMoreThreads(url(`cursor=${cursor({ a1: "p", a2: "q" })}&inbox=a2&folder=spam&q=%20hello%20`));
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listThreads).toHaveBeenCalledWith("tok", {
      query: "in:spam hello",
      max: 20,
      includeSpamTrash: true,
      pageToken: "q",
    });
  });

  it("keeps a failing inbox's token so the page can be retried, and merges threads newest first", async () => {
    m(readableMailAccounts).mockResolvedValue([acct({ id: "a1" }), acct({ id: "a2" })]);
    m(listThreads).mockImplementation(async (_t: string, o: { pageToken: string }) => {
      if (o.pageToken === "p1") throw new MailboxError("down");
      return { threads: [thread("old", "2026-01-01"), thread("new", "2026-03-01")] };
    });
    const res = await loadMoreThreads(url(`cursor=${cursor({ a1: "p1", a2: "p2" })}`));
    expect(res.errors).toEqual(["a1"]);
    expect(res.next).toEqual({ a1: "p1" });
    expect(res.threads.map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("rethrows non-mailbox errors", async () => {
    m(listThreads).mockRejectedValue(new TypeError("bug"));
    await expect(loadMoreThreads(url(`cursor=${cursor({ a1: "p" })}`))).rejects.toThrow("bug");
  });
});

describe("loadUnreadTotal", () => {
  it("is zero while impersonating", async () => {
    m(isImpersonating).mockReturnValue(true);
    expect(await loadUnreadTotal(new Request("http://localhost/"), "u1")).toBe(0);
    expect(inboxUnreadCount).not.toHaveBeenCalled();
  });

  it("sums connected, unarchived inboxes and leaves out unreachable ones", async () => {
    m(readableMailAccounts).mockResolvedValue([
      acct({ id: "a1" }),
      acct({ id: "a2" }),
      acct({ id: "a3", oauthTokens: null }),
      acct({ id: "a4", archived: true }),
      acct({ id: "a5" }),
    ]);
    m(getMailboxToken).mockImplementation(async (a: { id: string }) => a.id);
    m(inboxUnreadCount).mockImplementation(async (t: string) => {
      if (t === "a5") throw new MailboxError("down");
      return t === "a1" ? 3 : 4;
    });
    expect(await loadUnreadTotal(new Request("http://localhost/"), "u1")).toBe(7);
    expect(inboxUnreadCount).toHaveBeenCalledTimes(3);
  });
});

describe("loadEmailPage (live)", () => {
  const page = (qs = "") => loadEmailPage(new Request(`http://localhost/email?${qs}`));

  beforeEach(() => {
    m(listThreads).mockResolvedValue({ threads: [thread("t1", "2026-01-01")] });
    m(inboxUnreadCount).mockResolvedValue(2);
  });

  it("hides all mail while impersonating: no Gmail call, accounts shown disconnected-free", async () => {
    m(isImpersonating).mockReturnValue(true);
    const data = await page();
    expect(data.mailHidden).toBe(true);
    expect(listThreads).not.toHaveBeenCalled();
    expect(getMailboxToken).not.toHaveBeenCalled();
    expect(data.feed.threads).toEqual([]);
    expect(db.mailDraft.findMany.mock.calls[0][0].where.accountId).toEqual({ in: [] });
  });

  it("lists connected inboxes, flags unconnected ones, and reports unread per inbox", async () => {
    m(readableMailAccounts).mockResolvedValue([acct({ id: "a1" }), acct({ id: "a2", oauthTokens: null })]);
    const data = await page();
    expect(data.accounts.map((a) => [a.id, a.connected])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
    expect(data.feed.threads.map((t) => t.accountId)).toEqual(["a1"]);
    expect(data.unread).toEqual({ a1: 2 });
  });

  it("scopes the drafts query to connected inboxes and to drafts the user may see", async () => {
    await page();
    expect(db.mailDraft.findMany.mock.calls[0][0].where).toEqual({
      accountId: { in: ["a1"] },
      sentAt: null,
      OR: [{ shared: true }, { createdById: "u1" }],
    });
  });

  it("drafts view reads no feed", async () => {
    const data = await page("view=drafts");
    expect(data.view).toBe("drafts");
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("does not open a thread from an inbox the user hasn't connected", async () => {
    m(readableMailAccounts).mockResolvedValue([acct({ id: "a1" })]);
    const data = await page("t=other~t9");
    expect(data.selected).toBeNull();
    expect(getThread).not.toHaveBeenCalled();
  });

  it("opens a thread, marks it read in Gmail and in the feed list", async () => {
    m(getThread).mockResolvedValue([{ id: "m1" }]);
    db.mailComment.findMany.mockResolvedValue([
      {
        id: "c1",
        body: "hi",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        authorId: "u1",
        author: { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
      },
    ]);
    m(getThreadLink).mockResolvedValue(null);
    const data = await page("t=a1~t1");
    expect(modifyThread).toHaveBeenCalledWith("tok", "t1", { remove: ["UNREAD"] });
    expect(data.feed.threads[0].unread).toBe(false);
    expect(data.selected).toMatchObject({ error: false, applicantLinksEnabled: true, applicantLink: null });
    expect((data.selected as { comments: unknown[] }).comments).toEqual([
      expect.objectContaining({ id: "c1", mine: true, author: expect.objectContaining({ name: "Ada Lovelace" }) }),
    ]);
  });

  it("reports an unreadable thread as an error instead of throwing", async () => {
    m(getThread).mockRejectedValue(new MailboxError("down"));
    const data = await page("t=a1~t1");
    expect(data.selected).toEqual({ accountId: "a1", threadId: "t1", error: true });
  });

  it("shows the linked applicant on a shared inbox thread only", async () => {
    m(getThread).mockResolvedValue([]);
    db.mailComment.findMany.mockResolvedValue([]);
    m(getThreadLink).mockResolvedValue({ userId: "u9", source: "Manual" });
    db.user.findUnique.mockResolvedValue({ firstName: "Grace", lastName: "Hopper", photoUrl: null });
    const shared = await page("t=a1~t1");
    expect((shared.selected as { applicantLink: unknown }).applicantLink).toMatchObject({
      userId: "u9",
      name: "Grace Hopper",
      source: "Manual",
    });

    m(readableMailAccounts).mockResolvedValue([acct({ kind: "Personal" })]);
    m(getThreadLink).mockClear();
    const personal = await page("t=a1~t1");
    expect(getThreadLink).not.toHaveBeenCalled();
    expect(personal.selected).toMatchObject({ applicantLink: null, applicantLinksEnabled: false });
  });

  it("marks a category inbox connected only by the viewer's own connection", async () => {
    m(categoriesForUser).mockResolvedValue([
      {
        id: "c1",
        name: "Cat",
        description: "",
        subscriptions: [{}],
        accounts: [
          { account: { id: "a1", address: "x@example.edu", displayName: null } },
          { account: { id: "a2", address: "y@example.edu", displayName: "Y" } },
        ],
      },
    ]);
    db.mailAccountConnection.findMany.mockResolvedValue([{ accountId: "a1", syncError: "expired" }]);
    const data = await page();
    expect(data.categories[0].subscribed).toBe(true);
    expect(data.categories[0].inboxes).toEqual([
      expect.objectContaining({ id: "a1", connected: true, syncError: "expired" }),
      expect.objectContaining({ id: "a2", connected: false, syncError: null, label: "Y" }),
    ]);
  });
});

describe("submitEmailAction: personal consent", () => {
  it("is refused when the personal-inbox flag is off", async () => {
    m(isFeatureEnabled).mockResolvedValue(false);
    const res = (await submitEmailAction(post({ intent: "consentPersonal", agreed: PERSONAL_MAIL_NOTICE_VERSION }))) as Response;
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("requires the current notice version", async () => {
    m(isFeatureEnabled).mockResolvedValue(true);
    const res = (await submitEmailAction(post({ intent: "consentPersonal", agreed: "old" }))) as Response;
    expect(res.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("records consent as an audit event and confirms it was stored", async () => {
    m(isFeatureEnabled).mockResolvedValue(true);
    m(hasPersonalMailConsent).mockResolvedValue(true);
    const res = await submitEmailAction(post({ intent: "consentPersonal", agreed: PERSONAL_MAIL_NOTICE_VERSION }));
    expect(res).toEqual({ ok: true, consented: true });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "email.personal_consent", userId: "u1", targetId: PERSONAL_MAIL_NOTICE_VERSION }),
    );
  });
  it("fails loudly when the audit write was swallowed", async () => {
    m(isFeatureEnabled).mockResolvedValue(true);
    m(hasPersonalMailConsent).mockResolvedValue(false);
    const res = (await submitEmailAction(post({ intent: "consentPersonal", agreed: PERSONAL_MAIL_NOTICE_VERSION }))) as Response;
    expect(res.status).toBe(500);
  });
});

describe("submitEmailAction: subscriptions", () => {
  const cat = { id: "c1", accounts: [{ accountId: "a1" }, { accountId: "a2" }] };

  it("404s a category the user isn't in the audience of", async () => {
    m(categoriesForUser).mockResolvedValue([cat]);
    const res = (await submitEmailAction(post({ intent: "subscribe", categoryId: "nope" }))) as Response;
    expect(res.status).toBe(404);
    expect(db.mailSubscription.upsert).not.toHaveBeenCalled();
  });
  it("subscribes idempotently", async () => {
    m(categoriesForUser).mockResolvedValue([cat]);
    await submitEmailAction(post({ intent: "subscribe", categoryId: "c1" }));
    expect(db.mailSubscription.upsert).toHaveBeenCalledWith({
      where: { categoryId_userId: { categoryId: "c1", userId: "u1" } },
      create: { categoryId: "c1", userId: "u1" },
      update: {},
    });
  });
  it("unsubscribing drops sign-ins only for inboxes no longer readable by another route", async () => {
    m(categoriesForUser).mockResolvedValue([cat]);
    m(readableMailAccounts).mockResolvedValue([acct({ id: "a2" })]);
    await submitEmailAction(post({ intent: "unsubscribe", categoryId: "c1" }));
    expect(db.mailSubscription.deleteMany).toHaveBeenCalledWith({ where: { categoryId: "c1", userId: "u1" } });
    expect(db.mailAccountConnection.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", accountId: { in: ["a1"] } },
    });
  });
});

describe("submitEmailAction: account gate", () => {
  it("deleteComment only deletes the caller's own comment", async () => {
    await submitEmailAction(post({ intent: "deleteComment", commentId: "c1" }));
    expect(db.mailComment.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", authorId: "u1" } });
    expect(findReadableAccount).not.toHaveBeenCalled();
  });

  it.each(["archive", "send", "disconnect", "comment", "deleteDraft", "attach", "archiveInbox"])(
    "%s on an inbox the user can't read is 404 and touches nothing",
    async (intent) => {
      m(findReadableAccount).mockResolvedValue(null);
      const res = (await submitEmailAction(post({ intent, accountId: "foreign", threadId: "t1" }))) as Response;
      expect(res.status).toBe(404);
      expect(findReadableAccount).toHaveBeenCalledWith("u1", "foreign", expect.any(Request));
      expect(modifyThread).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(db.mailDraft.create).not.toHaveBeenCalled();
      expect(db.mailAccountConnection.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown intents", async () => {
    const res = (await submitEmailAction(post({ intent: "bogus", accountId: "a1" }))) as Response;
    expect(res.status).toBe(400);
  });
});

describe("submitEmailAction: connection and inbox archive", () => {
  it("disconnect removes only the caller's own sign-in", async () => {
    await submitEmailAction(post({ intent: "disconnect", accountId: "a1" }));
    expect(db.mailAccountConnection.deleteMany).toHaveBeenCalledWith({ where: { accountId: "a1", userId: "u1" } });
  });
  it("archiveInbox and restoreInbox are per user", async () => {
    await submitEmailAction(post({ intent: "archiveInbox", accountId: "a1" }));
    expect(db.mailInboxArchive.upsert).toHaveBeenCalledWith({
      where: { accountId_userId: { accountId: "a1", userId: "u1" } },
      create: { accountId: "a1", userId: "u1" },
      update: {},
    });
    await submitEmailAction(post({ intent: "restoreInbox", accountId: "a1" }));
    expect(db.mailInboxArchive.deleteMany).toHaveBeenCalledWith({ where: { accountId: "a1", userId: "u1" } });
  });
});

describe("submitEmailAction: comment", () => {
  it("requires a thread and a body", async () => {
    for (const f of [{ body: "hi" }, { threadId: "t1" }, { threadId: "t1", body: "   " }]) {
      const res = (await submitEmailAction(post({ intent: "comment", accountId: "a1", ...f }))) as Response;
      expect(res.status).toBe(400);
    }
    expect(db.mailComment.create).not.toHaveBeenCalled();
  });
  it("stores at most 5000 characters, authored by the caller, and notifies mentions with the full body", async () => {
    const body = "x".repeat(6000);
    await submitEmailAction(post({ intent: "comment", accountId: "a1", threadId: "t1", body }));
    expect(db.mailComment.create).toHaveBeenCalledWith({
      data: { accountId: "a1", threadId: "t1", authorId: "u1", body: "x".repeat(5000) },
    });
    expect(notifyMailCommentMentions).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t1", authorId: "u1", body }),
    );
  });
  it("a failing mention notification does not fail the comment", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m(notifyMailCommentMentions).mockRejectedValue(new Error("boom"));
    await expect(
      submitEmailAction(post({ intent: "comment", accountId: "a1", threadId: "t1", body: "hi" })),
    ).resolves.toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    spy.mockRestore();
  });
});

describe("submitEmailAction: archive / markUnread", () => {
  it("needs a thread", async () => {
    const res = (await submitEmailAction(post({ intent: "archive", accountId: "a1" }))) as Response;
    expect(res.status).toBe(400);
    expect(modifyThread).not.toHaveBeenCalled();
  });
  it("archive removes INBOX; markUnread adds UNREAD", async () => {
    await submitEmailAction(post({ intent: "archive", accountId: "a1", threadId: "t1" }));
    expect(modifyThread).toHaveBeenLastCalledWith("tok", "t1", { remove: ["INBOX"] });
    await submitEmailAction(post({ intent: "markUnread", accountId: "a1", threadId: "t1" }));
    expect(modifyThread).toHaveBeenLastCalledWith("tok", "t1", { add: ["UNREAD"] });
  });
  it("maps Gmail failure to 502 and rethrows other errors", async () => {
    m(modifyThread).mockRejectedValueOnce(new MailboxError("down"));
    const res = (await submitEmailAction(post({ intent: "archive", accountId: "a1", threadId: "t1" }))) as Response;
    expect(res.status).toBe(502);
    m(modifyThread).mockRejectedValueOnce(new TypeError("bug"));
    await expect(submitEmailAction(post({ intent: "archive", accountId: "a1", threadId: "t1" }))).rejects.toThrow("bug");
  });
});

describe("submitEmailAction: drafts and attachments", () => {
  const visible = { sentAt: null, OR: [{ shared: true }, { createdById: "u1" }] };

  it("deleteDraft is scoped to the inbox and visible drafts, and removes the S3 objects", async () => {
    db.mailDraftAttachment.findMany.mockResolvedValue([{ s3Key: "k1" }, { s3Key: "k2" }]);
    m(deleteObject).mockRejectedValueOnce(new Error("s3"));
    await expect(submitEmailAction(post({ intent: "deleteDraft", accountId: "a1", draftId: "d1" }))).resolves.toEqual({
      ok: true,
    });
    const where = { id: "d1", accountId: "a1", ...visible };
    expect(db.mailDraft.deleteMany).toHaveBeenCalledWith({ where });
    expect(db.mailDraftAttachment.findMany).toHaveBeenCalledWith({ where: { draft: where }, select: { s3Key: true } });
    expect(deleteObject).toHaveBeenCalledWith("k1");
    expect(deleteObject).toHaveBeenCalledWith("k2");
  });

  it.each([
    ["a key outside the attachment prefix", { s3Key: "uploads/other/x.pdf", filename: "x.pdf" }],
    ["a blocked file type", { s3Key: "uploads/email-attachments/x.exe", filename: "x.exe" }],
  ])("attach rejects %s", async (_n, f) => {
    const res = (await submitEmailAction(post({ intent: "attach", accountId: "a1", ...f }))) as Response;
    expect(res.status).toBe(400);
    expect(db.mailDraft.create).not.toHaveBeenCalled();
    expect(db.mailDraftAttachment.create).not.toHaveBeenCalled();
  });

  it("attach creates a draft for an unsaved compose, then pins the file with defaults", async () => {
    db.mailDraft.create.mockResolvedValue({ id: "d9" });
    db.mailDraftAttachment.findMany.mockResolvedValue([{ id: "att1" }]);
    const res = (await submitEmailAction(
      post({
        intent: "attach",
        accountId: "a1",
        s3Key: "uploads/email-attachments/x.pdf",
        filename: "x.pdf",
        sizeBytes: "abc",
        to: " ada@example.edu ",
        shared: "on",
      }),
    )) as Response;
    expect(db.mailDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "a1",
        to: "ada@example.edu",
        shared: true,
        createdById: "u1",
        updatedById: "u1",
        threadId: null,
      }),
    });
    expect(db.mailDraftAttachment.create).toHaveBeenCalledWith({
      data: {
        draftId: "d9",
        s3Key: "uploads/email-attachments/x.pdf",
        filename: "x.pdf",
        contentType: "application/octet-stream",
        sizeBytes: 0,
      },
    });
    expect(await res.json()).toEqual({ ok: true, draftId: "d9", attachments: [{ id: "att1" }] });
  });

  it("detach 404s a draft the user can't see, and only deletes an attachment of that draft", async () => {
    db.mailDraft.findFirst.mockResolvedValue(null);
    const res = (await submitEmailAction(
      post({ intent: "detach", accountId: "a1", draftId: "d1", attachmentId: "att1" }),
    )) as Response;
    expect(res.status).toBe(404);
    expect(db.mailDraftAttachment.delete).not.toHaveBeenCalled();

    db.mailDraft.findFirst.mockResolvedValue({ id: "d1" });
    db.mailDraftAttachment.findFirst.mockResolvedValue({ id: "att1", s3Key: "k" });
    db.mailDraftAttachment.findMany.mockResolvedValue([]);
    await submitEmailAction(post({ intent: "detach", accountId: "a1", draftId: "d1", attachmentId: "att1" }));
    expect(db.mailDraft.findFirst).toHaveBeenLastCalledWith({ where: { id: "d1", accountId: "a1", ...visible } });
    expect(db.mailDraftAttachment.findFirst).toHaveBeenCalledWith({ where: { id: "att1", draftId: "d1" } });
    expect(db.mailDraftAttachment.delete).toHaveBeenCalledWith({ where: { id: "att1" } });
    expect(deleteObject).toHaveBeenCalledWith("k");
  });
});

describe("submitEmailAction: saveDraft and send", () => {
  const draft = (o: Record<string, unknown> = {}) => ({
    id: "d1",
    to: "ada@example.edu",
    cc: "",
    bcc: "",
    subject: "Hello",
    body: "Hi",
    threadId: null,
    ...o,
  });

  beforeEach(() => {
    db.mailDraft.create.mockResolvedValue(draft());
    db.mailDraft.update.mockResolvedValue(draft());
    db.mailDraftAttachment.findMany.mockResolvedValue([]);
  });

  it("saveDraft creates a new draft owned by the caller", async () => {
    const res = await submitEmailAction(post({ intent: "saveDraft", accountId: "a1", to: "ada@example.edu" }));
    expect(res).toEqual({ ok: true, draftId: "d1" });
    expect(db.mailDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: "a1", createdById: "u1", shared: false }),
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("saveDraft updates an existing visible draft, but creates anew if the id is not visible", async () => {
    db.mailDraft.findFirst.mockResolvedValue({ id: "d1" });
    await submitEmailAction(post({ intent: "saveDraft", accountId: "a1", draftId: "d1" }));
    expect(db.mailDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", accountId: "a1", sentAt: null, OR: [{ shared: true }, { createdById: "u1" }] },
    });
    expect(db.mailDraft.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.not.objectContaining({ createdById: expect.anything() }),
    });
    db.mailDraft.findFirst.mockResolvedValue(null);
    db.mailDraft.create.mockClear();
    await submitEmailAction(post({ intent: "saveDraft", accountId: "a1", draftId: "someone-elses" }));
    expect(db.mailDraft.create).toHaveBeenCalledTimes(1);
  });

  it("send needs a recipient and keeps the draft", async () => {
    db.mailDraft.create.mockResolvedValue(draft({ to: "" }));
    const res = (await submitEmailAction(post({ intent: "send", accountId: "a1" }))) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Add a recipient.", draftId: "d1" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("send refuses attachments over 25MB in total", async () => {
    db.mailDraftAttachment.findMany.mockResolvedValue([
      { s3Key: "a", sizeBytes: 20 * 1024 * 1024 },
      { s3Key: "b", sizeBytes: 6 * 1024 * 1024 },
    ]);
    const res = (await submitEmailAction(post({ intent: "send", accountId: "a1" }))) as Response;
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("send reports an unloadable attachment as 502 with the draft saved", async () => {
    db.mailDraftAttachment.findMany.mockResolvedValue([{ s3Key: "a", sizeBytes: 1, filename: "a", contentType: "t" }]);
    m(getObjectBytes).mockRejectedValue(new Error("s3"));
    const res = (await submitEmailAction(post({ intent: "send", accountId: "a1" }))) as Response;
    expect(res.status).toBe(502);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("send a new message through Gmail, with attachments, then marks the draft sent", async () => {
    db.mailDraftAttachment.findMany.mockResolvedValue([
      { s3Key: "k", sizeBytes: 5, filename: "f.pdf", contentType: "application/pdf" },
    ]);
    m(getObjectBytes).mockResolvedValue({ body: Buffer.from("pdf") });
    const res = await submitEmailAction(post({ intent: "send", accountId: "a1" }));
    expect(res).toEqual({ ok: true, sent: true });
    expect(getThread).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("tok", {
      from: '"inbox@example.edu" <inbox@example.edu>',
      to: "ada@example.edu",
      cc: "",
      bcc: "",
      subject: "Hello",
      body: "Hi",
      threadId: null,
      inReplyTo: undefined,
      references: undefined,
      attachments: [{ filename: "f.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf") }],
    });
    expect(db.mailDraft.update).toHaveBeenLastCalledWith({
      where: { id: "d1" },
      data: { sentAt: expect.any(Date) },
    });
  });

  it("a reply threads onto the last message and prefixes Re: only when the subject is blank", async () => {
    db.mailDraft.create.mockResolvedValue(draft({ threadId: "t1", subject: "" }));
    m(getThread).mockResolvedValue([
      { messageId: "<1@x>", references: "", subject: "Re: Hi" },
      { messageId: "<2@x>", references: "<1@x>", subject: "Plan" },
    ]);
    await submitEmailAction(post({ intent: "send", accountId: "a1", threadId: "t1" }));
    expect(sendMessage).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ threadId: "t1", inReplyTo: "<2@x>", references: "<1@x>", subject: "Re: Plan" }),
    );

    m(getThread).mockResolvedValue([{ messageId: "<2@x>", references: "", subject: "re: Plan" }]);
    await submitEmailAction(post({ intent: "send", accountId: "a1", threadId: "t1" }));
    expect(sendMessage).toHaveBeenLastCalledWith("tok", expect.objectContaining({ subject: "re: Plan" }));

    db.mailDraft.create.mockResolvedValue(draft({ threadId: "t1", subject: "Mine" }));
    await submitEmailAction(post({ intent: "send", accountId: "a1", threadId: "t1" }));
    expect(sendMessage).toHaveBeenLastCalledWith("tok", expect.objectContaining({ subject: "Mine" }));
  });

  it("the From header drops quote and newline characters from the display name", async () => {
    const { mailAccountLabel } = await import("~/email/lib/access.server");
    m(mailAccountLabel).mockReturnValueOnce('Ada "The"\r\nBcc: x');
    await submitEmailAction(post({ intent: "send", accountId: "a1" }));
    expect(m(sendMessage).mock.calls[0][1].from).toBe('"Ada TheBcc: x" <inbox@example.edu>');
  });

  it("a Gmail failure on send is 502, leaves the draft unsent", async () => {
    m(sendMessage).mockRejectedValue(new MailboxError("down"));
    const res = (await submitEmailAction(post({ intent: "send", accountId: "a1" }))) as Response;
    expect(res.status).toBe(502);
    expect(db.mailDraft.update).not.toHaveBeenCalled();
  });
});

describe("submitEmailAction: applicant linking", () => {
  const link = (f: Record<string, string>) =>
    submitEmailAction(post({ intent: "linkApplicant", accountId: "a1", threadId: "t1", ...f }));

  beforeEach(() => {
    db.mailMessageIndex.count.mockResolvedValue(1);
    m(recordUserEmail).mockResolvedValue({ ok: true });
  });

  it("is only for shared inboxes", async () => {
    m(findReadableAccount).mockResolvedValue(acct({ kind: "Personal" }));
    const res = (await link({ userId: "u9" })) as Response;
    expect(res.status).toBe(403);
    expect(setThreadLink).not.toHaveBeenCalled();
  });

  it("needs a thread and, to link, a person", async () => {
    expect(((await submitEmailAction(post({ intent: "linkApplicant", accountId: "a1" }))) as Response).status).toBe(400);
    expect(((await link({})) as Response).status).toBe(400);
    expect(setThreadLink).not.toHaveBeenCalled();
  });

  it("indexes the thread first when it isn't indexed, labelling direction by sender", async () => {
    db.mailMessageIndex.count.mockResolvedValue(0);
    m(getThread).mockResolvedValue([
      { id: "m1", from: "Grace <grace@example.edu>", to: "inbox@example.edu", cc: "", subject: "s", date: "d" },
      { id: "m2", from: "Inbox <INBOX@example.edu>", to: "grace@example.edu", cc: "", subject: "s", date: "d" },
    ]);
    db.mailMessageIndex.findMany.mockResolvedValue([]);
    await link({ userId: "u9" });
    const arg = m(indexMessages).mock.calls[0][0];
    expect(arg.accountId).toBe("a1");
    expect(arg.metas.map((x: { id: string; direction: string }) => [x.id, x.direction])).toEqual([
      ["m1", "Inbound"],
      ["m2", "Outbound"],
    ]);
  });

  it("502s when Gmail can't be read for indexing and links nothing", async () => {
    db.mailMessageIndex.count.mockResolvedValue(0);
    m(getThread).mockRejectedValue(new MailboxError("down"));
    const res = (await link({ userId: "u9" })) as Response;
    expect(res.status).toBe(502);
    expect(setThreadLink).not.toHaveBeenCalled();
  });

  it("records only external inbound sender addresses against the applicant, lowercased", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([
      { fromAddress: "Grace@Example.edu" },
      { fromAddress: "grace@example.edu" },
      { fromAddress: "INBOX@example.edu" },
      { fromAddress: "staff@dali.dartmouth.edu" },
    ]);
    const res = await link({ userId: "u9" });
    expect(res).toEqual({ ok: true });
    expect(db.mailMessageIndex.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "a1", threadId: "t1", direction: "Inbound" } }),
    );
    expect(recordUserEmail).toHaveBeenCalledTimes(1);
    expect(recordUserEmail).toHaveBeenCalledWith({ userId: "u9", address: "grace@example.edu", verified: false });
    expect(setThreadLink).toHaveBeenCalledWith(expect.objectContaining({ target: { userId: "u9" }, byUserId: "u1" }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "email.applicant_link", targetId: "a1~t1", metadata: { userId: "u9" } }),
    );
  });

  it("warns when an address belongs to another account", async () => {
    db.mailMessageIndex.findMany.mockResolvedValue([{ fromAddress: "grace@example.edu" }]);
    m(recordUserEmail).mockResolvedValue({ ok: false });
    expect(await link({ userId: "u9" })).toMatchObject({ ok: true, warning: expect.any(String) });
  });

  it("unlink clears the link and audits it", async () => {
    const res = await submitEmailAction(post({ intent: "unlinkApplicant", accountId: "a1", threadId: "t1" }));
    expect(res).toEqual({ ok: true });
    expect(setThreadLink).toHaveBeenCalledWith(expect.objectContaining({ target: null, byUserId: "u1" }));
    expect(recordUserEmail).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "email.applicant_unlink" }));
  });
});
