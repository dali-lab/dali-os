// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { describe, expect, it } from "vitest";
import { EDITOR_PRESETS } from "../features";
import { buildSchema } from "./build";

const WATCH_URL = "https://www.youtube.com/watch?v=OY8fr2E96lg";
const PLAYER_URL = "https://www.youtube-nocookie.com/embed/OY8fr2E96lg";
const UPLOAD_URL = "/api/upload/raw?key=uploads/doc-images/demo.mp4";

function mount(type: "video" | "image", props: Record<string, unknown>): HTMLElement {
  const editor = BlockNoteEditor.create({
    schema: buildSchema(EDITOR_PRESETS.resource),
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    initialContent: [{ type, props }],
  } as never) as unknown as BlockNoteEditor;
  const root = document.createElement("div");
  editor.mount(root);
  return root;
}

describe.each(["video", "image"] as const)("a %s block holding a YouTube link", (type) => {
  it("plays in the provider's player", () => {
    const root = mount(type, { url: WATCH_URL, name: "watch?v=OY8fr2E96lg" });
    const frame = root.querySelector("iframe")!;
    expect(frame.src).toBe(PLAYER_URL);
    expect(frame.title).toBe("YouTube video");
    expect(frame.referrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(root.querySelector("video, img")).toBeNull();
  });

  it("fills the column unless it has been resized", () => {
    const frame = mount(type, { url: WATCH_URL }).querySelector("iframe")!;
    expect(frame.closest<HTMLElement>(".bn-file-block-content-wrapper")!.style.width).toBe("100%");
  });

  it("keeps a resized width", () => {
    const frame = mount(type, { url: WATCH_URL, previewWidth: 400 }).querySelector("iframe")!;
    expect(frame.closest<HTMLElement>(".bn-file-block-content-wrapper")!.style.width).toBe("400px");
  });

  it("titles the frame with the caption and still shows it", () => {
    const root = mount(type, { url: WATCH_URL, caption: "Partner stories" });
    expect(root.querySelector("iframe")!.title).toBe("Partner stories");
    expect(root.querySelector("figcaption")!.textContent).toBe("Partner stories");
  });

  it("offers resize handles around the player", () => {
    const root = mount(type, { url: WATCH_URL });
    const wrapper = root.querySelector("iframe")!.parentElement!;
    expect(wrapper.querySelectorAll(".bn-resize-handle")).toHaveLength(2);
  });
});

describe("a video block holding a file", () => {
  it("plays in a native player", () => {
    const root = mount("video", { url: UPLOAD_URL, name: "demo.mp4" });
    const video = root.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(UPLOAD_URL);
    expect(video.controls).toBe(true);
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("falls back to a link card when the URL turns out not to be a video", () => {
    const url = "https://example.com/some-page";
    const root = mount("video", { url, name: "Some page" });
    root.querySelector("video")!.dispatchEvent(new Event("error"));
    const card = root.querySelector<HTMLAnchorElement>("a.dali-embed--card")!;
    expect(card.href).toBe(url);
    expect(card.rel).toBe("noopener noreferrer");
    expect(card.textContent).toContain("Some page");
    expect(root.querySelector("video")).toBeNull();
  });

  it("never links to a script URL", () => {
    const root = mount("video", { url: "javascript:alert(1)" });
    root.querySelector("video")!.dispatchEvent(new Event("error"));
    expect(root.querySelector("a.dali-embed--card")).toBeNull();
  });
});

describe("the stock behavior these blocks keep", () => {
  it("shows an image in an <img>", () => {
    const url = "https://example.com/a.png";
    const root = mount("image", { url, name: "A" });
    expect(root.querySelector("img")!.getAttribute("src")).toBe(url);
    expect(root.querySelector("iframe")).toBeNull();
  });

  it.each(["video", "image"] as const)("offers upload on an empty %s block", (type) => {
    const root = mount(type, {});
    expect(root.querySelector(".bn-add-file-button")).not.toBeNull();
  });
});
