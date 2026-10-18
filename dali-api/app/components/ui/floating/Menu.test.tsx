// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
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
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.classList.contains("rounded-lg")).toBe(true);
      expect(row.classList.contains("px-3")).toBe(true);
      expect(row.classList.contains("py-2")).toBe(true);
    }
  });

  it("colour a destructive row with the destructive token and nothing else", () => {
    const [, del] = openMenu();
    expect(del.classList.contains("text-destructive")).toBe(true);
    expect(del.classList.contains("text-foreground")).toBe(false);
    expect(del.className).not.toContain("red-600");
  });

  it("give a plain row and a link row the same colour", () => {
    const [rename, , link] = openMenu();
    expect(rename.classList.contains("text-foreground")).toBe(true);
    expect(link.classList.contains("text-foreground")).toBe(true);
  });
});
