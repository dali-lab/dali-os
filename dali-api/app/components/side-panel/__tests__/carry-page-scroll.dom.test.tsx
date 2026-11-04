// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { useCarryPageScroll } from "~/components/side-panel/use-side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let navigate: ReturnType<typeof useNavigate>;
let page: HTMLDivElement | null = null;
const scrollTo = vi.fn();

function Harness({ open }: { open: boolean }) {
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

function render(open: boolean) {
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Harness open={open} />
      </MemoryRouter>,
    ),
  );
}

function setWindowY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  setCovers(false);
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  scrollTo.mockClear();
  setWindowY(0);
});

describe("useCarryPageScroll", () => {
  it("leaves the window alone when the page mounts with no panel", () => {
    render(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("moves the window's scroll into the page column when the panel opens", () => {
    render(false);
    setWindowY(640);
    render(true);
    expect(page!.scrollTop).toBe(640);
  });

  it("hands the column's scroll back to the window when the panel closes", () => {
    render(false);
    render(true);
    page!.scrollTop = 900;
    act(() => {
      page!.dispatchEvent(new Event("scroll"));
    });
    render(false);
    expect(scrollTo).toHaveBeenCalledWith(0, 900);
  });

  it("starts a new page at the top of the column while the panel stays open", () => {
    render(false);
    render(true);
    page!.scrollTop = 300;
    act(() => navigate("/admin/audit"));
    expect(page!.scrollTop).toBe(0);
  });

  it("does nothing when the panel covers the page on a narrow screen", () => {
    setCovers(true);
    render(false);
    setWindowY(640);
    render(true);
    expect(page!.scrollTop).toBe(0);
    render(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
