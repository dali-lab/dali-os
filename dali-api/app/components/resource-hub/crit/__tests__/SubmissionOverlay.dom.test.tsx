// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: (p: { name: string }) => createElement("span", { "data-avatar": p.name }) }));
vi.mock("~/components/ReactionBar", () => ({ ReactionBar: () => createElement("div", { "data-reactions": true }) }));
vi.mock("~/components/collab/CommentComposer", () => ({
  CommentComposer: (p: { placeholder?: string; submitLabel?: string; onSubmit: (s: unknown[]) => void }) =>
    createElement("button", { "data-composer": p.placeholder ?? "Add a comment", onClick: () => p.onSubmit([{ type: "text", text: "Nice work" }]) }, p.submitLabel ?? "Post"),
}));

import { SubmissionOverlay, type CritSubmissionView } from "../SubmissionOverlay";
import type { SlideComment } from "~/lib/slide-comments";

const viewer = { id: "me", name: "Ada Lovelace", photoUrl: null };
const submission = (o: Partial<CritSubmissionView> = {}): CritSubmissionView => ({
  id: "s1", title: "Logo", question: "Is the contrast ok?", kind: "image", url: "/a.png", previewUrl: null, fileName: "a.png",
  anonymous: false, authorName: "Grace", mine: false, canDelete: false, canModerate: false, commentCount: 0, createdAt: new Date(0).toISOString(), ...o,
});
const comment = (id: string, o: Partial<SlideComment> = {}): SlideComment => ({
  id, parentId: null, author: "Grace Hopper", authorId: "grace", body: `Body ${id}`, anchor: null, createdAt: new Date().toISOString(), ...o,
});

let container: HTMLDivElement;
let root: Root;
let posts: Record<string, unknown>[];
let serverComments: SlideComment[];

function stubEnvironment(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ id: "new" }) };
    }
    return { ok: true, json: async () => ({ comments: serverComments }) };
  }));
}

async function mount(props: Partial<React.ComponentProps<typeof SubmissionOverlay>> = {}, wide = true) {
  stubEnvironment(wide);
  await act(async () => {
    root.render(createElement(SubmissionOverlay, { viewer, submission: submission(), onClose: vi.fn(), onChanged: vi.fn(), ...props }));
  });
}

beforeEach(() => {
  posts = [];
  serverComments = [];
  confirm.mockClear();
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const press = (key: string) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const click = (el: Element | null, init: MouseEventInit = {}) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const mode = () => [...document.querySelectorAll('[role="radio"]')].find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
const image = () => document.querySelector("img[alt='Logo']");
const byText = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;
const rows = () => [...document.querySelectorAll("[data-thread-row]")].map((r) => r.getAttribute("data-thread-row"));

describe("comment mode", () => {
  it("starts in View, and C toggles Comment and back", async () => {
    await mount();
    expect(mode()).toBe("View");
    press("c");
    expect(mode()).toBe("Comment");
    press("C");
    expect(mode()).toBe("View");
  });

  it("returns to View on Escape without closing the overlay", async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    press("c");
    press("Escape");
    expect(mode()).toBe("View");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores C while typing in a field", async () => {
    await mount();
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    act(() => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true })));
    expect(mode()).toBe("View");
    field.remove();
  });

  it("is not offered on a file post", async () => {
    await mount({ submission: submission({ kind: "file" }) });
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    press("c");
    expect(document.querySelector("[aria-label='New comment']")).toBeNull();
  });
});

describe("placing a pin", () => {
  it("opens a composer at the click and posts a pinned comment", async () => {
    await mount();
    click(byText("Comment"));
    expect(mode()).toBe("Comment");
    click(image(), { clientX: 25, clientY: 75 });
    const card = document.querySelector("[aria-label='New comment']");
    expect(card).not.toBeNull();
    expect(document.querySelector("[data-draft-pin]")).not.toBeNull();
    await act(async () => void click(card!.querySelector("[data-composer]")));
    expect(posts).toEqual([
      { targetType: "crit", targetId: "s1", body: "Nice work", bodyJson: [{ type: "text", text: "Nice work" }], parentId: null, anchor: { kind: "image", x: 0.25, y: 0.75 } },
    ]);
    expect(document.querySelector("[aria-label='New comment']")).toBeNull();
  });

  it("cancels the draft on Escape, keeping Comment mode", async () => {
    await mount();
    press("c");
    click(image(), { clientX: 10, clientY: 10 });
    press("Escape");
    expect(document.querySelector("[aria-label='New comment']")).toBeNull();
    expect(mode()).toBe("Comment");
  });

  it("does not place a pin in View mode", async () => {
    await mount();
    click(image(), { clientX: 10, clientY: 10 });
    expect(document.querySelector("[data-draft-pin]")).toBeNull();
  });
});

describe("threads", () => {
  beforeEach(() => {
    serverComments = [
      comment("a", { anchor: { kind: "image", x: 0.2, y: 0.3 } }),
      comment("b", { authorId: "me", author: "Ada Lovelace" }),
      comment("r", { parentId: "a", body: "A reply" }),
    ];
  });

  it("shows a pin per pinned thread and opens the thread next to it on click", async () => {
    await mount();
    const pins = document.querySelectorAll("[data-comment-pin]");
    expect(pins).toHaveLength(1);
    click(pins[0]);
    const thread = document.querySelector("[aria-label='Comment thread']")!;
    expect(thread.textContent).toContain("Body a");
    expect(thread.textContent).toContain("A reply");
    expect(thread.querySelector("[data-composer='Reply']")).not.toBeNull();
  });

  it("opens the thread named in the link", async () => {
    await mount({ initialThreadId: "a" });
    expect(document.querySelector("[aria-label='Comment thread']")?.textContent).toContain("Body a");
  });

  it("ignores a link to a thread that no longer exists", async () => {
    await mount({ initialThreadId: "gone" });
    expect(document.querySelector("[aria-label='Comment thread']")).toBeNull();
  });

  it("opens a pinned thread from its row in the side panel", async () => {
    await mount();
    click(document.querySelector("[data-thread-row='a'] button"));
    expect(document.querySelector("[aria-label='Comment thread']")).not.toBeNull();
  });

  it("opens an unpinned thread in its row", async () => {
    await mount();
    click(document.querySelector("[data-thread-row='b'] button"));
    expect(document.querySelector("[aria-label='Comment thread']")).toBeNull();
    expect(document.querySelector("[data-thread-row='b'] [data-thread-view='b']")).not.toBeNull();
  });

  it("filters the list to my threads with Mine", async () => {
    await mount();
    expect(rows()).toEqual(["a", "b"]);
    click(byText("Mine"));
    expect(rows()).toEqual(["b"]);
    expect(document.querySelectorAll("[data-comment-pin]")).toHaveLength(0);
    click(byText("Mine"));
    expect(rows()).toEqual(["a", "b"]);
  });

  it("counts every comment and shows the question on top", async () => {
    await mount();
    expect(document.querySelector("h3")?.textContent).toBe("Comments 3");
    expect(document.body.textContent).toContain("Is the contrast ok?");
  });

  it("asks before deleting a thread, naming what goes with it", async () => {
    serverComments = [comment("b", { authorId: "me", author: "Ada Lovelace" })];
    await mount();
    click(document.querySelector("[data-thread-row='b'] button"));
    click(document.querySelector("[aria-label='More actions']"));
    await act(async () => void click([...document.querySelectorAll("[role='menuitem']")].find((i) => i.textContent === "Delete") ?? null));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete this comment?", description: "Its replies go too." }));
  });

  it("offers Delete on someone else's comment only to moderators", async () => {
    serverComments = [comment("b")];
    await mount();
    click(document.querySelector("[data-thread-row='b'] button"));
    expect(document.querySelector("[aria-label='More actions']")).toBeNull();
  });
});

describe("moderation", () => {
  it("offers a moderator Delete on someone else's comment", async () => {
    serverComments = [comment("b")];
    await mount({ submission: submission({ canModerate: true }) });
    click(document.querySelector("[data-thread-row='b'] button"));
    expect(document.querySelector("[aria-label='More actions']")).not.toBeNull();
  });
});

describe("empty states", () => {
  it("points an image post at the C shortcut", async () => {
    await mount();
    expect(document.body.textContent).toContain("No comments yet. Press C, then click the image to leave one.");
  });
  it("keeps it short for a file or link post", async () => {
    await mount({ submission: submission({ kind: "file" }) });
    expect(document.body.textContent).toContain("No comments yet.");
    expect(document.body.textContent).not.toContain("Press C");
  });
});

describe("narrow screens", () => {
  it("hides the C hint and composes in the panel instead of a popover", async () => {
    await mount({}, false);
    expect(document.body.textContent).not.toContain("Press C");
    expect(document.querySelector("kbd")).toBeNull();
    click(byText("Comment"));
    click(image(), { clientX: 50, clientY: 50 });
    expect(document.querySelector("[aria-label='New comment']")).toBeNull();
    expect(document.body.textContent).toContain("Comment on this spot");
  });

  it("opens a pinned thread inside its row", async () => {
    serverComments = [comment("a", { anchor: { kind: "image", x: 0.2, y: 0.3 } })];
    await mount({}, false);
    click(document.querySelector("[data-comment-pin]"));
    expect(document.querySelector("[aria-label='Comment thread']")).toBeNull();
    expect(document.querySelector("[data-thread-row='a'] [data-thread-view='a']")).not.toBeNull();
  });
});
