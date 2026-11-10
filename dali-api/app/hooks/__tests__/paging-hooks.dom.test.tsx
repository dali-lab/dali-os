// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useClientSlice } from "../useClientSlice";
import { useLoadMore, type CursorPage } from "../useLoadMore";
import type { LoadMoreProps } from "~/components/ui/Pager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

function render(node: React.ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(node));
}

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("useClientSlice", () => {
  let result: { visible: number[]; pager: LoadMoreProps };
  function Harness({ items, resetKey }: { items: number[]; resetKey?: string }) {
    result = useClientSlice(items, { pageSize: 2, resetKey });
    return null;
  }
  const three = [1, 2, 3];

  it("shows the first slice and reports the count", () => {
    render(createElement(Harness, { items: three }));
    expect(result.visible).toEqual([1, 2]);
    expect(result.pager).toMatchObject({ hasMore: true, shown: 2, total: 3 });
  });

  it("reveals the next slice, then stops", () => {
    render(createElement(Harness, { items: three }));
    act(() => void result.pager.onLoadMore());
    expect(result.visible).toEqual([1, 2, 3]);
    expect(result.pager).toMatchObject({ hasMore: false, shown: 3, total: 3 });
  });

  it("does not offer more on an exact fit", () => {
    render(createElement(Harness, { items: [1, 2] }));
    expect(result.pager.hasMore).toBe(false);
  });

  it("returns to the first slice when the filter changes", () => {
    render(createElement(Harness, { items: three, resetKey: "a" }));
    act(() => void result.pager.onLoadMore());
    render(createElement(Harness, { items: three, resetKey: "b" }));
    expect(result.visible).toEqual([1, 2]);
  });
});

describe("useLoadMore", () => {
  let result: { items: Row[]; pager: LoadMoreProps };
  function Harness({
    items,
    nextCursor,
    fetchPage,
    resetKey,
  }: {
    items: Row[];
    nextCursor: string | null;
    fetchPage: (cursor: string) => Promise<CursorPage<Row>>;
    resetKey?: string;
  }) {
    result = useLoadMore({ items, nextCursor, fetchPage, idOf: (r) => r.id, resetKey, total: 9 });
    return null;
  }
  const load = () => act(async () => void (await result.pager.onLoadMore()));

  it("appends pages and follows the cursor", async () => {
    const fetchPage = vi
      .fn<(cursor: string) => Promise<CursorPage<Row>>>()
      .mockResolvedValueOnce({ items: rows("b"), nextCursor: "c2" })
      .mockResolvedValueOnce({ items: rows("c"), nextCursor: null });
    render(createElement(Harness, { items: rows("a"), nextCursor: "c1", fetchPage }));
    await load();
    await load();
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["c1", "c2"]);
    expect(result.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.pager).toMatchObject({ hasMore: false, shown: 3, total: 9 });
  });

  it("keeps loaded pages when the loader revalidates, without duplicating rows", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: rows("b", "c"), nextCursor: "c2" });
    render(createElement(Harness, { items: rows("a"), nextCursor: "c1", fetchPage }));
    await load();
    render(createElement(Harness, { items: rows("new", "a", "b"), nextCursor: "c1", fetchPage }));
    expect(result.items.map((r) => r.id)).toEqual(["new", "a", "b", "c"]);
    expect(result.pager.hasMore).toBe(true);
  });

  it("keeps a row pushed off the first page by a new arrival", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: rows("d"), nextCursor: "c2" });
    render(createElement(Harness, { items: rows("b", "c"), nextCursor: "c1", fetchPage }));
    await load();
    render(createElement(Harness, { items: rows("a", "b"), nextCursor: "c0", fetchPage }));
    expect(result.items.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops a deleted row rather than keeping it as pushed", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: rows("d"), nextCursor: "c2" });
    render(createElement(Harness, { items: rows("a", "b", "c"), nextCursor: "c1", fetchPage }));
    await load();
    render(createElement(Harness, { items: rows("a", "c", "d"), nextCursor: "c1", fetchPage }));
    expect(result.items.map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("leaves paging to the loader cursor until a page has been loaded", () => {
    const fetchPage = vi.fn();
    render(createElement(Harness, { items: rows("b", "c"), nextCursor: "c1", fetchPage }));
    render(createElement(Harness, { items: rows("a", "b"), nextCursor: "c0", fetchPage }));
    expect(result.items.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("forgets pushed rows when the filter changes", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: rows("d"), nextCursor: "c2" });
    render(createElement(Harness, { items: rows("b", "c"), nextCursor: "c1", fetchPage, resetKey: "x" }));
    await load();
    render(createElement(Harness, { items: rows("a", "b"), nextCursor: "c0", fetchPage, resetKey: "x" }));
    render(createElement(Harness, { items: rows("z"), nextCursor: null, fetchPage, resetKey: "y" }));
    expect(result.items.map((r) => r.id)).toEqual(["z"]);
  });

  it("drops older pages and uses the new cursor when the filter changes", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: rows("b"), nextCursor: null });
    render(createElement(Harness, { items: rows("a"), nextCursor: "c1", fetchPage, resetKey: "x" }));
    await load();
    render(createElement(Harness, { items: rows("z"), nextCursor: "z1", fetchPage, resetKey: "y" }));
    expect(result.items.map((r) => r.id)).toEqual(["z"]);
    await load();
    expect(fetchPage).toHaveBeenLastCalledWith("z1");
  });

  it("ignores a page that resolves after the filter changed", async () => {
    let resolve!: (page: CursorPage<Row>) => void;
    const fetchPage = vi.fn(() => new Promise<CursorPage<Row>>((r) => (resolve = r)));
    render(createElement(Harness, { items: rows("a"), nextCursor: "c1", fetchPage, resetKey: "x" }));
    let pending!: Promise<void>;
    act(() => {
      pending = Promise.resolve(result.pager.onLoadMore());
    });
    render(createElement(Harness, { items: rows("z"), nextCursor: null, fetchPage, resetKey: "y" }));
    await act(async () => {
      resolve({ items: rows("stale"), nextCursor: "c2" });
      await pending;
    });
    expect(result.items.map((r) => r.id)).toEqual(["z"]);
    expect(result.pager.hasMore).toBe(false);
  });

  it("reports a failed page and keeps the cursor for a retry", async () => {
    const fetchPage = vi
      .fn<(cursor: string) => Promise<CursorPage<Row>>>()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValueOnce({ items: rows("b"), nextCursor: null });
    render(createElement(Harness, { items: rows("a"), nextCursor: "c1", fetchPage }));
    await load();
    expect(result.pager).toMatchObject({ failed: true, hasMore: true, loading: false });
    await load();
    expect(result.pager.failed).toBe(false);
    expect(result.items.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
