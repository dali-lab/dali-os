// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Sun } from "lucide-react";
import { SegmentedTabButtons } from "./SegmentedTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SegmentedTabButtons", () => {
  it("renders a tablist with aria-selected on the active tab and fires onClick", () => {
    const onClick = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(SegmentedTabButtons, {
          label: "View",
          items: [
            { label: "Day", active: true, onClick: () => {} },
            { label: "Week", onClick },
          ],
        }),
      );
    });
    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("View");
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    act(() => tabs[1].click());
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("SegmentedTabButtons island", () => {
  function mountItems(items: Parameters<typeof SegmentedTabButtons>[0]["items"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(MemoryRouter, null, createElement(SegmentedTabButtons, { items, label: "View" })),
      );
    });
    return [...container.querySelectorAll<HTMLElement>('[role="tab"], a')];
  }

  it("sits on a recessed well and raises the open tab", () => {
    const tabs = mountItems([
      { label: "Day", active: true, onClick: () => {} },
      { label: "Week", onClick: () => {} },
    ]);
    expect(container.querySelector('[role="tablist"]')!.className).toContain("bg-os-well");
    expect(tabs[0].className).toContain("bg-os-bg");
    expect(tabs[0].className).toContain("shadow-");
    expect(tabs[1].className).not.toContain("bg-os-bg");
  });

  it("renders an icon beside the label", () => {
    const tabs = mountItems([{ label: "Day", icon: Sun, active: true, onClick: () => {} }]);
    expect(tabs[0].querySelector("svg")).not.toBeNull();
  });

  it("renders real links with aria-current when every tab has an href", () => {
    const tabs = mountItems([
      { label: "One", href: "/one", active: true },
      { label: "Two", href: "/two" },
    ]);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector("nav")!.getAttribute("aria-label")).toBe("View");
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(["/one", "/two"]);
    expect(tabs.map((t) => t.getAttribute("aria-current"))).toEqual(["page", null]);
  });

  it("moves between ARIA tabs with the arrow keys, wrapping at the ends", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const onC = vi.fn();
    const tabs = mountItems([
      { label: "A", active: true, onClick: onA },
      { label: "B", onClick: onB },
      { label: "C", onClick: onC },
    ]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const key = (el: HTMLElement, k: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      });
    key(tabs[0], "ArrowRight");
    expect(onB).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(tabs[1]);
    key(tabs[0], "ArrowLeft");
    expect(onC).toHaveBeenCalledOnce();
    key(tabs[0], "End");
    expect(onC).toHaveBeenCalledTimes(2);
    key(tabs[2], "Home");
    expect(onA).toHaveBeenCalledOnce();
  });
});
