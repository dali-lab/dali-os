import { describe, expect, it } from "vitest";
import { emojiNameFromFile, emojiSections } from "../EmojiPicker";
import type { CustomEmojiItem } from "~/lib/reactions.server";

const data = {
  categories: [
    { id: "people", emojis: ["grin", "wave"] },
    { id: "foods", emojis: ["pizza", "missing"] },
  ],
  emojis: {
    grin: { name: "Grinning Face", keywords: ["happy", "smile"], skins: [{ native: "😀" }] },
    wave: { name: "Waving Hand", keywords: ["hello"], skins: [{ native: "👋" }] },
    pizza: { name: "Pizza", keywords: ["food"], skins: [{ native: "🍕" }] },
  },
};

const parrot: CustomEmojiItem = {
  id: "e1",
  name: "party-parrot",
  imageUrl: "/p.gif",
  addedBy: "Ada Lovelace",
  canDelete: true,
};

describe("emojiSections", () => {
  it("puts custom first, then labelled categories, skipping ids with no data", () => {
    const sections = emojiSections(data, [parrot], "");
    expect(sections.map((s) => s.label)).toEqual(["Custom", "Smileys and people", "Food and drink"]);
    expect(sections[0].tiles[0]).toMatchObject({ emoji: ":party-parrot:", imageUrl: "/p.gif" });
    expect(sections[2].tiles.map((t) => t.emoji)).toEqual(["🍕"]);
  });

  it("drops the custom section when there are none", () => {
    expect(emojiSections(data, [], "").map((s) => s.id)).toEqual(["people", "foods"]);
  });

  it("searches names and keywords, every word having to match", () => {
    const emoji = (q: string) => emojiSections(data, [], q).flatMap((s) => s.tiles.map((t) => t.emoji));
    expect(emoji("pizza")).toEqual(["🍕"]);
    expect(emoji("HAPPY")).toEqual(["😀"]);
    expect(emoji("grinning smile")).toEqual(["😀"]);
    expect(emoji("grinning pizza")).toEqual([]);
  });

  it("searches custom emoji by name, ahead of standard ones", () => {
    const hits = emojiSections(data, [parrot], "p").flatMap((s) => s.tiles.map((t) => t.emoji));
    expect(hits[0]).toBe(":party-parrot:");
  });

  it("has only custom emoji while the data loads", () => {
    expect(emojiSections(null, [parrot], "").map((s) => s.id)).toEqual(["custom"]);
    expect(emojiSections(null, [], "")).toEqual([]);
  });
});

describe("emojiNameFromFile", () => {
  it("makes a valid name out of a filename", () => {
    expect(emojiNameFromFile("Party Parrot (1).png")).toBe("party-parrot-1");
    expect(emojiNameFromFile("already_ok.gif")).toBe("already_ok");
    expect(emojiNameFromFile(`${"x".repeat(60)}.png`)).toHaveLength(48);
  });
});
