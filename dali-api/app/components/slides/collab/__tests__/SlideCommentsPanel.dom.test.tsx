// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: (p: { name: string }) => createElement("span", { "data-avatar": p.name }) }));
vi.mock("~/components/collab/CommentComposer", () => ({
  CommentComposer: (p: { placeholder?: string; onSubmit: (s: unknown[]) => void }) =>
    createElement("button", { "data-composer": p.placeholder ?? "new", onClick: () => p.onSubmit([{ type: "text", text: "Looks good" }]) }, "post"),
}));

import { SlideCommentsPanel } from "../SlideCommentsPanel";
import type { SlideComment } from "~/lib/slide-comments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const c = (id: string, anchor: unknown, over: Partial<SlideComment> = {}): SlideComment => ({
  id,
  parentId: null,
  author: "Grace",
  authorId: "grace",
  body: `body ${id}`,
  anchor,
  createdAt: "2026-11-05T10:00:00.000Z",
  ...over,
});

const comments = [
  c("on-2", { kind: "slide", slideId: "s2" }),
  c("on-1", { kind: "slide", slideId: "s1", elementId: "title" }),
  c("text-1", { kind: "blocknote", slideId: "s1", elementId: "body" }, { authorId: "ada", author: "Ada" }),
  c("on-gone", { kind: "slide", slideId: "gone" }),
  c("reply", null, { parentId: "on-2", body: "a reply" }),
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  confirm.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(over: Record<string, unknown> = {}) {
  const fns = { onPost: vi.fn(async () => true), onDelete: vi.fn(), onOpenThread: vi.fn(), onRestoreSlide: vi.fn(), onClearTarget: vi.fn(), onClose: vi.fn() };
  act(() =>
    root.render(
      createElement(SlideCommentsPanel, {
        comments,
        error: null,
        viewerId: "ada",
        canComment: true,
        canModerate: false,
        slideIds: ["s1", "s2"],
        deletedIds: ["gone"],
        currentSlideId: "s2",
        canRestore: true,
        target: null,
        focusThreadId: null,
        ...fns,
        ...over,
      } as never),
    ),
  );
  return fns;
}
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const sections = () => [...container.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));

describe("SlideCommentsPanel", () => {
  it("groups threads by slide in deck order, deleted slides last", () => {
    mount();
    expect(sections()).toEqual(["Slide 1", "Slide 2", "Deleted slide"]);
    expect([...container.querySelectorAll("[data-thread-id]")].map((e) => e.getAttribute("data-thread-id"))).toEqual(["on-1", "text-1", "on-2", "on-gone"]);
  });

  it("labels element and text threads and shows replies under their thread", () => {
    mount();
    expect(container.querySelector("[data-thread-id=on-1]")!.textContent).toContain("On title");
    expect(container.querySelector("[data-thread-id=text-1]")!.textContent).toContain("On text in body");
    expect(container.querySelector("[data-thread-id=on-2] [data-comment-id=reply]")!.textContent).toContain("a reply");
  });

  it("opens a thread's slide and anchor when its card is clicked", () => {
    const { onOpenThread } = mount();
    click(container.querySelector("[data-thread-id=on-1] button"));
    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ kind: "element", root: expect.objectContaining({ id: "on-1" }) }));
  });

  it("offers Restore on a deleted slide's threads and keeps them listed", () => {
    const { onRestoreSlide } = mount();
    const gone = container.querySelector("section[aria-label='Deleted slide']")!;
    expect(gone.textContent).toContain("body on-gone");
    click([...gone.querySelectorAll("button")].find((b) => b.textContent?.includes("Restore")) ?? null);
    expect(onRestoreSlide).toHaveBeenCalledWith("gone");
  });

  it("hides Restore from people who cannot edit", () => {
    mount({ canRestore: false });
    expect(container.textContent).not.toContain("Restore");
    expect(container.textContent).toContain("body on-gone");
  });

  it("posts a new comment on the slide being viewed as a slide anchor", async () => {
    const { onPost } = mount();
    await act(async () => void (container.querySelector("[data-composer=new]") as HTMLElement).click());
    expect(onPost).toHaveBeenCalledWith({
      body: "Looks good",
      bodyJson: [{ type: "text", text: "Looks good" }],
      parentId: null,
      anchor: { kind: "slide", slideId: "s2" },
    });
  });

  it("posts onto the element or point chosen from the stage", async () => {
    const { onPost, onClearTarget } = mount({ target: { slideId: "s1", elementId: "title", x: 0.5, y: 0.25 } });
    expect(container.textContent).toContain("Comment on Slide 1, title");
    await act(async () => void (container.querySelector("[data-composer=new]") as HTMLElement).click());
    expect(onPost).toHaveBeenCalledWith(expect.objectContaining({ anchor: { kind: "slide", slideId: "s1", elementId: "title", x: 0.5, y: 0.25 } }));
    expect(onClearTarget).toHaveBeenCalled();
  });

  it("replies into the thread", async () => {
    const { onPost } = mount();
    click([...container.querySelectorAll("[data-thread-id=on-2] button")].find((b) => b.textContent === "Reply") ?? null);
    await act(async () => void (container.querySelector("[data-composer=Reply…]") as HTMLElement).click());
    expect(onPost).toHaveBeenCalledWith(expect.objectContaining({ parentId: "on-2", anchor: null }));
  });

  it("lets people delete their own comments, and anyone's for a moderator", async () => {
    const own = mount();
    const deleteButtons = () => [...container.querySelectorAll("button")].filter((b) => b.textContent?.includes("Delete") && !b.textContent.includes("Deleted"));
    expect(deleteButtons()).toHaveLength(1);
    await act(async () => void deleteButtons()[0].click());
    expect(confirm).toHaveBeenCalled();
    expect(own.onDelete).toHaveBeenCalledWith("text-1");
    mount({ canModerate: true });
    expect(deleteButtons().length).toBeGreaterThan(1);
  });

  it("shows no composer or reply to someone who can only read", () => {
    mount({ canComment: false });
    expect(container.querySelector("[data-composer]")).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Reply")).toBe(false);
    expect(container.textContent).toContain("body on-1");
  });

  it("marks the focused thread", () => {
    mount({ focusThreadId: "on-2" });
    expect(container.querySelector("[data-thread-id=on-2]")!.getAttribute("data-focused")).toBe("true");
    expect(container.querySelector("[data-thread-id=on-1]")!.getAttribute("data-focused")).toBeNull();
  });

  it("says when a deck has no comments", () => {
    mount({ comments: [] });
    expect(container.textContent).toContain("No comments on this deck yet.");
  });
});
