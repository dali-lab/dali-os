import { describe, expect, it } from "vitest";
import { visibleRows, type LeaderboardEntry, type LeaderboardState } from "~/hooks/useLeaderboard";

const entry = (rank: number, userId = `u${rank}`): LeaderboardEntry => ({
  rank,
  userId,
  name: userId,
  score: 1000 - rank,
  achievedAt: "2026-10-19T00:00:00Z",
});

const board = (entries: LeaderboardEntry[], you: LeaderboardEntry | null): LeaderboardState => ({
  entries,
  you,
  loading: false,
  available: true,
  personalBest: false,
});

const ten = Array.from({ length: 10 }, (_, i) => entry(i + 1));

describe("visibleRows", () => {
  it("cuts the board to the limit", () => {
    expect(visibleRows(board(ten, null), 5).shown.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows every place without a limit", () => {
    expect(visibleRows(board(ten, null)).shown).toHaveLength(10);
  });

  it("adds no trailing row when the caller placed within the limit", () => {
    expect(visibleRows(board(ten, ten[2]), 5).trailing).toBeNull();
  });

  it("trails the caller's row when they placed below the limit", () => {
    expect(visibleRows(board(ten, ten[7]), 5).trailing?.rank).toBe(8);
  });

  it("trails the caller's row when they are off the board entirely", () => {
    expect(visibleRows(board(ten, entry(42, "me")), 5).trailing?.rank).toBe(42);
  });

  it("adds no trailing row for someone who has never played", () => {
    expect(visibleRows(board(ten, null), 5).trailing).toBeNull();
  });
});
