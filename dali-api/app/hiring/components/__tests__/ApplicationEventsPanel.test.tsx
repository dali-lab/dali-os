import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "America/New_York" }));

import { ApplicationEventsPanel, type EventEngagementRow } from "../ApplicationEventsPanel";

function entry(overrides: Partial<EventEngagementRow> = {}): EventEngagementRow {
  return {
    eventId: "evt-1",
    title: "Application help hour",
    kind: "HelpHour",
    startsAt: new Date("2026-10-14T20:00:00.000Z"),
    endsAt: new Date("2026-10-14T21:00:00.000Z"),
    cycleId: "cycle-1",
    cycleName: "26F",
    ...overrides,
  };
}

describe("ApplicationEventsPanel", () => {
  it("renders nothing when there are no entries", () => {
    const html = renderToStaticMarkup(
      createElement(ApplicationEventsPanel, { entries: [], currentCycleId: "cycle-1" }),
    );
    expect(html).toBe("");
  });

  it("renders the title, kind pill, and date for an entry in the current cycle, with no cycle note", () => {
    const html = renderToStaticMarkup(
      createElement(ApplicationEventsPanel, {
        entries: [entry()],
        currentCycleId: "cycle-1",
      }),
    );
    expect(html).toContain("Application events attended");
    expect(html).toContain("Help hour");
    expect(html).toContain("Application help hour");
    expect(html).not.toContain("Prior cycle");
  });

  it("labels each kind correctly", () => {
    const html = renderToStaticMarkup(
      createElement(ApplicationEventsPanel, {
        entries: [
          entry({ eventId: "e-social", kind: "Social" }),
          entry({ eventId: "e-info", kind: "InfoSession" }),
          entry({ eventId: "e-other", kind: "Other" }),
        ],
        currentCycleId: "cycle-1",
      }),
    );
    expect(html).toContain("Social");
    expect(html).toContain("Info session");
    expect(html).toContain("Other");
  });

  it("shows the prior cycle's name when the entry's cycle differs from the current one", () => {
    const html = renderToStaticMarkup(
      createElement(ApplicationEventsPanel, {
        entries: [entry({ cycleId: "cycle-0", cycleName: "25F" })],
        currentCycleId: "cycle-1",
      }),
    );
    expect(html).toContain("Prior cycle: 25F");
  });
});
