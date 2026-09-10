import { describe, it, expect, vi } from "vitest";

// The route module pulls in its own server half (Prisma, Google) at import
// time. Only shouldRevalidate is under test here, so stub that half out.
vi.mock("~/calendar/routes/calendar.server", () => ({
  loadCalendarData: vi.fn(),
  submitCalendarAction: vi.fn(),
}));

import { shouldRevalidate } from "~/calendar/routes/calendar";

const url = (search: string) => new URL(`https://dali.test/calendar${search}`);

function check(args: {
  current: string;
  next: string;
  formMethod?: string;
  defaultShouldRevalidate?: boolean;
}) {
  return shouldRevalidate({
    currentUrl: url(args.current),
    nextUrl: url(args.next),
    formMethod: args.formMethod,
    defaultShouldRevalidate: args.defaultShouldRevalidate ?? true,
  });
}

describe("calendar shouldRevalidate", () => {
  // The optimisation: month/week/day are derived on the client from data
  // already in hand, so switching view shouldn't wait on a Google round-trip.
  it("skips the loader when only the view changed", () => {
    expect(check({ current: "?view=week&anchor=2026-09-06", next: "?view=month&anchor=2026-09-06" })).toBe(false);
  });

  // The counterpart to the mutation case below: a hand-rolled `fetch()` write
  // (the timesheet's add/edit/delete, and this page's several /api writes) is
  // invisible to the router, so the `revalidator.revalidate()` that follows it
  // arrives with no formMethod and an unchanged URL. Skipping that left the
  // entry in Postgres and off the grid. A view switch always changes a param,
  // so an identical URL is never the case this guard exists to skip.
  it("reloads when the URL is unchanged — an explicit revalidate", () => {
    expect(check({ current: "?view=week", next: "?view=week" })).toBe(true);
  });

  it("skips a param-only change even with no form method", () => {
    expect(check({ current: "?view=week&doc=abc", next: "?view=week" })).toBe(false);
  });

  it("reloads when the anchor moves to another week", () => {
    expect(check({ current: "?view=week&anchor=2026-09-06", next: "?view=week&anchor=2026-09-13" })).toBe(true);
  });

  // The regression this guards: every action on this screen posts to the
  // current location, so the URL is identical before and after. Without the
  // form-method check the comparison above reads that as "nothing changed" and
  // skips the loader — leaving a just-created event or time entry off the grid
  // until the next window focus, which looked like the write never happened.
  it("reloads after a mutation even though the URL is unchanged", () => {
    expect(check({ current: "?view=week", next: "?view=week", formMethod: "POST" })).toBe(true);
  });

  it("reloads after a mutation whose method arrives lowercase", () => {
    expect(check({ current: "?view=week", next: "?view=week", formMethod: "post" })).toBe(true);
  });

  it("still skips a GET form submission that only changed the view", () => {
    expect(check({ current: "?view=week", next: "?view=day", formMethod: "GET" })).toBe(false);
  });

  it("defers to the router when it has already decided not to revalidate", () => {
    expect(
      check({ current: "?view=week", next: "?view=week", formMethod: "POST", defaultShouldRevalidate: false }),
    ).toBe(false);
  });
});
