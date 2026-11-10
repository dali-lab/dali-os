import { describe, expect, it } from "vitest";
import type { CommentData } from "@blocknote/core/comments";
import { getOrCreateStore } from "../DaliThreadStore";

const commentBy = (userId: string) => ({ userId, reactions: [] }) as unknown as CommentData;

describe("getOrCreateStore viewer", () => {
  it("lets the editor's viewer edit and delete after the count hook created the store", () => {
    const counted = getOrCreateStore("viewer-page");
    expect(counted.auth.canDeleteComment(commentBy("u1"))).toBe(false);

    const editor = getOrCreateStore("viewer-page", { currentUserId: "u1", canComment: true, canModerate: false });
    expect(editor).toBe(counted);
    expect(editor.auth.canUpdateComment(commentBy("u1"))).toBe(true);
    expect(editor.auth.canDeleteComment(commentBy("u1"))).toBe(true);
    expect(editor.auth.canDeleteComment(commentBy("u2"))).toBe(false);
  });

  it("gives a moderator delete on other people's comments", () => {
    getOrCreateStore("viewer-page-2");
    const store = getOrCreateStore("viewer-page-2", { currentUserId: "u1", canComment: true, canModerate: true });
    expect(store.auth.canDeleteComment(commentBy("u2"))).toBe(true);
    expect(store.auth.canUpdateComment(commentBy("u2"))).toBe(false);
  });

  it("keeps the viewer when a later call passes no config", () => {
    getOrCreateStore("viewer-page-3", { currentUserId: "u1", canComment: true, canModerate: false });
    const store = getOrCreateStore("viewer-page-3");
    expect(store.auth.canDeleteComment(commentBy("u1"))).toBe(true);
  });
});
