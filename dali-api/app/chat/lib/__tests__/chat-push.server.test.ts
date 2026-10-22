import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    mobilePushToken: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  EXPO_PUSH_URL,
  PUSH_BODY_MAX,
  chunk,
  deadTokens,
  deliverPushes,
  mentionsHandle,
  pushAllowed,
  pushBody,
  pushRecipientIds,
  pushTitle,
  sendChatPush,
  truncate,
  type ExpoPushMessage,
} from "~/chat/lib/chat-push.server";

const db = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
  chatMessage: { findMany: ReturnType<typeof vi.fn> };
  mobilePushToken: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};

const ENV_KEYS = ["DALI_APP_ENV", "NOTIFY_PUSH_OVERRIDE"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.DALI_APP_ENV = "prod";
  delete process.env.NOTIFY_PUSH_OVERRIDE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const base = {
  messageKind: "user" as const,
  memberIds: ["author", "a", "b", "c"],
  authorId: "author",
  text: "hello",
  handles: { author: "me", a: "alice", b: "bob", c: null } as Record<string, string | null>,
  threadParticipantIds: [] as string[],
};

describe("mentionsHandle", () => {
  it.each([
    ["@alice can you look", true],
    ["hey @ALICE", true],
    ["(@alice)", true],
    ["thanks @alice.", true],
    ["@alice, @bob", true],
    ["@alicex", false],
    ["@alice-smith", false],
    ["email alice@alice.com", false],
    ["@@alice", false],
    ["alice", false],
  ])("%s → %s", (text, expected) => {
    expect(mentionsHandle(text, "alice")).toBe(expected);
  });

  it("escapes regex characters in handles", () => {
    expect(mentionsHandle("hi @a.b", "a.b")).toBe(true);
    expect(mentionsHandle("hi @axb", "a.b")).toBe(false);
  });

  it("never matches an empty handle", () => {
    expect(mentionsHandle("@ hi", "")).toBe(false);
  });
});

describe("pushRecipientIds", () => {
  it("sends every DM message to all other members", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "dm" })).toEqual(["a", "b", "c"]);
  });

  it("only notifies mentioned members in channels", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "channel", text: "@bob ping" })).toEqual(["b"]);
  });

  it("notifies nobody for an unmentioned channel message", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "channel" })).toEqual([]);
  });

  it("notifies thread participants on replies", () => {
    expect(
      pushRecipientIds({ ...base, conversationKind: "channel", threadParticipantIds: ["c", "author", "a"] }),
    ).toEqual(["a", "c"]);
  });

  it("ignores thread participants who left the conversation", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "channel", threadParticipantIds: ["gone"] })).toEqual([]);
  });

  it("never notifies the author, even when they mention themselves", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "channel", text: "@me note to self" })).toEqual([]);
    expect(pushRecipientIds({ ...base, conversationKind: "dm" })).not.toContain("author");
  });

  it("never notifies for system messages", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "dm", messageKind: "system" })).toEqual([]);
  });

  it("dedupes repeated member ids", () => {
    expect(pushRecipientIds({ ...base, conversationKind: "dm", memberIds: ["author", "a", "a"] })).toEqual(["a"]);
  });
});

describe("payload formatting", () => {
  it("titles channels with their name", () => {
    expect(pushTitle({ conversationKind: "channel", channelName: "dali-os", senderName: "Kiran Jones", otherMemberFirstNames: [] })).toBe("#dali-os");
  });

  it("titles 1:1 DMs with the sender", () => {
    expect(pushTitle({ conversationKind: "dm", channelName: null, senderName: "Kiran Jones", otherMemberFirstNames: ["Sophie"] })).toBe("Kiran Jones");
  });

  it("titles group DMs with the sender and the others", () => {
    expect(
      pushTitle({ conversationKind: "dm", channelName: null, senderName: "Kiran Jones", otherMemberFirstNames: ["Sophie", "Carson"] }),
    ).toBe("Kiran Jones in Sophie, Carson");
  });

  it("prefixes channel bodies with the sender", () => {
    expect(pushBody("channel", "Kiran Jones", "hi")).toBe("Kiran Jones: hi");
    expect(pushBody("dm", "Kiran Jones", "hi")).toBe("hi");
  });

  it("truncates long bodies with an ellipsis at the limit", () => {
    const out = truncate("x".repeat(500));
    expect(out).toHaveLength(PUSH_BODY_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses whitespace and leaves short text alone", () => {
    expect(truncate("  a\n\n b  ")).toBe("a b");
  });
});

describe("chunk", () => {
  it("splits into batches of at most 100", () => {
    const batches = chunk(Array.from({ length: 250 }, (_, i) => i));
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("returns no batches for no items", () => {
    expect(chunk([])).toEqual([]);
  });
});

function msg(to: string): ExpoPushMessage {
  return { to, title: "t", body: "b", data: { conversationId: "c", messageId: "m", parentId: null }, sound: "default", threadId: "c" };
}

describe("deadTokens", () => {
  it("returns tokens whose ticket says DeviceNotRegistered, by position", () => {
    expect(
      deadTokens([msg("t1"), msg("t2"), msg("t3")], [
        { status: "ok", id: "1" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
        { status: "error", details: { error: "MessageRateExceeded" } },
      ]),
    ).toEqual(["t2"]);
  });
});

function okFetch(ticketsFor: (batch: ExpoPushMessage[]) => unknown[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(init.body as string) as ExpoPushMessage[];
    return new Response(JSON.stringify({ data: ticketsFor(batch) }), { status: 200 });
  });
}

describe("deliverPushes", () => {
  it("posts batches to Expo and removes unregistered devices", async () => {
    const messages = Array.from({ length: 101 }, (_, i) => msg(`t${i}`));
    const fetchImpl = okFetch((batch) =>
      batch.map((m) => (m.to === "t5" ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: m.to })),
    );
    const result = await deliverPushes(messages, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(result).toEqual({ sent: 100, removed: 1 });
    expect(db.mobilePushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ["t5"] } } });
  });

  it("skips cleanup when nothing is dead and survives a failed batch", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await deliverPushes([msg("t1")], fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ sent: 0, removed: 0 });
    expect(db.mobilePushToken.deleteMany).not.toHaveBeenCalled();
    expect(spy.mock.calls.flat().join(" ")).not.toContain("t1");
    spy.mockRestore();
  });
});

describe("pushAllowed", () => {
  it("allows prod and the override only", () => {
    expect(pushAllowed()).toBe(true);
    process.env.DALI_APP_ENV = "staging";
    expect(pushAllowed()).toBe(false);
    process.env.NOTIFY_PUSH_OVERRIDE = "1";
    expect(pushAllowed()).toBe(true);
  });
});

describe("sendChatPush", () => {
  const conversation = { id: "c1", kind: "dm" as const, name: null, memberIds: ["author", "a"] };
  const message = { id: "m1", authorId: "author", text: "hey", parentId: null, kind: "user" as const };

  beforeEach(() => {
    db.user.findMany.mockResolvedValue([
      { id: "author", firstName: "Kiran", lastName: "Jones", handle: "kjones" },
      { id: "a", firstName: "Sophie", lastName: "Park", handle: "spark" },
    ]);
    db.chatMessage.findMany.mockResolvedValue([]);
    db.mobilePushToken.findMany.mockResolvedValue([{ token: "tokA" }]);
  });

  it("sends the DM to the other member's devices", async () => {
    const fetchImpl = okFetch((batch) => batch.map(() => ({ status: "ok", id: "x" })));
    await sendChatPush(conversation, message, fetchImpl as unknown as typeof fetch);
    expect(db.mobilePushToken.findMany).toHaveBeenCalledWith({ where: { userId: { in: ["a"] } }, select: { token: true } });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as ExpoPushMessage[];
    expect(sent).toEqual([
      {
        to: "tokA",
        title: "Kiran Jones",
        body: "hey",
        data: { conversationId: "c1", messageId: "m1", parentId: null },
        sound: "default",
        threadId: "c1",
      },
    ]);
  });

  it("does nothing outside prod without the override", async () => {
    process.env.DALI_APP_ENV = "staging";
    const fetchImpl = vi.fn();
    await sendChatPush(conversation, message, fetchImpl as unknown as typeof fetch);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing for system messages", async () => {
    const fetchImpl = vi.fn();
    await sendChatPush(conversation, { ...message, kind: "system" }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("looks up thread participants for replies", async () => {
    db.chatMessage.findMany.mockResolvedValue([{ authorId: "a" }]);
    const fetchImpl = okFetch((batch) => batch.map(() => ({ status: "ok", id: "x" })));
    await sendChatPush(
      { ...conversation, kind: "channel", name: "dali-os" },
      { ...message, parentId: "root" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(db.chatMessage.findMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "root" }, { parentId: "root" }] },
      select: { authorId: true },
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as ExpoPushMessage[];
    expect(sent[0]).toMatchObject({ title: "#dali-os", body: "Kiran Jones: hey", data: { parentId: "root" } });
  });

  it("skips Expo entirely when recipients have no devices", async () => {
    db.mobilePushToken.findMany.mockResolvedValue([]);
    const fetchImpl = vi.fn();
    await sendChatPush(conversation, message, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
