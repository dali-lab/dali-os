// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRefreshedLoadMore } from "../useRefreshedLoadMore";
import type { LoadMoreProps } from "~/components/ui/Pager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Post {
  id: string;
  createdAt: string;
  body: string;
}
const post = (id: string, day: number, body = id): Post => ({
  id,
  createdAt: `2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  body,
});

let root: Root | null = null;
let container: HTMLDivElement;
let result: { items: Post[]; pager: LoadMoreProps };

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

type Props = {
  items: Post[];
  fetchByIds: (ids: string[]) => Promise<Post[]>;
  fetchPage: (cursor: string) => Promise<{ items: Post[]; nextCursor: string | null }>;
};

function Harness({ items, fetchByIds, fetchPage }: Props) {
  result = useRefreshedLoadMore<Post>({ items, nextCursor: "c1", fetchPage, fetchByIds });
  return null;
}

let pageFetcher: Props["fetchPage"] = async () => ({ items: [], nextCursor: null });

function render(items: Post[], fetchByIds: Props["fetchByIds"]) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(createElement(Harness, { items, fetchByIds, fetchPage: pageFetcher })));
}

const ids = () => result.items.map((p) => p.id);

async function withLoadedPage(first: Post[], later: Post[], fetchByIds: (ids: string[]) => Promise<Post[]>) {
  pageFetcher = vi.fn().mockResolvedValue({ items: later, nextCursor: null });
  render(first, fetchByIds);
  await act(async () => void (await result.pager.onLoadMore()));
}

describe("useRefreshedLoadMore", () => {
  it("refreshes later-page posts when the loader revalidates", async () => {
    const fetchByIds = vi.fn().mockResolvedValue([post("old", 1, "edited")]);
    const first = [post("a", 5)];
    await withLoadedPage(first, [post("old", 1)], fetchByIds);
    expect(fetchByIds).not.toHaveBeenCalled();

    await act(async () => render([post("a", 5)], fetchByIds));
    expect(fetchByIds).toHaveBeenCalledWith(["old"]);
    expect(result.items.find((p) => p.id === "old")?.body).toBe("edited");
  });

  it("drops a later-page post that was deleted", async () => {
    const fetchByIds = vi.fn().mockResolvedValue([]);
    await withLoadedPage([post("a", 5)], [post("old", 1)], fetchByIds);
    await act(async () => render([post("a", 5)], fetchByIds));
    expect(ids()).toEqual(["a"]);
  });

  it("keeps a post the first page pushed off its end, in order, and refreshes it", async () => {
    const fetchByIds = vi.fn().mockResolvedValue([post("a", 5, "fresh"), post("old", 1)]);
    await withLoadedPage([post("a", 5)], [post("old", 1)], fetchByIds);
    await act(async () => render([post("new", 6)], fetchByIds));
    expect(fetchByIds).toHaveBeenCalledWith(expect.arrayContaining(["a", "old"]));
    expect(ids()).toEqual(["new", "a", "old"]);
    expect(result.items[1].body).toBe("fresh");
  });

  it("does not refetch when only the first page is shown", async () => {
    const fetchByIds = vi.fn().mockResolvedValue([]);
    render([post("a", 5)], fetchByIds);
    render([post("a", 5)], fetchByIds);
    expect(fetchByIds).not.toHaveBeenCalled();
  });

  it("keeps the loaded rows if the refresh request fails", async () => {
    const fetchByIds = vi.fn().mockRejectedValue(new Error("offline"));
    await withLoadedPage([post("a", 5)], [post("old", 1)], fetchByIds);
    await act(async () => render([post("a", 5)], fetchByIds));
    expect(ids()).toEqual(["a", "old"]);
  });

  it("counts every shown row in the pager", async () => {
    await withLoadedPage([post("a", 5)], [post("old", 1)], vi.fn());
    expect(result.pager.shown).toBe(2);
  });
});
