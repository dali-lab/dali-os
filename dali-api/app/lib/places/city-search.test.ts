import { describe, it, expect } from "vitest";
import {
  buildIndex,
  cityById,
  cityLabel,
  matchFreeText,
  normalize,
  searchIndex,
  type CityRow,
} from "./city-search";

const row = (
  geonameId: number,
  name: string,
  region: string,
  country: string,
  population: number,
  alts: string[] = [],
): CityRow => ({ geonameId, name, region, country, lat: 1, lng: 2, population, alts });

const index = buildIndex([
  row(1, "New York City", "New York", "United States", 8_000_000, ["New York", "Big Apple"]),
  row(2, "New York Mills", "Minnesota", "United States", 1_000),
  row(3, "Brooklyn", "New York", "United States", 2_500_000),
  row(4, "Brooklyn Park", "Minnesota", "United States", 80_000),
  row(5, "Washington", "District of Columbia", "United States", 690_000, ["Washington DC"]),
  row(6, "Washington", "Indiana", "United States", 12_000),
  row(7, "Zürich", "Zurich", "Switzerland", 400_000, ["Zurich"]),
  row(8, "Hanover", "New Hampshire", "United States", 11_000),
  row(9, "Hanover", "Lower Saxony", "Germany", 530_000),
  row(10, "Philadelphia", "Pennsylvania", "United States", 1_500_000),
  row(11, "San Francisco", "California", "United States", 870_000),
  row(12, "San Francisco", "Cordoba", "Argentina", 59_000),
  row(13, "Lisbon", "Lisbon", "Portugal", 500_000, ["Old New York"]),
  row(14, "Singapore", "", "Singapore", 5_000_000),
]);

const labels = (q: string, opts?: Parameters<typeof searchIndex>[2]) =>
  searchIndex(index, q, opts).map((h) => h.label);

describe("normalize", () => {
  it("lowercases, drops diacritics and punctuation", () => {
    expect(normalize("  Zürich, D.C. ")).toBe("zurich d c");
  });
});

describe("searchIndex", () => {
  it("matches a name prefix", () => {
    expect(labels("brook")).toEqual([
      "Brooklyn, New York, United States",
      "Brooklyn Park, Minnesota, United States",
    ]);
  });

  it("matches multiword prefixes", () => {
    expect(labels("new y")).toEqual([
      "New York City, New York, United States",
      "New York Mills, Minnesota, United States",
      "Lisbon, Lisbon, Portugal",
    ]);
  });

  it("is case and diacritic insensitive in both directions", () => {
    expect(labels("ZURICH")[0]).toBe("Zürich, Zurich, Switzerland");
    expect(labels("zürich")[0]).toBe("Zürich, Zurich, Switzerland");
  });

  it("finds a city by an alternate name", () => {
    expect(labels("big app")).toEqual(["New York City, New York, United States"]);
  });

  it("puts nicknames on the right city first", () => {
    expect(labels("nyc")[0]).toBe("New York City, New York, United States");
    expect(labels("dc")[0]).toBe("Washington, District of Columbia, United States");
    expect(labels("sf")[0]).toBe("San Francisco, California, United States");
    expect(labels("philly")).toEqual(["Philadelphia, Pennsylvania, United States"]);
  });

  it("orders ties by population", () => {
    expect(labels("hanover")).toEqual([
      "Hanover, Lower Saxony, Germany",
      "Hanover, New Hampshire, United States",
    ]);
  });

  it("ranks a name-prefix match above an alternate-name match", () => {
    const hits = labels("new york");
    expect(hits.indexOf("New York Mills, Minnesota, United States")).toBeLessThan(
      hits.indexOf("Lisbon, Lisbon, Portugal"),
    );
  });

  it("puts boosted places first", () => {
    expect(labels("hanover", { boostGeonameIds: new Set([8]) })[0]).toBe(
      "Hanover, New Hampshire, United States",
    );
    expect(labels("brook", { boostGeonameIds: new Set([4]) })[0]).toBe(
      "Brooklyn Park, Minnesota, United States",
    );
  });

  it("respects the limit and returns nothing for an empty query", () => {
    expect(searchIndex(index, "new", { limit: 1 })).toHaveLength(1);
    expect(searchIndex(index, "  ")).toEqual([]);
    expect(labels("qqqq")).toEqual([]);
  });

  it("returns the hit shape the picker reads", () => {
    expect(searchIndex(index, "singap")[0]).toEqual({
      geonameId: 14,
      name: "Singapore",
      region: "",
      country: "Singapore",
      label: "Singapore, Singapore",
    });
  });
});

describe("labels and lookup", () => {
  it("skips an empty region", () => {
    expect(cityLabel({ name: "Singapore", region: "", country: "Singapore" })).toBe("Singapore, Singapore");
  });

  it("finds a city by geoname id", () => {
    expect(cityById(index, 8)).toMatchObject({ name: "Hanover", label: "Hanover, New Hampshire, United States" });
    expect(cityById(index, 999)).toBeNull();
  });
});

describe("matchFreeText", () => {
  const id = (t: string) => matchFreeText(index, t)?.geonameId ?? null;

  it("takes the most populous exact-name match when nothing else is given", () => {
    expect(id("Hanover")).toBe(9);
    expect(id("washington")).toBe(5);
  });

  it("uses the region or country to choose between same-named cities", () => {
    expect(id("Hanover, New Hampshire")).toBe(8);
    expect(id("Hanover, NH")).toBe(8);
    expect(id("Hanover, NH, USA")).toBe(8);
    expect(id("Hanover, Germany")).toBe(9);
    expect(id("Washington, Indiana")).toBe(6);
    expect(id("Washington, DC")).toBe(5);
  });

  it("matches a city by its alternate name", () => {
    expect(id("Big Apple")).toBe(1);
    expect(id("New York, NY")).toBe(1);
  });

  it("resolves nicknames", () => {
    expect(id("NYC")).toBe(1);
    expect(id("SF")).toBe(11);
  });

  it("returns null when the rest of the text disagrees or nothing matches", () => {
    expect(id("Hanover, Texas")).toBeNull();
    expect(id("Atlantis")).toBeNull();
    expect(id("")).toBeNull();
  });
});
