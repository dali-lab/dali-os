// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OsTabBar } from "./os-page";

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

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
] as const;

describe("OsTabBar", () => {
  it("renders a ruled header strip: top-rounded plates on a hairline, not a pill", () => {
    mount(
      createElement(OsTabBar, {
        tabs: [...TABS],
        active: "overview",
        onSelect: () => {},
        ariaLabel: "Sections",
      }),
    );
    const list = container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Sections");
    // The rule that separates the header from the content below spans the
    // whole row, outside the scrolling tablist.
    const row = list.parentElement!;
    expect(row.className.split(" ")).toContain("border-b");
    expect(list.className).not.toContain("rounded-full");
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.className).toContain("rounded-t-[10px]");
      expect(tab.className).not.toContain("rounded-full");
    }
    // Only the open tab is a filled plate.
    const [overview, members] = tabs;
    expect(overview.className).toContain("bg-os-container");
    expect(members.className).not.toContain("bg-os-container");
  });

  it("marks the active tab and reports the selected key", () => {
    const onSelect = vi.fn();
    mount(
      createElement(OsTabBar, {
        tabs: [...TABS],
        active: "overview",
        onSelect,
      }),
    );
    const [overview, members] = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(overview.getAttribute("aria-selected")).toBe("true");
    expect(members.getAttribute("aria-selected")).toBe("false");
    act(() => members.click());
    expect(onSelect).toHaveBeenCalledWith("members");
  });

  it("pins trailing content to the right of the track", () => {
    mount(
      createElement(OsTabBar, {
        tabs: [...TABS],
        active: "members",
        onSelect: () => {},
        trailing: createElement("button", { type: "button" }, "Gear"),
      }),
    );
    const gear = container.querySelector("button:not([role='tab'])")!;
    expect(gear.textContent).toBe("Gear");
    expect(gear.parentElement!.className).toContain("ml-auto");
    expect(gear.closest('[role="tablist"]')).toBeNull();
  });
});
