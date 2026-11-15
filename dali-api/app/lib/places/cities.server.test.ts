import { describe, it, expect } from "vitest";
import { parseCities } from "./cities.server";

describe("parseCities", () => {
  it("reads the trimmed TSV rows", () => {
    const rows = parseCities(
      "1\tBrooklyn\tNew York\tUnited States\t40.65\t-73.95\t2500000\tBK|Kings\n2\tSingapore\t\tSingapore\t1.29\t103.85\t5000000\t\n",
    );
    expect(rows).toEqual([
      { geonameId: 1, name: "Brooklyn", region: "New York", country: "United States", lat: 40.65, lng: -73.95, population: 2500000, alts: ["BK", "Kings"] },
      { geonameId: 2, name: "Singapore", region: "", country: "Singapore", lat: 1.29, lng: 103.85, population: 5000000, alts: [] },
    ]);
  });
});
