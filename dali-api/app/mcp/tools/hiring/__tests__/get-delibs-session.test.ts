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
  return { ...real, hasCycleAccess: vi.fn() };
});
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { GET_DELIBS_SESSION_TOOL, runGetDelibsSession } from "../get-delibs-session";

const mockPrisma = prisma as unknown as {
  delibsSession: { findUnique: ReturnType<typeof vi.fn> };
};

const fakeSession = {
  id: "ds1",
  applicationCycleId: "cy1",
  domainId: "dom1",
  domain: { id: "dom1", name: "design", displayName: "Design" },
  type: "Initial",
  status: "Active",
  columnOrder: { "No Decision": ["da1"], Interview: [], Reject: [] },
  createdAt: new Date("2026-10-05"),
  updatedAt: new Date("2026-10-06"),
};

beforeEach(() => vi.clearAllMocks());

describe("get_delibs_session", () => {
  it("requires mcp:read scope", () => {
    expect(GET_DELIBS_SESSION_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws 404 when session not found", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue(null);
    await expect(
      runGetDelibsSession("u1", { delibsSessionId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws forbidden when caller has no cycle access", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue(fakeSession);
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    await expect(
      runGetDelibsSession("u1", { delibsSessionId: "ds1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("throws forbidden when confidentiality not signed", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue(fakeSession);
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "no_agreement",
      activeVersionId: null,
    });
    await expect(
      runGetDelibsSession("u1", { delibsSessionId: "ds1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns session board state for a signed caller with cycle access", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue(fakeSession);
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "signed",
      activeVersionId: "v1",
    });

    const result = await runGetDelibsSession("u1", { delibsSessionId: "ds1" }) as any;
    expect(result).toMatchObject({
      id: "ds1",
      cycleId: "cy1",
      type: "Initial",
      status: "Active",
      domain: { id: "dom1", name: "Design" },
      columnOrder: { "No Decision": ["da1"] },
    });
  });
});
