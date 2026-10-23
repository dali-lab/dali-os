import { describe, expect, it } from "vitest";
import { groupByPlace, minZoomToFill, profileCompleteness, type ConnectAlum } from "../connect";

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

describe("minZoomToFill", () => {
  it("never goes below zoom 2", () => {
    expect(minZoomToFill(0)).toBe(2);
    expect(minZoomToFill(400)).toBe(2);
    expect(minZoomToFill(1024)).toBe(2);
  });

  it("zooms in until the world is at least as tall as the map", () => {
    // 256 * 2^z must reach the height: 1025px needs z=3 (2048px), 2049px needs z=4.
    expect(minZoomToFill(1025)).toBe(3);
    expect(minZoomToFill(2048)).toBe(3);
    expect(minZoomToFill(2049)).toBe(4);
  });
});

describe("profileCompleteness", () => {
  const all = { photo: true, job: true, location: true, bio: true, classYear: true };

  it("is 100% with no hint when every field is filled", () => {
    expect(profileCompleteness(all)).toEqual({ percent: 100, hint: null });
  });

  it("counts each of the five fields as 20%", () => {
    expect(profileCompleteness({ ...all, bio: false }).percent).toBe(80);
    expect(profileCompleteness({ photo: false, job: false, location: false, bio: false, classYear: false }).percent).toBe(0);
  });

  it("asks for one missing field on its own", () => {
    expect(profileCompleteness({ ...all, photo: false }).hint).toBe("Add a photo so students can find you.");
  });

  it("joins two missing fields with and", () => {
    expect(profileCompleteness({ ...all, job: false, bio: false }).hint).toBe(
      "Add your employer and a short bio so students can find you.",
    );
  });

  it("lists three or more with commas", () => {
    expect(profileCompleteness({ ...all, photo: false, job: false, location: false }).hint).toBe(
      "Add a photo, your employer and where you're based so students can find you.",
    );
  });
});
