// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { CrumbSwitcher } from "~/components/Breadcrumbs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function openSwitcher() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <CrumbSwitcher
          label="Board"
          siblings={[
            { label: "Board", to: "/p/board", current: true },
            { label: "Files", to: "/p/files" },
          ]}
        />
      </MemoryRouter>,
    ),
  );
  const trigger = container.querySelector("button")!;
  act(() => trigger.click());
  return trigger;
}

describe("CrumbSwitcher", () => {
  it("marks focus and the current sibling with the os accent, never coral", () => {
    const trigger = openSwitcher();
    expect(trigger.className).toContain("ring-os-accent");
    expect(document.body.innerHTML).not.toContain("accent-coral");
    expect(document.body.querySelector("svg.text-os-accent")).not.toBeNull();
  });

  it("draws its rows like every other menu row", () => {
    openSwitcher();
    const rows = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.classList.contains("px-3")).toBe(true);
      expect(row.classList.contains("py-2")).toBe(true);
      expect(row.classList.contains("rounded-lg")).toBe(true);
      expect(row.classList.contains("hover:bg-muted")).toBe(true);
    }
    expect(rows[0].classList.contains("text-foreground")).toBe(true);
    expect(rows[1].classList.contains("text-muted-foreground")).toBe(true);
  });
});
