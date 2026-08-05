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
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/hiring/lib/waitlist.server", () => ({
  listActiveWaitlistEntries: vi.fn(),
}));

import { isCore } from "~/lib/roles";
import { listActiveWaitlistEntries } from "~/hiring/lib/waitlist.server";
import { LIST_WAITLIST_TOOL, runListWaitlist } from "../list-waitlist";

beforeEach(() => vi.clearAllMocks());

const fakeEntry = {
  domainApplicationId: "da1",
  rank: 1,
  waitlistedAt: new Date("2026-10-01"),
  applicant: {
    userId: "u2",
    firstName: "Bob",
    lastName: "Jones",
    dartmouthEmail: "bob@dartmouth.edu",
  },
  domain: { id: "dom1", name: "design", displayName: "Design" },
  cycle: { id: "cy1", name: "Fall 2026", cycleType: "Standard", status: "Completed" },
};

describe("list_waitlist", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_WAITLIST_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws forbidden for non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListWaitlist("u1", {})).rejects.toMatchObject({ status: 403 });
    expect(listActiveWaitlistEntries).not.toHaveBeenCalled();
  });

  it("returns waitlist entries for Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(listActiveWaitlistEntries).mockResolvedValue([fakeEntry]);

    const result = await runListWaitlist("u1", {}) as any[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ domainApplicationId: "da1", rank: 1 });
    expect(listActiveWaitlistEntries).toHaveBeenCalledWith({ cycleId: undefined });
  });

  it("passes cycleId filter when provided", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(listActiveWaitlistEntries).mockResolvedValue([]);

    await runListWaitlist("u1", { cycleId: "cy1" });
    expect(listActiveWaitlistEntries).toHaveBeenCalledWith({ cycleId: "cy1" });
  });
});
