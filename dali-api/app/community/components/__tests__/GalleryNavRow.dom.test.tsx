// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const navigate = vi.fn();
vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: () => null }));
vi.mock("../GallerySearch", () => ({ GallerySearch: () => null }));

import { GalleryNavRow, GalleryPostButton } from "../GalleryNavRow";
import type { GalleryPerson } from "~/community/lib/gallery.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ada = { id: "u1", name: "Ada", classYear: 2026, photoUrl: null, postCount: 3 } as GalleryPerson;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  navigate.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );

describe("GalleryNavRow", () => {
  it("opens the composer from the shared Post button", () => {
    const onPost = vi.fn();
    act(() => root.render(<GalleryNavRow onPost={onPost} />));

    const post = button("Post")!;
    expect(post.className).toContain("dali-btn--primary");
    act(() => post.click());
    expect(onPost).toHaveBeenCalledOnce();
  });

  it("shows no person chip on the unfiltered feed", () => {
    act(() => root.render(<GalleryNavRow onPost={() => {}} />));
    expect(button("Stop showing only Ada's posts")).toBeUndefined();
  });

  it("clears a person filter back to the feed, keeping the search", () => {
    act(() =>
      root.render(
        <GalleryNavRow
          person={ada}
          results={{ q: "lab", people: [], posts: [] }}
          onPost={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("Ada");
    act(() => button("Stop showing only Ada's posts")!.click());
    expect(navigate).toHaveBeenCalledWith("/community/gallery?q=lab");
  });

  it("switches to Mine and back to All", () => {
    act(() => root.render(<GalleryNavRow onPost={() => {}} />));
    act(() => button("Mine")!.click());
    expect(navigate).toHaveBeenLastCalledWith("/community/gallery?show=mine");

    act(() => root.render(<GalleryNavRow mine onPost={() => {}} />));
    act(() => button("All")!.click());
    expect(navigate).toHaveBeenLastCalledWith("/community/gallery");
  });
});

describe("GalleryPostButton", () => {
  it("takes a custom label for empty states", () => {
    const onClick = vi.fn();
    act(() => root.render(<GalleryPostButton onClick={onClick} label="Post the first one" />));
    act(() => button("Post the first one")!.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
});
