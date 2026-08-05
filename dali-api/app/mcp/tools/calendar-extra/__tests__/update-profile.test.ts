import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/timezone-preference.server", () => ({
  syncAvailabilityTimezone: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { syncAvailabilityTimezone } from "~/lib/timezone-preference.server";
import {
  runUpdateProfile,
  UPDATE_PROFILE_DEF,
} from "~/mcp/tools/calendar-extra/update-profile";

const mockPrisma = prisma as unknown as {
  user: { update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_profile", () => {
  it("requires the mcp:write scope", () => {
    expect(UPDATE_PROFILE_DEF.requiredScope).toBe("mcp:write");
  });

  it("throws McpInvalidError when only firstName provided without lastName", async () => {
    await expect(
      runUpdateProfile("u1", { firstName: "Alice", lastName: "" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError for an unrecognized timezone", async () => {
    await expect(
      runUpdateProfile("u1", { timezone: "Not/A/Zone" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError on handle conflict (P2002)", async () => {
    mockPrisma.user.update.mockRejectedValue({
      code: "P2002",
      meta: { target: ["handle"] },
    });
    await expect(
      runUpdateProfile("u1", { handle: "taken" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", message: "That handle is already taken" });
  });

  it("updates fields and calls syncAvailabilityTimezone when timezone changes", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", {
      firstName: "Alice",
      lastName: "Smith",
      timezone: "America/New_York",
      handle: "alice",
    });

    expect(out.ok).toBe(true);
    expect(out.updated).toMatchObject({
      firstName: "Alice",
      lastName: "Smith",
      timezone: "America/New_York",
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ firstName: "Alice", timeZone: "America/New_York" }),
      }),
    );
    expect(syncAvailabilityTimezone).toHaveBeenCalledWith("u1", "America/New_York");
  });

  it("returns empty updated when no fields provided", async () => {
    const out = await runUpdateProfile("u1", {});
    expect(out).toEqual({ ok: true, updated: {} });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
