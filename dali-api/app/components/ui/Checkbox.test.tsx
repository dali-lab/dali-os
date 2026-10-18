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

describe("Checkbox / Radio / Toggle os-shell markers", () => {
  it("Checkbox marks its box and check for the .os-shell rules in app.css", () => {
    mount(createElement(Checkbox, { checked: true, onChange: () => {} }));
    const input = container.querySelector("input")!;
    expect(input.nextElementSibling?.classList.contains("dali-check")).toBe(true);
    expect(container.querySelector(".dali-check-mark")).toBeTruthy();
  });

  it("Radio marks its ring and dot, with the ring right after the input", () => {
    mount(createElement(Radio, { name: "r", value: "a" }));
    const input = container.querySelector("input")!;
    expect(input.nextElementSibling?.classList.contains("dali-radio")).toBe(true);
    expect(container.querySelector(".dali-radio-dot")).toBeTruthy();
  });

  it("Toggle marks its track right after the input", () => {
    mount(createElement(Toggle, { checked: true, onChange: () => {} }));
    const input = container.querySelector("input")!;
    expect(input.nextElementSibling?.classList.contains("dali-switch")).toBe(true);
  });

  it("brand tone stays coral with a white check by default", () => {
    mount(createElement(Checkbox, { checked: true, onChange: () => {} }));
    expect(container.querySelector(".dali-check")!.className).toContain("peer-checked:bg-accent-coral");
    expect(container.querySelector(".dali-check-mark")!.getAttribute("class")).toContain("text-white");
  });

  it("os tone draws the check in the page colour so it reads on the pale dark accent", () => {
    mount(createElement(Checkbox, { checked: true, onChange: () => {}, tone: "os" }));
    const mark = container.querySelector(".dali-check-mark")!.getAttribute("class")!;
    expect(mark).toContain("text-os-bg");
    expect(mark).not.toContain("text-white");
    expect(container.querySelector(".dali-check")!.className).toContain("peer-checked:bg-os-accent");
  });

  it("Toggle os tone fills with the os accent; brand stays coral", () => {
    mount(createElement(Toggle, { checked: true, onChange: () => {}, tone: "os" }));
    expect(container.querySelector(".dali-switch")!.className).toContain("peer-checked:bg-os-accent");
  });
});
