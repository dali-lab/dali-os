import { describe, expect, it } from "vitest";
import { useOsChrome } from "~/components/os-chrome";

describe("useOsChrome", () => {
  it("has no os flag, since there is only one look", () => {
    expect(useOsChrome()).not.toHaveProperty("os");
  });
});
