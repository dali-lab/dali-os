import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCancel, withoutCancelled } from "~/rooms/lib/optimistic-cancel";

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

describe("requestCancel", () => {
  const fetchMock = vi.fn();
  afterEach(() => vi.unstubAllGlobals());
  const stub = (impl: () => Promise<unknown>) => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(impl);
    vi.stubGlobal("fetch", fetchMock);
  };

  it("succeeds when the server accepts", async () => {
    stub(async () => new Response(null, { status: 200 }));
    expect(await requestCancel("b1")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/room-bookings/b1/cancel", { method: "POST", credentials: "include" });
  });

  it("sends the scope and occurrence for a series", async () => {
    stub(async () => new Response(null, { status: 200 }));
    await requestCancel("b1", { scope: "following", occurrenceStart: "2026-10-22T18:00:00.000Z" });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "following", occurrenceStart: "2026-10-22T18:00:00.000Z" }),
    });
  });

  it("returns the server's reason when it refuses", async () => {
    stub(async () => Response.json({ error: "Not yours" }, { status: 403 }));
    expect(await requestCancel("b1")).toEqual({ ok: false, error: "Not yours" });
  });

  it("falls back to a plain message when the refusal has no reason", async () => {
    stub(async () => new Response("<html>", { status: 502 }));
    expect(await requestCancel("b1")).toEqual({ ok: false, error: "Couldn't cancel the booking." });
  });

  it("returns a failure instead of throwing when the network is down", async () => {
    stub(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestCancel("b1")).toEqual({ ok: false, error: "Couldn't cancel the booking." });
  });
});
