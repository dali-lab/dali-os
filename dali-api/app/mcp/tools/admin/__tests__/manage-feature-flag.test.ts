import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/feature-flags.server", () => ({
  listFlagsForAdmin: vi.fn(),
  updateFlag: vi.fn().mockResolvedValue(undefined),
}));

import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { listFlagsForAdmin, updateFlag } from "~/lib/feature-flags.server";
import {
  runManageFeatureFlag,
  MANAGE_FEATURE_FLAG_TOOL,
} from "~/mcp/tools/admin/manage-feature-flag";
import type { McpCtx } from "~/mcp/registry";

const CURRENT = {
  key: "desktop-app",
  label: "Desktop app",
  description: "…",
  enabled: false,
  everyone: false,
  roles: ["isCore"] as string[],
  userIds: ["u-1"] as string[],
  note: "old note" as string | null,
};

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(listFlagsForAdmin).mockResolvedValue([{ ...CURRENT }] as any);
});

describe("manage_feature_flag", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_FEATURE_FLAG_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not isCore", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageFeatureFlag(makeCtx("u-nobody"), { action: "list" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  });

  describe("action: list", () => {
    it("returns all flags", async () => {
      const out = await runManageFeatureFlag(makeCtx(), { action: "list" });
      expect(out).toEqual({ flags: [{ ...CURRENT }] });
    });
  });

  describe("action: set_config", () => {
    it("patches only the provided fields, preserving the rest", async () => {
      const out = await runManageFeatureFlag(makeCtx(), {
        action: "set_config",
        key: "desktop-app",
        enabled: true,
      });
      expect(out).toEqual({ ok: true });
      expect(updateFlag).toHaveBeenCalledWith("desktop-app", {
        enabled: true,
        everyone: false,
        roles: ["isCore"],
        userIds: ["u-1"],
        note: "old note",
      });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "feature-flags.update", targetId: "desktop-app" }),
      );
    });

    it("clears the note with an empty string", async () => {
      await runManageFeatureFlag(makeCtx(), {
        action: "set_config",
        key: "desktop-app",
        note: "",
      });
      expect(updateFlag).toHaveBeenCalledWith(
        "desktop-app",
        expect.objectContaining({ note: null }),
      );
    });

    it("throws McpNotFoundError for an unknown flag key", async () => {
      await expect(
        runManageFeatureFlag(makeCtx(), {
          action: "set_config",
          key: "ghost-flag",
          enabled: true,
        }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
      expect(updateFlag).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError for an unknown role target", async () => {
      await expect(
        runManageFeatureFlag(makeCtx(), {
          action: "set_config",
          key: "desktop-app",
          roles: ["isWizard"],
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(updateFlag).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError when key is missing", async () => {
      await expect(
        runManageFeatureFlag(makeCtx(), { action: "set_config", enabled: true }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpInvalidError when nothing to update", async () => {
      await expect(
        runManageFeatureFlag(makeCtx(), { action: "set_config", key: "desktop-app" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });
});
