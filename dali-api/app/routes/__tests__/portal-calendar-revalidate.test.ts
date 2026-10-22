import { describe, it, expect, vi } from "vitest";

vi.mock("~/calendar/routes/calendar.server", () => ({
  loadCalendarData: vi.fn(),
  submitCalendarAction: vi.fn(),
}));

import * as portalCalendar from "~/routes/portal.calendar";
import { shouldRevalidate } from "~/calendar/routes/calendar";

describe("portal calendar route", () => {
  it("shares the member calendar's shouldRevalidate so view switches skip the loader", () => {
    expect(portalCalendar.shouldRevalidate).toBe(shouldRevalidate);
    const url = (search: string) => new URL(`https://dali.test/portal/calendar${search}`);
    expect(
      portalCalendar.shouldRevalidate({
        currentUrl: url("?view=week"),
        nextUrl: url("?view=month"),
        defaultShouldRevalidate: true,
      } as never),
    ).toBe(false);
  });
});
