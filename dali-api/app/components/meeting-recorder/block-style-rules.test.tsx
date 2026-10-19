// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { mountDom } from "./test-support";
import { blockSelector, useBlockStyleRules } from "./block-style-rules";

function Harness({ name, css }: { name: string; css: string }) {
  useBlockStyleRules(name, css);
  return null;
}

const styles = (name: string) => [...document.head.querySelectorAll(`style[data-enhance-rules="${name}"]`)];

afterEach(() => {
  document.body.innerHTML = "";
  for (const style of document.head.querySelectorAll("style[data-enhance-rules]")) style.remove();
});

describe("useBlockStyleRules", () => {
  it("creates one style element on the first non-empty css and replaces its text after", () => {
    const ui = mountDom(createElement(Harness, { name: "k", css: "" }));
    expect(styles("k")).toHaveLength(0);
    ui.rerender(createElement(Harness, { name: "k", css: "a { color: red }" }));
    const [first] = styles("k");
    expect(first!.textContent).toBe("a { color: red }");
    ui.rerender(createElement(Harness, { name: "k", css: "b { color: blue }" }));
    expect(styles("k")).toEqual([first]);
    expect(first!.textContent).toBe("b { color: blue }");
    ui.unmount();
  });

  it("removes the element when the css empties and on unmount", () => {
    const ui = mountDom(createElement(Harness, { name: "k", css: "a {}" }));
    ui.rerender(createElement(Harness, { name: "k", css: "" }));
    expect(styles("k")).toHaveLength(0);
    ui.rerender(createElement(Harness, { name: "k", css: "a {}" }));
    expect(styles("k")).toHaveLength(1);
    ui.unmount();
    expect(styles("k")).toHaveLength(0);
  });

  it("keeps separate keys apart", () => {
    const ui = mountDom(createElement("div", null, createElement(Harness, { name: "one", css: "a {}" }), createElement(Harness, { name: "two", css: "b {}" })));
    expect(styles("one")).toHaveLength(1);
    expect(styles("two")).toHaveLength(1);
    ui.unmount();
  });
});

describe("blockSelector", () => {
  it("targets the block wrapper by id", () => {
    expect(blockSelector("abc-123_X")).toBe('.dali-doc .bn-block-outer[data-id="abc-123_X"]');
  });

  it("skips ids it cannot quote safely when CSS.escape is unavailable", () => {
    const original = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = undefined;
    expect(blockSelector('a"] { x')).toBeNull();
    (globalThis as { CSS?: unknown }).CSS = original;
  });
});
