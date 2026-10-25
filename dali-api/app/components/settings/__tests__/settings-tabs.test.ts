import { describe, it, expect } from "vitest";
import { settingsRedirectTarget } from "~/components/settings/settings-tabs";

describe("settingsRedirectTarget", () => {
  it("sends bare /settings to General", () => {
    expect(settingsRedirectTarget("/settings", "")).toBe("/settings/general");
    expect(settingsRedirectTarget("/settings/", "")).toBe("/settings/general");
  });

  it.each([
    ["slack", "/settings/connections#slack"],
    ["calendar", "/settings/connections#calendar"],
    ["connected-apps", "/settings/connections#connected-apps"],
    ["integrations", "/settings/connections"],
    ["devices", "/settings/security#devices"],
    ["notifications", "/settings/notifications"],
    ["membership-pass", "/settings/general#membership-pass"],
    ["appearance", "/settings/general#appearance"],
    ["workspace", "/settings/general#workspace"],
  ])("maps the legacy #%s hash to its tab", (hash, target) => {
    expect(settingsRedirectTarget("/settings", hash)).toBe(target);
  });

  it("stays put when the hash already names a section on this tab", () => {
    expect(settingsRedirectTarget("/settings/connections", "slack")).toBeNull();
    expect(settingsRedirectTarget("/settings/security", "devices")).toBeNull();
  });

  it("moves a legacy hash on the wrong tab to the right one", () => {
    expect(settingsRedirectTarget("/settings/general", "slack")).toBe("/settings/connections#slack");
  });

  it("ignores unknown hashes on a tab", () => {
    expect(settingsRedirectTarget("/settings/general", "nope")).toBeNull();
    expect(settingsRedirectTarget("/settings", "nope")).toBe("/settings/general");
  });
});
