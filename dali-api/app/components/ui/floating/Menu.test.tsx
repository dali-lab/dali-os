// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Menu } from "./Menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function openMenu() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <Menu trigger={<button type="button">Open</button>} ariaLabel="Actions">
          <Menu.Item>Rename</Menu.Item>
          <Menu.Item shortcut="⌥ click">Beside</Menu.Item>
          <Menu.Item destructive>Delete</Menu.Item>
          <Menu.LinkItem to="/x">Open page</Menu.LinkItem>
        </Menu>
      </MemoryRouter>,
    ),
  );
  act(() => (container.querySelector("button") as HTMLButtonElement).click());
  return [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];
}

describe("Menu rows", () => {
  it("use the os row shape", () => {
    const rows = openMenu();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.classList.contains("rounded-lg")).toBe(true);
      expect(row.classList.contains("px-3")).toBe(true);
      expect(row.classList.contains("py-2")).toBe(true);
    }
  });

  it("colour a destructive row with the destructive token and nothing else", () => {
    const del = openMenu()[2];
    expect(del.classList.contains("text-destructive")).toBe(true);
    expect(del.classList.contains("text-foreground")).toBe(false);
    expect(del.className).not.toContain("red-600");
  });

  it("give a plain row and a link row the same colour", () => {
    const [rename, , , link] = openMenu();
    expect(rename.classList.contains("text-foreground")).toBe(true);
    expect(link.classList.contains("text-foreground")).toBe(true);
  });

  it("show a shortcut hint only on the row that has one", () => {
    const [rename, beside] = openMenu();
    expect(beside.textContent).toContain("⌥ click");
    expect(beside.textContent).toContain("Beside");
    expect(rename.textContent).toBe("Rename");
  });
});

describe("Menu.Sub and checked rows", () => {
  function openWithSub(onPick: () => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter>
          <Menu trigger={<button type="button">Open</button>} ariaLabel="Actions">
            <Menu.Item>Plain</Menu.Item>
            <Menu.Sub label="Arrange">
              <Menu.Item shortcut="⌘]" onSelect={onPick}>Bring forward</Menu.Item>
              <Menu.Item checked>Current</Menu.Item>
            </Menu.Sub>
          </Menu>
        </MemoryRouter>,
      ),
    );
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
  }
  const sub = () => [...document.body.querySelectorAll<HTMLElement>("[role='menuitem'][aria-haspopup]")][0];

  it("opens the second panel on click and shows it beside the row", () => {
    openWithSub(() => {});
    expect(document.body.querySelector("[data-menu-sub]")).toBeNull();
    expect(sub().getAttribute("aria-expanded")).toBe("false");
    act(() => sub().click());
    expect(sub().getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector("[data-menu-sub]")!.textContent).toContain("Bring forward");
  });

  it("opens on hover and from the right arrow key", () => {
    openWithSub(() => {});
    act(() => void sub().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => void sub().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => void sub().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(document.body.querySelector("[data-menu-sub]")).not.toBeNull();
  });

  it("runs a submenu row and closes the whole menu", () => {
    const pick = vi.fn();
    openWithSub(pick);
    act(() => sub().click());
    const item = [...document.body.querySelectorAll<HTMLElement>("[data-menu-sub] [role^='menuitem']")].find((r) => r.textContent?.startsWith("Bring forward"))!;
    expect(item.textContent).toContain("⌘]");
    act(() => item.click());
    expect(pick).toHaveBeenCalled();
    expect(document.body.querySelector("[role=menu]")).toBeNull();
  });

  it("keeps the menu open for a press inside the submenu and marks checked rows", () => {
    openWithSub(() => {});
    act(() => sub().click());
    const panel = document.body.querySelector("[data-menu-sub]")!;
    act(() => void panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    act(() => void panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.body.querySelector("[data-menu-sub]")).not.toBeNull();
    const checked = panel.querySelector("[aria-checked=true]")!;
    expect(checked.getAttribute("role")).toBe("menuitemcheckbox");
    expect(checked.textContent).toBe("Current");
  });

  it("closes the submenu with the left arrow", () => {
    openWithSub(() => {});
    act(() => sub().click());
    const panel = document.body.querySelector("[data-menu-sub]")!;
    act(() => void panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
    expect(document.body.querySelector("[data-menu-sub]")).toBeNull();
  });
});
