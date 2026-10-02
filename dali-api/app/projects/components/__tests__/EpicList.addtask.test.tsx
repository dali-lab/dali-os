// @vitest-environment jsdom
//
// Guards the per-story "Add task" affordance in the Progress outline. It is the
// shortcut that files a task under the story you're looking at, so two things
// have to hold: it appears only where a task can actually be created (an
// onAddTask handler — the partner hub and viewers get none), and it hands back
// BOTH ids, since the task modal needs the epic as well as the story.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { EpicList } from "../EpicList";
import type { TimelineEpic } from "../EpicsTimeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const iso = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

// One epic → one story → one task. Epics render expanded (the component tracks
// collapsed ids, not open ones), so the story row is in the markup right away.
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

const ADD_LABEL = "Add task to Onboarding";

describe("EpicList add-task affordance (static)", () => {
  it("renders a per-story add button when onAddTask is given", () => {
    const html = renderToStaticMarkup(
      createElement(EpicList, {
        epics: fixture(),
        terms: [],
        onAddTask: () => {},
      }),
    );
    expect(html).toContain(ADD_LABEL);
  });

  it("renders nothing without onAddTask (partner hub, viewers)", () => {
    const html = renderToStaticMarkup(
      createElement(EpicList, { epics: fixture(), terms: [] }),
    );
    expect(html).not.toContain(ADD_LABEL);
    expect(html).not.toContain("Add task");
  });

  it("offers the add on story rows only, not epic or task rows", () => {
    const html = renderToStaticMarkup(
      createElement(EpicList, {
        epics: fixture(),
        terms: [],
        onAddTask: () => {},
      }),
    );
    // An epic holds stories and a task holds nothing, so neither takes a task.
    expect(html).not.toContain("Add task to Design");
    expect(html).not.toContain("Add task to Wireframes");
    expect(html.split("Add task to").length - 1).toBe(1);
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
  it("clicking a story's add hands back its epic and story ids", () => {
    const onAddTask = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        createElement(EpicList, { epics: fixture(), terms: [], onAddTask }),
      ),
    );

    const button = container.querySelector(
      `[aria-label="${ADD_LABEL}"]`,
    ) as HTMLElement;
    expect(button).toBeTruthy();
    act(() => button.click());
    // The epic comes along because the task modal's story picker is scoped to
    // an epic — a story id alone couldn't open the form filled in.
    expect(onAddTask).toHaveBeenCalledWith("epic-1", "story-1");
  });
});
