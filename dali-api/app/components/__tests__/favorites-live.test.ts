import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FAVORITES_CHANGED_EVENT,
  saveFavoritesOrder,
  setFavoriteRequest,
  setPageFavorite,
} from "../favorites-live";

const dispatchEvent = vi.fn();

beforeEach(() => {
  dispatchEvent.mockReset();
  const win: Record<string, unknown> = { dispatchEvent };
  win.self = win;
  win.top = win;
  vi.stubGlobal("window", win);
  vi.stubGlobal("Event", class { constructor(public type: string) {} });
});
afterEach(() => vi.unstubAllGlobals());

const respond = (ok: boolean) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok }));

describe("setFavoriteRequest", () => {
  it("notifies the shell after a page write succeeds", async () => {
    respond(true);
    expect(await setPageFavorite("p1", true)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/pages/p1/favorite",
      expect.objectContaining({ body: JSON.stringify({ favorited: true }) }),
    );
    expect(dispatchEvent.mock.calls[0][0].type).toBe(FAVORITES_CHANGED_EVENT);
  });

  it("posts route targets to the route endpoint", async () => {
    respond(true);
    await setFavoriteRequest({ href: "/projects/p1", label: "Hood" }, false);
    expect(fetch).toHaveBeenCalledWith(
      "/api/favorites/route",
      expect.objectContaining({ body: JSON.stringify({ href: "/projects/p1", label: "Hood", favorited: false }) }),
    );
  });

  it("does not notify when the server rejects the write", async () => {
    respond(false);
    expect(await setPageFavorite("p1", true)).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not notify when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await setPageFavorite("p1", true)).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("saveFavoritesOrder", () => {
  it("posts the ids and reports success", async () => {
    respond(true);
    expect(await saveFavoritesOrder(["a", "b"])).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/favorites/reorder",
      expect.objectContaining({ body: JSON.stringify({ ids: ["a", "b"] }) }),
    );
  });

  it("reports failure", async () => {
    respond(false);
    expect(await saveFavoritesOrder(["a"])).toBe(false);
  });
});
