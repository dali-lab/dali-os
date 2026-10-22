import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { chatConversation: { findUnique: vi.fn() } } }));
vi.mock("~/lib/mobile-auth.server", () => ({ isMobileAppEnabled: vi.fn() }));
vi.mock("~/lib/mobile-members.server", () => ({ listMemberSummaries: vi.fn() }));
vi.mock("~/chat/lib/chat.server", () => ({
  bootstrap: vi.fn(),
  createChannel: vi.fn(),
  inviteMembers: vi.fn(),
  joinChannel: vi.fn(),
  leaveChannel: vi.fn(),
  listMessages: vi.fn(),
  markRead: vi.fn(),
  openDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
  toggleReaction: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isMobileAppEnabled } from "~/lib/mobile-auth.server";
import { listMemberSummaries } from "~/lib/mobile-members.server";
import * as chat from "~/chat/lib/chat.server";
import type { WireConversation, WireMessage } from "~/chat/lib/chat.server";
import type { McpCtx } from "../../../registry";
import {
  CHAT_TOOLS,
  conversationTitle,
  formatMessage,
  resolveConversationId,
  runListChatConversations,
  runManageChatConversation,
  runReactToChatMessage,
  runReadChatMessages,
  runSendChatMessage,
  unreadCount,
  unwrap,
} from "..";

const ME = "me";
const ctx = { user: { id: ME }, scopes: ["mcp:read", "mcp:write"], request: new Request("http://x/mcp") } as unknown as McpCtx;

const NAMES: Record<string, string> = { me: "Sophie Park", kiran: "Kiran Jones", yaying: "YaYing Yu" };

function conv(over: Partial<WireConversation> = {}): WireConversation {
  return {
    id: "c1",
    kind: "channel",
    name: "dali-os",
    isPrivate: false,
    isDefault: false,
    topic: null,
    memberIds: [ME, "kiran"],
    createdBy: "kiran",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastReadAt: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

function msg(over: Partial<WireMessage> = {}): WireMessage {
  return {
    id: "m1",
    conversationId: "c1",
    authorId: "kiran",
    text: "hi",
    createdAt: "2026-10-21T12:00:00.000Z",
    reactions: [],
    parentId: null,
    kind: "user",
    ...over,
  };
}

const names = new Map(Object.entries(NAMES));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMobileAppEnabled).mockResolvedValue(true);
  vi.mocked(listMemberSummaries).mockImplementation(async (ids?: string[]) =>
    (ids ?? []).map((id) => ({ id, name: NAMES[id] ?? id }) as never),
  );
});

describe("registration", () => {
  it("exposes the five chat tools with read/write scopes", () => {
    expect(CHAT_TOOLS.map((t) => [t.def.name, t.def.requiredScope])).toEqual([
      ["list_chat_conversations", "mcp:read"],
      ["read_chat_messages", "mcp:read"],
      ["send_chat_message", "mcp:write"],
      ["react_to_chat_message", "mcp:write"],
      ["manage_chat_conversation", "mcp:write"],
    ]);
  });
});

describe("feature flag gate", () => {
  it.each([
    ["list", () => runListChatConversations(ctx, {})],
    ["read", () => runReadChatMessages(ctx, { conversationId: "c1" })],
    ["send", () => runSendChatMessage(ctx, { conversationId: "c1", text: "x" })],
    ["react", () => runReactToChatMessage(ctx, { messageId: "m1", emoji: "👍" })],
    ["manage", () => runManageChatConversation(ctx, { action: "mark_read", conversationId: "c1" })],
  ])("%s returns not found when mobile-app is off for the member", async (_name, call) => {
    vi.mocked(isMobileAppEnabled).mockResolvedValue(false);
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(chat.bootstrap).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});

describe("unwrap", () => {
  it("returns data on success", () => {
    expect(unwrap({ ok: true, data: 5 })).toBe(5);
  });
  it.each([
    [404, "McpNotFoundError"],
    [403, "McpForbiddenError"],
    [409, "McpError"],
    [400, "McpError"],
  ])("maps status %i to %s with the same status", (status, name) => {
    try {
      unwrap({ ok: false, status, error: "nope" });
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ name, status, message: "nope" });
    }
  });
});

describe("resolveConversationId", () => {
  it("prefers conversationId", async () => {
    await expect(resolveConversationId({ conversationId: "c9", channel: "general" })).resolves.toBe("c9");
    expect(prisma.chatConversation.findUnique).not.toHaveBeenCalled();
  });
  it("looks a channel up by slug, ignoring a leading #", async () => {
    vi.mocked(prisma.chatConversation.findUnique).mockResolvedValue({ id: "c2" } as never);
    await expect(resolveConversationId({ channel: "#Design Crits" })).resolves.toBe("c2");
    expect(prisma.chatConversation.findUnique).toHaveBeenCalledWith({ where: { name: "design-crits" }, select: { id: true } });
  });
  it("404s an unknown channel", async () => {
    vi.mocked(prisma.chatConversation.findUnique).mockResolvedValue(null);
    await expect(resolveConversationId({ channel: "nope" })).rejects.toMatchObject({ status: 404 });
  });
  it("rejects a call with no target", async () => {
    await expect(resolveConversationId({ channel: "  " })).rejects.toMatchObject({ status: 400 });
  });
});

describe("formatting", () => {
  it("titles channels with # and DMs with the other members", () => {
    expect(conversationTitle(conv(), ME, names)).toBe("#dali-os");
    expect(conversationTitle(conv({ kind: "dm", name: null, memberIds: [ME, "kiran", "yaying"] }), ME, names)).toBe(
      "Kiran Jones, YaYing Yu",
    );
    expect(conversationTitle(conv({ kind: "dm", name: null, memberIds: [ME] }), ME, names)).toBe("You");
  });

  it("prefixes system messages with the actor and names reactors", () => {
    const out = formatMessage(
      msg({ kind: "system", text: "joined the channel", reactions: [{ emoji: "🎉", userIds: [ME, "kiran"] }] }),
      names,
      2,
    );
    expect(out).toMatchObject({
      author: "Kiran Jones",
      text: "Kiran Jones joined the channel",
      replyCount: 2,
      reactions: [{ emoji: "🎉", count: 2, by: ["Sophie Park", "Kiran Jones"] }],
    });
  });

  it("omits replyCount when not given", () => {
    expect(formatMessage(msg(), names)).not.toHaveProperty("replyCount");
  });
});

describe("unreadCount", () => {
  const c = conv();
  it("counts other members' top-level user messages after the read marker", () => {
    const messages = [
      msg({ id: "a", createdAt: "2026-10-19T00:00:00.000Z" }),
      msg({ id: "b" }),
      msg({ id: "c", authorId: ME }),
      msg({ id: "d", parentId: "b" }),
      msg({ id: "e", kind: "system" }),
      msg({ id: "f", conversationId: "other" }),
      msg({ id: "g" }),
    ];
    expect(unreadCount(c, messages, ME)).toBe(2);
  });
  it("is zero for a channel the member hasn't joined", () => {
    expect(unreadCount(conv({ memberIds: ["kiran"] }), [msg()], ME)).toBe(0);
  });
});

describe("list_chat_conversations", () => {
  beforeEach(() => {
    vi.mocked(chat.bootstrap).mockResolvedValue({
      conversations: [
        conv({ id: "c1" }),
        conv({ id: "c2", name: "random", memberIds: ["kiran"], createdAt: "2026-10-22T00:00:00.000Z" }),
        conv({ id: "d1", kind: "dm", name: null, memberIds: [ME, "yaying"], lastReadAt: "2026-10-22T00:00:00.000Z" }),
      ],
      messages: [
        msg({ id: "m1", conversationId: "c1", createdAt: "2026-10-21T10:00:00.000Z" }),
        msg({ id: "m2", conversationId: "d1", authorId: "yaying", createdAt: "2026-10-21T11:00:00.000Z" }),
      ],
    });
  });

  it("lists joined conversations, newest activity first, with unread counts", async () => {
    const { conversations } = await runListChatConversations(ctx, {});
    expect(conversations.map((c) => [c.id, c.title, c.unreadCount, c.isMember])).toEqual([
      ["d1", "YaYing Yu", 0, true],
      ["c1", "#dali-os", 1, true],
    ]);
    expect(conversations[1].lastMessage).toMatchObject({ id: "m1", author: "Kiran Jones" });
  });

  it("includes unjoined public channels when asked", async () => {
    const { conversations } = await runListChatConversations(ctx, { includeBrowsable: true });
    expect(conversations.find((c) => c.id === "c2")).toMatchObject({ isMember: false, lastMessage: null });
  });

  it("filters to unread conversations", async () => {
    const { conversations } = await runListChatConversations(ctx, { unreadOnly: true });
    expect(conversations.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("read_chat_messages", () => {
  const page = [
    msg({ id: "r1", createdAt: "2026-10-21T10:00:00.000Z" }),
    msg({ id: "r1a", parentId: "r1", authorId: ME, createdAt: "2026-10-21T10:01:00.000Z" }),
    msg({ id: "r1b", parentId: "r1", createdAt: "2026-10-21T10:02:00.000Z" }),
    msg({ id: "r2", createdAt: "2026-10-21T11:00:00.000Z" }),
    msg({ id: "r3", createdAt: "2026-10-21T12:00:00.000Z" }),
  ];

  beforeEach(() => vi.mocked(chat.listMessages).mockResolvedValue({ ok: true, data: page }));

  it("returns top-level messages oldest first with reply counts", async () => {
    const out = await runReadChatMessages(ctx, { conversationId: "c1" });
    expect("messages" in out && out.messages?.map((m) => [m.id, m.replyCount])).toEqual([
      ["r1", 2],
      ["r2", 0],
      ["r3", 0],
    ]);
    expect("nextBefore" in out && out.nextBefore).toBeNull();
  });

  it("limits to the newest roots and offers a cursor", async () => {
    const out = await runReadChatMessages(ctx, { conversationId: "c1", limit: 2 });
    expect("messages" in out && out.messages?.map((m) => m.id)).toEqual(["r2", "r3"]);
    expect("nextBefore" in out && out.nextBefore).toBe("2026-10-21T11:00:00.000Z");
  });

  it("returns one thread", async () => {
    const out = await runReadChatMessages(ctx, { conversationId: "c1", threadId: "r1" });
    expect("thread" in out && out.thread).toMatchObject({ id: "r1", replyCount: 2 });
    expect("replies" in out && out.replies?.map((m) => m.id)).toEqual(["r1a", "r1b"]);
  });

  it("404s an unknown thread", async () => {
    await expect(runReadChatMessages(ctx, { conversationId: "c1", threadId: "r1a" })).rejects.toMatchObject({ status: 404 });
  });

  it("passes before through and rejects a bad date", async () => {
    await runReadChatMessages(ctx, { conversationId: "c1", before: "2026-10-21T00:00:00.000Z" });
    expect(chat.listMessages).toHaveBeenCalledWith(ME, "c1", new Date("2026-10-21T00:00:00.000Z"));
    await expect(runReadChatMessages(ctx, { conversationId: "c1", before: "yesterday" })).rejects.toMatchObject({ status: 400 });
  });

  it("surfaces a hidden conversation as not found", async () => {
    vi.mocked(chat.listMessages).mockResolvedValue({ ok: false, status: 404, error: "Conversation not found" });
    await expect(runReadChatMessages(ctx, { conversationId: "secret" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("send_chat_message", () => {
  beforeEach(() => {
    vi.mocked(chat.sendMessage).mockImplementation(async (_me, conversationId, text, parentId) => ({
      ok: true,
      data: msg({ id: "new", conversationId, text, parentId: parentId ?? null, authorId: ME }),
    }));
  });

  it("sends to a conversation, trimming text and threading", async () => {
    const out = await runSendChatMessage(ctx, { conversationId: "c1", text: "  hello  ", threadId: "r1" });
    expect(chat.sendMessage).toHaveBeenCalledWith(ME, "c1", "hello", "r1");
    expect(out.message).toMatchObject({ author: "Sophie Park", text: "hello", threadId: "r1" });
  });

  it("opens the DM for userIds and sends there", async () => {
    vi.mocked(chat.openDirectMessage).mockResolvedValue({ ok: true, data: conv({ id: "d7", kind: "dm" }) });
    const out = await runSendChatMessage(ctx, { userIds: ["kiran"], text: "yo" });
    expect(chat.openDirectMessage).toHaveBeenCalledWith(ME, ["kiran"]);
    expect(out.conversationId).toBe("d7");
  });

  it.each([
    [{ text: "x" }],
    [{ conversationId: "c1", channel: "general", text: "x" }],
    [{ conversationId: "c1", userIds: ["kiran"], text: "x" }],
  ])("requires exactly one target: %j", async (args) => {
    await expect(runSendChatMessage(ctx, args)).rejects.toMatchObject({ status: 400 });
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized text", async () => {
    await expect(runSendChatMessage(ctx, { conversationId: "c1", text: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(runSendChatMessage(ctx, { conversationId: "c1", text: "x".repeat(4001) })).rejects.toMatchObject({ status: 400 });
  });

  it("maps a non-member post to forbidden", async () => {
    vi.mocked(chat.sendMessage).mockResolvedValue({ ok: false, status: 403, error: "Join the channel to post" });
    await expect(runSendChatMessage(ctx, { conversationId: "c1", text: "hi" })).rejects.toMatchObject({
      status: 403,
      message: "Join the channel to post",
    });
  });
});

describe("react_to_chat_message", () => {
  it("reports whether the member's reaction is now on", async () => {
    vi.mocked(chat.toggleReaction).mockResolvedValue({ ok: true, data: msg({ reactions: [{ emoji: "👍", userIds: [ME] }] }) });
    await expect(runReactToChatMessage(ctx, { messageId: "m1", emoji: "👍" })).resolves.toMatchObject({ reacted: true });
    vi.mocked(chat.toggleReaction).mockResolvedValue({ ok: true, data: msg({ reactions: [{ emoji: "👍", userIds: ["kiran"] }] }) });
    await expect(runReactToChatMessage(ctx, { messageId: "m1", emoji: "👍" })).resolves.toMatchObject({ reacted: false });
  });

  it("requires a message and an emoji", async () => {
    await expect(runReactToChatMessage(ctx, { emoji: "👍" })).rejects.toMatchObject({ status: 400 });
    await expect(runReactToChatMessage(ctx, { messageId: "m1", emoji: "" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("manage_chat_conversation", () => {
  it("creates a channel with a slugged name and the given people", async () => {
    vi.mocked(chat.createChannel).mockResolvedValue({ ok: true, data: { conversation: conv({ name: "mobile-app" }), messages: [] } });
    const out = await runManageChatConversation(ctx, { action: "create_channel", name: "Mobile App", userIds: ["kiran"] });
    expect(chat.createChannel).toHaveBeenCalledWith(ME, { name: "mobile-app", topic: null, isPrivate: false, memberIds: ["kiran"] });
    expect(out).toMatchObject({ conversation: { title: "#mobile-app", members: [{ id: ME, name: "Sophie Park" }, { id: "kiran", name: "Kiran Jones" }] } });
  });

  it("maps a taken channel name to a 409", async () => {
    vi.mocked(chat.createChannel).mockResolvedValue({ ok: false, status: 409, error: "#general already exists" });
    await expect(runManageChatConversation(ctx, { action: "create_channel", name: "general" })).rejects.toMatchObject({ status: 409 });
  });

  it("opens a DM", async () => {
    vi.mocked(chat.openDirectMessage).mockResolvedValue({ ok: true, data: conv({ kind: "dm", name: null }) });
    const out = await runManageChatConversation(ctx, { action: "open_dm", userIds: ["kiran"] });
    expect(out).toMatchObject({ conversation: { kind: "dm", title: "Kiran Jones" } });
  });

  it("joins, leaves, adds members and marks read by channel name", async () => {
    vi.mocked(prisma.chatConversation.findUnique).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(chat.joinChannel).mockResolvedValue({ ok: true, data: { conversation: conv(), messages: [] } });
    vi.mocked(chat.leaveChannel).mockResolvedValue({ ok: true, data: null });
    vi.mocked(chat.inviteMembers).mockResolvedValue({ ok: true, data: { conversation: conv(), messages: [] } });
    vi.mocked(chat.markRead).mockResolvedValue({ ok: true, data: null });

    await runManageChatConversation(ctx, { action: "join", channel: "dali-os" });
    expect(chat.joinChannel).toHaveBeenCalledWith(ME, "c1");
    await expect(runManageChatConversation(ctx, { action: "leave", channel: "dali-os" })).resolves.toEqual({ ok: true, conversationId: "c1" });
    await runManageChatConversation(ctx, { action: "add_members", channel: "dali-os", userIds: ["yaying"] });
    expect(chat.inviteMembers).toHaveBeenCalledWith(ME, "c1", ["yaying"]);
    await runManageChatConversation(ctx, { action: "mark_read", channel: "dali-os" });
    expect(chat.markRead).toHaveBeenCalledWith(ME, "c1", expect.any(Date));
  });

  it("refuses to leave a default channel", async () => {
    vi.mocked(chat.leaveChannel).mockResolvedValue({ ok: false, status: 400, error: "You can't leave this conversation" });
    await expect(runManageChatConversation(ctx, { action: "leave", conversationId: "general" })).rejects.toMatchObject({ status: 400 });
  });

  it("validates required fields per action and unknown actions", async () => {
    await expect(runManageChatConversation(ctx, { action: "create_channel" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageChatConversation(ctx, { action: "open_dm" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageChatConversation(ctx, { action: "add_members", conversationId: "c1" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageChatConversation(ctx, { action: "archive", conversationId: "c1" })).rejects.toMatchObject({ status: 400 });
  });
});
