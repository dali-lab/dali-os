import { afterEach, describe, expect, it, vi } from "vitest";
import { isPageItem, moveDriveItem } from "~/components/drive/move-item";
import type { DriveItem } from "~/lib/drive.server";

const item = (type: string, id = "i1") =>
  ({ type, id, title: "T", parentFolderId: null, iconEmoji: null, updatedAt: new Date(), href: "/x" }) as DriveItem;

afterEach(() => vi.unstubAllGlobals());

describe("moving a drive item", () => {
  it("treats docs and folders as pages, not files", () => {
    expect(isPageItem(item("doc"))).toBe(true);
    expect(isPageItem(item("folder"))).toBe(true);
    expect(isPageItem(item("file"))).toBe(false);
  });

  it("sends a page through the page move route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await moveDriveItem(item("doc", "page-1"), "folder-2");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pages/page-1/move");
    expect(JSON.parse(init.body)).toEqual({ parentPageId: "folder-2" });
  });

  it("still sends files to the drive move route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await moveDriveItem(item("file", "f1"), "folder-2");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drive/move");
  });
});
