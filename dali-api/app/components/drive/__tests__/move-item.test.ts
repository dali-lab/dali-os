import { afterEach, describe, expect, it, vi } from "vitest";
import { isPageItem, moveDriveItem } from "~/components/drive/move-item";
import type { DriveItem } from "~/lib/drive.server";

const item = (type: string, id = "i1") =>
  ({ type, id, title: "T", parentFolderId: null, iconEmoji: null, updatedAt: new Date(), href: "/x" }) as DriveItem;

afterEach(() => vi.unstubAllGlobals());

describe("moving a shortcut", () => {
  it("treats a shortcut as a page", () => {
    expect(isPageItem(item("shortcut"))).toBe(true);
    expect(isPageItem(item("doc"))).toBe(true);
    expect(isPageItem(item("file"))).toBe(false);
  });

  it("moves the shortcut row through the page move route, never a target id or the drive move route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await moveDriveItem({ ...item("shortcut", "shortcut-row"), targetId: "the-original" } as DriveItem, "folder-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pages/shortcut-row/move");
    expect(JSON.parse(init.body)).toEqual({ parentPageId: "folder-2" });
  });

  it("still sends files to the drive move route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await moveDriveItem(item("file", "f1"), "folder-2");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drive/move");
  });
});
