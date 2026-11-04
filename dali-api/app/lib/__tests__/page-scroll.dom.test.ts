// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SCROLLER_ATTR, isPageScroll, pageScrollY, scrollPageTo } from "~/lib/page-scroll";

const scrollTo = vi.fn();
let column: HTMLDivElement;

function setWindowY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

beforeEach(() => {
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  column = document.createElement("div");
  document.body.appendChild(column);
});

afterEach(() => {
  column.remove();
  scrollTo.mockClear();
  setWindowY(0);
});

function makeScroller() {
  column.setAttribute(PAGE_SCROLLER_ATTR, "");
  column.style.overflowY = "auto";
}

describe("page scroll with no side panel", () => {
  it("reads and moves the window", () => {
    setWindowY(412.4);
    expect(pageScrollY()).toBe(412);
    scrollPageTo(80);
    expect(scrollTo).toHaveBeenCalledWith(0, 80);
  });

  it("counts only the document's own scroll", () => {
    expect(isPageScroll({ target: document } as unknown as Event)).toBe(true);
    expect(isPageScroll({ target: column } as unknown as Event)).toBe(false);
  });
});

describe("page scroll beside an open side panel", () => {
  it("reads and moves the page column instead of the window", () => {
    makeScroller();
    setWindowY(0);
    column.scrollTop = 300;
    expect(pageScrollY()).toBe(300);
    scrollPageTo(120);
    expect(column.scrollTop).toBe(120);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("counts the column's scroll as the page's", () => {
    makeScroller();
    expect(isPageScroll({ target: column } as unknown as Event)).toBe(true);
  });

  it("falls back to the window when the column isn't scrolling, as on a narrow screen", () => {
    column.setAttribute(PAGE_SCROLLER_ATTR, "");
    setWindowY(50);
    expect(pageScrollY()).toBe(50);
    scrollPageTo(10);
    expect(scrollTo).toHaveBeenCalledWith(0, 10);
  });
});
