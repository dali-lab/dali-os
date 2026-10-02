// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TimeField } from "./TimeField";
import { isInFloatingLayer } from "./floating/outside";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no scroll geometry; record what the list asked to scroll to instead.
let scrolledTo: string[];
beforeEach(() => {
  scrolledTo = [];
  Element.prototype.scrollIntoView = function () {
    scrolledTo.push(this.textContent ?? "");
  };
});

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
  vi.restoreAllMocks();
});

const input = () => container.querySelector("input") as HTMLInputElement;
// React tracks a controlled input's last value on the node, so a plain
// `el.value = …` is seen as a no-op. Go through the native setter.
function type(el: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const list = () => document.querySelector("[data-field-popover]") as HTMLElement | null;
const openList = () => act(() => input().focus());

describe("TimeField dropdown", () => {
  it("scrolls the selected time into view on open, rather than opening on 12:00 AM", () => {
    mount(createElement(TimeField, { value: "14:00", onChange: () => {} }));
    openList();
    expect(scrolledTo).toContain("2:00 PM");
  });

  it("opens on the first row when nothing is selected yet", () => {
    mount(createElement(TimeField, { value: "", onChange: () => {} }));
    openList();
    expect(scrolledTo).toEqual([]);
    expect(list()).not.toBeNull();
  });

  it("tags the list as a floating layer so a host card does not dismiss itself", () => {
    mount(createElement(TimeField, { value: "09:00", onChange: () => {} }));
    openList();
    const row = list()!.querySelector("button")!;
    expect(isInFloatingLayer(row)).toBe(true);
  });

  it("closes the list when focus leaves, instead of leaving it over the page", () => {
    mount(createElement(TimeField, { value: "09:00", onChange: () => {} }));
    openList();
    expect(list()).not.toBeNull();
    act(() => input().blur());
    expect(list()).toBeNull();
  });

  it("commits a freely typed time on blur, and only when it moved", () => {
    const seen: string[] = [];
    mount(createElement(TimeField, { value: "09:00", onChange: (v: string) => seen.push(v) }));
    openList();
    act(() => type(input(), "2:53 pm"));
    act(() => input().blur());
    expect(seen).toEqual(["14:53"]);
  });

  it("does not re-emit an untouched value when focus just passes through", () => {
    const seen: string[] = [];
    mount(createElement(TimeField, { value: "09:00", onChange: (v: string) => seen.push(v) }));
    openList();
    act(() => input().blur());
    expect(seen).toEqual([]);
  });
});
