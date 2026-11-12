// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
