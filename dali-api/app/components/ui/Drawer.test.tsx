// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Drawer } from "./Drawer";

// Tell React we drive updates through act() (no setupFile in this repo) —
// same pattern as app/components/__tests__/Modal.test.tsx.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("data-modal-open");
});

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    const { container, unmount } = mount(
      createElement(Drawer, { open: false, onClose: () => {}, title: "Tasks", children: "body" }),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });

  it("renders the title, children, and a dialog role when open", () => {
    const { container, unmount } = mount(
      createElement(Drawer, { open: true, onClose: () => {}, title: "Tasks (3)", children: "the body content" }),
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.textContent).toContain("Tasks (3)");
    expect(container.textContent).toContain("the body content");
    unmount();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    const { container, unmount } = mount(
      createElement(Drawer, { open: true, onClose, title: "Tasks", children: "body" }),
    );
    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    const { unmount } = mount(createElement(Drawer, { open: true, onClose, title: "Tasks", children: "body" }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("renders headerActions before the Close button", () => {
    const { container, unmount } = mount(
      createElement(Drawer, {
        open: true,
        onClose: () => {},
        title: "Tasks",
        headerActions: createElement("a", { href: "/tasks" }, "See all"),
        children: "body",
      }),
    );
    expect(container.textContent).toContain("See all");
    unmount();
  });

  it("renders a footer only when provided", () => {
    const withoutFooter = mount(
      createElement(Drawer, { open: true, onClose: () => {}, title: "Tasks", children: "body" }),
    );
    expect(withoutFooter.container.querySelector(".border-t")).toBeNull();
    withoutFooter.unmount();

    const withFooter = mount(
      createElement(Drawer, {
        open: true,
        onClose: () => {},
        title: "Tasks",
        children: "body",
        footer: createElement("button", null, "Apply"),
      }),
    );
    expect(withFooter.container.textContent).toContain("Apply");
    withFooter.unmount();
  });

  it("defaults to a 480px max width and accepts 360", () => {
    const wide = mount(createElement(Drawer, { open: true, onClose: () => {}, title: "Tasks", children: "body" }));
    expect(wide.container.querySelector(".max-w-\\[480px\\]")).not.toBeNull();
    wide.unmount();

    const narrow = mount(
      createElement(Drawer, { open: true, onClose: () => {}, title: "Tasks", children: "body", width: 360 }),
    );
    expect(narrow.container.querySelector(".max-w-\\[360px\\]")).not.toBeNull();
    narrow.unmount();
  });
});
