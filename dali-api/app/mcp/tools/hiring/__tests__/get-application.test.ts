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
  requireApiSignedOrForbidden: vi.fn(),
}));
vi.mock("~/hiring/lib/rubric-criteria", () => ({
  buildCriteriaLabelMap: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { GET_APPLICATION_TOOL, runGetApplication } from "../get-application";

const mockPrisma = prisma as unknown as {
  domainApplication: { findUnique: ReturnType<typeof vi.fn> };
  domainApplicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  rubricVersion: { findUnique: ReturnType<typeof vi.fn> };
  collabDocumentVersion: { findMany: ReturnType<typeof vi.fn> };
};

const fakeDa = {
  id: "da1",
  answers: {},
  interviewPrepNote: null,
  challengeVersion: null,
  domain: { id: "dom1", name: "Design" },
  application: {
    id: "app1",
    answers: {},
    user: { firstName: "Alice", lastName: "Smith" },
    generalChallengeVersion: null,
    internToFullFormVersion: null,
    applicationCycle: {
      id: "cy1",
      generalRubricVersionId: null,
      cycleType: "Standard",
    },
  },
  reviews: [],
  decisions: [],
  interviews: [],
};

beforeEach(() => vi.clearAllMocks());

describe("get_application", () => {
  it("requires mcp:read scope", () => {
    expect(GET_APPLICATION_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws 404 when domain application not found", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(null);
    await expect(runGetApplication("u1", { domainApplicationId: "nope" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("throws forbidden when caller has no cycle access", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(fakeDa);
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    await expect(runGetApplication("u1", { domainApplicationId: "da1" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("throws forbidden when confidentiality not signed", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(fakeDa);
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "unsigned",
      activeVersionId: "v1",
    });
    await expect(runGetApplication("u1", { domainApplicationId: "da1" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns full context for a signed caller", async () => {
    mockPrisma.domainApplication.findUnique.mockResolvedValue(fakeDa);
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getCycleConfidentialityState).mockResolvedValue({
      status: "signed",
      activeVersionId: "v1",
    });
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(null);
    mockPrisma.rubricVersion.findUnique.mockResolvedValue(null);
    mockPrisma.collabDocumentVersion.findMany.mockResolvedValue([]);

    const result = await runGetApplication("u1", { domainApplicationId: "da1" }) as any;
    expect(result).toMatchObject({
      domainApplication: { id: "da1" },
      application: { id: "app1", applicant: { firstName: "Alice" } },
      reviews: [],
      decisions: [],
      interviews: [],
    });
  });
});
