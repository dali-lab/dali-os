import { describe, expect, it } from "vitest";
import { groupByPlace, type ConnectAlum } from "../connect";

const alum = (id: string, location: string, lat: number, lng: number): ConnectAlum => ({
  id,
  name: id,
  photoUrl: null,
  classYear: null,
  location,
  lat,
  lng,
  currentJob: null,
});

describe("groupByPlace", () => {
  it("puts alumni in the same city on one pin, biggest place first", () => {
    const places = groupByPlace([
      alum("a", "London, UK", 51.5074, -0.1278),
      alum("b", "New York, NY", 40.7128, -74.006),
      alum("c", "NYC", 40.7127, -74.0059),
      alum("d", "New York, NY", 40.7128, -74.006),
    ]);
    expect(places.map((p) => [p.label, p.alumni.map((a) => a.id)])).toEqual([
      ["New York, NY", ["b", "c", "d"]],
      ["London, UK", ["a"]],
    ]);
  });
});
