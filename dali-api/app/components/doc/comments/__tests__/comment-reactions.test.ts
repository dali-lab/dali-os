import { describe, expect, it } from "vitest";
import type { CommentData } from "@blocknote/core/comments";
import { commentReactionSummaries } from "../comment-reactions";
import { apiCommentsToThreadMap } from "../DaliThreadStore";

const at = (s: number) => new Date(Date.UTC(2026, 10, 3, 12, 0, s));

const comment = (reactions: CommentData["reactions"], metadata: unknown = {}) =>
  ({ reactions, metadata }) as unknown as CommentData;

describe("commentReactionSummaries", () => {
  it("counts, marks the viewer's own and names everyone else, oldest emoji first", () => {
    const out = commentReactionSummaries(
      comment(
        [
          { emoji: "😂", createdAt: at(2), userIds: ["u2"] },
          { emoji: "👍", createdAt: at(1), userIds: ["me", "u2", "u3"] },
        ],
        { reactionInfo: { "👍": { names: { u2: "Grace Hopper" } } } },
      ),
      "me",
    );
    expect(out).toEqual([
      { emoji: "👍", count: 3, mine: true, people: ["Grace Hopper", "Unknown"] },
      { emoji: "😂", count: 1, mine: false, people: ["Unknown"] },
    ]);
  });

  it("carries a custom emoji's image, and null once it's deleted", () => {
    const out = commentReactionSummaries(
      comment(
        [
          { emoji: ":party:", createdAt: at(1), userIds: ["u2"] },
          { emoji: ":gone:", createdAt: at(2), userIds: ["u2"] },
        ],
        { reactionInfo: { ":party:": { names: {}, imageUrl: "/p.png" }, ":gone:": { names: {}, imageUrl: null } } },
      ),
      "me",
    );
    expect(out.map((r) => r.imageUrl)).toEqual(["/p.png", null]);
  });
});

describe("apiCommentsToThreadMap reactions", () => {
  it("keeps reactor names and custom emoji images on the comment", () => {
    const map = apiCommentsToThreadMap([
      {
        id: "t1",
        parentId: null,
        author: "Ada",
        authorId: "u1",
        body: "hi",
        anchor: { kind: "blocknote" },
        createdAt: "2026-11-03T12:00:00.000Z",
        reactions: [
          { userId: "u2", emoji: ":party:", createdAt: "2026-11-03T12:00:01.000Z", name: "Grace Hopper", imageUrl: "/p.png" },
        ],
      },
    ]);
    const c = map.get("t1")!.comments[0];
    expect(commentReactionSummaries(c, "u1")).toEqual([
      { emoji: ":party:", count: 1, mine: false, people: ["Grace Hopper"], imageUrl: "/p.png" },
    ]);
  });
});
