// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DateField } from "./DateField";

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

const hidden = (name: string) =>
  container.querySelector(`input[name='${name}']`) as HTMLInputElement | null;
const triggerText = () =>
  container.querySelector("button[aria-haspopup='dialog']")?.textContent ?? "";

describe("DateField value contract", () => {
  it("date: hidden native input carries the exact yyyy-MM-dd string for <Form> submission", () => {
    mount(createElement(DateField, { mode: "date", name: "d", value: "2026-08-03", onChange: () => {} }));
    expect(hidden("d")?.value).toBe("2026-08-03");
    expect(triggerText()).toContain("2026"); // human label, tz-pinned
  });

  it("datetime-local: hidden input carries yyyy-MM-ddThh:mm unchanged", () => {
    mount(createElement(DateField, { mode: "datetime-local", name: "dt", value: "2026-08-03T14:30", onChange: () => {} }));
    expect(hidden("dt")?.value).toBe("2026-08-03T14:30");
  });

  it("time: hidden input carries HH:mm", () => {
    mount(createElement(DateField, { mode: "time", name: "t", value: "09:05", onChange: () => {} }));
    // Hidden input keeps 24h "HH:mm" (the value contract); the trigger shows 12h.
    expect(hidden("t")?.value).toBe("09:05");
    expect(triggerText()).toContain("9:05 AM");
  });

  it("no hidden input when uncontrolled without a name (pure controlled/onChange)", () => {
    mount(createElement(DateField, { mode: "date", value: "2026-01-01", onChange: () => {} }));
    expect(container.querySelector("input")).toBeNull();
  });

  it("shows the placeholder when empty", () => {
    mount(createElement(DateField, { mode: "date", value: "", onChange: () => {}, placeholder: "Pick a day" }));
    expect(triggerText()).toContain("Pick a day");
  });
});
