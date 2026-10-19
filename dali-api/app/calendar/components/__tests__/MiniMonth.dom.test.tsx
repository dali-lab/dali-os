// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalendarView } from "~/calendar/lib/types";
import { MiniMonth } from "~/calendar/components/MiniMonth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function render(view: CalendarView, focusDate: Date) {
  act(() => {
    root.render(createElement(MiniMonth, { focusDate, view, timezone: "UTC", onPick: () => {} }));
  });
  return [...host.querySelectorAll<HTMLButtonElement>('button[aria-current="date"]')];
}

describe("MiniMonth focus highlight", () => {
  it("marks every day of the focused week in week view, not just its Sunday", () => {
    const marked = render("week", new Date(Date.UTC(2026, 9, 18)));
    expect(marked.map((b) => b.textContent)).toEqual(["18", "19", "20", "21", "22", "23", "24"]);
    expect(marked.every((b) => b.className.includes("bg-muted"))).toBe(true);
    expect(marked[0].className).toContain("rounded-l-md");
    expect(marked[6].className).toContain("rounded-r-md");
    expect(marked[3].className).not.toContain("rounded-md");
  });

  it("marks only the focused day in day view", () => {
    const marked = render("day", new Date(Date.UTC(2026, 9, 21)));
    expect(marked.map((b) => b.textContent)).toEqual(["21"]);
    expect(marked[0].className).toContain("rounded-md");
  });

  it.each<CalendarView>(["month", "agenda"])("marks no day in %s view", (view) => {
    expect(render(view, new Date(Date.UTC(2026, 9, 11)))).toEqual([]);
  });

  it("keeps today's accent inside the week band", () => {
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const marked = render("week", new Date(Date.UTC(2026, 9, 18)));
    const today = marked.find((b) => b.textContent === "20")!;
    expect(today.className).toContain("bg-os-accent");
    expect(today.className).not.toContain("bg-muted");
  });
});
