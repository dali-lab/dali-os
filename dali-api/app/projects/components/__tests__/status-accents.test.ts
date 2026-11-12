import { describe, expect, it } from "vitest";
import { osStatusAccent } from "~/components/board/status-accent";
import { statusAccent } from "../task-board-shared";
import { stageAccent } from "~/partners/components/PartnerBoard";

describe("board accents", () => {
  it("maps each task status to its os accent", () => {
    const pairs = {
      Backlog: "backlog",
      Todo: "todo",
      InProgress: "progress",
      InReview: "review",
      Done: "done",
      Cancelled: "cancelled",
    } as const;
    for (const [status, key] of Object.entries(pairs)) {
      expect(statusAccent(status as keyof typeof pairs)).toEqual(osStatusAccent(key));
    }
  });

  it("maps each partner stage to the matching task accent", () => {
    const pairs = {
      Backlog: "backlog",
      New: "todo",
      Interview: "progress",
      Deciding: "review",
      Accepted: "done",
      Rejected: "cancelled",
    } as const;
    for (const [stage, key] of Object.entries(pairs)) {
      expect(stageAccent(stage as keyof typeof pairs)).toEqual(osStatusAccent(key));
    }
  });
});
