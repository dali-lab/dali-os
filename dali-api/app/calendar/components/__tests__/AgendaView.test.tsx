import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgendaView } from "~/calendar/components/AgendaView";
import type { EventBlock } from "~/calendar/lib/types";

const days = [0, 1, 2].map((i) => ({ dayOfWeek: i + 1, num: 26 + i, dateUtc: new Date(Date.UTC(2026, 9, 26 + i)) }));

const render = (eventsByDay: Record<number, EventBlock[]>) =>
  renderToStaticMarkup(
    <AgendaView days={days} eventsByDay={eventsByDay} timezone="America/New_York" onSelectDay={vi.fn()} />,
  );

describe("AgendaView empty range", () => {
  it("pictures an empty range above the message, hidden from screen readers", () => {
    const out = render({});
    expect(out).toMatch(/data-empty-agenda-art="true" class="[^"]*" aria-hidden="true"/);
    expect(out.indexOf("data-empty-agenda-art")).toBeLessThan(out.indexOf("Nothing scheduled in this range."));
  });

  it("treats days with empty event lists as an empty range", () => {
    expect(render({ 0: [], 2: [] })).toContain("data-empty-agenda-art");
  });
});
