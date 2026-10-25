import { describe, it, expect } from "vitest";
import { paneFlag } from "~/lib/pane-flags";

describe("paneFlag", () => {
  it("reads a boolean handle flag", () => {
    expect(paneFlag({ handle: { fitViewport: true } }, "fitViewport")).toBe(true);
    expect(paneFlag({ handle: { fitViewport: false } }, "fitViewport")).toBe(false);
  });

  it("is false when the handle or the key is missing", () => {
    expect(paneFlag({}, "bleedPane")).toBe(false);
    expect(paneFlag({ handle: { fitViewport: true } }, "bleedPane")).toBe(false);
  });

  it("calls a function flag with the route's loader data", () => {
    const handle = { bleedPane: (d: unknown) => (d as { full: boolean }).full };
    expect(paneFlag({ handle, data: { full: true } }, "bleedPane")).toBe(true);
    expect(paneFlag({ handle, data: { full: false } }, "bleedPane")).toBe(false);
  });
});
