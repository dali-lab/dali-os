import { describe, it, expect, vi } from "vitest";

// me.ts transitively imports ~/lib/db (via get-member-profile). Hoist the mock
// so vitest doesn't try to load the real Prisma client — its generated module
// isn't on disk during CI's `npm test` step.
vi.mock("~/lib/db");

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
