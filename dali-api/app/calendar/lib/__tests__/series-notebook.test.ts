import { describe, it, expect, vi } from "vitest";
import {
  SERIES_CHANGE_CONFIRM,
  changedSeriesNotebook,
  seriesDefaultDiffers,
  setSeriesNotebookRequest,
} from "~/calendar/lib/series-notebook";

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

describe("changedSeriesNotebook", () => {
  const picked = { kind: "existing", notebook: { id: "nb2" } } as const;

  it("names the notebook picked by hand when it differs from the series'", () => {
    expect(changedSeriesNotebook(picked, false, "nb1")).toBe("nb2");
    expect(changedSeriesNotebook(picked, false, null)).toBe("nb2");
  });

  it("is null when the pick is the series' own notebook", () => {
    expect(changedSeriesNotebook(picked, false, "nb2")).toBeNull();
  });

  it("is null for a default the form filled in, a new notebook or no place", () => {
    expect(changedSeriesNotebook(picked, true, "nb1")).toBeNull();
    expect(changedSeriesNotebook({ kind: "new" }, false, "nb1")).toBeNull();
    expect(changedSeriesNotebook(null, false, "nb1")).toBeNull();
  });

  it("confirms with the future-only promise", () => {
    expect(SERIES_CHANGE_CONFIRM.description).toBe("Notes already taken stay where they are.");
  });
});
