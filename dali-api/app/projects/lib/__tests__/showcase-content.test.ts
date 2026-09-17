import { describe, it, expect } from "vitest";
import {
  DEFAULT_DETAILS,
  parseDetails,
  parseMedia,
} from "../showcase-content";

describe("parseDetails", () => {
  it("keeps and trims item/description pairs", () => {
    expect(
      parseDetails([
        { item: "  The Problem ", description: " Students struggle. " },
        { item: "Our Solution", description: "We help." },
      ]),
    ).toEqual([
      { item: "The Problem", description: "Students struggle." },
      { item: "Our Solution", description: "We help." },
    ]);
  });

  it("drops rows blank on both fields but keeps heading-only or body-only rows", () => {
    expect(
      parseDetails([
        { item: "", description: "" },
        { item: "The Impact", description: "" },
        { item: "", description: "An intro blurb." },
      ]),
    ).toEqual([
      { item: "The Impact", description: "" },
      { item: "", description: "An intro blurb." },
    ]);
  });

  it("coerces missing/non-string fields and skips non-objects", () => {
    expect(
      parseDetails([{ item: 5 }, "nope", null, { description: "kept" }]),
    ).toEqual([{ item: "", description: "kept" }]);
  });

  it("returns [] for non-array input", () => {
    expect(parseDetails(null)).toEqual([]);
    expect(parseDetails(undefined)).toEqual([]);
    expect(parseDetails("[]")).toEqual([]);
  });

  it("has three default sections, all with empty descriptions", () => {
    expect(DEFAULT_DETAILS.map((d) => d.item)).toEqual([
      "The Problem",
      "Our Solution",
      "The Impact",
    ]);
    expect(DEFAULT_DETAILS.every((d) => d.description === "")).toBe(true);
  });
});

describe("parseMedia", () => {
  it("normalizes type, trims src, and keeps captions only when present", () => {
    expect(
      parseMedia([
        { type: "video", src: " uploads/a.mp4 ", caption: " Demo " },
        { type: "image", src: "uploads/b.png" },
      ]),
    ).toEqual([
      { type: "video", src: "uploads/a.mp4", caption: "Demo" },
      { type: "image", src: "uploads/b.png" },
    ]);
  });

  it("defaults an unknown type to image and drops blank src", () => {
    expect(
      parseMedia([
        { type: "gif", src: "uploads/c.gif" },
        { type: "image", src: "  " },
      ]),
    ).toEqual([{ type: "image", src: "uploads/c.gif" }]);
  });

  it("returns [] for non-array input", () => {
    expect(parseMedia(null)).toEqual([]);
  });
});
