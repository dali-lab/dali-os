// @vitest-environment jsdom
//
// Guards the edit-mode drag *affordances* on the timeline. The drag logic has
// always worked, but the bars gave no sign they could be dragged: `draggable`
// was never passed down, so the grab cursor, the end grips and the grab handle
// never rendered and turning on Edit looked like it did nothing. These tests
// pin that the affordances appear exactly when a drag could actually be saved
// (edit mode + an onReschedule), stay off otherwise (read view, partner hub),
// and that a drag still commits through onReschedule.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { EpicsTimeline, type TimelineEpic } from "../EpicsTimeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lays nothing out, so a scroller reports clientWidth 0 — which collapses
// the timeline's render window to zero and culls every bar. Give it a width so
// the bars mount and can be grabbed. Also stub the scroll methods jsdom omits.
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 4000,
});
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

const iso = (day: number) =>
  new Date(Date.UTC(2026, 0, day)).toISOString();

// One epic → one story → one task, all dated so all three draw as bars.
function fixture(): TimelineEpic[] {
  return [
    {
      id: "epic-1",
      title: "Design",
      status: "Open",
      startsAt: iso(5),
      endsAt: iso(30),
      stories: [
        {
          id: "story-1",
          title: "Onboarding",
          status: "InProgress",
          startsAt: iso(6),
          endsAt: iso(20),
          tasks: [
            {
              id: "task-1",
              title: "Wireframes",
              status: "Todo",
              startsAt: iso(7),
              endsAt: iso(10),
              assignees: [],
              commentCount: 0,
              fileCount: 0,
            },
          ],
        },
      ],
      tasks: [],
    },
  ];
}

const HINT = "Drag a bar to move it, or grab an end to change one date.";
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

// ── Static render: which affordances the markup carries ──────────────────────

describe("EpicsTimeline drag affordances (static)", () => {
  it("read view shows no drag affordances", () => {
    const html = renderToStaticMarkup(
      createElement(EpicsTimeline, {
        epics: fixture(),
        onEpicClick: () => {},
        onStoryClick: () => {},
        onTaskClick: () => {},
      }),
    );
    expect(html).not.toContain(HINT);
    expect(html).not.toContain("cursor-grab");
    expect(html).not.toContain("cursor-ew-resize");
    expect(html).not.toContain("lucide-grip-vertical");
    // The bars are still clickable-to-open in the read view.
    expect(html).toContain("cursor-pointer");
  });

  it("edit mode with a reschedule handler shows the hint, grips and grab handles", () => {
    const html = renderToStaticMarkup(
      createElement(EpicsTimeline, {
        epics: fixture(),
        editMode: true,
        onReschedule: () => {},
        onEpicClick: () => {},
        onStoryClick: () => {},
        onTaskClick: () => {},
      }),
    );
    // The one-line explanation of what edit mode now lets you do.
    expect(html).toContain(HINT);
    // Every bar becomes grabbable...
    expect(html).toContain("cursor-grab");
    // ...and carries the end grips that move a single date, with their titles.
    expect(html).toContain("cursor-ew-resize");
    expect(html).toContain("Drag to move the start date");
    expect(html).toContain("Drag to move the end date");
    // A grab handle on each of the three bars, plus the one in the hint.
    expect(count(html, "lucide-grip-vertical")).toBe(4);
    // Each draggable bar draws both grips (start + end) → three of each.
    expect(count(html, "Drag to move the start date")).toBe(3);
    expect(count(html, "Drag to move the end date")).toBe(3);
  });

  it("edit mode WITHOUT a reschedule handler stays read-only (partner/viewer)", () => {
    // The partner hub and non-managers never get onReschedule; even if editMode
    // were set, nothing should advertise a drag that can't be saved.
    const html = renderToStaticMarkup(
      createElement(EpicsTimeline, {
        epics: fixture(),
        editMode: true,
        onEpicClick: () => {},
        onStoryClick: () => {},
        onTaskClick: () => {},
      }),
    );
    expect(html).not.toContain(HINT);
    expect(html).not.toContain("cursor-grab");
    expect(html).not.toContain("cursor-ew-resize");
    expect(html).not.toContain("lucide-grip-vertical");
  });
});

// ── Interaction: a drag still reaches onReschedule ───────────────────────────

let container: HTMLDivElement | undefined;
let root: Root | undefined;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}
afterEach(() => {
  // Only the interaction tests mount; the static ones render to a string.
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

const PX_PER_DAY = 42; // mirrors the constant in EpicsTimeline

function pointerDown(el: Element, clientX: number) {
  act(() =>
    void el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX }),
    ),
  );
}
function windowPointer(type: "pointermove" | "pointerup", clientX: number) {
  act(() => void window.dispatchEvent(new MouseEvent(type, { clientX })));
}

function taskBar(): HTMLElement {
  return container!.querySelector(".os-bar-label--task") as HTMLElement;
}

describe("EpicsTimeline drag interaction", () => {
  it("dragging a task bar sideways reschedules by whole days", () => {
    const onReschedule = vi.fn();
    mount(
      createElement(EpicsTimeline, {
        epics: fixture(),
        editMode: true,
        onReschedule,
        onTaskClick: () => {},
      }),
    );
    const bar = taskBar();
    expect(bar).toBeTruthy();
    // Grab the body (a "move") and drag three columns to the right.
    pointerDown(bar, 100);
    windowPointer("pointermove", 100 + PX_PER_DAY * 3);
    windowPointer("pointerup", 100 + PX_PER_DAY * 3);
    expect(onReschedule).toHaveBeenCalledWith("task", "task-1", 3, "move");
  });

  it("dragging a task's start grip moves only the start date", () => {
    const onReschedule = vi.fn();
    mount(
      createElement(EpicsTimeline, {
        epics: fixture(),
        editMode: true,
        onReschedule,
        onTaskClick: () => {},
      }),
    );
    const grip = taskBar().querySelector(
      '[title="Drag to move the start date"]',
    ) as HTMLElement;
    expect(grip).toBeTruthy();
    pointerDown(grip, 200);
    windowPointer("pointermove", 200 + PX_PER_DAY);
    windowPointer("pointerup", 200 + PX_PER_DAY);
    expect(onReschedule).toHaveBeenCalledWith("task", "task-1", 1, "start");
  });

  it("does not reschedule from the read view (no edit mode)", () => {
    const onReschedule = vi.fn();
    mount(
      createElement(EpicsTimeline, {
        epics: fixture(),
        onReschedule,
        onTaskClick: () => {},
      }),
    );
    pointerDown(taskBar(), 100);
    windowPointer("pointermove", 100 + PX_PER_DAY * 3);
    windowPointer("pointerup", 100 + PX_PER_DAY * 3);
    expect(onReschedule).not.toHaveBeenCalled();
  });
});
