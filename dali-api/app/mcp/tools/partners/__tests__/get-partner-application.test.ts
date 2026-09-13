// Tests for get_partner_application (deepened read: eval fields, meetings, source, assignedMeeterId).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplication: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canViewStaffing: vi.fn() };
});

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'.`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import {
  runGetPartnerApplication,
  GET_PARTNER_APPLICATION_TOOL,
} from "../get-partner-application";

const mockPrisma = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn> };
};

const FAKE_APPLICATION = {
  id: "app-1",
  title: "AI Health Tool",
  status: "UnderReview",
  summary: "A useful tool",
  sowDocId: null,
  resultingProjectId: null,
  source: "Manual",
  assignedMeeterId: "user-42",
  evalRubric: { feasibility: 4, impact: 5, criteriaVersion: 1 },
  interviewRating: 4,
  ambiguityRating: 3,
  fundingModel: "Magnuson grant",
  decisionReason: null,
  partnerOrg: null,
  applicantContact: { id: "c1", name: "Jane Partner", email: "jane@example.com" },
  targetTerms: [{ termId: "t1", term: { code: "27W" } }],
  domains: [
    { id: "dom-1", domainId: "domain-ml", expectedMembers: 2, domain: { displayName: "ML" } },
  ],
  formSubmission: { id: "sub-1" },
  meetings: [
    {
      id: "meet-1",
      scheduledAt: new Date("2026-10-15T14:00:00Z"),
      attendeeUserIds: ["user-a"],
      notes: "Prep notes",
      debrief: "Great call",
      outcome: "Advance",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_partner_application metadata", () => {
  it("requires mcp:read scope", () => {
    expect(GET_PARTNER_APPLICATION_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(
      runGetPartnerApplication("u1", { applicationId: "a1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });
});

describe("get_partner_application", () => {
  it("returns deepened fields: evalRubric, meetings, source, assignedMeeterId", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(FAKE_APPLICATION);

    const out = await runGetPartnerApplication("u1", { applicationId: "app-1" }) as Record<string, unknown>;

    expect(out.id).toBe("app-1");
    expect(out.source).toBe("Manual");
    expect(out.assignedMeeterId).toBe("user-42");
    expect(out.evalRubric).toMatchObject({ feasibility: 4, impact: 5 });
    expect(out.interviewRating).toBe(4);
    expect(out.ambiguityRating).toBe(3);
    expect(out.fundingModel).toBe("Magnuson grant");
    expect(out.decisionReason).toBeNull();
    expect((out.meetings as unknown[]).length).toBe(1);
    expect((out.meetings as Record<string, unknown>[])[0]).toMatchObject({
      id: "meet-1",
      scheduledAt: "2026-10-15T14:00:00.000Z",
      outcome: "Advance",
    });
    expect(out.hasFormSubmission).toBe(true);
  });

  it("throws McpNotFoundError when application is missing", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(
      runGetPartnerApplication("u1", { applicationId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns null for optional fields when unset", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({
      ...FAKE_APPLICATION,
      assignedMeeterId: null,
      evalRubric: null,
      interviewRating: null,
      ambiguityRating: null,
      fundingModel: null,
      meetings: [],
      formSubmission: null,
    });

    const out = await runGetPartnerApplication("u1", { applicationId: "app-1" }) as Record<string, unknown>;
    expect(out.assignedMeeterId).toBeNull();
    expect(out.evalRubric).toBeNull();
    expect(out.interviewRating).toBeNull();
    expect((out.meetings as unknown[]).length).toBe(0);
    expect(out.hasFormSubmission).toBe(false);
  });
});
