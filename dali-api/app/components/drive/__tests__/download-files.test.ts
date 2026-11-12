import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadItems, hasDownloadable } from "~/components/drive/download-files";
import type { DriveItem } from "~/drive/lib/drive.server";

const item = (type: string, id: string) => ({ type, id, title: id }) as unknown as DriveItem;
const file = (id: string) => item("file", id);

const toast = { info: vi.fn(), error: vi.fn() };
const open = vi.fn();
const fetchMock = vi.fn();

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
const sentIds = () => JSON.parse(fetchMock.mock.calls[0][1].body).fileIds;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("hasDownloadable", () => {
  it("needs at least one file", () => {
    expect(hasDownloadable([item("doc", "d"), file("f")])).toBe(true);
    expect(hasDownloadable([item("doc", "d"), item("folder", "x")])).toBe(false);
  });
});

describe("downloadItems", () => {
  it("does nothing without a file", async () => {
    await downloadItems([item("doc", "d")], { toast, open });
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves one file directly without building a ZIP", async () => {
    await downloadItems([file("a")], { toast, open });
    expect(open).toHaveBeenCalledWith("/api/files/a/download");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("zips several files and opens the link it gets back", async () => {
    respond({ url: "https://s3.example/z", included: 2, skipped: 0 });
    await downloadItems([file("a"), file("b")], { toast, open });

    expect(sentIds()).toEqual(["a", "b"]);
    expect(toast.info).toHaveBeenCalledWith("Preparing a ZIP of 2 files…");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://s3.example/z");
  });

  it("sends only files, and says how much was left out", async () => {
    respond({ url: "https://s3.example/z", included: 1, skipped: 1 });
    await downloadItems([file("a"), file("b"), item("doc", "d")], { toast, open });

    expect(sentIds()).toEqual(["a", "b"]);
    expect(toast.info).toHaveBeenLastCalledWith("2 items left out. Only files you can view are included.");
  });

  it("uses the ZIP path for one file picked alongside a doc, so the doc's omission is reported", async () => {
    respond({ url: "https://s3.example/z", included: 1, skipped: 0 });
    await downloadItems([file("a"), item("doc", "d")], { toast, open });

    expect(toast.info).toHaveBeenLastCalledWith("1 item left out. Only files you can view are included.");
  });

  it("shows the server's reason and opens nothing when refused", async () => {
    respond({ error: "That's over the 500 MB limit. Select fewer files." }, 413);
    await downloadItems([file("a"), file("b")], { toast, open });

    expect(toast.error).toHaveBeenCalledWith("That's over the 500 MB limit. Select fewer files.");
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to a plain message on a network failure or an unreadable reply", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await downloadItems([file("a"), file("b")], { toast, open });
    fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
    await downloadItems([file("a"), file("b")], { toast, open });

    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("Couldn't prepare the download");
  });
});
