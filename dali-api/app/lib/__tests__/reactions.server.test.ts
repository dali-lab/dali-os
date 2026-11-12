import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ customEmoji: { count: vi.fn(), findMany: vi.fn() } }));
const s3 = vi.hoisted(() => ({
  isS3Configured: vi.fn(() => true),
  getDownloadUrl: vi.fn(async (key: string) => `https://s3.test/${key}`),
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/s3", () => s3);

import data from "@emoji-mart/data/sets/15/native.json";
import { addReaction, isStandardEmoji, listCustomEmoji, reactionRefusal, toggleReaction } from "../reactions.server";

beforeEach(() => vi.clearAllMocks());

describe("isStandardEmoji", () => {
  it("accepts plain, keycap, family and flag emoji", () => {
    for (const emoji of ["🔥", "❤️", "1️⃣", "👨‍👩‍👧", "🇺🇸", "👍🏽"]) {
      expect(isStandardEmoji(emoji), emoji).toBe(true);
    }
  });

  it("refuses text, numbers and two emoji", () => {
    for (const value of ["", "a", "1", "🔥🔥", "🔥 ", "<b>"]) {
      expect(isStandardEmoji(value), value).toBe(false);
    }
  });

  // The picker offers these, so one the server refuses would be a dead button.
  it("accepts everything the picker offers", () => {
    const natives = Object.values(data.emojis).map((e) => e.skins[0].native);
    expect(natives.length).toBeGreaterThan(1500);
    expect(natives.filter((n) => !isStandardEmoji(n))).toEqual([]);
  });
});

describe("reactionRefusal", () => {
  it("allows a live custom emoji and refuses an unknown or deleted one", async () => {
    db.customEmoji.count.mockResolvedValue(1);
    expect(await reactionRefusal(":parrot:", [])).toBeNull();
    expect(db.customEmoji.count).toHaveBeenCalledWith({ where: { name: "parrot", deletedAt: null } });
    db.customEmoji.count.mockResolvedValue(0);
    expect(await reactionRefusal(":parrot:", [])).toBe(400);
  });

  it("refuses a custom-looking token with an invalid name without a query", async () => {
    expect(await reactionRefusal(":Not Valid:", [])).toBe(400);
    expect(db.customEmoji.count).not.toHaveBeenCalled();
  });
});

describe("listCustomEmoji", () => {
  const row = (over = {}) => ({
    id: "e1",
    name: "parrot",
    imageKey: "uploads/custom-emoji/a-emoji.gif",
    addedById: "ada",
    addedBy: { firstName: "Ada", lastName: "Lovelace" },
    ...over,
  });

  it("uses a cacheable link and hides deleted rows", async () => {
    db.customEmoji.findMany.mockResolvedValue([row()]);
    const [item] = await listCustomEmoji({ userId: "ada", core: false });
    expect(item).toMatchObject({
      imageUrl: "https://s3.test/uploads/custom-emoji/a-emoji.gif",
      addedBy: "Ada Lovelace",
    });
    expect(s3.getDownloadUrl).toHaveBeenCalledWith(expect.any(String), { cacheFor: 3600 });
    expect(db.customEmoji.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("lets the adder and Core delete, and nobody else", async () => {
    db.customEmoji.findMany.mockResolvedValue([row()]);
    const canDelete = async (userId: string, core: boolean) =>
      (await listCustomEmoji({ userId, core }))[0].canDelete;
    expect(await canDelete("ada", false)).toBe(true);
    expect(await canDelete("grace", true)).toBe(true);
    expect(await canDelete("grace", false)).toBe(false);
  });

  it("copes with an adder whose account is gone", async () => {
    db.customEmoji.findMany.mockResolvedValue([row({ addedById: null, addedBy: null })]);
    const [item] = await listCustomEmoji({ userId: "ada", core: false });
    expect(item).toMatchObject({ addedBy: null, canDelete: false });
  });
});

describe("toggleReaction", () => {
  const store = (removed: number, used: string[] = []) => ({
    remove: vi.fn(async () => removed),
    usedEmoji: vi.fn(async () => used),
    add: vi.fn(async () => ({})),
  });

  it("removes an existing reaction without checking or adding", async () => {
    const s = store(1);
    expect(await toggleReaction(s, "🔥")).toBe("removed");
    expect(s.usedEmoji).not.toHaveBeenCalled();
    expect(s.add).not.toHaveBeenCalled();
  });

  it("adds a valid new reaction", async () => {
    const s = store(0, ["❤️"]);
    expect(await toggleReaction(s, "🔥")).toBe("added");
    expect(s.add).toHaveBeenCalledOnce();
  });

  it("refuses an invalid emoji with 400 and never adds", async () => {
    const s = store(0);
    expect(await toggleReaction(s, "hello")).toBe(400);
    expect(s.add).not.toHaveBeenCalled();
  });

  it("refuses a new emoji past the cap with 409 and never adds", async () => {
    const s = store(0, Array.from({ length: 20 }, (_, i) => `:e${i}:`));
    expect(await toggleReaction(s, "🔥")).toBe(409);
    expect(s.add).not.toHaveBeenCalled();
  });
});

describe("addReaction", () => {
  it("returns null and adds when allowed", async () => {
    const add = vi.fn(async () => ({}));
    expect(await addReaction({ remove: vi.fn(), usedEmoji: async () => [], add }, "🔥")).toBeNull();
    expect(add).toHaveBeenCalledOnce();
  });
});
