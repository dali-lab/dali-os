// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Combobox } from "./Combobox";
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

const opts: SelectOption<string>[] = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
];

// Simulate real typing: React tracks the input's value, so we set it through
// the native setter before dispatching so onChange sees the new value.
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function input(): HTMLInputElement {
  return container.querySelector("input[role='combobox']") as HTMLInputElement;
}
function open() {
  act(() => input().dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function options(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button[role='option']"));
}

const allowMinutes = (q: string): SelectOption | null =>
  /^\d+$/.test(q) && Number(q) >= 5 && Number(q) <= 480 ? { value: q, label: `${q} min` } : null;

describe("Combobox", () => {
  it("shows the selected option's label on the trigger", () => {
    mount(createElement(Combobox, { value: "30", options: opts, onChange: () => {}, ariaLabel: "Length" }));
    expect(input().value).toBe("30 min");
  });

  it("offers a typed custom value as a selectable row", () => {
    mount(createElement(Combobox, { value: "30", options: opts, onChange: () => {}, ariaLabel: "Length", allowCustom: allowMinutes }));
    open();
    type(input(), "45");
    expect(options().map((o) => o.textContent)).toContain("45 min");
  });

  it("commits the custom value via onChange", () => {
    let chosen = "";
    mount(
      createElement(Combobox, {
        value: "30",
        options: opts,
        onChange: (v: string) => (chosen = v),
        ariaLabel: "Length",
        allowCustom: allowMinutes,
      }),
    );
    open();
    type(input(), "45");
    const row = options().find((o) => o.textContent === "45 min")!;
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(chosen).toBe("45");
  });

  it("does not offer a custom row the parser rejects", () => {
    mount(createElement(Combobox, { value: "30", options: opts, onChange: () => {}, ariaLabel: "Length", allowCustom: allowMinutes }));
    open();
    type(input(), "999"); // above the max
    expect(options().map((o) => o.textContent)).not.toContain("999 min");
  });

  it("does not duplicate a custom row that already matches an option", () => {
    mount(createElement(Combobox, { value: "30", options: opts, onChange: () => {}, ariaLabel: "Length", allowCustom: allowMinutes }));
    open();
    type(input(), "15");
    expect(options().filter((o) => o.textContent === "15 min")).toHaveLength(1);
  });
});
