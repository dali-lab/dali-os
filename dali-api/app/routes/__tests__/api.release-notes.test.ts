import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/release-notes.server", () => ({
  requireReleaseNoteViewer: vi.fn(),
  loadReleaseNotesPage: vi.fn(),
  loadRecapWeeksPage: vi.fn(),
}));

import {
  loadRecapWeeksPage,
  loadReleaseNotesPage,
  requireReleaseNoteViewer,
} from "~/lib/release-notes.server";
import { loader } from "~/routes/api.release-notes";

const viewer = { userId: "ada", isCore: false, groupIds: [] };

function call(qs = "") {
  return loader({ request: new Request(`http://localhost/api/release-notes${qs}`), params: {}, context: {} } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireReleaseNoteViewer).mockResolvedValue(viewer as never);
  vi.mocked(loadReleaseNotesPage).mockResolvedValue({ items: [{ id: "n1" }], nextCursor: "c2" } as never);
  vi.mocked(loadRecapWeeksPage).mockResolvedValue({ items: [], nextCursor: null } as never);
});

describe("api.release-notes", () => {
  it("lets the viewer gate reject first", async () => {
    vi.mocked(requireReleaseNoteViewer).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(loadReleaseNotesPage).not.toHaveBeenCalled();
  });

  it("loads the next page of notes for an area", async () => {
    const res = await call("?cursor=c1&area=calendar");
    expect(loadReleaseNotesPage).toHaveBeenCalledWith(viewer, { area: "calendar", cursor: "c1" });
    expect(await res.json()).toEqual({ items: [{ id: "n1" }], nextCursor: "c2" });
  });

  it("loads the next weeks of recaps", async () => {
    await call("?view=recaps&cursor=2026-W10");
    expect(loadRecapWeeksPage).toHaveBeenCalledWith(viewer, "2026-W10");
    expect(loadReleaseNotesPage).not.toHaveBeenCalled();
  });
});
