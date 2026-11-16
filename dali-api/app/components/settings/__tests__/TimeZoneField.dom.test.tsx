// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TimeZoneField } from "../TimeZoneField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
function mount(defaultValue: string | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(TimeZoneField, { defaultValue })));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const hidden = () => container.querySelector("input[type='hidden']") as HTMLInputElement;
const combobox = () => container.querySelector("input[role='combobox']") as HTMLInputElement;

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(combobox(), value);
    combobox().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TimeZoneField", () => {
  it("posts the saved zone and shows it without underscores", () => {
    mount("America/Los_Angeles");
    expect(hidden().name).toBe("timeZone");
    expect(hidden().value).toBe("America/Los_Angeles");
    expect(combobox().value).toBe("America/Los Angeles");
  });

  it("stays empty when no zone is saved, instead of defaulting", () => {
    mount(null);
    expect(hidden().value).toBe("");
    expect(combobox().placeholder).toBe("Choose a time zone");
  });

  it("posts the zone picked from a typed search", () => {
    mount(null);
    act(() => combobox().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    type("chicago");
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']")).find(
      (o) => o.textContent === "America/Chicago",
    )!;
    act(() => row.click());
    expect(hidden().value).toBe("America/Chicago");
  });
});
