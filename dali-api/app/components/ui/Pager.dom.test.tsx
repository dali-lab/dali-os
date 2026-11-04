// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { LoadMore, PagerLinks } from "./Pager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, node)));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LoadMore", () => {
  it("renders nothing when there is no more", () => {
    mount(createElement(LoadMore, { hasMore: false, onLoadMore: vi.fn(), shown: 5, total: 5 }));
    expect(container.textContent).toBe("");
  });

  it("states the true count", () => {
    mount(createElement(LoadMore, { hasMore: true, onLoadMore: vi.fn(), shown: 50, total: 1200 }));
    expect(container.textContent).toContain("Showing 50 of 1,200");
  });

  it("omits the count when the total is unknown", () => {
    mount(createElement(LoadMore, { hasMore: true, onLoadMore: vi.fn(), shown: 50 }));
    expect(container.textContent).not.toContain("Showing");
  });

  it("calls back on click", () => {
    const onLoadMore = vi.fn();
    mount(createElement(LoadMore, { hasMore: true, onLoadMore }));
    act(() => container.querySelector("button")!.click());
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("disables the button while loading", () => {
    mount(createElement(LoadMore, { hasMore: true, onLoadMore: vi.fn(), loading: true }));
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Loading…");
  });

  it("offers a retry after a failure", () => {
    mount(createElement(LoadMore, { hasMore: true, onLoadMore: vi.fn(), failed: true }));
    expect(container.textContent).toContain("Couldn't load more. Try again.");
    expect(container.querySelector("button")!.disabled).toBe(false);
  });
});

describe("PagerLinks", () => {
  const hrefFor = (page: number) => `?page=${page}`;
  const href = (label: string) => container.querySelector(`a[aria-label='${label}']`)?.getAttribute("href");

  it("hides Previous on page 1", () => {
    mount(createElement(PagerLinks, { page: 1, hasNext: true, hrefFor, label: "Pages" }));
    expect(href("Previous")).toBeUndefined();
    expect(href("Next")).toContain("page=2");
  });

  it("shows the end label on the last page", () => {
    mount(createElement(PagerLinks, { page: 3, hasNext: false, hrefFor, label: "Pages", endLabel: "End of log" }));
    expect(href("Previous")).toContain("page=2");
    expect(href("Next")).toBeUndefined();
    expect(container.textContent).toContain("End of log");
  });

  it("names the nav for assistive tech", () => {
    mount(createElement(PagerLinks, { page: 1, hasNext: false, hrefFor, label: "Outbox pagination" }));
    expect(container.querySelector("nav")!.getAttribute("aria-label")).toBe("Outbox pagination");
  });
});
