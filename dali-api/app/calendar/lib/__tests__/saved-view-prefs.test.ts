import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_VISIBILITY } from "../layers";
import {
  CALENDAR_HIDDEN_CALS_KEY,
  CALENDAR_HOURS_SCOPE_KEY,
  CALENDAR_LAYERS_KEY,
  CALENDAR_ROLE_COLORS_KEY,
  hoursScopeCodec,
  layersCodec,
} from "../saved-view-prefs";

describe("saved calendar view prefs", () => {
  it("keeps the storage keys existing users already have", () => {
    expect([CALENDAR_LAYERS_KEY, CALENDAR_HIDDEN_CALS_KEY, CALENDAR_ROLE_COLORS_KEY, CALENDAR_HOURS_SCOPE_KEY]).toEqual([
      "dali:calendar:layers",
      "dali:calendar:hiddenCals",
      "dali:calendar:roleColors",
      "dali:calendar:hoursScope",
    ]);
  });

  it("reads a stored layer set over the defaults", () => {
    expect(layersCodec.parse('{"logged":true}')).toEqual({ ...DEFAULT_LAYER_VISIBILITY, logged: true });
  });

  it("reads the plain hours scope string and treats anything else as the pay period", () => {
    expect(hoursScopeCodec.parse("week")).toBe("week");
    expect(hoursScopeCodec.parse("bogus")).toBe("period");
    expect(hoursScopeCodec.serialize("week")).toBe("week");
  });
});
