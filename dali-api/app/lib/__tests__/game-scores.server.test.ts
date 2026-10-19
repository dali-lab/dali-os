import { describe, expect, it, vi } from "vitest";
import { scoreBoard } from "~/lib/game-scores.server";

function fakeTable() {
  return { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn().mockResolvedValue(0) };
}

const row = (userId: string, score: number, extra: Record<string, number> = {}) => ({
  userId,
  score,
  achievedAt: new Date("2026-10-19T00:00:00Z"),
  user: { firstName: "Ada", lastName: "Bates" },
  ...extra,
});

describe("scoreBoard", () => {
  it("selects and returns a game's extra columns", async () => {
    const table = fakeTable();
    table.findMany.mockResolvedValue([row("a", 900, { lines: 12, level: 2 })]);
    const { readLeaderboard } = scoreBoard<{ lines: number; level: number }>(table, ["lines", "level"]);
    const board = await readLeaderboard("a");
    expect(table.findMany.mock.calls[0][0].select).toMatchObject({ lines: true, level: true });
    expect(board.entries[0]).toMatchObject({ rank: 1, score: 900, lines: 12, level: 2 });
  });

  it("works for a game with no extra columns", async () => {
    const table = fakeTable();
    table.findMany.mockResolvedValue([row("a", 300)]);
    const { readLeaderboard } = scoreBoard(table, []);
    const board = await readLeaderboard("a");
    expect(Object.keys(board.entries[0]).sort()).toEqual(["achievedAt", "name", "rank", "score", "userId"]);
    expect(board.you?.userId).toBe("a");
  });

  it("writes only the score for a game with no extra columns", async () => {
    const table = fakeTable();
    table.findUnique.mockResolvedValue(null);
    table.findMany.mockResolvedValue([row("a", 300)]);
    const { recordScore } = scoreBoard(table, []);
    const result = await recordScore("a", { score: 300 });
    expect(result.personalBest).toBe(true);
    expect(table.upsert.mock.calls[0][0].create).toEqual({ userId: "a", score: 300 });
  });
});
