import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    chatConversation: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    chatMember: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn(), delete: vi.fn() },
    chatMessage: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    chatReaction: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("~/chat/lib/chat-stream.server", () => ({ publishChatEvent: vi.fn() }));
vi.mock("~/chat/lib/chat-push.server", () => ({ sendChatPush: vi.fn(() => Promise.resolve()) }));

import { prisma } from "~/lib/db";
import { publishChatEvent } from "~/chat/lib/chat-stream.server";
import {
  createChannel,
  ensureDefaultChannels,
  inviteMembers,
  joinChannel,
  leaveChannel,
  listMessages,
  markRead,
  openDirectMessage,
  sendMessage,
  toggleReaction,
} from "~/chat/lib/chat.server";

const db = prisma as unknown as {
  chatConversation: Record<"findUnique" | "findMany" | "create" | "upsert", ReturnType<typeof vi.fn>>;
  chatMember: Record<"findUnique" | "update" | "create" | "createMany" | "delete", ReturnType<typeof vi.fn>>;
  chatMessage: Record<"findUnique" | "findUniqueOrThrow" | "findMany" | "create", ReturnType<typeof vi.fn>>;
  chatReaction: Record<"findUnique" | "create" | "delete", ReturnType<typeof vi.fn>>;
  user: Record<"findMany", ReturnType<typeof vi.fn>>;
};

const created = new Date("2026-10-01T00:00:00Z");

function conversation(overrides: Partial<{ kind: "channel" | "dm"; isPrivate: boolean; isDefault: boolean; memberIds: string[]; name: string | null }> = {}) {
  const { memberIds = ["me"], ...rest } = overrides;
  return {
    id: "c1",
    kind: "channel" as const,
    name: "dali-os",
    isPrivate: false,
    isDefault: false,
    topic: null,
    createdById: "me",
    createdAt: created,
    members: memberIds.map((userId) => ({ userId, lastReadAt: created })),
    ...rest,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    conversationId: "c1",
    authorId: "me",
    text: "hi",
    createdAt: new Date("2026-10-21T15:00:00Z"),
    parentId: null,
    kind: "user" as const,
    reactions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.chatMessage.findMany.mockResolvedValue([]);
  db.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, firstName: id.toUpperCase() })),
  );
});

describe("sendMessage", () => {
  it("posts for a member, moves their read marker, and notifies members", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["me", "kiran"] }));
    db.chatMessage.create.mockResolvedValue(messageRow());

    const result = await sendMessage("me", "c1", "hi", undefined);

    expect(result).toMatchObject({ ok: true, data: { id: "m1", text: "hi", reactions: [], kind: "user" } });
    expect(db.chatMember.update).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "c1", userId: "me" } },
      data: { lastReadAt: new Date("2026-10-21T15:00:00Z") },
    });
    expect(publishChatEvent).toHaveBeenCalledWith(["me", "kiran"], "message", "c1");
  });

  it("refuses a non-member of a public channel with 403", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["kiran"] }));
    expect(await sendMessage("me", "c1", "hi", undefined)).toEqual({ ok: false, status: 403, error: "Join the channel to post" });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });

  it("hides private channels and DMs from non-members with 404", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ isPrivate: true, memberIds: ["kiran"] }));
    expect(await sendMessage("me", "c1", "hi", undefined)).toMatchObject({ ok: false, status: 404 });
    db.chatConversation.findUnique.mockResolvedValue(conversation({ kind: "dm", isPrivate: true, memberIds: ["kiran", "carson"] }));
    expect(await sendMessage("me", "c1", "hi", undefined)).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects replies to a message in another conversation or to a reply", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation());
    db.chatMessage.findUnique.mockResolvedValue({ conversationId: "other", parentId: null });
    expect(await sendMessage("me", "c1", "hi", "p1")).toEqual({ ok: false, status: 400, error: "Invalid thread" });
    db.chatMessage.findUnique.mockResolvedValue({ conversationId: "c1", parentId: "root" });
    expect(await sendMessage("me", "c1", "hi", "p1")).toEqual({ ok: false, status: 400, error: "Invalid thread" });
  });

  it("accepts a reply to a root message in the same conversation", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation());
    db.chatMessage.findUnique.mockResolvedValue({ conversationId: "c1", parentId: null });
    db.chatMessage.create.mockResolvedValue(messageRow({ parentId: "p1" }));
    expect(await sendMessage("me", "c1", "hi", "p1")).toMatchObject({ ok: true, data: { parentId: "p1" } });
  });
});

describe("listMessages", () => {
  it("lets a non-member preview a public channel", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["kiran"] }));
    expect(await listMessages("me", "c1")).toEqual({ ok: true, data: [] });
  });

  it("returns roots oldest first followed by their replies", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation());
    db.chatMessage.findMany
      .mockResolvedValueOnce([messageRow({ id: "r2" }), messageRow({ id: "r1" })])
      .mockResolvedValueOnce([messageRow({ id: "x1", parentId: "r1" })]);
    const result = await listMessages("me", "c1");
    expect(result.ok && result.data.map((m) => m.id)).toEqual(["r1", "r2", "x1"]);
  });

  it("404s a missing conversation", async () => {
    db.chatConversation.findUnique.mockResolvedValue(null);
    expect(await listMessages("me", "nope")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("toggleReaction", () => {
  beforeEach(() => {
    db.chatMessage.findUnique.mockResolvedValue({ conversationId: "c1" });
    db.chatConversation.findUnique.mockResolvedValue(conversation());
    db.chatMessage.findUniqueOrThrow.mockResolvedValue(messageRow());
  });

  it("adds the viewer's reaction when absent", async () => {
    db.chatReaction.findUnique.mockResolvedValue(null);
    await toggleReaction("me", "m1", "🔥");
    expect(db.chatReaction.create).toHaveBeenCalledWith({ data: { messageId: "m1", userId: "me", emoji: "🔥" } });
    expect(db.chatReaction.delete).not.toHaveBeenCalled();
  });

  it("removes the viewer's reaction when present", async () => {
    db.chatReaction.findUnique.mockResolvedValue({ id: "r1" });
    await toggleReaction("me", "m1", "🔥");
    expect(db.chatReaction.delete).toHaveBeenCalledWith({
      where: { messageId_userId_emoji: { messageId: "m1", userId: "me", emoji: "🔥" } },
    });
    expect(db.chatReaction.create).not.toHaveBeenCalled();
  });

  it("requires membership", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["kiran"] }));
    expect(await toggleReaction("me", "m1", "🔥")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("openDirectMessage", () => {
  it("returns the existing DM with exactly the same members", async () => {
    db.chatConversation.findMany.mockResolvedValue([
      { ...conversation({ kind: "dm", isPrivate: true, memberIds: ["me", "kiran", "carson"], name: null }), id: "group" },
      { ...conversation({ kind: "dm", isPrivate: true, memberIds: ["kiran", "me"], name: null }), id: "pair" },
    ]);
    const result = await openDirectMessage("me", ["kiran"]);
    expect(result).toMatchObject({ ok: true, data: { id: "pair" } });
    expect(db.chatConversation.create).not.toHaveBeenCalled();
  });

  it("creates a new DM when only a superset exists", async () => {
    db.chatConversation.findMany.mockResolvedValue([
      conversation({ kind: "dm", isPrivate: true, memberIds: ["me", "kiran", "carson"], name: null }),
    ]);
    db.chatConversation.create.mockResolvedValue({
      ...conversation({ kind: "dm", isPrivate: true, memberIds: ["kiran", "me"], name: null }),
      id: "new",
    });
    const result = await openDirectMessage("me", ["kiran"]);
    expect(result).toMatchObject({ ok: true, data: { id: "new", kind: "dm" } });
    expect(db.chatConversation.create.mock.calls[0][0].data.members.create).toEqual([{ userId: "kiran" }, { userId: "me" }]);
  });

  it("rejects a DM with nobody else", async () => {
    expect(await openDirectMessage("me", ["me"])).toMatchObject({ ok: false, status: 400 });
  });
});

describe("joinChannel / leaveChannel", () => {
  it("joins a public channel with a system message", async () => {
    db.chatConversation.findUnique
      .mockResolvedValueOnce(conversation({ memberIds: ["kiran"] }))
      .mockResolvedValueOnce(conversation({ memberIds: ["kiran", "me"] }));
    db.chatMessage.create.mockResolvedValue({ createdAt: created });
    const result = await joinChannel("me", "c1");
    expect(result).toMatchObject({ ok: true, data: { conversation: { memberIds: ["kiran", "me"] } } });
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: { conversationId: "c1", authorId: "me", text: "joined the channel", kind: "system" },
    });
  });

  it("can't join a private channel it can't see", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ isPrivate: true, memberIds: ["kiran"] }));
    expect(await joinChannel("me", "c1")).toMatchObject({ ok: false, status: 404 });
  });

  it("can't leave a default channel or a DM", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ isDefault: true }));
    expect(await leaveChannel("me", "c1")).toMatchObject({ ok: false, status: 400 });
    db.chatConversation.findUnique.mockResolvedValue(conversation({ kind: "dm", isPrivate: true }));
    expect(await leaveChannel("me", "c1")).toMatchObject({ ok: false, status: 400 });
    expect(db.chatMember.delete).not.toHaveBeenCalled();
  });

  it("leaves a regular channel with a system message", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["me", "kiran"] }));
    expect(await leaveChannel("me", "c1")).toEqual({ ok: true, data: null });
    expect(db.chatMember.delete).toHaveBeenCalled();
    expect(publishChatEvent).toHaveBeenCalledWith(["me", "kiran"], "conversation", "c1");
  });
});

describe("createChannel", () => {
  it("refuses a taken name", async () => {
    db.chatConversation.findUnique.mockResolvedValue({ id: "x" });
    expect(await createChannel("me", { name: "general", topic: null, isPrivate: false, memberIds: [] })).toEqual({
      ok: false,
      status: 409,
      error: "#general already exists",
    });
  });

  it("creates with the creator plus active invitees and a created message", async () => {
    db.chatConversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(conversation({ memberIds: ["me", "kiran"], name: "crits" }));
    db.chatConversation.create.mockResolvedValue({ id: "c1" });
    const result = await createChannel("me", { name: "crits", topic: null, isPrivate: true, memberIds: ["kiran", "me"] });
    expect(result.ok).toBe(true);
    expect(db.chatConversation.create.mock.calls[0][0].data.members.create).toEqual([{ userId: "me" }, { userId: "kiran" }]);
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: { conversationId: "c1", authorId: "me", text: "created #crits", kind: "system" },
    });
  });
});

describe("inviteMembers", () => {
  it("adds only new people and announces them by first name", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["me", "kiran"] }));
    await inviteMembers("me", "c1", ["kiran", "carson"]);
    expect(db.chatMember.createMany).toHaveBeenCalledWith({
      data: [{ conversationId: "c1", userId: "carson" }],
      skipDuplicates: true,
    });
    expect(db.chatMessage.create).toHaveBeenCalledWith({
      data: { conversationId: "c1", authorId: "me", text: "added CARSON", kind: "system" },
    });
  });

  it("doesn't let a non-member add people", async () => {
    db.chatConversation.findUnique.mockResolvedValue(conversation({ memberIds: ["kiran"] }));
    expect(await inviteMembers("me", "c1", ["carson"])).toMatchObject({ ok: false, status: 403 });
  });
});

describe("markRead", () => {
  const now = new Date("2026-10-21T15:00:00Z");

  it("moves the marker forward", async () => {
    db.chatMember.findUnique.mockResolvedValue({ lastReadAt: new Date("2026-10-21T12:00:00Z") });
    await markRead("me", "c1", new Date("2026-10-21T14:00:00Z"), now);
    expect(db.chatMember.update).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "c1", userId: "me" } },
      data: { lastReadAt: new Date("2026-10-21T14:00:00Z") },
    });
  });

  it("does not move the marker backward", async () => {
    db.chatMember.findUnique.mockResolvedValue({ lastReadAt: new Date("2026-10-21T12:00:00Z") });
    expect(await markRead("me", "c1", new Date("2026-10-21T10:00:00Z"), now)).toEqual({ ok: true, data: null });
    expect(db.chatMember.update).not.toHaveBeenCalled();
  });

  it("404s for non-members", async () => {
    db.chatMember.findUnique.mockResolvedValue(null);
    expect(await markRead("me", "c1", now, now)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("ensureDefaultChannels", () => {
  it("creates #general once and joins the viewer idempotently", async () => {
    db.chatConversation.findUnique.mockResolvedValue(null);
    db.chatConversation.upsert.mockResolvedValue({ id: "gen" });
    await ensureDefaultChannels("me");
    expect(db.chatConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "general" }, update: {} }),
    );
    expect(db.chatMember.createMany).toHaveBeenCalledWith({
      data: [{ conversationId: "gen", userId: "me" }],
      skipDuplicates: true,
    });
  });

  it("reuses an existing #general", async () => {
    db.chatConversation.findUnique.mockResolvedValue({ id: "gen" });
    await ensureDefaultChannels("me");
    expect(db.chatConversation.upsert).not.toHaveBeenCalled();
    expect(db.chatMember.createMany).toHaveBeenCalled();
  });
});
