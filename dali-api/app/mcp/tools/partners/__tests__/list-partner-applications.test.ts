import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
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
  class McpInvalidError extends McpError {
    constructor(message = "Invalid") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpForbiddenError, McpInvalidError, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { runListPartnerApplications, LIST_PARTNER_APPLICATIONS_TOOL } from "../list-partner-applications";

const mockPrisma = prisma as unknown as {
  partnerApplication: { findMany: ReturnType<typeof vi.fn> };
  partnerCrmSettings: { findUnique: ReturnType<typeof vi.fn> };
};

const NOW = new Date("2026-10-06T12:00:00Z");

function app(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    title: "Kiosk pitch",
    stage: "Interview",
    createdAt: new Date("2026-08-01"),
    nextStep: null,
    nextStepDueAt: null,
    lastActivityAt: NOW,
    holdUntil: null,
    partnerOrg: null,
    applicantContact: { id: "c1", name: "Jo", email: "jo@acme.com" },
    targetTerms: [],
    domains: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockPrisma.partnerCrmSettings = { findUnique: vi.fn().mockResolvedValue({ staleDays: 14 }) };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("list_partner_applications", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_PARTNER_APPLICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runListPartnerApplications("u1", {})).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("rejects an invalid stage filter", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([]) };
    await expect(runListPartnerApplications("u1", { stage: ["Bogus"] })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
  });

  it("flags a card past the stale threshold as isStale", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const staleCard = app({
      id: "app-stale",
      lastActivityAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
    });
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([staleCard]) };

    const { applications } = await runListPartnerApplications("u1", {});

    expect(applications).toEqual([
      expect.objectContaining({ id: "app-stale", isStale: true }),
    ]);
  });

  it("carries nextStep, nextStepDueAt and lastActivityAt, and isStale is false for a fresh card", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const dueTomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const fresh = app({ nextStep: "Send SOW draft", nextStepDueAt: dueTomorrow });
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([fresh]) };

    const { applications } = await runListPartnerApplications("u1", {});

    expect(applications[0]).toMatchObject({
      nextStep: "Send SOW draft",
      nextStepDueAt: dueTomorrow,
      lastActivityAt: NOW,
      isStale: false,
    });
  });

  it("a card outside New/Interview is never stale regardless of lastActivityAt", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const oldAccepted = app({
      stage: "Accepted",
      lastActivityAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000),
    });
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([oldAccepted]) };

    const { applications } = await runListPartnerApplications("u1", {});

    expect((applications[0] as Record<string, unknown>).isStale).toBe(false);
  });

  it("falls back to the default stale threshold when no settings row exists", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerCrmSettings.findUnique.mockResolvedValue(null);
    const staleCard = app({ lastActivityAt: new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000) });
    mockPrisma.partnerApplication = { findMany: vi.fn().mockResolvedValue([staleCard]) };

    const { applications } = await runListPartnerApplications("u1", {});

    expect((applications[0] as Record<string, unknown>).isStale).toBe(true);
  });
});
