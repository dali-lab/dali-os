import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShortcutRequest,
  deleteShortcutRequest,
  fetchPlacements,
  placePageRequest,
  swapPrimaryRequest,
} from "~/components/drive/shortcut-api";

const dest = { workspaceType: "Lab", workspaceId: null, parentPageId: "f1" } as const;

function stub(response: Response | Error) {
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("deleteShortcutRequest", () => {
  it("deletes through the shortcuts route, not the documents one", async () => {
    const fetchMock = stub(reply({ ok: true }));
    await deleteShortcutRequest("s1");
    expect(fetchMock).toHaveBeenCalledWith("/api/shortcuts/s1", { method: "DELETE", credentials: "include" });
  });
});

describe("placePageRequest", () => {
  it("posts the destinations and the primary's index", async () => {
    const fetchMock = stub(reply({ ok: true, declined: 1 }));
    const res = await placePageRequest("p1", [dest, { ...dest, parentPageId: "f2" }], 1);
    expect(res).toEqual({ ok: true, declined: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pages/p1/place");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ destinations: [dest, { ...dest, parentPageId: "f2" }], primaryIndex: 1 });
  });

  it("hands back the server's message on a refusal", async () => {
    stub(reply({ error: "You can't put things in that folder" }, 403));
    expect(await placePageRequest("p1", [dest], 0)).toEqual({ ok: false, error: "You can't put things in that folder" });
  });

  it("falls back to a plain message when the request itself fails", async () => {
    stub(new Error("offline"));
    expect(await placePageRequest("p1", [dest], 0)).toEqual({ ok: false, error: "Couldn't file it there" });
  });
});

describe("createShortcutRequest", () => {
  it("posts the target and destination", async () => {
    const fetchMock = stub(reply({ ok: true, created: true, grantDeclined: false }));
    const res = await createShortcutRequest("t1", dest);
    expect(res).toMatchObject({ ok: true, created: true, grantDeclined: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ targetPageId: "t1", dest });
  });
});

describe("swapPrimaryRequest", () => {
  it("posts the shortcut to promote", async () => {
    const fetchMock = stub(reply({ ok: true }));
    await swapPrimaryRequest("p1", "s1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/p1/swap-primary");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ shortcutId: "s1" });
  });
});

describe("fetchPlacements", () => {
  it("returns where the page lives and its shortcuts", async () => {
    const body = { primary: { workspaceType: "Lab", workspaceId: null, folderId: null, path: [] }, shortcuts: [] };
    const fetchMock = stub(reply({ ok: true, ...body }));
    expect(await fetchPlacements("p1")).toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/p1/shortcuts");
  });

  it("is null when the page can't be read", async () => {
    stub(reply({ error: "Document not found" }, 404));
    expect(await fetchPlacements("p1")).toBeNull();
  });
});
