// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useFetcher: () => ({ submit: vi.fn(), state: "idle" }),
}));
vi.mock("~/components/ReactionBar", () => ({ ReactionPicker: () => null }));
vi.mock("~/community/components/GalleryPostMenu", () => ({ GalleryPostMenu: () => null }));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: () => null }));

import { GalleryMasonry } from "../GalleryMasonry";
import type { GalleryTileData } from "~/community/lib/gallery.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resize: (width: number) => void = () => {};
class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    resize = (width) =>
      this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
  unobserve() {}
}

const post = (id: string) =>
  ({
    id,
    imageUrl: `/img/${id}`,
    width: 800,
    height: 800,
    color: "#000000",
    caption: null,
    hidden: false,
    createdAt: "2026-10-23T00:00:00.000Z",
    author: { id: "u1", name: "Maya Chen", classYear: 2026, photoUrl: null },
    reactions: [],
    commentCount: 0,
    mine: false,
    canModerate: false,
  }) as GalleryTileData;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const loading = () =>
  Object.fromEntries(
    [...container.querySelectorAll("img")].map((img) => [
      img.getAttribute("src"),
      [img.getAttribute("loading"), img.getAttribute("fetchpriority")],
    ]),
  );

describe("GalleryMasonry image loading", () => {
  it("fetches the first row at once and leaves the rest to lazy loading", () => {
    const posts = ["a", "b", "c", "d", "e", "f", "g"].map(post);
    act(() => root.render(<GalleryMasonry posts={posts} />));
    act(() => resize(720));

    expect(loading()).toEqual({
      "/img/a": ["eager", "high"],
      "/img/b": ["eager", "high"],
      "/img/c": ["eager", "high"],
      "/img/d": ["lazy", "auto"],
      "/img/e": ["lazy", "auto"],
      "/img/f": ["lazy", "auto"],
      "/img/g": ["lazy", "auto"],
    });
  });

  it("follows the column count as the feed resizes", () => {
    const posts = ["a", "b", "c", "d"].map(post);
    act(() => root.render(<GalleryMasonry posts={posts} />));
    act(() => resize(480));

    expect(loading()).toEqual({
      "/img/a": ["eager", "high"],
      "/img/b": ["eager", "high"],
      "/img/c": ["lazy", "auto"],
      "/img/d": ["lazy", "auto"],
    });
  });
});
