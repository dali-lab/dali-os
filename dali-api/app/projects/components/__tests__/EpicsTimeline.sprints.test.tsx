// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EpicsTimeline, type TimelineEpic, type TimelineSprint } from "../EpicsTimeline";

const iso = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

const SPRINTS: TimelineSprint[] = [
  { id: "s1", startsOn: iso(5), endsOn: iso(11), label: "Sprint 1" },
  { id: "s2", startsOn: iso(12), endsOn: iso(18), label: "Sprint 2" },
];

function epics(): TimelineEpic[] {
  return [
    {
      id: "epic-1",
      title: "Design",
      status: "InProgress",
      startsAt: iso(5),
      endsAt: iso(18),
      stories: [],
      requirements: [{ id: "st-1", title: "Onboarding", status: "Todo", incomplete: true }],
      tasks: [
        {
          id: "task-1",
          title: "Wireframes",
          status: "Todo",
          startsAt: iso(12),
          endsAt: iso(18),
          assignees: [],
          commentCount: 0,
          fileCount: 0,
        },
      ],
      progress: { done: 0, total: 1 },
    },
    {
      id: "epic-2",
      title: "Someday",
      status: "Open",
      startsAt: null,
      endsAt: null,
      stories: [],
      requirements: [],
      tasks: [],
      progress: { done: 0, total: 0 },
    },
  ];
}

const render = (props: Partial<Parameters<typeof EpicsTimeline>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(EpicsTimeline, {
      epics: epics(),
      sprints: SPRINTS,
      hiddenLevels: ["story"],
      onEpicClick: () => {},
      onTaskClick: () => {},
      ...props,
    }),
  );

describe("EpicsTimeline on stored sprints", () => {
  it("labels the header bands with the project's sprints", () => {
    const html = render();
    expect(html).toContain("Sprint 1");
    expect(html).toContain("Sprint 2");
  });

  it("offers no drag or resize affordances (spans follow sprints)", () => {
    const html = render();
    expect(html).not.toContain("cursor-grab");
    expect(html).not.toContain("cursor-ew-resize");
    expect(html).not.toContain("lucide-grip-vertical");
    expect(html).toContain("cursor-pointer");
  });

  it("lists an epic with nothing sprinted as unscheduled", () => {
    expect(render()).toContain("Someday");
  });

  it("drops the story level from the legend when hidden", () => {
    expect(render()).not.toContain("User stories");
  });
});
