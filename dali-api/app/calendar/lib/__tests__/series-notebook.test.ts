import { describe, it, expect, vi } from "vitest";
import { seriesDefaultDiffers, setSeriesNotebookRequest } from "~/calendar/lib/series-notebook";

describe("seriesDefaultDiffers", () => {
  it("offers a change only when both are set and they differ", () => {
    expect(seriesDefaultDiffers("nb-x", "nb-s")).toBe(true);
    expect(seriesDefaultDiffers("nb-s", "nb-s")).toBe(false);
  });

  it("offers nothing when the series had no default or the note filed nowhere", () => {
    expect(seriesDefaultDiffers("nb-x", null)).toBe(false);
    expect(seriesDefaultDiffers(null, "nb-s")).toBe(false);
    expect(seriesDefaultDiffers(null, null)).toBe(false);
  });
});

describe("setSeriesNotebookRequest", () => {
  const respond = (ok: boolean, json: unknown) => vi.fn(async () => ({ ok, json: async () => json }));

  it("posts the notebook and scope to the series' notebook route", async () => {
    const doFetch = respond(true, { ok: true, moved: 2, skipped: 1 });

    const res = await setSeriesNotebookRequest("m1", "nb1", "all", doFetch);

    expect(res).toEqual({ ok: true, moved: 2, skipped: 1 });
    expect(doFetch).toHaveBeenCalledWith("/api/scheduled-meetings/m1/notebook", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookId: "nb1", scope: "all" }),
    });
  });

  it("unsets with a null notebook", async () => {
    const doFetch = respond(true, { ok: true, moved: 0, skipped: 0 });

    await setSeriesNotebookRequest("m1", null, "future", doFetch);

    expect(JSON.parse((doFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      notebookId: null,
      scope: "future",
    });
  });

  it("returns the server's error when the change is refused", async () => {
    expect(await setSeriesNotebookRequest("m1", "nb1", "future", respond(false, { error: "Meeting not found" }))).toEqual({
      ok: false,
      moved: 0,
      skipped: 0,
      error: "Meeting not found",
    });
  });
});
