// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { Menu } from "~/components/ui/floating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <PanelFrame panel={{ type: "doc", id: "p1" }} title="Notes" onClose={onClose}>
          <Menu trigger={<button type="button">Menu</button>} ariaLabel="Actions">
            <Menu.Item>Rename</Menu.Item>
          </Menu>
        </PanelFrame>
      </MemoryRouter>,
    ),
  );
}

const escape = (target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onClose.mockClear();
});

describe("PanelFrame header", () => {
  it("labels the panel and offers the full page", () => {
    mount();
    expect(container.textContent).toContain("Side view");
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Open full page"));
    expect(link?.getAttribute("href")).toBe("/documents/p1");
  });

  it("closes from the close button, which shows the Esc hint", () => {
    mount();
    const close = container.querySelector<HTMLButtonElement>("[aria-label='Close panel']")!;
    expect(close.textContent).toContain("Esc");
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    mount();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to a handler that already claimed it", () => {
    mount();
    const claim = (e: Event) => e.preventDefault();
    document.body.addEventListener("keydown", claim);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    document.body.removeEventListener("keydown", claim);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when Escape is pressed inside an open menu", () => {
    mount();
    act(() => container.querySelector<HTMLButtonElement>("button:not([aria-label])")!.click());
    const item = document.body.querySelector<HTMLElement>("[role='menuitem']")!;
    act(() => item.focus());
    escape(item);
    expect(onClose).not.toHaveBeenCalled();
  });
});
