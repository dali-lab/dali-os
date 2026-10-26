// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { Menu } from "~/components/ui/floating";
import { PageBarMenuItems, PageBarPortal } from "~/components/shell/page-bar-slot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function Contribution() {
  return (
    <>
      <PageBarPortal slot="actions">
        <span>Edited today</span>
      </PageBarPortal>
      <PageBarMenuItems>
        <Menu.Item>Download PDF</Menu.Item>
      </PageBarMenuItems>
    </>
  );
}

function mount(location: string | null = null, contribute = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <PanelFrame panel={{ type: "doc", id: "p1" }} title="Notes" location={location} onClose={onClose}>
          {contribute && <Contribution />}
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
  it("is one header row: close, open full page, then the overflow menu", () => {
    mount();
    expect(container.textContent).not.toContain("Side view");
    expect(container.textContent).not.toContain("Esc");
    const header = container.querySelector("aside > div:nth-of-type(2)")!;
    const labels = [...header.querySelectorAll("a, button")].map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["Close panel", "Open full page", "More actions"]);
    const link = container.querySelector("a[aria-label='Open full page']");
    expect(link?.getAttribute("href")).toBe("/documents/p1");
  });

  it("shows where the document lives when known", () => {
    mount("My Drive");
    expect(container.textContent).toContain("My Drive");
  });

  it("closes from the close button", () => {
    mount();
    act(() => container.querySelector<HTMLButtonElement>("[aria-label='Close panel']")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hints Esc in the close tooltip", async () => {
    mount();
    const close = container.querySelector<HTMLButtonElement>("[aria-label='Close panel']")!;
    await act(async () => {
      close.dispatchEvent(new FocusEvent("focus"));
      close.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toContain("Esc");
  });

  it("publishes its width for the feedback button and clears it on close", () => {
    mount();
    expect(document.documentElement.style.getPropertyValue("--side-panel-w")).toMatch(/^\d+px$/);
    act(() => root.unmount());
    expect(document.documentElement.style.getPropertyValue("--side-panel-w")).toBe("");
    root = createRoot(container);
  });

  it("puts a page's registered entries in the overflow menu and its slot content in the header", async () => {
    mount(null, true);
    expect(container.textContent).toContain("Edited today");
    await act(async () => {
      container.querySelector<HTMLElement>("[aria-label='More actions']")!.click();
    });
    expect(document.body.querySelector("[role='menuitem']")?.textContent).toContain("Download PDF");
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

  it.each([
    [
      "the document editor",
      () => {
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        editor.tabIndex = 0;
        return editor;
      },
    ],
    ["a text field", () => document.createElement("textarea")],
  ])("first Escape in %s leaves it, the next one closes", (_, make) => {
    mount();
    const field = make() as HTMLElement;
    container.querySelector("[aria-label]")!.appendChild(field);
    act(() => field.focus());
    escape(field);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
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
