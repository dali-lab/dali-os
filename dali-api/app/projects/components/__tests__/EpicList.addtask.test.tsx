// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { EpicList } from "../EpicList";
import type { TimelineEpic } from "../EpicsTimeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const iso = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

// One epic holding a sprinted task and a story (requirement) side by side.
function fixture(): TimelineEpic[] {
  return [
    {
      id: "epic-1",
      title: "Design",
      status: "InProgress",
      startsAt: iso(5),
      endsAt: iso(11),
      stories: [],
      requirements: [{ id: "story-1", title: "Onboarding", status: "InProgress", incomplete: false }],
      tasks: [
        {
          id: "task-1",
          title: "Wireframes",
          status: "Todo",
          startsAt: iso(5),
          endsAt: iso(11),
          assignees: [],
          commentCount: 0,
          fileCount: 0,
        },
      ],
      progress: { done: 1, total: 3 },
    },
  ];
}

const ADD_LABEL = "Add task to Design";

describe("EpicList outline", () => {
  it("lists the epic's tasks and stories as siblings under it", () => {
    const html = renderToStaticMarkup(createElement(EpicList, { epics: fixture(), terms: [] }));
    expect(html).toContain("Wireframes");
    expect(html).toContain("Onboarding");
    expect(html).toContain("Requirement");
    expect(html).toContain("1/3");
  });

  it("offers the add on the epic row only, and only with onAddTask", () => {
    const withAdd = renderToStaticMarkup(
      createElement(EpicList, { epics: fixture(), terms: [], onAddTask: () => {} }),
    );
    expect(withAdd).toContain(ADD_LABEL);
    expect(withAdd.split("Add task to").length - 1).toBe(1);
    const without = renderToStaticMarkup(createElement(EpicList, { epics: fixture(), terms: [] }));
    expect(without).not.toContain("Add task");
  });
});

let container: HTMLDivElement | undefined;
let root: Root | undefined;
afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

describe("EpicList add-task interaction", () => {
  it("clicking the epic's add hands back its id", () => {
    const onAddTask = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(EpicList, { epics: fixture(), terms: [], onAddTask })));
    const button = container.querySelector(`[aria-label="${ADD_LABEL}"]`) as HTMLElement;
    act(() => button.click());
    expect(onAddTask).toHaveBeenCalledWith("epic-1");
  });
});
