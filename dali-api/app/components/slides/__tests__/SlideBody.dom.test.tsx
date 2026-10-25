// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SlideBody } from "../SlideBody";
import type { RichDoc } from "~/components/slides/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(doc: unknown) {
  act(() => root.render(createElement(SlideBody, { doc: doc as RichDoc })));
  return container;
}

const text = (t: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: t, styles });

describe("SlideBody", () => {
  it("renders nothing for an empty or missing doc", () => {
    expect(render([]).innerHTML).toBe("");
    expect(render(undefined).innerHTML).toBe("");
  });

  it("renders paragraphs with inline styles", () => {
    const el = render([
      {
        type: "paragraph",
        content: [
          text("plain "),
          text("bold", { bold: true }),
          text("it", { italic: true }),
          text("u", { underline: true }),
          text("s", { strike: true }),
          text("x()", { code: true }),
        ],
      },
    ]);
    const p = el.querySelector("p")!;
    expect(p.textContent).toBe("plain bolditusx()");
    expect(p.querySelector("strong")?.textContent).toBe("bold");
    expect(p.querySelector("em")?.textContent).toBe("it");
    expect(p.querySelector("u")?.textContent).toBe("u");
    expect(p.querySelector("s")?.textContent).toBe("s");
    expect(p.querySelector("code")?.textContent).toBe("x()");
  });

  it("accepts string inline content", () => {
    expect(render([{ type: "paragraph", content: "hello" }]).querySelector("p")?.textContent).toBe("hello");
  });

  it("renders headings by level", () => {
    const el = render([
      { type: "heading", props: { level: 1 }, content: [text("One")] },
      { type: "heading", props: { level: 2 }, content: [text("Two")] },
      { type: "heading", props: { level: 3 }, content: [text("Three")] },
    ]);
    expect(el.querySelector("h3")?.textContent).toBe("One");
    expect(el.querySelector("h4")?.textContent).toBe("Two");
    expect(el.querySelector("h5")?.textContent).toBe("Three");
  });

  it("groups consecutive list items into one list per run", () => {
    const el = render([
      { type: "bulletListItem", content: [text("a")] },
      { type: "bulletListItem", content: [text("b")] },
      { type: "paragraph", content: [text("break")] },
      { type: "numberedListItem", content: [text("1")] },
      { type: "numberedListItem", content: [text("2")] },
      { type: "bulletListItem", content: [text("c")] },
    ]);
    const uls = el.querySelectorAll(":scope > div > ul");
    const ols = el.querySelectorAll(":scope > div > ol");
    expect(uls).toHaveLength(2);
    expect(uls[0].querySelectorAll("li")).toHaveLength(2);
    expect(ols).toHaveLength(1);
    expect(ols[0].querySelectorAll("li")).toHaveLength(2);
  });

  it("renders nested list children inside their item", () => {
    const el = render([
      {
        type: "bulletListItem",
        content: [text("parent")],
        children: [{ type: "bulletListItem", content: [text("child")] }],
      },
    ]);
    const outer = el.querySelector("ul > li")!;
    expect(outer.querySelector("ul > li")?.textContent).toBe("child");
  });

  it("renders check list items with their checked state", () => {
    const el = render([
      { type: "checkListItem", props: { checked: true }, content: [text("done")] },
      { type: "checkListItem", props: { checked: false }, content: [text("todo")] },
    ]);
    const items = el.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".line-through")?.textContent).toBe("done");
    expect(items[1].querySelector(".line-through")).toBeNull();
  });

  it("renders quotes, code blocks, dividers and images", () => {
    const el = render([
      { type: "quote", content: [text("wise")] },
      { type: "codeBlock", props: { language: "js" }, content: [text("let a = 1;")] },
      { type: "divider" },
      { type: "image", props: { url: "/a.png", caption: "A cat" } },
      { type: "image", props: { url: "" } },
    ]);
    expect(el.querySelector("blockquote")?.textContent).toBe("wise");
    expect(el.querySelector("pre code")?.textContent).toBe("let a = 1;");
    expect(el.querySelector("hr")).not.toBeNull();
    const imgs = el.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("/a.png");
    expect(imgs[0].getAttribute("alt")).toBe("A cat");
  });

  it("renders links with their text", () => {
    const el = render([
      {
        type: "paragraph",
        content: [text("see "), { type: "link", href: "https://dali.dartmouth.edu", content: [text("DALI", { bold: true })] }],
      },
    ]);
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://dali.dartmouth.edu");
    expect(a.getAttribute("rel")).toBe("noreferrer");
    expect(a.querySelector("strong")?.textContent).toBe("DALI");
  });

  it("skips unknown blocks and inline items without crashing", () => {
    const el = render([
      { type: "table", content: { type: "tableContent", rows: [] } },
      { type: "mystery" },
      { type: "paragraph", content: [{ type: "mention", props: { id: "u1" } }, text("kept")] },
    ]);
    expect(el.querySelector("table")).toBeNull();
    expect(el.textContent).toBe("kept");
  });

  it("never injects raw HTML from text", () => {
    const el = render([{ type: "paragraph", content: [text("<img src=x onerror=alert(1)>")] }]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
