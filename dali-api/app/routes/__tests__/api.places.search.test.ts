import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/places/cities.server", () => ({ searchCities: vi.fn() }));

import { mockedPrisma } from "~/test-utils/prisma";
import { requireAuth } from "~/lib/auth";
import { searchCities } from "~/lib/places/cities.server";
import { loader, resetPlaceBoostCache } from "../api.places.search";

const db = mockedPrisma();
const hit = {
  geonameId: 5110302,
  name: "Brooklyn",
  region: "New York",
  country: "United States",
  label: "Brooklyn, New York, United States",
};

const load = (q?: string) =>
  loader({
    request: new Request(`https://os.example/api/places/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  resetPlaceBoostCache();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(searchCities).mockReturnValue([hit]);
  db.user.findMany.mockResolvedValue([
    { currentLocationGeonameId: 4140963 },
    { currentLocationGeonameId: null },
  ] as never);
});

describe("GET /api/places/search", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 401 }),
    } as never);
    const res = await load("brook");
    expect(res.status).toBe(401);
    expect(searchCities).not.toHaveBeenCalled();
  });

  it("returns an empty list for a missing, short or overlong query", async () => {
    for (const q of [undefined, "", " b ", "x".repeat(61)]) {
      const res = await load(q);
      expect(await res.json()).toEqual({ places: [] });
    }
    expect(searchCities).not.toHaveBeenCalled();
  });

  it("returns the matches, boosting places members already live", async () => {
    const res = await load("  brook ");
    expect(await res.json()).toEqual({ places: [hit] });
    expect(searchCities).toHaveBeenCalledWith("brook", { boostGeonameIds: new Set([4140963]) });
  });

  it("reads the boost list once per cache window", async () => {
    await load("brook");
    await load("new y");
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });
});
