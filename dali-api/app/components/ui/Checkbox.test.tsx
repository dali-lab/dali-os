// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { Toggle } from "./Toggle";

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

describe("Checkbox / Radio / Toggle", () => {
  it("Checkbox renders a real native checkbox carrying name + checked (form-submittable)", () => {
    mount(createElement(Checkbox, { name: "opt", checked: true, onChange: () => {}, label: "Opt" }));
    const input = container.querySelector("input[type='checkbox'][name='opt']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(true);
    expect(container.textContent).toContain("Opt");
  });

  it("Checkbox reflects the controlled checked value", () => {
    mount(createElement(Checkbox, { name: "opt", checked: false, onChange: () => {} }));
    expect((container.querySelector("input[name='opt']") as HTMLInputElement).checked).toBe(false);
  });

  it("Toggle renders a native switch input with name", () => {
    mount(createElement(Toggle, { name: "sw", checked: true, onChange: () => {}, label: "On" }));
    const input = container.querySelector("input[type='checkbox'][role='switch'][name='sw']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(true);
  });

  it("Radio renders a native radio with name + value", () => {
    mount(createElement(Radio, { name: "r", value: "a", defaultChecked: true, label: "A" }));
    const input = container.querySelector("input[type='radio'][name='r']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("a");
  });
});
