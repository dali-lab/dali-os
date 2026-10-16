import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/pageAccess.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/pageAccess.server")>()),
  getPageAccess: vi.fn(),
}));
vi.mock("~/lib/user-pages.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/user-pages.server")>()),
  favoriteHrefs: vi.fn(),
  isFavorited: vi.fn(),
  setFavorite: vi.fn(),
  setRouteFavorite: vi.fn(),
  reorderFavorites: vi.fn(),
}));
vi.mock("~/lib/db", () => ({ prisma: {} }));

import { requireMemberSession } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  favoriteHrefs,
  isFavorited,
  reorderFavorites,
  setFavorite,
  setRouteFavorite,
} from "~/lib/user-pages.server";
import { action as routeAction, loader as routeLoader } from "../api.favorites.route";
import { action as reorderAction } from "../api.favorites.reorder";

const post = (url: string, body: unknown) =>
  new Request(`http://x${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true } as any);
  vi.mocked(favoriteHrefs).mockResolvedValue(new Set());
});

describe("POST /api/favorites/route", () => {
  it("stars a plain URL through the route path", async () => {
    const res = await routeAction({
      request: post("/api/favorites/route", { href: "/projects/p1", label: "Hood", favorited: true }),
    } as any);
    expect(res.status).toBe(200);
    expect(setRouteFavorite).toHaveBeenCalledWith("u1", "/projects/p1", "Hood", true);
    expect(setFavorite).not.toHaveBeenCalled();
  });

  it.each(["/documents/d1", "/forms/edit/d1?x=1", "/whiteboard/d1"])(
    "dispatches %s to the page favorite after a canView check",
    async (href) => {
      const res = await routeAction({
        request: post("/api/favorites/route", { href, label: "Doc", favorited: true }),
      } as any);
      expect(res.status).toBe(200);
      expect(getPageAccess).toHaveBeenCalledWith("u1", "d1");
      expect(setFavorite).toHaveBeenCalledWith("u1", "d1", true);
      expect(setRouteFavorite).not.toHaveBeenCalled();
    },
  );

  it("404s a page URL the caller cannot view", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: false } as any);
    const res = await routeAction({
      request: post("/api/favorites/route", { href: "/documents/d1", label: "Doc", favorited: true }),
    } as any);
    expect(res.status).toBe(404);
    expect(setFavorite).not.toHaveBeenCalled();
  });

  it("still rejects navbar routes and unsafe paths", async () => {
    const nav = await routeAction({
      request: post("/api/favorites/route", { href: "/settings", label: "S", favorited: true }),
    } as any);
    expect(nav.status).toBe(400);
    const evil = await routeAction({
      request: post("/api/favorites/route", { href: "//evil.com", label: "S", favorited: true }),
    } as any);
    expect(evil.status).toBe(400);
  });
});

describe("GET /api/favorites/route", () => {
  it("reports a page URL's state from the page favorite", async () => {
    vi.mocked(isFavorited).mockResolvedValue(true);
    const res = await routeLoader({ request: new Request("http://x/api/favorites/route?href=%2Fdocuments%2Fd1") } as any);
    expect(await res.json()).toEqual({ ok: true, favorited: true });
    expect(isFavorited).toHaveBeenCalledWith("u1", "d1");
  });

  it("reports a plain URL's state from the route favorites", async () => {
    vi.mocked(favoriteHrefs).mockResolvedValue(new Set(["/projects/p1"]));
    const res = await routeLoader({
      request: new Request("http://x/api/favorites/route?href=%2Fprojects%2Fp1%3Ftab%3Dboard"),
    } as any);
    expect(await res.json()).toEqual({ ok: true, favorited: true });
  });
});

describe("POST /api/favorites/reorder", () => {
  const call = (body: unknown) => reorderAction({ request: post("/api/favorites/reorder", body) } as any);

  it("reorders the caller's favorites", async () => {
    const res = await call({ ids: ["a", "/projects/p1"] });
    expect(res.status).toBe(200);
    expect(reorderFavorites).toHaveBeenCalledWith("u1", ["a", "/projects/p1"]);
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["missing ids", {}],
    ["non-array ids", { ids: "a" }],
    ["non-string id", { ids: ["a", 1] }],
    ["empty id", { ids: [""] }],
    ["too many ids", { ids: Array.from({ length: 501 }, (_, i) => `id${i}`) }],
  ])("400s on %s", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(reorderFavorites).not.toHaveBeenCalled();
  });

  it("returns the auth response when the session is missing", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 401 }),
    } as any);
    const res = await call({ ids: ["a"] });
    expect(res.status).toBe(401);
    expect(reorderFavorites).not.toHaveBeenCalled();
  });

  it("405s non-POST", async () => {
    const res = await reorderAction({ request: new Request("http://x/api/favorites/reorder", { method: "PUT" }) } as any);
    expect(res.status).toBe(405);
  });
});
