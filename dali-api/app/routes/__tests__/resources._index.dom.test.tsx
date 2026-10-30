// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, Outlet } from "react-router";

vi.mock("~/lib/blog-post.server", () => ({
  loadBlogFrontPage: vi.fn(),
  moveBlogPostPin: vi.fn(),
  pinBlogPostToTop: vi.fn(),
  unpinBlogPost: vi.fn(),
}));
vi.mock("~/lib/resources.server", () => ({ requireResourcesViewer: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));

import ResourcesFrontPage from "~/routes/resources._index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Post ${id}`,
  excerpt: "",
  coverImageUrl: null,
  isPublic: false,
  status: "published" as const,
  mine: false,
  pinned: false,
  date: "Oct 1",
  author: "Ada Tester",
  ...extra,
});

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(data: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(Outlet, { context: { editing: false } }),
      children: [{ index: true, Component: ResourcesFrontPage as never, loader: () => data }],
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const titles = () => [...container.querySelectorAll("h2")].map((h) => h.textContent);
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("Resources front page", () => {
  it("keeps the pinned post as lead and appends older posts to the grid with Load more", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [post("old1"), post("old2")], nextCursor: null }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mount({
      published: [post("pin", { pinned: true }), post("a"), post("b"), post("c"), post("d"), post("e")],
      nextCursor: "2026-10-01T00:00:00.000Z|e",
      toReview: [],
      drafts: [],
      canCurate: false,
    });
    expect(titles()).toEqual(["Post pin", "Post a", "Post b", "Post c", "Post d", "Post e"]);
    await act(async () => loadMore()!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resources/blog-posts?cursor=2026-10-01T00%3A00%3A00.000Z%7Ce",
      expect.anything(),
    );
    expect(titles()).toEqual(["Post pin", "Post a", "Post b", "Post c", "Post d", "Post e", "Post old1", "Post old2"]);
    expect(loadMore()).toBeUndefined();
  });

  it("offers no Load more when the feed ended on the first page", async () => {
    await mount({ published: [post("a")], nextCursor: null, toReview: [], drafts: [], canCurate: false });
    expect(loadMore()).toBeUndefined();
  });

  it("still lists drafts and review items outside the paged feed", async () => {
    await mount({
      published: [post("a")],
      nextCursor: null,
      toReview: [post("r1", { status: "review" })],
      drafts: [post("d1", { status: "draft", mine: true })],
      canCurate: false,
    });
    expect(container.textContent).toContain("Waiting for approval");
    expect(container.textContent).toContain("Your drafts");
  });
});
