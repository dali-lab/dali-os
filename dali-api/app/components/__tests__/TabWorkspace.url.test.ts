import { describe, expect, it } from "vitest";
import { comparableUrl } from "~/components/TabWorkspace";

describe("comparableUrl", () => {
  it("leaves a plain path alone", () => {
    expect(comparableUrl("/hiring/applications")).toBe("/hiring/applications");
  });

  it("drops the embed marker a frame's own location carries", () => {
    expect(comparableUrl("/hiring/applications?embed=1")).toBe("/hiring/applications");
    expect(comparableUrl("/drive?type=agreement&embed=1")).toBe("/drive?type=agreement");
  });

  it("gives differently encoded queries one spelling", () => {
    expect(comparableUrl("/drive?q=a%20b")).toBe(comparableUrl("/drive?q=a+b"));
  });

  it("keeps a list and one of its items apart", () => {
    expect(comparableUrl("/hiring/applications/abc?embed=1")).not.toBe(
      comparableUrl("/hiring/applications"),
    );
  });
});
