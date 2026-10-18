// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
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
      createElement(
        MemoryRouter,
        null,
        createElement(
          Menu,
          { trigger: createElement("button", { type: "button" }, "Open"), ariaLabel: "Actions" },
          createElement(Menu.Item, null, "Rename"),
          createElement(Menu.Item, { destructive: true }, "Delete"),
          createElement(Menu.LinkItem, { to: "/x" }, "Open page"),
        ),
      ),
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
