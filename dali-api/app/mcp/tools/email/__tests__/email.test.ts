import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  mailComment: { findMany: vi.fn() },
  mailDraft: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const mail = vi.hoisted(() => ({
  emailAccessDenied: vi.fn(),
  loadFeed: vi.fn(),
  loadUnreadCounts: vi.fn(),
  addMailComment: vi.fn(),
  deleteMailComment: vi.fn(),
  changeThreadLabels: vi.fn(),
  upsertDraft: vi.fn(),
  findVisibleDraft: vi.fn(),
  draftVisibleTo: (userId: string) => ({ sentAt: null, OR: [{ shared: true }, { createdById: userId }] }),
}));
const access = vi.hoisted(() => ({
  readableMailAccounts: vi.fn(),
  mailAccountLabel: (a: { displayName: string | null; address: string }) => a.displayName ?? a.address,
}));
const gmail = vi.hoisted(() => {
  class MailboxError extends Error {}
  return {
    MailboxError,
    getMailboxToken: vi.fn(async () => "tok"),
    getThread: vi.fn(),
    listLabels: vi.fn(),
    sendMessage: vi.fn(),
  };
});
const index = vi.hoisted(() => ({ getThreadLink: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/email/lib/email.server", () => mail);
vi.mock("~/email/lib/access.server", () => access);
vi.mock("~/email/lib/gmail-mailbox.server", () => gmail);
vi.mock("~/email/lib/mail-index.server", () => index);

import { validateInput } from "~/lib/mcp-input";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import type { McpCtx } from "~/mcp/registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "~/mcp/errors";
import { EMAIL_TOOLS } from "..";

const ctx: McpCtx = {
  user: { id: "u1", daliEmail: "ada@dali.dartmouth.edu", dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "L" },
  scopes: ["mcp:read", "mcp:write"],
  request: new Request("https://os.example.edu/mcp", { method: "POST" }),
};

const tool = (name: string) => {
  const t = EMAIL_TOOLS.find((x) => x.def.name === name);
  if (!t) throw new Error(name);
  return t;
};
const call = (name: string, args: Record<string, unknown> = {}) => tool(name).run(ctx, args);

const account = (o: Record<string, unknown> = {}) => ({
  id: "a1",
  kind: "Shared",
  address: "partners@dali.dartmouth.edu",
  displayName: "Partners",
  project: null,
  oauthTokens: "enc",
  syncError: null,
  archived: false,
  connectionId: "c1",
  ...o,
});

const LABELS = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "UNREAD", name: "UNREAD", type: "system" },
  { id: "SPAM", name: "SPAM", type: "system" },
  { id: "SENT", name: "SENT", type: "system" },
  { id: "Label_1", name: "Partners", type: "user" },
  { id: "Label_2", name: "Partner follow-up", type: "user" },
];

const ALL_TOOLS = EMAIL_TOOLS.map((t) => t.def.name);
const ACCOUNT_TOOLS: [string, Record<string, unknown>][] = [
  ["list_mail_labels", { accountId: "a1" }],
  ["get_mail_thread", { accountId: "a1", threadId: "t1" }],
  ["label_mail_thread", { accountId: "a1", threadId: "t1", add: ["UNREAD"] }],
  ["comment_on_mail_thread", { action: "create", accountId: "a1", threadId: "t1", body: "hi" }],
  ["draft_mail", { accountId: "a1", to: "x@example.edu", body: "hi" }],
  ["search_mail", { accountId: "a1" }],
];

beforeEach(() => {
  vi.resetAllMocks();
  gmail.getMailboxToken.mockResolvedValue("tok");
  mail.emailAccessDenied.mockResolvedValue(false);
  access.readableMailAccounts.mockResolvedValue([account()]);
  gmail.listLabels.mockResolvedValue(LABELS);
  mail.loadUnreadCounts.mockResolvedValue({});
});

describe("tool definitions", () => {
  it("registers every tool behind the mcp-email flag", () => {
    expect(ALL_TOOLS.sort()).toEqual(
      ["comment_on_mail_thread", "draft_mail", "get_mail_thread", "label_mail_thread", "list_mail_inboxes", "list_mail_labels", "search_mail"].sort(),
    );
    expect(EMAIL_TOOLS.every((t) => t.featureFlag === "mcp-email")).toBe(true);
    expect(FEATURE_FLAGS.some((f) => f.key === "mcp-email")).toBe(true);
  });

  it("uses read scope for reads and write scope for writes, with no send tool", () => {
    const scopes = Object.fromEntries(EMAIL_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect(scopes).toEqual({
      list_mail_inboxes: "mcp:read", list_mail_labels: "mcp:read", search_mail: "mcp:read", get_mail_thread: "mcp:read",
      label_mail_thread: "mcp:write", comment_on_mail_thread: "mcp:write", draft_mail: "mcp:write",
    });
  });

  it("has no em dashes and warns about untrusted content on the reading tools", () => {
    for (const t of EMAIL_TOOLS) expect(t.def.description).not.toContain("—");
    expect(tool("get_mail_thread").def.description).toContain("untrusted");
    expect(tool("search_mail").def.description).toContain("untrusted");
  });

  it("rejects bad input at the schema", () => {
    const ok = (n: string, input: Record<string, unknown>) => validateInput(input, tool(n).def.inputSchema).ok;
    expect(ok("search_mail", { folder: "inbox" })).toBe(true);
    expect(ok("search_mail", { folder: "drafts" })).toBe(false);
    expect(ok("get_mail_thread", { accountId: "a1" })).toBe(false);
    expect(ok("draft_mail", { accountId: "a1", to: "x@example.edu" })).toBe(false);
    expect(ok("comment_on_mail_thread", { action: "edit", accountId: "a1" })).toBe(false);
  });
});

describe("access", () => {
  it.each([["list_mail_inboxes", {}], ...ACCOUNT_TOOLS])("%s is forbidden for users the Email tab rejects", async (name, args) => {
    mail.emailAccessDenied.mockResolvedValue(true);
    await expect(call(name, args)).rejects.toBeInstanceOf(McpForbiddenError);
    expect(access.readableMailAccounts).not.toHaveBeenCalled();
  });

  it.each(ACCOUNT_TOOLS)("%s says Inbox not found for an inbox outside the readable set", async (name, args) => {
    await expect(call(name, { ...args, accountId: "nope" })).rejects.toThrow(McpNotFoundError);
    await expect(call(name, { ...args, accountId: "nope" })).rejects.toThrow("Inbox not found");
  });

  it.each(ACCOUNT_TOOLS)("%s treats a Personal inbox as not found", async (name, args) => {
    access.readableMailAccounts.mockResolvedValue([account({ id: "p1", kind: "Personal" })]);
    await expect(call(name, { ...args, accountId: "p1" })).rejects.toThrow("Inbox not found");
  });

  it.each(ACCOUNT_TOOLS)("%s asks to connect an inbox with no sign-in", async (name, args) => {
    access.readableMailAccounts.mockResolvedValue([account({ oauthTokens: null })]);
    await expect(call(name, args)).rejects.toThrow("Connect this inbox in Email first.");
    await expect(call(name, args)).rejects.toBeInstanceOf(McpInvalidError);
  });
});

describe("list_mail_inboxes", () => {
  it("lists Project and Shared inboxes, never Personal, with connected and unread", async () => {
    access.readableMailAccounts.mockResolvedValue([
      account({ id: "a1" }),
      account({ id: "a2", kind: "Project", displayName: null, project: { name: "Bloom" }, oauthTokens: null, syncError: "expired", archived: true, address: "bloom@x.edu" }),
      account({ id: "p1", kind: "Personal" }),
    ]);
    mail.loadUnreadCounts.mockResolvedValue({ a1: 4 });
    const r = (await call("list_mail_inboxes")) as { inboxes: Record<string, unknown>[] };
    expect(r.inboxes).toEqual([
      { id: "a1", kind: "Shared", name: "Partners", address: "partners@dali.dartmouth.edu", connected: true, syncError: null, archived: false, unread: 4 },
      { id: "a2", kind: "Project", name: "bloom@x.edu", address: "bloom@x.edu", connected: false, syncError: "expired", archived: true },
    ]);
    expect(mail.loadUnreadCounts).toHaveBeenCalledWith([expect.objectContaining({ id: "a1" })]);
  });

  it("omits unread when Gmail could not count it", async () => {
    const r = (await call("list_mail_inboxes")) as { inboxes: Record<string, unknown>[] };
    expect(r.inboxes[0]).not.toHaveProperty("unread");
  });
});

describe("list_mail_labels", () => {
  it("returns labels flagged as system or not", async () => {
    const r = (await call("list_mail_labels", { accountId: "a1" })) as { labels: { id: string; system: boolean }[] };
    expect(r.labels.find((l) => l.id === "INBOX")?.system).toBe(true);
    expect(r.labels.find((l) => l.id === "Label_1")?.system).toBe(false);
  });

  it("maps a Gmail failure to a 502", async () => {
    gmail.listLabels.mockRejectedValue(new gmail.MailboxError("down"));
    await expect(call("list_mail_labels", { accountId: "a1" })).rejects.toMatchObject({ status: 502 });
  });
});

describe("search_mail", () => {
  const found = (o: Record<string, unknown> = {}) => ({
    threads: [
      { accountId: "a1", id: "t1", subject: "Hi", from: "x", to: "y", snippet: "s", date: "2026-01-01", unread: true, messageCount: 2, labelIds: ["INBOX", "Label_1"] },
    ],
    errors: [],
    next: {},
    ...o,
  });

  it.each([
    ["inbox", "in:inbox", false],
    ["sent", "in:sent", false],
    ["all", "", false],
    ["spam", "in:spam", true],
    ["trash", "in:trash", true],
  ])("folder %s maps to query %j", async (folder, query, spamTrash) => {
    mail.loadFeed.mockResolvedValue(found());
    await call("search_mail", { folder });
    expect(mail.loadFeed).toHaveBeenCalledWith(expect.any(Array), query, spamTrash, undefined);
  });

  it("defaults to the inbox and passes label: searches through", async () => {
    mail.loadFeed.mockResolvedValue(found());
    await call("search_mail", { query: "label:foo from:ada" });
    expect(mail.loadFeed).toHaveBeenCalledWith(expect.any(Array), "label:foo from:ada", false, undefined);
    await call("search_mail", { folder: "sent", query: "label:foo" });
    expect(mail.loadFeed).toHaveBeenLastCalledWith(expect.any(Array), "in:sent label:foo", false, undefined);
  });

  it("without accountId searches connected, unarchived, non-Personal inboxes only", async () => {
    access.readableMailAccounts.mockResolvedValue([
      account({ id: "a1" }),
      account({ id: "a2", oauthTokens: null }),
      account({ id: "a3", archived: true }),
      account({ id: "p1", kind: "Personal" }),
    ]);
    mail.loadFeed.mockResolvedValue(found());
    await call("search_mail");
    expect(mail.loadFeed.mock.calls[0][0].map((a: { id: string }) => a.id)).toEqual(["a1"]);
  });

  it("maps label ids to names and serializes the cursor", async () => {
    mail.loadFeed.mockResolvedValue(found({ next: { a1: "page2" } }));
    const r = (await call("search_mail")) as { threads: { labels: string[] }[]; next: string | null };
    expect(r.threads[0].labels).toEqual(["INBOX", "Partners"]);
    expect(r.next).toBe(JSON.stringify({ a1: "page2" }));
  });

  it("round-trips the cursor into the next page and rejects a bad one", async () => {
    mail.loadFeed.mockResolvedValue(found());
    await call("search_mail", { cursor: JSON.stringify({ a1: "page2" }) });
    expect(mail.loadFeed).toHaveBeenCalledWith(expect.any(Array), "in:inbox", false, { a1: "page2" });
    await expect(call("search_mail", { cursor: "garbage" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("reports a failing inbox in errors without failing the rest, and has no next when exhausted", async () => {
    mail.loadFeed.mockResolvedValue(found({ errors: ["a2"] }));
    const r = (await call("search_mail")) as { errors: string[]; threads: unknown[]; next: string | null };
    expect(r.errors).toEqual(["a2"]);
    expect(r.threads).toHaveLength(1);
    expect(r.next).toBeNull();
  });

  it("falls back to label ids when the label list can't be read", async () => {
    mail.loadFeed.mockResolvedValue(found());
    gmail.listLabels.mockRejectedValue(new gmail.MailboxError("down"));
    const r = (await call("search_mail")) as { threads: { labels: string[] }[] };
    expect(r.threads[0].labels).toEqual(["INBOX", "Label_1"]);
  });
});

describe("get_mail_thread", () => {
  const message = (o: Record<string, unknown> = {}) => ({
    id: "m1", labelIds: ["INBOX"], from: "x@example.com", to: "y", cc: "", date: "2026-01-01T00:00:00.000Z",
    subject: "Hello", messageId: "<m>", references: "", html: null, text: "plain", attachments: [], ...o,
  });
  const run = () => call("get_mail_thread", { accountId: "a1", threadId: "t1" }) as Promise<{
    subject: string; labels: string[]; messages: Record<string, unknown>[]; comments: unknown[];
    applicantLink: unknown; drafts: Record<string, unknown>[];
  }>;

  beforeEach(() => {
    gmail.getThread.mockResolvedValue([message()]);
    db.mailComment.findMany.mockResolvedValue([]);
    db.mailDraft.findMany.mockResolvedValue([]);
    index.getThreadLink.mockResolvedValue(null);
  });

  it("converts an HTML-only message to text", async () => {
    gmail.getThread.mockResolvedValue([message({ text: null, html: "<p>Hi&nbsp;there</p><script>x()</script>" })]);
    const r = await run();
    expect(r.messages[0].text).toBe("Hi there");
    expect(r.messages[0].truncated).toBe(false);
  });

  it("truncates long messages and flags them", async () => {
    gmail.getThread.mockResolvedValue([message({ text: "a".repeat(25_000) })]);
    const r = await run();
    expect((r.messages[0].text as string).length).toBe(20_000);
    expect(r.messages[0].truncated).toBe(true);
  });

  it("returns attachment metadata only, and labels as names", async () => {
    gmail.getThread.mockResolvedValue([
      message({ labelIds: ["INBOX", "Label_1"], attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 9, attachmentId: "secret" }] }),
      message({ id: "m2", labelIds: ["INBOX", "UNREAD"] }),
    ]);
    const r = await run();
    expect(r.messages[0].attachments).toEqual([{ filename: "a.pdf", contentType: "application/pdf", size: 9 }]);
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(r.labels).toEqual(["INBOX", "Partners", "UNREAD"]);
    expect(r.subject).toBe("Hello");
  });

  it("does not mark the thread read", async () => {
    await run();
    expect(mail.changeThreadLabels).not.toHaveBeenCalled();
  });

  it("scopes drafts to those the caller can see, and comments to the thread", async () => {
    db.mailDraft.findMany.mockResolvedValue([
      { id: "d1", to: "z", cc: "", bcc: "", subject: "S", body: "B", shared: true, createdById: "u2", updatedAt: new Date("2026-01-02"), createdBy: { firstName: "Bo", lastName: "K" } },
    ]);
    db.mailComment.findMany.mockResolvedValue([
      { id: "c1", body: "note", createdAt: new Date("2026-01-03"), author: { firstName: "Ada", lastName: "L" } },
    ]);
    const r = await run();
    expect(db.mailDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "a1", threadId: "t1", sentAt: null, OR: [{ shared: true }, { createdById: "u1" }] } }),
    );
    expect(r.drafts[0]).toMatchObject({ id: "d1", mine: false, author: "Bo K" });
    expect(r.comments).toEqual([{ id: "c1", author: "Ada L", body: "note", date: "2026-01-03T00:00:00.000Z" }]);
  });

  it("includes the applicant link on Shared inboxes only", async () => {
    index.getThreadLink.mockResolvedValue({ userId: "u9", source: "Auto" });
    db.user.findUnique.mockResolvedValue({ firstName: "Grace", lastName: "H" });
    expect((await run()).applicantLink).toEqual({ name: "Grace H", source: "Auto" });
    access.readableMailAccounts.mockResolvedValue([account({ kind: "Project" })]);
    index.getThreadLink.mockClear();
    expect((await run()).applicantLink).toBeNull();
    expect(index.getThreadLink).not.toHaveBeenCalled();
  });

  it("maps a Gmail failure to a 502", async () => {
    gmail.getThread.mockRejectedValue(new gmail.MailboxError("down"));
    await expect(run()).rejects.toBeInstanceOf(McpError);
  });
});

describe("label_mail_thread", () => {
  const label = (args: Record<string, unknown>) => call("label_mail_thread", { accountId: "a1", threadId: "t1", ...args });

  it("resolves names case-insensitively and ids, then applies once and clears the unread cache via the helper", async () => {
    const r = await label({ add: ["partners"], remove: ["inbox"] });
    expect(mail.changeThreadLabels).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), "t1", { add: ["Label_1"], remove: ["INBOX"] }, "u1");
    expect(r).toEqual({ ok: true, added: ["Partners"], removed: ["INBOX"] });
    await label({ add: ["Label_2"] });
    expect(mail.changeThreadLabels).toHaveBeenLastCalledWith(expect.anything(), "t1", { add: ["Label_2"], remove: [] }, "u1");
  });

  it("supports archive and mark unread via system labels", async () => {
    await label({ remove: ["INBOX"] });
    await label({ add: ["UNREAD"] });
    expect(mail.changeThreadLabels).toHaveBeenCalledTimes(2);
  });

  it("applies nothing for an unknown name and suggests close matches", async () => {
    const err = (await label({ add: ["Partners", "follow"], remove: ["INBOX"] }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(McpInvalidError);
    expect(err.message).toContain("No label named \"follow\"");
    expect(err.message).toContain("Partner follow-up");
    expect(mail.changeThreadLabels).not.toHaveBeenCalled();
  });

  it("refuses adding SPAM and removing SENT or DRAFT", async () => {
    await expect(label({ add: ["SPAM"] })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(label({ remove: ["SENT"] })).rejects.toBeInstanceOf(McpInvalidError);
    expect(mail.changeThreadLabels).not.toHaveBeenCalled();
  });

  it("rejects an empty change and a label in both lists", async () => {
    await expect(label({})).rejects.toBeInstanceOf(McpInvalidError);
    await expect(label({ add: [], remove: [] })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(label({ add: ["INBOX"], remove: ["inbox"] })).rejects.toBeInstanceOf(McpInvalidError);
    expect(mail.changeThreadLabels).not.toHaveBeenCalled();
  });

  it("maps a Gmail failure to a 502", async () => {
    mail.changeThreadLabels.mockRejectedValue(new gmail.MailboxError("down"));
    await expect(label({ remove: ["INBOX"] })).rejects.toMatchObject({ status: 502 });
  });
});

describe("comment_on_mail_thread", () => {
  it("creates a comment as the caller", async () => {
    mail.addMailComment.mockResolvedValue({ id: "c1" });
    const r = await call("comment_on_mail_thread", { action: "create", accountId: "a1", threadId: "t1", body: "  note  " });
    expect(mail.addMailComment).toHaveBeenCalledWith(
      expect.objectContaining({ account: expect.objectContaining({ id: "a1" }), threadId: "t1", userId: "u1", body: "note", request: ctx.request }),
    );
    expect(r).toEqual({ ok: true, commentId: "c1" });
  });

  it("requires a thread and a body to create, and a comment id to delete", async () => {
    await expect(call("comment_on_mail_thread", { action: "create", accountId: "a1", body: "x" })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(call("comment_on_mail_thread", { action: "create", accountId: "a1", threadId: "t1", body: "   " })).rejects.toBeInstanceOf(McpInvalidError);
    await expect(call("comment_on_mail_thread", { action: "delete", accountId: "a1" })).rejects.toBeInstanceOf(McpInvalidError);
    expect(mail.addMailComment).not.toHaveBeenCalled();
  });

  it("deletes only the caller's own comment and reports a no-op for someone else's", async () => {
    mail.deleteMailComment.mockResolvedValue(1);
    expect(await call("comment_on_mail_thread", { action: "delete", accountId: "a1", commentId: "c1" })).toEqual({ ok: true, deleted: true });
    expect(mail.deleteMailComment).toHaveBeenCalledWith("c1", "u1", "a1");
    mail.deleteMailComment.mockResolvedValue(0);
    expect(await call("comment_on_mail_thread", { action: "delete", accountId: "a1", commentId: "c2" })).toEqual({ ok: true, deleted: false });
  });
});

describe("draft_mail", () => {
  beforeEach(() => {
    mail.upsertDraft.mockResolvedValue({ id: "d1" });
  });

  it("creates a draft, returns its id and the Email tab URL, and never sends", async () => {
    const r = await call("draft_mail", { accountId: "a1", threadId: "t1", to: " x@example.edu ", body: "Hi" });
    expect(mail.upsertDraft).toHaveBeenCalledWith(
      { draftId: undefined, threadId: "t1", to: "x@example.edu", cc: "", bcc: "", subject: "", body: "Hi", shared: false },
      "a1",
      "u1",
    );
    expect(r).toEqual({ draftId: "d1", url: "https://os.example.edu/email?view=drafts&inbox=a1" });
    expect(gmail.sendMessage).not.toHaveBeenCalled();
    expect(mail.findVisibleDraft).not.toHaveBeenCalled();
  });

  it("updates a visible draft, keeping fields that are left out", async () => {
    mail.findVisibleDraft.mockResolvedValue({ id: "d9", threadId: "t5", cc: "c@x.edu", bcc: "", subject: "Old", shared: true });
    await call("draft_mail", { accountId: "a1", draftId: "d9", to: "x@example.edu", body: "New" });
    expect(mail.findVisibleDraft).toHaveBeenCalledWith("d9", "a1", "u1");
    expect(mail.upsertDraft).toHaveBeenCalledWith(
      { draftId: "d9", threadId: "t5", to: "x@example.edu", cc: "c@x.edu", bcc: "", subject: "Old", body: "New", shared: true },
      "a1",
      "u1",
    );
  });

  it("can't update another user's unshared draft", async () => {
    mail.findVisibleDraft.mockResolvedValue(null);
    await expect(call("draft_mail", { accountId: "a1", draftId: "theirs", to: "x@example.edu", body: "b" })).rejects.toBeInstanceOf(McpNotFoundError);
    expect(mail.upsertDraft).not.toHaveBeenCalled();
  });
});
