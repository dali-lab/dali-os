// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CommentData, ThreadData } from "@blocknote/core/comments";
import { DaliThreadStoreAuth } from "../DaliThreadStore";

const confirm = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  viewerId: "me",
  auth: null as unknown as DaliThreadStoreAuth,
  addReaction: vi.fn(async () => {}),
  deleteReaction: vi.fn(async () => {}),
  deleteComment: vi.fn(async () => {}),
  deleteThread: vi.fn(async () => {}),
  updateComment: vi.fn(async () => {}),
  addComment: vi.fn(async () => {}),
}));

const editor = vi.hoisted(() => ({ document: [], focus: vi.fn(), replaceBlocks: vi.fn(), removeBlocks: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("@blocknote/react", () => {
  const Box = ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  );
  const components = {
    Comments: {
      Card: Box,
      CardSection: Box,
      Editor: ({ editable }: { editable: boolean }) => <div data-editable={String(editable)} />,
    },
  };
  return {
    useComponentsContext: () => components,
    useExtension: () => ({ threadStore: store, commentEditorSchema: undefined }),
    useCreateBlockNote: () => editor,
    useEditorState: () => false,
    useDictionary: () => ({ placeholders: { comment_reply: "Reply" } }),
  };
});

import { DaliThread } from "../DaliThread";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date("2026-11-03T12:00:00Z");
const comment = (id: string, userId: string, over: Partial<CommentData> = {}) =>
  ({
    type: "comment",
    id,
    userId,
    createdAt: at,
    updatedAt: at,
    reactions: [],
    metadata: { author: userId === "me" ? "Ada Lovelace" : "Grace Hopper", authorPhotoUrl: null },
    body: [],
    ...over,
  }) as CommentData;
const thread = (comments: CommentData[]): ThreadData => ({
  type: "thread",
  id: comments[0].id,
  createdAt: at,
  updatedAt: at,
  comments,
  resolved: false,
  metadata: {},
});

let container: HTMLDivElement;
let root: Root;

function render(t: ThreadData, role: "comment" | "editor" = "comment") {
  store.auth = new DaliThreadStoreAuth("me", role);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<DaliThread thread={t} />));
}

const commentEl = (id: string) => container.querySelector(`[data-comment-id="${id}"]`)!;
const button = (el: Element, name: string) =>
  [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);

async function openMenuAndPick(id: string, item: string) {
  await act(async () => button(commentEl(id), "More actions")!.click());
  const row = [...document.querySelectorAll('[role="menuitem"]')].find((r) => r.textContent === item) as HTMLElement;
  await act(async () => row.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  confirm.mockResolvedValue(true);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DaliThread", () => {
  it("offers edit and delete on the viewer's own comment only", () => {
    render(thread([comment("root", "other"), comment("mine", "me")]));
    expect(button(commentEl("mine"), "More actions")).toBeDefined();
    expect(button(commentEl("root"), "More actions")).toBeUndefined();
  });

  it("lets a moderator delete someone else's comment but not edit it", async () => {
    render(thread([comment("root", "other")]), "editor");
    await act(async () => button(commentEl("root"), "More actions")!.click());
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((r) => r.textContent);
    expect(items).toEqual(["Delete"]);
  });

  it("deletes a reply after confirming", async () => {
    render(thread([comment("root", "other"), comment("mine", "me")]));
    await openMenuAndPick("mine", "Delete");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete this comment?", description: undefined }));
    expect(store.deleteComment).toHaveBeenCalledWith({ threadId: "root", commentId: "mine" });
    expect(store.deleteThread).not.toHaveBeenCalled();
  });

  it("deletes the whole thread from its first comment and warns about replies", async () => {
    render(thread([comment("root", "me"), comment("reply", "other")]));
    await openMenuAndPick("root", "Delete");
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Its replies go with it, for everyone." }),
    );
    expect(store.deleteThread).toHaveBeenCalledWith({ threadId: "root" });
  });

  it("keeps the comment when the confirm is cancelled", async () => {
    confirm.mockResolvedValue(false);
    render(thread([comment("root", "other"), comment("mine", "me")]));
    await openMenuAndPick("mine", "Delete");
    expect(store.deleteComment).not.toHaveBeenCalled();
  });

  it("opens the body for editing", async () => {
    render(thread([comment("mine", "me")]));
    expect(commentEl("mine").querySelector("[data-editable]")!.getAttribute("data-editable")).toBe("false");
    await openMenuAndPick("mine", "Edit");
    expect(commentEl("mine").querySelector("[data-editable]")!.getAttribute("data-editable")).toBe("true");
    expect(editor.focus).toHaveBeenCalled();
  });

  it("shows reactions as chips and toggles the viewer's own off", async () => {
    render(
      thread([
        comment("root", "other", {
          reactions: [
            { emoji: "👍", createdAt: at, userIds: ["me", "other"] },
            { emoji: "😂", createdAt: new Date(at.getTime() + 1), userIds: ["other"] },
          ],
        }),
      ]),
    );
    const el = commentEl("root");
    expect(button(el, "👍 2")!.getAttribute("aria-pressed")).toBe("true");
    expect(button(el, "😂 1")!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button(el, "👍 2")!.click());
    expect(store.deleteReaction).toHaveBeenCalledWith({ threadId: "root", commentId: "root", emoji: "👍" });
    await act(async () => button(el, "😂 1")!.click());
    expect(store.addReaction).toHaveBeenCalledWith({ threadId: "root", commentId: "root", emoji: "😂" });
  });

  it("puts one add reaction control on each comment", () => {
    render(
      thread([
        comment("root", "other", { reactions: [{ emoji: "👍", createdAt: at, userIds: ["other"] }] }),
        comment("plain", "other"),
      ]),
    );
    expect(commentEl("root").querySelectorAll('[aria-label="Add reaction"]')).toHaveLength(1);
    expect(commentEl("plain").querySelectorAll('[aria-label="Add reaction"]')).toHaveLength(1);
  });

  it("collapses long threads to the first and last comment until selected", () => {
    render(thread(["a", "b", "c", "d", "e", "f"].map((id) => comment(id, "other"))));
    expect([...container.querySelectorAll("[data-comment-id]")].map((e) => e.getAttribute("data-comment-id"))).toEqual(["a", "f"]);
    expect(container.textContent).toContain("4 more replies");
  });
});
