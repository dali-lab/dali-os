import { describe, expect, it } from "vitest";
import { settingsSectionParam } from "../settings-section";

describe("settingsSectionParam", () => {
  it("opens the named settings section", () => {
    expect(settingsSectionParam("classes")).toBe("classes");
    expect(settingsSectionParam("hours")).toBe("hours");
    expect(settingsSectionParam("calendars")).toBe("calendars");
  });

  it("ignores a missing or unknown section", () => {
    expect(settingsSectionParam(null)).toBeNull();
    expect(settingsSectionParam("billing")).toBeNull();
  });
});
