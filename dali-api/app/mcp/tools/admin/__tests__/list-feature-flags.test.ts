import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ listFlagsForAdmin: vi.fn() }));

import { isCore } from "~/lib/roles";
import { listFlagsForAdmin } from "~/lib/feature-flags.server";
import { runListFeatureFlags, LIST_FEATURE_FLAGS_TOOL } from "~/mcp/tools/admin/list-feature-flags";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: { id: userId, daliEmail: null, dartmouthEmail: null, netId: null, firstName: "Core", lastName: "Lead" },
    scopes: ["mcp:read"],
    request: new Request("http://localhost/"),
  };
}

const FLAG = { key: "infra-dashboard", enabled: false, everyone: false, roles: ["isCore"], userIds: ["u-1"], note: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(listFlagsForAdmin).mockResolvedValue([FLAG] as never);
});

describe("list_feature_flags", () => {
  it("is a read tool", () => {
    expect(LIST_FEATURE_FLAGS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns all flags", async () => {
    expect(await runListFeatureFlags(makeCtx())).toEqual({ flags: [FLAG] });
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListFeatureFlags(makeCtx("u-nobody"))).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(listFlagsForAdmin).not.toHaveBeenCalled();
  });
});
