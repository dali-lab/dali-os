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
vi.mock("~/lib/availability", () => ({
  computeUserFreeBusy: vi.fn(),
  intersectFreeIntervals: vi.fn(),
}));
vi.mock("~/lib/timezone", async (orig) => {
  const real = await orig<typeof import("~/lib/timezone")>();
  return { ...real };
});

import {
  computeUserFreeBusy,
  intersectFreeIntervals,
} from "~/lib/availability";
import {
  runGetGroupAvailability,
  GET_GROUP_AVAILABILITY_DEF,
} from "~/mcp/tools/calendar-extra/get-group-availability";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_group_availability", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_GROUP_AVAILABILITY_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError when dates are invalid", async () => {
    await expect(
      runGetGroupAvailability({
        userIds: ["u1"],
        weekStartIso: "not-a-date",
        weekEndIso: "2026-08-10T00:00:00Z",
        durationMinutes: 30,
        timezone: "America/New_York",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError when end is before start", async () => {
    await expect(
      runGetGroupAvailability({
        userIds: ["u1"],
        weekStartIso: "2026-08-10T00:00:00Z",
        weekEndIso: "2026-08-09T00:00:00Z",
        durationMinutes: 30,
        timezone: "America/New_York",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("returns days and perUser arrays on success", async () => {
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "u1",
      free: [],
      busy: [],
    });
    vi.mocked(intersectFreeIntervals).mockReturnValue([]);

    const out = await runGetGroupAvailability({
      userIds: ["u1"],
      weekStartIso: "2026-08-10T00:00:00Z",
      weekEndIso: "2026-08-17T00:00:00Z",
      durationMinutes: 30,
      timezone: "America/New_York",
    });

    expect(out).toHaveProperty("days");
    expect(out).toHaveProperty("perUser");
    expect(Array.isArray(out.days)).toBe(true);
    expect(Array.isArray(out.perUser)).toBe(true);
    expect(out.perUser[0]).toMatchObject({ userId: "u1", free: [] });
  });
});
