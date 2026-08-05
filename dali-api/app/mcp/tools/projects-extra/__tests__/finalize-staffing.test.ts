import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db so the real ~/lib/roles pulled in via orig() below doesn't load the
// generated Prisma client (absent in CI). Uses the manual mock in __mocks__/db.
vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canManageStaffing: vi.fn() };
});
vi.mock("~/projects/lib/finalize-staffing.server", () => ({
  finalizeStaffing: vi.fn(),
}));

import { canManageStaffing } from "~/lib/roles";
import { finalizeStaffing } from "~/projects/lib/finalize-staffing.server";
import { runFinalizeStaffing, FINALIZE_STAFFING_TOOL } from "~/mcp/tools/projects-extra/finalize-staffing";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("finalize_staffing", () => {
  it("requires mcp:admin scope", () => {
    expect(FINALIZE_STAFFING_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError for non-staffing-manager", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    await expect(
      runFinalizeStaffing("u1", { cycleId: "c1", projectId: "p1", automations: ["assignments"] }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpInvalidError when no automations and not saveFieldsOnly", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    await expect(
      runFinalizeStaffing("u1", { cycleId: "c1", projectId: "p1", automations: [] }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("calls finalizeStaffing with the actor id and body", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    vi.mocked(finalizeStaffing).mockResolvedValue({ saved: true });
    const out = await runFinalizeStaffing("u1", {
      cycleId: "c1",
      projectId: "p1",
      automations: [],
      saveFieldsOnly: true,
    });
    expect(finalizeStaffing).toHaveBeenCalledWith(
      "u1",
      { cycleId: "c1", projectId: "p1", automations: [], saveFieldsOnly: true },
      expect.any(Request),
    );
    expect(out).toMatchObject({ saved: true });
  });

  it("allows saveFieldsOnly with empty automations", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    vi.mocked(finalizeStaffing).mockResolvedValue({ saved: true });
    await expect(
      runFinalizeStaffing("u1", {
        cycleId: "c1",
        projectId: "p1",
        automations: [],
        saveFieldsOnly: true,
      }),
    ).resolves.toBeDefined();
  });
});
