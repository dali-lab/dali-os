// Unit tests for DaliThreadStore helpers (node environment, no DOM, no
// BlockNote imports — only pure mapping and serialization logic).

import { describe, it, expect } from "vitest";
import {
  bodyToPlainText,
  serializeBody,
  deserializeBody,
  apiCommentsToThreadMap,
} from "../comments/DaliThreadStore";

const blocknoteAnchor = { kind: "blocknote" };

// Minimal ApiComment shape (only fields our mapping code touches).
function makeComment(overrides: {
  id: string;
  parentId?: string | null;
  body?: string;
  resolved?: boolean;
  anchor?: object | null;
  createdAt?: string;
}) {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    author: "Ada Lovelace",
    authorId: "u-ada",
    authorPhotoUrl: null,
    body: overrides.body ?? JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]),
    anchor: overrides.anchor !== undefined ? overrides.anchor : blocknoteAnchor,
    resolved: overrides.resolved ?? false,
    createdAt: overrides.createdAt ?? "2026-07-31T12:00:00.000Z",
  };
}

describe("bodyToPlainText", () => {
  it("extracts text from a single paragraph block", () => {
    const body = [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }];
    expect(bodyToPlainText(body)).toBe("Hello world");
  });

  it("concatenates text across multiple inline nodes", () => {
    const body = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Foo " },
          { type: "text", text: "bar" },
        ],
      },
    ];
    expect(bodyToPlainText(body)).toBe("Foo bar");
  });

  it("returns empty string for an empty block array", () => {
    expect(bodyToPlainText([])).toBe("");
  });

  it("handles non-array gracefully", () => {
    expect(bodyToPlainText(null as unknown as [])).toBe("");
  });
});

describe("serializeBody / deserializeBody round-trip", () => {
  it("round-trips a block array", () => {
    const body = [{ type: "paragraph", content: [{ type: "text", text: "round-trip" }] }];
    const stored = serializeBody(body);
    expect(JSON.parse(stored)).toEqual(body);
    expect(deserializeBody(stored)).toEqual(body);
  });

  it("deserializeBody wraps legacy plain text in a paragraph", () => {
    const result = deserializeBody("plain text comment");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content[0].text).toBe("plain text comment");
  });

  it("deserializeBody returns block array for valid JSON", () => {
    const blocks = [{ type: "paragraph", content: [] }];
    expect(deserializeBody(JSON.stringify(blocks))).toEqual(blocks);
  });

  it("handles non-JSON strings gracefully", () => {
    const result = deserializeBody("{not json");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].content[0].text).toBe("{not json");
  });
});

describe("apiCommentsToThreadMap", () => {
  it("maps a root inline comment to a thread", () => {
    const comments = [makeComment({ id: "c1" })];
    const map = apiCommentsToThreadMap(comments);
    expect(map.size).toBe(1);
    const thread = map.get("c1")!;
    expect(thread.type).toBe("thread");
    expect(thread.id).toBe("c1");
    expect(thread.resolved).toBe(false);
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].userId).toBe("u-ada");
  });

  it("attaches replies to their root thread", () => {
    const comments = [
      makeComment({ id: "root1" }),
      makeComment({ id: "reply1", parentId: "root1", anchor: null }),
      makeComment({ id: "reply2", parentId: "root1", anchor: null }),
    ];
    const map = apiCommentsToThreadMap(comments);
    expect(map.size).toBe(1);
    const thread = map.get("root1")!;
    expect(thread.comments).toHaveLength(3); // root + 2 replies
    expect(thread.comments.map((c) => c.id)).toEqual(["root1", "reply1", "reply2"]);
  });

  it("excludes doc-level threads (anchor = null)", () => {
    const comments = [makeComment({ id: "doc-level", anchor: null })];
    const map = apiCommentsToThreadMap(comments);
    expect(map.size).toBe(0);
  });

  it("excludes legacy Yjs-anchor threads (anchor = {from, to})", () => {
    const comments = [makeComment({ id: "yjs-anchor", anchor: { from: "abc", to: "def" } })];
    const map = apiCommentsToThreadMap(comments);
    expect(map.size).toBe(0);
  });

  it("marks resolved threads correctly", () => {
    const comments = [makeComment({ id: "res1", resolved: true })];
    const map = apiCommentsToThreadMap(comments);
    expect(map.get("res1")!.resolved).toBe(true);
  });

  it("handles empty input", () => {
    expect(apiCommentsToThreadMap([]).size).toBe(0);
  });

  it("creates proper CommentData with metadata for avatar display", () => {
    const c = makeComment({ id: "c-meta" });
    const map = apiCommentsToThreadMap([c]);
    const comment = map.get("c-meta")!.comments[0];
    expect(comment.metadata).toMatchObject({ author: "Ada Lovelace", authorPhotoUrl: null });
  });

  it("deserializes the body field", () => {
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "test body" }] }];
    const c = makeComment({ id: "c-body", body: JSON.stringify(blocks) });
    const map = apiCommentsToThreadMap([c]);
    const comment = map.get("c-body")!.comments[0];
    expect(comment.body).toEqual(blocks);
  });
});
