// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColorField, COLOR_PRESETS, normalizeHex } from "./ColorField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
async function open(value: string, onChange = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ColorField, { value, onChange })));
  await act(async () => {
    (container.querySelector("button[aria-label='Color']") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
  return onChange;
}
const panel = () => document.body.querySelector("[aria-label='Color'][role='dialog']") as HTMLElement;
const setText = (input: HTMLInputElement, v: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("normalizeHex", () => {
  it("accepts 6 and 3 digit hex with or without #", () => {
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" #123456 ")).toBe("#123456");
  });
  it("rejects anything else", () => {
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345g")).toBeNull();
  });
});

describe("ColorField", () => {
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the current color on the trigger", async () => {
    await open("#112233");
    expect((container.querySelector("button span") as HTMLElement).style.backgroundColor).toBe("rgb(17, 34, 51)");
  });

  it("picks a preset and closes", async () => {
    const onChange = await open("#112233");
    await act(async () => (panel().querySelector(`button[aria-label='${COLOR_PRESETS[5]}']`) as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith(COLOR_PRESETS[5]);
    expect(panel()).toBeNull();
  });

  it("marks the preset that matches the value", async () => {
    await open(COLOR_PRESETS[1]);
    expect(panel().querySelector(`button[aria-label='${COLOR_PRESETS[1]}']`)!.getAttribute("aria-pressed")).toBe("true");
  });

  it("commits a typed hex on Enter and ignores an invalid one", async () => {
    const onChange = await open("#112233");
    const input = panel().querySelector("input[aria-label='Hex color']") as HTMLInputElement;
    setText(input, "#ABCDEF");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
    onChange.mockClear();
    setText(input, "nope");
    act(() => {
      input.blur();
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("passes the system picker value through", async () => {
    const onChange = await open("#112233");
    setText(panel().querySelector("input[type='color']") as HTMLInputElement, "#00ff00");
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });
});
