import { beforeEach, describe, expect, it, vi } from "vitest";

// Self-contained rather than the shared ~/lib/__mocks__/db stub: this is the
// only caller of prisma.tetrisScore, so the model doesn't need to be added to a
// fixture every other suite loads.
const tetrisScore = {
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  count: vi.fn(),
};
vi.mock("~/lib/db.server", () => ({ prisma: { tetrisScore } }));

const { readLeaderboard, recordScore } = await import("~/lib/tetris-scores.server");

const row = (userId: string, score: number, firstName: string | null, at = "2026-10-12T00:00:00Z") => ({
  userId,
  score,
  lines: 20,
  level: 3,
  achievedAt: new Date(at),
  user: { firstName, lastName: firstName ? "Bates" : null },
});

beforeEach(() => {
  vi.clearAllMocks();
  tetrisScore.count.mockResolvedValue(0);
});

describe("readLeaderboard", () => {
  it("ranks the board highest first and names the rows", async () => {
    tetrisScore.findMany.mockResolvedValue([row("a", 900, "Ada"), row("b", 400, "Bo")]);
    const board = await readLeaderboard("b");
    expect(board.entries.map((e) => [e.rank, e.name, e.score])).toEqual([
      [1, "Ada Bates", 900],
      [2, "Bo Bates", 400],
    ]);
  });

  it("marks the caller's own row so the panel can pick it out", async () => {
    tetrisScore.findMany.mockResolvedValue([row("a", 900, "Ada"), row("b", 400, "Bo")]);
    const board = await readLeaderboard("b");
    expect(board.you?.userId).toBe("b");
    // Already on the board, so no second lookup is needed to find them.
    expect(tetrisScore.findUnique).not.toHaveBeenCalled();
  });

  it("gives a player who did not place their real rank", async () => {
    tetrisScore.findMany.mockResolvedValue([row("a", 900, "Ada")]);
    tetrisScore.findUnique.mockResolvedValue(row("z", 50, "Zed"));
    tetrisScore.count.mockResolvedValue(17);
    const board = await readLeaderboard("z");
    expect(board.entries.some((e) => e.userId === "z")).toBe(false);
    expect(board.you).toMatchObject({ userId: "z", rank: 18, score: 50 });
  });

  it("leaves `you` empty for someone who has never finished a game", async () => {
    tetrisScore.findMany.mockResolvedValue([row("a", 900, "Ada")]);
    tetrisScore.findUnique.mockResolvedValue(null);
    expect((await readLeaderboard("new")).you).toBeNull();
  });

  it("falls back to a stand-in when a player has no name on file", async () => {
    tetrisScore.findMany.mockResolvedValue([row("a", 900, null)]);
    expect((await readLeaderboard("a")).entries[0].name).toBe("A DALI member");
  });
});

describe("recordScore", () => {
  // The board read that follows a write finds the player on it, which is what
  // happens for real and keeps the off-board lookup out of these cases.
  beforeEach(() => tetrisScore.findMany.mockResolvedValue([row("a", 500, "Ada")]));

  it("records a first run", async () => {
    tetrisScore.findUnique.mockResolvedValue(null);
    const result = await recordScore("a", { score: 500, lines: 20, level: 3 });
    expect(result.personalBest).toBe(true);
    expect(tetrisScore.upsert).toHaveBeenCalledTimes(1);
  });

  it("keeps the better score and does not write a worse one", async () => {
    tetrisScore.findUnique.mockResolvedValue({ score: 900 });
    const result = await recordScore("a", { score: 500, lines: 20, level: 3 });
    expect(result.personalBest).toBe(false);
    expect(tetrisScore.upsert).not.toHaveBeenCalled();
  });

  it("does not count equalling your own best as beating it", async () => {
    tetrisScore.findUnique.mockResolvedValue({ score: 500 });
    const result = await recordScore("a", { score: 500, lines: 20, level: 3 });
    expect(result.personalBest).toBe(false);
    expect(tetrisScore.upsert).not.toHaveBeenCalled();
  });

  it("stamps a new time when the best is beaten, so ties order by when they were set", async () => {
    tetrisScore.findUnique.mockResolvedValue({ score: 100 });
    await recordScore("a", { score: 900, lines: 30, level: 4 });
    const update = tetrisScore.upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({ score: 900, lines: 30, level: 4 });
    expect(update.achievedAt).toBeInstanceOf(Date);
  });
});
