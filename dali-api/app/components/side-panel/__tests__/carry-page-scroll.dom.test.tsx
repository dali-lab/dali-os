// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { useCarryPageScroll } from "~/components/side-panel/use-side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let navigate: ReturnType<typeof useNavigate>;
let page: HTMLDivElement | null = null;
const scrollTo = vi.fn();

function Harness() {
  const open = new URLSearchParams(useLocation().search).has("side");
  const ref = useCarryPageScroll(open);
  navigate = useNavigate();
  return (
    <div
      ref={(el) => {
        ref.current = el;
        page = el;
      }}
    />
  );
}

function setCovers(covers: boolean) {
  window.matchMedia = ((query: string) => ({ matches: covers, media: query })) as unknown as typeof window.matchMedia;
}

function setWindowY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

function go(to: string) {
  act(() => navigate(to));
}

function scrollColumn(y: number) {
  page!.scrollTop = y;
  act(() => {
    page!.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  setCovers(false);
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Harness />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  scrollTo.mockClear();
  setWindowY(0);
});

describe("useCarryPageScroll", () => {
  it("leaves the window alone when the page mounts with no panel", () => {
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("moves the window's scroll into the page column when the panel opens", () => {
    setWindowY(640);
    go("/admin?side");
    expect(page!.scrollTop).toBe(640);
  });

  it("hands the column's scroll back to the window when the panel closes", () => {
    go("/admin?side");
    scrollColumn(900);
    go("/admin");
    expect(scrollTo).toHaveBeenCalledWith(0, 900);
  });

  it("leaves the column to the tab's own restore when the panel opens on a different page", () => {
    setWindowY(640);
    go("/admin/audit?side");
    expect(page!.scrollTop).toBe(0);
  });

  it("leaves the window to the tab's own restore when the panel closes on a different page", () => {
    go("/admin?side");
    scrollColumn(900);
    go("/admin/audit");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when the panel covers the page on a narrow screen", () => {
    setCovers(true);
    setWindowY(640);
    go("/admin?side");
    expect(page!.scrollTop).toBe(0);
    go("/admin");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
