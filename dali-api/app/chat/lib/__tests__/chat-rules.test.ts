import { describe, expect, it } from "vitest";
import {
  addedMembersText,
  canInvite,
  canJoin,
  canLeave,
  canPost,
  canView,
  createChannelSchema,
  dmMemberKey,
  dmMemberSet,
  groupReactions,
  nextReadMarker,
  readSchema,
  sendMessageSchema,
  toChannelSlug,
} from "~/chat/lib/chat-rules";

const publicChannel = { kind: "channel" as const, isPrivate: false, isDefault: false };
const privateChannel = { kind: "channel" as const, isPrivate: true, isDefault: false };
const defaultChannel = { kind: "channel" as const, isPrivate: false, isDefault: true };
const dm = { kind: "dm" as const, isPrivate: true, isDefault: false };

describe("access rules", () => {
  it("lets anyone view a public channel but only members view private channels and DMs", () => {
    expect(canView(publicChannel, false)).toBe(true);
    expect(canView(privateChannel, false)).toBe(false);
    expect(canView(dm, false)).toBe(false);
    expect(canView(privateChannel, true)).toBe(true);
    expect(canView(dm, true)).toBe(true);
  });

  it("only lets members post", () => {
    expect(canPost(publicChannel, false)).toBe(false);
    expect(canPost(publicChannel, true)).toBe(true);
    expect(canPost(dm, true)).toBe(true);
  });

  it("only lets non-members join public channels", () => {
    expect(canJoin(publicChannel, false)).toBe(true);
    expect(canJoin(publicChannel, true)).toBe(false);
    expect(canJoin(privateChannel, false)).toBe(false);
    expect(canJoin(dm, false)).toBe(false);
  });

  it("forbids leaving default channels and DMs", () => {
    expect(canLeave(publicChannel, true)).toBe(true);
    expect(canLeave(privateChannel, true)).toBe(true);
    expect(canLeave(defaultChannel, true)).toBe(false);
    expect(canLeave(dm, true)).toBe(false);
    expect(canLeave(publicChannel, false)).toBe(false);
  });

  it("only lets channel members add people", () => {
    expect(canInvite(publicChannel, true)).toBe(true);
    expect(canInvite(publicChannel, false)).toBe(false);
    expect(canInvite(dm, true)).toBe(false);
  });
});

describe("toChannelSlug", () => {
  it.each([
    ["Design Crits", "design-crits"],
    ["  #Hello   World! ", "hello-world"],
    ["snake_case-ok", "snake_case-ok"],
    ["émoji 🎉 party", "moji-party"],
    ["a".repeat(60), "a".repeat(40)],
    ["!!!", ""],
  ])("slugifies %j to %j", (input, expected) => {
    expect(toChannelSlug(input)).toBe(expected);
  });
});

describe("DM member sets", () => {
  it("includes the viewer once and sorts", () => {
    expect(dmMemberSet("me", ["b", "a", "me", "b"])).toEqual(["a", "b", "me"]);
  });

  it("keys identical member sets the same regardless of order or duplicates", () => {
    expect(dmMemberKey(["b", "a", "me"])).toBe(dmMemberKey(["me", "a", "b", "a"]));
  });

  it("keys a superset differently", () => {
    expect(dmMemberKey(["me", "a"])).not.toBe(dmMemberKey(["me", "a", "b"]));
  });
});

describe("nextReadMarker", () => {
  const now = new Date("2026-10-21T15:00:00Z");
  const current = new Date("2026-10-21T12:00:00Z");

  it("moves forward", () => {
    const at = new Date("2026-10-21T13:00:00Z");
    expect(nextReadMarker(current, at, now)).toEqual(at);
  });

  it("never moves backward", () => {
    expect(nextReadMarker(current, new Date("2026-10-21T11:00:00Z"), now)).toEqual(current);
  });

  it("caps future timestamps at now", () => {
    expect(nextReadMarker(current, new Date("2027-01-01T00:00:00Z"), now)).toEqual(now);
  });
});

describe("groupReactions", () => {
  it("groups by emoji in first-reaction order without duplicate users", () => {
    const t = (m: number) => new Date(2026, 0, 1, 0, m);
    expect(
      groupReactions([
        { emoji: "🔥", userId: "b", createdAt: t(2) },
        { emoji: "👍", userId: "a", createdAt: t(1) },
        { emoji: "👍", userId: "c", createdAt: t(3) },
        { emoji: "👍", userId: "a", createdAt: t(4) },
      ]),
    ).toEqual([
      { emoji: "👍", userIds: ["a", "c"] },
      { emoji: "🔥", userIds: ["b"] },
    ]);
  });

  it("returns an empty list for no reactions", () => {
    expect(groupReactions([])).toEqual([]);
  });
});

describe("addedMembersText", () => {
  it("lists first names", () => {
    expect(addedMembersText(["Kiran", "Carson"])).toBe("added Kiran, Carson");
  });
});

describe("request schemas", () => {
  it("trims message text and rejects empty or oversized text", () => {
    expect(sendMessageSchema.parse({ text: "  hi  " })).toEqual({ text: "hi" });
    expect(sendMessageSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ text: "x".repeat(4001) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ text: "x".repeat(4000) }).success).toBe(true);
  });

  it("slugifies channel names and rejects names with nothing left", () => {
    expect(createChannelSchema.parse({ name: "Design Crits", isPrivate: false })).toEqual({
      name: "design-crits",
      topic: null,
      isPrivate: false,
      memberIds: [],
    });
    expect(createChannelSchema.safeParse({ name: "!!!", isPrivate: false }).success).toBe(false);
  });

  it("normalizes a blank topic to null and trims a real one", () => {
    expect(createChannelSchema.parse({ name: "x", topic: "  ", isPrivate: true }).topic).toBeNull();
    expect(createChannelSchema.parse({ name: "x", topic: " hi ", isPrivate: true }).topic).toBe("hi");
  });

  it("requires an ISO timestamp for read markers", () => {
    expect(readSchema.safeParse({ at: "2026-10-21T15:00:00.000Z" }).success).toBe(true);
    expect(readSchema.safeParse({ at: "yesterday" }).success).toBe(false);
  });
});
