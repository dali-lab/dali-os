// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LabFiles } from "~/journeys/lib/types";
import { useFileTabs, type FileTabs } from "../useFileTabs";
import { clampSize } from "../Splitter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let tabs: FileTabs;

function Harness({ files, preferred }: { files: LabFiles; preferred?: string }) {
  tabs = useFileTabs(files, preferred);
  return null;
}

function mount(files: LabFiles, preferred?: string) {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Harness, { files, preferred })));
}
const rerender = (files: LabFiles) => act(() => root.render(createElement(Harness, { files })));

afterEach(() => {
  act(() => root.unmount());
});

const FILES = { "index.html": "", "a.js": "", "b.js": "", "c.js": "" };

describe("useFileTabs", () => {
  it("starts with the preferred file, else the entry file, open and active", () => {
    mount(FILES, "b.js");
    expect(tabs.openTabs).toEqual(["b.js"]);
    expect(tabs.activePath).toBe("b.js");
    act(() => root.unmount());
    mount(FILES, "missing.js");
    expect(tabs.openTabs).toEqual(["index.html"]);
  });

  it("starts empty with no files", () => {
    mount({});
    expect(tabs.openTabs).toEqual([]);
    expect(tabs.activePath).toBeNull();
  });

  it("opens a file once and makes it active", () => {
    mount(FILES);
    act(() => tabs.open("a.js"));
    act(() => tabs.open("a.js"));
    expect(tabs.openTabs).toEqual(["index.html", "a.js"]);
    expect(tabs.activePath).toBe("a.js");
    act(() => tabs.open("index.html"));
    expect(tabs.activePath).toBe("index.html");
  });

  it("closing the active tab activates its left neighbour, or the first tab", () => {
    mount(FILES);
    act(() => tabs.open("a.js"));
    act(() => tabs.open("b.js"));
    act(() => tabs.close("b.js"));
    expect(tabs.openTabs).toEqual(["index.html", "a.js"]);
    expect(tabs.activePath).toBe("a.js");
    act(() => tabs.open("index.html"));
    act(() => tabs.close("index.html"));
    expect(tabs.activePath).toBe("a.js");
  });

  it("closing an inactive tab keeps the active one", () => {
    mount(FILES);
    act(() => tabs.open("a.js"));
    act(() => tabs.close("index.html"));
    expect(tabs.openTabs).toEqual(["a.js"]);
    expect(tabs.activePath).toBe("a.js");
  });

  it("closing the last tab leaves nothing active", () => {
    mount(FILES);
    act(() => tabs.close("index.html"));
    expect(tabs.openTabs).toEqual([]);
    expect(tabs.activePath).toBeNull();
  });

  it("renames open tabs, including files inside a renamed folder", () => {
    mount({ "src/a.js": "", "src/b.js": "" }, "src/a.js");
    act(() => tabs.open("src/b.js"));
    act(() => tabs.rename("src", "lib"));
    rerender({ "lib/a.js": "", "lib/b.js": "" });
    expect(tabs.openTabs).toEqual(["lib/a.js", "lib/b.js"]);
    expect(tabs.activePath).toBe("lib/b.js");
  });

  it("drops tabs for deleted files and falls back to the last open tab", () => {
    mount(FILES);
    act(() => tabs.open("a.js"));
    act(() => tabs.open("b.js"));
    rerender({ "index.html": "", "a.js": "" });
    expect(tabs.openTabs).toEqual(["index.html", "a.js"]);
    expect(tabs.activePath).toBe("a.js");
  });
});

describe("clampSize", () => {
  it("keeps both panes above their minimums", () => {
    expect(clampSize(5, 10, 20)).toBe(10);
    expect(clampSize(95, 10, 20)).toBe(80);
    expect(clampSize(40, 10, 20)).toBe(40);
  });
});
