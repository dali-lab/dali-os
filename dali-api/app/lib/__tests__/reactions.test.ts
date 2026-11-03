import { describe, expect, it } from "vitest";
import {
  MAX_REACTION_EMOJI,
  customEmojiName,
  hasRoomForReaction,
  reactionSentence,
  summarizeReactions,
  toggleReaction,
} from "../reactions";

const at = (day: number) => new Date(Date.UTC(2026, 2, day));

describe("summarizeReactions", () => {
  it("orders chips by first reaction and marks the viewer's own", () => {
    const rows = [
      { emoji: "👍", userId: "me", createdAt: at(3) },
      { emoji: "🚀", userId: "a", createdAt: at(1) },
      { emoji: "👍", userId: "b", createdAt: at(2) },
    ];
    expect(summarizeReactions(rows, "me")).toEqual([
      { emoji: "🚀", count: 1, mine: false },
      { emoji: "👍", count: 2, mine: true },
    ]);
  });

  it("keeps an emoji outside any palette", () => {
    const rows = [{ emoji: ":parrot:", userId: "a", createdAt: at(1) }];
    expect(summarizeReactions(rows, "me")[0].emoji).toBe(":parrot:");
  });

  it("lists names without the viewer, only when they were loaded", () => {
    const named = [
      { emoji: "👍", userId: "me", createdAt: at(1), user: { firstName: "Me", lastName: "Self" } },
      { emoji: "👍", userId: "a", createdAt: at(2), user: { firstName: "Ada", lastName: "Lovelace" } },
    ];
    expect(summarizeReactions(named, "me")[0].people).toEqual(["Ada Lovelace"]);
    expect(summarizeReactions([{ emoji: "👍", userId: "a", createdAt: at(1) }], "me")[0]).not.toHaveProperty(
      "people",
    );
  });

  it("returns nothing for a post without reactions", () => {
    expect(summarizeReactions([], "me")).toEqual([]);
  });
});

describe("reactionSentence", () => {
  const sentence = (people: string[] | undefined, mine = false, count = (people?.length ?? 0) + (mine ? 1 : 0)) =>
    reactionSentence({ emoji: "👍", count, mine, people });

  it("has nothing to say without names", () => {
    expect(sentence(undefined, false, 3)).toBeNull();
  });

  it("reads naturally for one, two and three people", () => {
    expect(sentence(["Ada"])).toBe("Ada reacted with 👍");
    expect(sentence([], true)).toBe("You reacted with 👍");
    expect(sentence(["Ada"], true)).toBe("Ada and you reacted with 👍");
    expect(sentence(["Ada", "Grace"], true)).toBe("Ada, Grace and you reacted with 👍");
  });

  it("stops at five names and counts the rest", () => {
    const six = ["A", "B", "C", "D", "E", "F"];
    expect(sentence(six)).toBe("A, B, C, D, E and 1 other reacted with 👍");
    expect(sentence([...six, "G"], true)).toBe("A, B, C, D, you and 3 others reacted with 👍");
  });

  it("uses a custom emoji's token", () => {
    expect(reactionSentence({ emoji: ":parrot:", count: 1, mine: false, people: ["Ada"] })).toBe(
      "Ada reacted with :parrot:",
    );
  });
});

describe("toggleReaction", () => {
  it("adds a new emoji at the end, with its image", () => {
    expect(toggleReaction([{ emoji: "🎉", count: 2, mine: false }], ":parrot:", "/p.gif")).toEqual([
      { emoji: "🎉", count: 2, mine: false },
      { emoji: ":parrot:", count: 1, mine: true, people: [], imageUrl: "/p.gif" },
    ]);
  });

  it("joins someone else's reaction", () => {
    expect(toggleReaction([{ emoji: "🔥", count: 2, mine: false }], "🔥")).toEqual([
      { emoji: "🔥", count: 3, mine: true },
    ]);
  });

  it("takes the viewer's back and drops an emptied chip", () => {
    expect(toggleReaction([{ emoji: "🔥", count: 3, mine: true }], "🔥")).toEqual([
      { emoji: "🔥", count: 2, mine: false },
    ]);
    expect(toggleReaction([{ emoji: "🔥", count: 1, mine: true }], "🔥")).toEqual([]);
  });
});

describe("customEmojiName", () => {
  it("reads a token and ignores everything else", () => {
    expect(customEmojiName(":party-parrot:")).toBe("party-parrot");
    expect(customEmojiName("🔥")).toBeNull();
    expect(customEmojiName(":Not Valid:")).toBeNull();
    expect(customEmojiName("::")).toBeNull();
  });
});

describe("hasRoomForReaction", () => {
  const full = Array.from({ length: MAX_REACTION_EMOJI }, (_, i) => `:e${i}:`);

  it("allows a new emoji under the cap", () => {
    expect(hasRoomForReaction(full.slice(1), "🔥")).toBe(true);
  });

  it("refuses a new emoji at the cap but not one already on the post", () => {
    expect(hasRoomForReaction(full, "🔥")).toBe(false);
    expect(hasRoomForReaction(full, ":e0:")).toBe(true);
  });
});
