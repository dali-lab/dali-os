// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DateField } from "./DateField";
import { isInFloatingLayer } from "./floating/outside";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships no ResizeObserver (the popover observes itself so a pane switch
// re-places it) and no scrollIntoView (the year list scrolls to the selection).
// No-op stand-ins are enough — these tests assert content, not geometry, which
// jsdom has none of anyway.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const hidden = (name: string) =>
  container.querySelector(`input[name='${name}']`) as HTMLInputElement | null;
const triggerEl = () =>
  container.querySelector("button[aria-haspopup='dialog']") as HTMLButtonElement;
const triggerText = () => triggerEl()?.textContent ?? "";
const popover = () => document.querySelector("[data-datefield-popover]") as HTMLElement | null;
const openPopover = () => act(() => triggerEl().click());
const clickText = (scope: HTMLElement, text: string) => {
  const btn = Array.from(scope.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`no button labelled "${text}"`);
  act(() => btn.click());
};

describe("DateField value contract", () => {
  it("date: hidden native input carries the exact yyyy-MM-dd string for <Form> submission", () => {
    mount(createElement(DateField, { mode: "date", name: "d", value: "2026-08-03", onChange: () => {} }));
    expect(hidden("d")?.value).toBe("2026-08-03");
    expect(triggerText()).toContain("2026"); // human label, tz-pinned
  });

  it("datetime-local: hidden input carries yyyy-MM-ddThh:mm unchanged", () => {
    mount(createElement(DateField, { mode: "datetime-local", name: "dt", value: "2026-08-03T14:30", onChange: () => {} }));
    expect(hidden("dt")?.value).toBe("2026-08-03T14:30");
  });

  it("time: hidden input carries HH:mm", () => {
    mount(createElement(DateField, { mode: "time", name: "t", value: "09:05", onChange: () => {} }));
    // Hidden input keeps 24h "HH:mm" (the value contract); the trigger shows 12h.
    expect(hidden("t")?.value).toBe("09:05");
    expect(triggerText()).toContain("9:05 AM");
  });

  it("no hidden input when uncontrolled without a name (pure controlled/onChange)", () => {
    mount(createElement(DateField, { mode: "date", value: "2026-01-01", onChange: () => {} }));
    expect(container.querySelector("input")).toBeNull();
  });

  it("shows the placeholder when empty", () => {
    mount(createElement(DateField, { mode: "date", value: "", onChange: () => {}, placeholder: "Pick a day" }));
    expect(triggerText()).toContain("Pick a day");
  });
});

describe("DateField calendar", () => {
  it("marks today in the open calendar", () => {
    mount(createElement(DateField, { mode: "date", name: "d", value: "", onChange: () => {} }));
    openPopover();
    const today = popover()?.querySelector("[aria-current='date']");
    expect(today?.textContent).toBe(String(new Date().getDate()));
  });

  it("opens centred on the selected month, not today", () => {
    mount(createElement(DateField, { mode: "date", value: "1998-03-17", onChange: () => {} }));
    openPopover();
    expect(popover()?.textContent).toContain("March");
    expect(popover()?.textContent).toContain("1998");
  });
});

describe("DateField month / year panes", () => {
  // A birthday was unreachable: the only way back to a birth year was clicking
  // the month arrow a few hundred times.
  it("the year chip lists years and jumps the calendar to the one picked", () => {
    const seen: string[] = [];
    mount(
      createElement(DateField, {
        mode: "date",
        value: "2026-10-02",
        onChange: (v: string) => seen.push(v),
      }),
    );
    openPopover();
    const pop = popover()!;
    clickText(pop, "2026"); // the year chip
    clickText(pop, "1998");
    expect(pop.textContent).toContain("1998");
    // Jumping the view is not a value change; the day still has to be clicked.
    expect(seen).toEqual([]);
    clickText(pop, "17");
    expect(seen).toEqual(["1998-10-17"]);
  });

  it("offers a century of years by default, so a birth year is in reach", () => {
    mount(createElement(DateField, { mode: "date", value: "2026-10-02", onChange: () => {} }));
    openPopover();
    const pop = popover()!;
    clickText(pop, "2026");
    const years = Array.from(pop.querySelectorAll("[role='group'][aria-label='Year'] button")).map(
      (b) => b.textContent,
    );
    expect(years).toContain("1926");
    expect(years).toContain("2036");
  });

  it("clamps the year list to min/max rather than offering impossible years", () => {
    mount(
      createElement(DateField, {
        mode: "date",
        value: "2026-10-02",
        min: "2026-01-01",
        max: "2028-12-31",
        onChange: () => {},
      }),
    );
    openPopover();
    const pop = popover()!;
    clickText(pop, "2026");
    const years = Array.from(pop.querySelectorAll("[role='group'][aria-label='Year'] button")).map(
      (b) => b.textContent,
    );
    expect(years).toEqual(["2026", "2027", "2028"]);
  });

  it("keeps the edited value's year reachable even when it falls outside min/max", () => {
    mount(
      createElement(DateField, {
        mode: "date",
        value: "1990-05-01",
        min: "2026-01-01",
        onChange: () => {},
      }),
    );
    openPopover();
    const pop = popover()!;
    clickText(pop, "1990");
    const years = Array.from(pop.querySelectorAll("[role='group'][aria-label='Year'] button")).map(
      (b) => b.textContent,
    );
    expect(years[0]).toBe("1990");
  });

  it("the month chip picks a month without leaving the popover", () => {
    mount(createElement(DateField, { mode: "date", value: "2026-10-02", onChange: () => {} }));
    openPopover();
    const pop = popover()!;
    clickText(pop, "October"); // the month chip
    clickText(pop, "Feb");
    expect(pop.textContent).toContain("February");
    expect(popover()).not.toBeNull(); // still open
  });
});

describe("DateField popover and its host", () => {
  // The timesheet / calendar cards dismiss on an outside pointerdown. The
  // picker portals to <body>, so without this tag a click on a day read as
  // "outside" and closed the whole new-entry form before the date landed.
  it("tags the popover as a floating layer so a host card does not dismiss itself", () => {
    mount(createElement(DateField, { mode: "datetime-local", value: "2026-10-02T09:00", onChange: () => {} }));
    openPopover();
    const day = popover()!.querySelector("[data-day='2026-10-02']")!;
    expect(isInFloatingLayer(day)).toBe(true);
  });

  it("renders the popover immediately so its height can be measured before placing it", () => {
    mount(createElement(DateField, { mode: "date", value: "", onChange: () => {} }));
    openPopover();
    expect(popover()).not.toBeNull();
  });
});
