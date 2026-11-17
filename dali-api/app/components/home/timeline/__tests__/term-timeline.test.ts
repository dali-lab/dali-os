import { describe, expect, it } from "vitest";
import { eventMeta, projectsLine, weekStates, type TimelineEvent } from "../term-timeline";

const event: TimelineEvent = {
  id: "e1",
  source: "alumni",
  title: "NYC alumni drinks",
  startsAt: "2026-11-20T00:00:00Z",
  hostName: "Ada Lovelace",
  location: "Online",
  goingCount: 12,
  classmates: 3,
  viewerGoing: false,
  href: null,
};

describe("weekStates", () => {
  it("tints past weeks, marks the current week, leaves the rest open and marks the last", () => {
    expect(weekStates(3)).toEqual([
      "past", "past", "current", "future", "future", "future", "future", "future", "future", "last",
    ]);
  });

  it("keeps the current marker when it is the last week", () => {
    expect(weekStates(10).at(-1)).toBe("current");
    expect(weekStates(10).filter((s) => s === "past")).toHaveLength(9);
  });
});

describe("eventMeta", () => {
  it("joins day and time, host, going count and classmates in the viewer's zone", () => {
    expect(eventMeta(event, "America/New_York")).toBe(
      "Thu 7 PM · Hosted by Ada Lovelace · 12 going, 3 from your class",
    );
  });

  it("leaves out the class count when nobody is from the viewer's class", () => {
    expect(eventMeta({ ...event, classmates: 0 }, "America/New_York")).toBe(
      "Thu 7 PM · Hosted by Ada Lovelace · 12 going",
    );
  });

  it("falls back to the place for DALI events", () => {
    expect(
      eventMeta({ ...event, hostName: null, location: "Sudikoff", goingCount: 0, classmates: 0 }, "America/New_York"),
    ).toBe("Thu 7 PM · Sudikoff");
  });
});

describe("projectsLine", () => {
  it("names the viewer's old project when it is running this term", () => {
    expect(projectsLine({ count: 14, oldProject: "Habitat Map" })).toBe(
      "Habitat Map, your old project, is still running this term.",
    );
  });

  it("counts projects otherwise", () => {
    expect(projectsLine({ count: 14, oldProject: null })).toBe("14 teams are building this term.");
    expect(projectsLine({ count: 1, oldProject: null })).toBe("1 team is building this term.");
  });

  it("says nothing when there are no projects", () => {
    expect(projectsLine({ count: 0, oldProject: null })).toBeNull();
  });
});
