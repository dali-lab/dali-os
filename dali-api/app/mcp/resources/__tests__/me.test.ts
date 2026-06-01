import { describe, it, expect } from "vitest";
import { ME_RESOURCE } from "~/mcp/resources/me";

describe("dali://me", () => {
  it("requires the mcp:read scope", () => {
    expect(ME_RESOURCE.requiredScope).toBe("mcp:read");
  });

  it("advertises a JSON mime type and a stable URI", () => {
    expect(ME_RESOURCE.uri).toBe("dali://me");
    expect(ME_RESOURCE.mimeType).toBe("application/json");
  });
});
