import { describe, it, expect } from "vitest";
import { groupReactions } from "../DaliThreadStore";

describe("groupReactions", () => {
  it("returns empty array for no reactions", () => {
    expect(groupReactions([])).toEqual([]);
  });

  it("groups multiple users on the same emoji into one entry", () => {
    const rows = [
      { userId: "user-1", emoji: "👍", createdAt: "2026-08-01T10:00:00Z" },
      { userId: "user-2", emoji: "👍", createdAt: "2026-08-01T11:00:00Z" },
    ];
    const result = groupReactions(rows);
    expect(result).toHaveLength(1);
    expect(result[0].emoji).toBe("👍");
    expect(result[0].userIds).toEqual(["user-1", "user-2"]);
    // earliest createdAt wins
    expect(result[0].createdAt).toEqual(new Date("2026-08-01T10:00:00Z"));
  });

  it("produces separate entries for different emojis", () => {
    const rows = [
      { userId: "user-1", emoji: "👍", createdAt: "2026-08-01T10:00:00Z" },
      { userId: "user-1", emoji: "❤️", createdAt: "2026-08-01T12:00:00Z" },
    ];
    const result = groupReactions(rows);
    expect(result).toHaveLength(2);
    const emojis = result.map((r) => r.emoji);
    expect(emojis).toContain("👍");
    expect(emojis).toContain("❤️");
  });

  it("picks the earliest createdAt when rows are out of order", () => {
    const rows = [
      { userId: "user-2", emoji: "🎉", createdAt: "2026-08-01T15:00:00Z" },
      { userId: "user-1", emoji: "🎉", createdAt: "2026-08-01T09:00:00Z" },
    ];
    const result = groupReactions(rows);
    expect(result[0].createdAt).toEqual(new Date("2026-08-01T09:00:00Z"));
    // Both users included
    expect(result[0].userIds).toContain("user-1");
    expect(result[0].userIds).toContain("user-2");
  });

  it("handles a single reaction correctly", () => {
    const rows = [
      { userId: "user-1", emoji: "🚀", createdAt: "2026-08-01T00:00:00Z" },
    ];
    const result = groupReactions(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      emoji: "🚀",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      userIds: ["user-1"],
    });
  });

  it("handles mixed emojis and multiple users", () => {
    const rows = [
      { userId: "a", emoji: "👍", createdAt: "2026-08-01T01:00:00Z" },
      { userId: "b", emoji: "👍", createdAt: "2026-08-01T02:00:00Z" },
      { userId: "a", emoji: "❤️", createdAt: "2026-08-01T03:00:00Z" },
      { userId: "c", emoji: "❤️", createdAt: "2026-08-01T04:00:00Z" },
    ];
    const result = groupReactions(rows);
    expect(result).toHaveLength(2);
    const byEmoji = Object.fromEntries(result.map((r) => [r.emoji, r]));
    expect(byEmoji["👍"].userIds).toEqual(["a", "b"]);
    expect(byEmoji["❤️"].userIds).toEqual(["a", "c"]);
  });
});
