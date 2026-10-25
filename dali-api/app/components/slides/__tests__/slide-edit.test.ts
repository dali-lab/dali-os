import { describe, expect, it } from "vitest";
import { changeSlideLayout, createSlide, duplicateSlide, moveItem, slideIssues } from "~/components/slides/slide-edit";
import type { Slide } from "~/components/slides/types";

describe("createSlide", () => {
  it("gives a title slide an empty subtitle and no body or image", () => {
    const s = createSlide("title", "Hello");
    expect(s).toMatchObject({ layout: "title", title: "Hello", subtitle: "" });
    expect(s.body).toBeUndefined();
    expect(s.image).toBeUndefined();
  });

  it("starts a content slide with one empty bullet", () => {
    expect(createSlide("content").body).toEqual([{ type: "bulletListItem", content: [] }]);
  });

  it("gives split slides a body and an empty image, and image slides only the image", () => {
    expect(createSlide("split")).toMatchObject({ body: [], image: { src: "", alt: "" } });
    const image = createSlide("image");
    expect(image.image).toEqual({ src: "", alt: "" });
    expect(image.body).toBeUndefined();
  });

  it("gives every slide a fresh slide- id", () => {
    const a = createSlide("content");
    const b = createSlide("content");
    expect(a.id).toMatch(/^slide-/);
    expect(a.id).not.toBe(b.id);
  });
});

describe("changeSlideLayout", () => {
  it("returns the same slide when the layout doesn't change", () => {
    const s = createSlide("content");
    expect(changeSlideLayout(s, "content")).toBe(s);
  });

  it("keeps what was written and fills in what the new layout needs", () => {
    const s: Slide = { id: "s1", layout: "content", title: "T", body: [{ type: "paragraph" }], notes: "n" };
    const split = changeSlideLayout(s, "split");
    expect(split).toMatchObject({ id: "s1", layout: "split", title: "T", body: [{ type: "paragraph" }], notes: "n", image: { src: "", alt: "" } });
  });

  it("keeps an existing image when switching away and back", () => {
    const s: Slide = { id: "s1", layout: "image", title: "", image: { src: "/a.png", alt: "A" } };
    expect(changeSlideLayout(changeSlideLayout(s, "title"), "image").image).toEqual({ src: "/a.png", alt: "A" });
  });
});

describe("duplicateSlide", () => {
  it("copies everything under a new id without sharing the image object", () => {
    const s: Slide = { id: "s1", layout: "split", title: "T", image: { src: "/a.png", alt: "A" } };
    const copy = duplicateSlide(s);
    expect(copy.id).not.toBe("s1");
    expect(copy).toMatchObject({ layout: "split", title: "T", image: { src: "/a.png", alt: "A" } });
    expect(copy.image).not.toBe(s.image);
  });

  it("leaves image undefined when the slide has none", () => {
    expect(duplicateSlide(createSlide("title")).image).toBeUndefined();
  });
});

describe("moveItem", () => {
  it("moves an item by a delta", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
  });

  it("returns the same list when the move would leave it", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });
});

describe("slideIssues", () => {
  it("is empty for a deck that presents cleanly", () => {
    expect(
      slideIssues([
        { id: "1", layout: "title", title: "Hi" },
        { id: "2", layout: "image", title: "", image: { src: "/a.png", alt: "" } },
      ]),
    ).toEqual([]);
  });

  it("asks for titles everywhere but image slides", () => {
    expect(
      slideIssues([
        { id: "1", layout: "title", title: " " },
        { id: "2", layout: "content", title: "" },
        { id: "3", layout: "image", title: "", image: { src: "/a.png", alt: "" } },
      ]),
    ).toEqual(["Slide 1 needs a title.", "Slide 2 needs a title."]);
  });

  it("asks for images on split and image slides", () => {
    expect(
      slideIssues([
        { id: "1", layout: "split", title: "T", image: { src: " ", alt: "" } },
        { id: "2", layout: "image", title: "" },
      ]),
    ).toEqual(["Slide 1 needs an image.", "Slide 2 needs an image."]);
  });
});
