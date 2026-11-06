// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MultiSelect } from "./MultiSelect";
import { SEARCH_THRESHOLD } from "./search";
import type { SelectOption } from "./Select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function makeOptions(n: number): SelectOption[] {
  return Array.from({ length: n }, (_, i) => ({
    value: `v${i}`,
    label: `Option ${i}`,
    description: i === 3 ? "Special" : undefined,
  }));
}

let latest: string[] = [];
function Harness(props: { options: SelectOption[]; initial?: string[]; searchable?: boolean; name?: string }) {
  const [values, setValues] = useState<string[]>(props.initial ?? []);
  latest = values;
  return createElement(MultiSelect, {
    values,
    onChange: setValues,
    options: props.options,
    searchable: props.searchable,
    name: props.name,
    ariaLabel: "Things",
  });
}

function trigger(): HTMLButtonElement {
  return container.querySelector("button[aria-haspopup]") as HTMLButtonElement;
}
function openPanel() {
  act(() => trigger().dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function search(): HTMLInputElement | null {
  return document.querySelector("input[type='search']");
}
function rows(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button[role='option']"));
}
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(el: HTMLElement, k: string) {
  act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
}

describe("MultiSelect", () => {
  it("has no search box for a short list", () => {
    mount(createElement(Harness, { options: makeOptions(SEARCH_THRESHOLD) }));
    openPanel();
    expect(search()).toBeNull();
    expect(rows()).toHaveLength(SEARCH_THRESHOLD);
  });

  it("adds a search box once the list is longer than the threshold", () => {
    mount(createElement(Harness, { options: makeOptions(SEARCH_THRESHOLD + 1) }));
    openPanel();
    expect(search()).not.toBeNull();
  });

  it("shows search on a short list when searchable is set", () => {
    mount(createElement(Harness, { options: makeOptions(2), searchable: true }));
    openPanel();
    expect(search()).not.toBeNull();
  });

  it("narrows rows by label and description", () => {
    mount(createElement(Harness, { options: makeOptions(12) }));
    openPanel();
    type(search()!, "option 1");
    expect(rows().map((r) => r.textContent)).toEqual(["Option 1", "Option 10", "Option 11"]);
    type(search()!, "special");
    expect(rows().map((r) => r.textContent)).toEqual(["Option 3Special"]);
  });

  it("says so when nothing matches", () => {
    mount(createElement(Harness, { options: makeOptions(12) }));
    openPanel();
    type(search()!, "zzz");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matches");
  });

  it("toggles rows by click and keeps the panel open", () => {
    mount(createElement(Harness, { options: makeOptions(12) }));
    openPanel();
    type(search()!, "option 2");
    act(() => rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(latest).toEqual(["v2"]);
    expect(search()).not.toBeNull();
    act(() => rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(latest).toEqual([]);
  });

  it("moves the highlight with the arrow keys and toggles with Enter", () => {
    mount(createElement(Harness, { options: makeOptions(12) }));
    openPanel();
    const input = search()!;
    type(input, "option 1");
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows()[1].id);
    key(input, "Enter");
    expect(latest).toEqual(["v10"]);
    key(input, "ArrowUp");
    key(input, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows()[2].id);
  });

  it("skips disabled rows when moving the highlight", () => {
    const options = makeOptions(12).map((o, i) => (i === 0 ? { ...o, disabled: true } : o));
    mount(createElement(Harness, { options }));
    openPanel();
    const input = search()!;
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows()[1].id);
  });

  it("clears the query when the panel closes", () => {
    mount(createElement(Harness, { options: makeOptions(12) }));
    openPanel();
    type(search()!, "option 1");
    openPanel();
    expect(search()).toBeNull();
    openPanel();
    expect(search()!.value).toBe("");
    expect(rows()).toHaveLength(12);
  });

  it("posts one hidden input per chosen value under name", () => {
    mount(createElement(Harness, { options: makeOptions(3), initial: ["v0", "v2"], name: "ids" }));
    const hidden = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='hidden'][name='ids']"));
    expect(hidden.map((h) => h.value)).toEqual(["v0", "v2"]);
  });

  it("posts nothing without a name", () => {
    mount(createElement(Harness, { options: makeOptions(3), initial: ["v0"] }));
    expect(container.querySelectorAll("input[type='hidden']")).toHaveLength(0);
  });
});
