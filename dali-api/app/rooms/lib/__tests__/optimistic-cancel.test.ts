import { describe, expect, it } from "vitest";
import { withoutCancelled } from "~/rooms/lib/optimistic-cancel";

const item = (id: string, start: string, end: string) => ({ id, start, end, occurrenceStart: start });
const NOW = new Date("2026-10-22T15:00:00.000Z");

const series = [
  item("s", "2026-10-21T18:00:00.000Z", "2026-10-21T19:00:00.000Z"),
  item("s", "2026-10-22T18:00:00.000Z", "2026-10-22T19:00:00.000Z"),
  item("s", "2026-10-23T18:00:00.000Z", "2026-10-23T19:00:00.000Z"),
  item("other", "2026-10-22T18:00:00.000Z", "2026-10-22T19:00:00.000Z"),
];

describe("withoutCancelled", () => {
  it("drops only the chosen time of a series", () => {
    const out = withoutCancelled(series, series[1]!, "this", NOW);
    expect(out.map((i) => i.start)).toEqual([series[0]!.start, series[2]!.start, series[3]!.start]);
  });

  it("drops the chosen time and everything after it", () => {
    const out = withoutCancelled(series, series[1]!, "following", NOW);
    expect(out).toEqual([series[0], series[3]]);
  });

  it("drops the whole series and leaves other bookings", () => {
    expect(withoutCancelled(series, series[1]!, "all", NOW)).toEqual([series[3]]);
  });

  it("cuts a booking that is underway short instead of removing it", () => {
    const underway = item("u", "2026-10-22T14:00:00.000Z", "2026-10-22T16:00:00.000Z");
    const out = withoutCancelled([underway], underway, "this", NOW);
    expect(out).toEqual([{ ...underway, end: NOW.toISOString() }]);
  });

  it("returns the same items when nothing matches", () => {
    const stray = item("x", "2026-10-22T10:00:00.000Z", "2026-10-22T11:00:00.000Z");
    expect(withoutCancelled(series, stray, "this", NOW)).toEqual(series);
  });
});
