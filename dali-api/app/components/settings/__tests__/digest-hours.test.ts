import { describe, it, expect } from "vitest";
import {
  digestHourLabel,
  digestHourOptions,
  digestHourToStore,
} from "~/components/settings/digest-hours";

describe("digestHourOptions", () => {
  it("always offers the lab default alongside the fixed choices, in order", () => {
    expect(digestHourOptions(9)).toEqual([8, 9, 12, 18]);
    expect(digestHourOptions(21)).toEqual([8, 12, 18, 21]);
  });

  it("doesn't repeat a default that is already a choice", () => {
    expect(digestHourOptions(8)).toEqual([8, 12, 18]);
  });
});

describe("digestHourLabel", () => {
  it.each([
    [0, "Midnight"],
    [8, "8 AM"],
    [12, "Noon"],
    [18, "6 PM"],
  ])("labels %i as %s", (hour, label) => {
    expect(digestHourLabel(hour)).toBe(label);
  });
});

describe("digestHourToStore", () => {
  it("stores null for the default and the hour otherwise", () => {
    expect(digestHourToStore(9, 9)).toBeNull();
    expect(digestHourToStore(18, 9)).toBe(18);
  });
});
