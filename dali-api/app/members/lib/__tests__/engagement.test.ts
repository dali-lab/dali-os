import { describe, expect, it } from "vitest";
import { countEngagement, describeCounts, engagementScore, rankLeaderboard } from "../engagement";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("engagement score", () => {
  it("weights teaching over coffee chats over attendance", () => {
    expect(engagementScore({ taught: 1, coffeeChats: 2, sessions: 3, meetings: 4 })).toBe(
      10 + 2 * 5 + 3 * 2 + 4,
    );
  });

  it("counts only what happened after each alum graduated", () => {
    const counts = countEngagement(
      [
        { id: "a", alumSince: d("2025-06-15") },
        { id: "b", alumSince: null },
      ],
      [
        { userId: "a", kind: "meetings", at: d("2025-01-10") },
        { userId: "a", kind: "meetings", at: d("2025-09-01") },
        { userId: "a", kind: "coffeeChats", at: d("2026-01-01") },
        { userId: "b", kind: "meetings", at: d("2020-01-01") },
        { userId: "not-an-alum", kind: "taught", at: d("2026-01-01") },
      ],
    );
    expect(counts.get("a")).toEqual({ taught: 0, coffeeChats: 1, sessions: 0, meetings: 1 });
    expect(counts.get("b")).toMatchObject({ meetings: 1 });
    expect(counts.has("not-an-alum")).toBe(false);
  });

  it("ranks by score, breaks ties by name, and leaves off zero scores", () => {
    const ranked = rankLeaderboard(
      [
        { name: "Zed", score: 5 },
        { name: "Amy", score: 5 },
        { name: "Top", score: 9 },
        { name: "None", score: 0 },
      ],
      3,
    );
    expect(ranked.map((r) => r.name)).toEqual(["Top", "Amy", "Zed"]);
  });

  it("describes the non-zero counts", () => {
    expect(describeCounts({ taught: 1, coffeeChats: 2, sessions: 0, meetings: 1 })).toBe(
      "1 taught, 2 coffee chats, 1 meeting",
    );
  });
});
