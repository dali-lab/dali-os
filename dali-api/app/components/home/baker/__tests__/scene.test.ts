import { describe, expect, it } from "vitest";
import { bakerScene, isNightInHanover, seasonOn } from "../scene";

describe("seasonOn", () => {
  it.each([
    [12, 1, "winter"],
    [3, 31, "winter"],
    [4, 1, "spring"],
    [5, 31, "spring"],
    [6, 1, "summer"],
    [9, 21, "summer"],
    [9, 22, "fall"],
    [11, 30, "fall"],
  ] as const)("%i/%i is %s", (month, day, season) => {
    expect(seasonOn(month, day)).toBe(season);
  });
});

describe("isNightInHanover", () => {
  it.each([
    ["2026-11-11T21:10:00Z", false], // 4:10 PM EST, before dusk
    ["2026-11-11T23:30:00Z", true], // 6:30 PM EST
    ["2026-07-01T00:30:00Z", false], // 8:30 PM EDT, a summer evening past midnight UTC
    ["2026-07-01T02:00:00Z", true], // 10 PM EDT
    ["2026-01-15T11:00:00Z", true], // 6 AM EST, before dawn
    ["2026-01-15T13:00:00Z", false], // 8 AM EST
  ])("%s is night: %s", (iso, night) => {
    expect(isNightInHanover(new Date(iso))).toBe(night);
  });
});

describe("bakerScene", () => {
  it("reads Hanover's wall clock, not the viewer's", () => {
    expect(bakerScene(new Date("2026-11-11T21:10:00Z"))).toEqual({
      season: "fall",
      night: false,
      hour: 16,
      minute: 10,
      label: "Wednesday 4:10 PM",
    });
  });

  it("uses Hanover's date for the season", () => {
    // Still November 30 in Hanover, already December 1 in UTC.
    expect(bakerScene(new Date("2026-12-01T03:00:00Z")).season).toBe("fall");
  });

  it("labels midnight as 12 AM and hour 0", () => {
    const scene = bakerScene(new Date("2026-11-12T05:00:00Z"));
    expect(scene).toMatchObject({ hour: 0, minute: 0, label: "Thursday 12:00 AM", night: true });
  });
});
