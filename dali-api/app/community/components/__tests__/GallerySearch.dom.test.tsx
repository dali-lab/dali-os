// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const navigate = vi.hoisted(() => vi.fn());
const location = vi.hoisted(() => ({ key: "k1", state: null as unknown }));
vi.mock("react-router", () => ({ useNavigate: () => navigate, useLocation: () => location }));

import { GallerySearch, type GallerySearchResults } from "../GallerySearch";
import type { GalleryTileData } from "~/community/lib/gallery.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const priya = { id: "u1", name: "Priya Shah", classYear: 2026, photoUrl: null, postCount: 18 };
const post = (id: string, caption: string) =>
  ({
    id,
    caption,
    imageUrl: `/img/${id}`,
    color: "#000000",
    author: { id: "u2", name: "Maya Chen", classYear: 2026, photoUrl: null },
  }) as GalleryTileData;
const loaded: GallerySearchResults = {
  q: "pri",
  people: [priya],
  posts: [post("p1", "Prints"), post("p2", "Prize night"), post("p3", "Spring print"), post("p4", "Pride")],
};

let container: HTMLDivElement;
let root: Root;
function mount(results: GallerySearchResults | null, mine = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<GallerySearch mine={mine} results={results} />));
}
function rerender(results: GallerySearchResults | null) {
  act(() => root.render(<GallerySearch mine={false} results={results} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const input = () => container.querySelector("input") as HTMLInputElement;
function type(text: string) {
  act(() => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(k: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}
const options = () => [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
const list = () => container.querySelector('[role="listbox"]');

describe("GallerySearch", () => {
  it("searches the feed a moment after typing stops, replacing history", () => {
    mount({ q: "", people: [], posts: [] });
    type("p");
    type("pr");
    act(() => vi.advanceTimersByTime(299));
    expect(navigate).not.toHaveBeenCalled();
    type("pri");
    act(() => vi.advanceTimersByTime(300));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/community/gallery?q=pri", {
      replace: true,
      preventScrollReset: true,
      state: { gallerySearch: true },
    });
  });

  it("keeps Mine while searching", () => {
    mount({ q: "", people: [], posts: [] }, true);
    type("pri");
    act(() => vi.advanceTimersByTime(300));
    expect(navigate.mock.calls[0][0]).toBe("/community/gallery?show=mine&q=pri");
  });

  it("shows only Searching until results for the typed text arrive", () => {
    mount({ q: "", people: [], posts: [] });
    type("pri");
    expect(list()?.textContent).toBe("Searching…");
    rerender(loaded);
    expect(list()?.textContent).not.toContain("Searching");
  });

  it("lists people, then the top three posts", () => {
    mount(loaded);
    type("pri");
    expect(options()).toEqual([
      "PSPriya Shah '2618 posts",
      "PrintsMaya Chen '26",
      "Prize nightMaya Chen '26",
      "Spring printMaya Chen '26",
    ]);
  });

  it("says so when nothing matches", () => {
    mount({ q: "zzz", people: [], posts: [] });
    type("zzz");
    expect(list()?.textContent).toBe("No matches");
  });

  it("filters to a person with arrow keys and Enter, clearing the search", () => {
    mount(loaded);
    type("pri");
    key("ArrowDown");
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("Priya Shah");
    key("Enter");
    expect(navigate).toHaveBeenCalledWith("/community/gallery?by=u1");
    expect(input().value).toBe("");
    act(() => vi.advanceTimersByTime(1000));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("opens a post picked from the list", () => {
    mount(loaded);
    type("pri");
    act(() => (container.querySelectorAll('[role="option"]')[2] as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("/community/gallery/p2");
  });

  it("wraps the highlight from the top to the last item", () => {
    mount(loaded);
    type("pri");
    key("ArrowUp");
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("Spring print");
  });

  it("searches at once on Enter with nothing highlighted", () => {
    mount({ q: "", people: [], posts: [] });
    type("demo");
    key("Enter");
    expect(navigate).toHaveBeenCalledWith("/community/gallery?q=demo", expect.anything());
    act(() => vi.advanceTimersByTime(1000));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and keeps the text", () => {
    mount(loaded);
    type("pri");
    key("Escape");
    expect(list()).toBeNull();
    expect(input().value).toBe("pri");
  });

  it("off the feed, goes to the feed without replacing the post page in history", () => {
    mount(null);
    type("pri");
    expect(list()).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(navigate).toHaveBeenCalledWith(
      "/community/gallery?q=pri",
      expect.objectContaining({ replace: false, state: { gallerySearch: true } }),
    );
  });
});
