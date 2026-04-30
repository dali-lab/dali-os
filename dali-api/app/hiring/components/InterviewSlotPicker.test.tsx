import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InterviewSlotPicker } from "./InterviewSlotPicker";
import type { DateGroup } from "./InterviewSlotPicker";

const sampleGroups: DateGroup[] = [
  {
    date: "Monday, January 6",
    slots: [
      { id: "slot-0", date: "Monday, January 6", time: "9:00 AM - 9:30 AM" },
      { id: "slot-1", date: "Monday, January 6", time: "10:00 AM - 10:30 AM" },
    ],
  },
  {
    date: "Tuesday, January 7",
    slots: [
      { id: "slot-2", date: "Tuesday, January 7", time: "2:00 PM - 2:30 PM" },
    ],
  },
];

describe("InterviewSlotPicker", () => {
  it("renders date group headers", () => {
    const html = renderToStaticMarkup(
      createElement(InterviewSlotPicker, { groups: sampleGroups, variant: "schedule", onSelect: () => {} }),
    );
    expect(html).toContain("Monday, January 6");
    expect(html).toContain("Tuesday, January 7");
  });

  it("renders all slot time labels", () => {
    const html = renderToStaticMarkup(
      createElement(InterviewSlotPicker, { groups: sampleGroups, variant: "schedule", onSelect: () => {} }),
    );
    expect(html).toContain("9:00 AM - 9:30 AM");
    expect(html).toContain("10:00 AM - 10:30 AM");
    expect(html).toContain("2:00 PM - 2:30 PM");
  });

  it("returns null (empty markup) when groups is empty", () => {
    const html = renderToStaticMarkup(
      createElement(InterviewSlotPicker, { groups: [], variant: "schedule", onSelect: () => {} }),
    );
    expect(html).toBe("");
  });

  it("shows 'Booking...' for the loading slot in schedule variant", () => {
    const html = renderToStaticMarkup(
      createElement(InterviewSlotPicker, {
        groups: sampleGroups,
        variant: "schedule",
        onSelect: () => {},
        loadingSlotId: "slot-0",
      }),
    );
    expect(html).toContain("Booking...");
    // The non-loading slot should still show its time
    expect(html).toContain("10:00 AM - 10:30 AM");
    // The loading slot's time label should NOT appear
    expect(html).not.toContain("9:00 AM - 9:30 AM");
  });

  it("applies selected styling in selectable variant", () => {
    const html = renderToStaticMarkup(
      createElement(InterviewSlotPicker, {
        groups: sampleGroups,
        variant: "selectable",
        selectedSlotId: "slot-1",
        onSelect: () => {},
      }),
    );
    // The selected button should have the coral accent class
    expect(html).toContain("border-accent-coral");
  });

  it("uses 4-column grid for schedule variant and 2-column for selectable", () => {
    const scheduleHtml = renderToStaticMarkup(
      createElement(InterviewSlotPicker, { groups: sampleGroups, variant: "schedule", onSelect: () => {} }),
    );
    expect(scheduleHtml).toContain("md:grid-cols-4");

    const selectableHtml = renderToStaticMarkup(
      createElement(InterviewSlotPicker, { groups: sampleGroups, variant: "selectable", onSelect: () => {} }),
    );
    expect(selectableHtml).toContain("sm:grid-cols-2");
    expect(selectableHtml).not.toContain("md:grid-cols-4");
  });
});
