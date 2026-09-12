// Tests for the new CRM actions added to manage_partner_application:
//   update_title, assign_meeter, save_eval, save_acceptance, add_note,
//   update_domain_scope (extended with expectedChallenges).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplication: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    partnerApplicationDomain: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    partnerActivity: {
      create: vi.fn(),
    },
  },
}));

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

vi.mock("~/partners/lib/application-form.server", () => ({
  setApplicationFormBinding: vi.fn(),
  clearApplicationFormBinding: vi.fn(),
}));

vi.mock("~/partners/lib/partner-activity.server", () => ({
  setApplicationStatus: vi.fn().mockResolvedValue("Inquiry"),
  logPartnerActivity: vi.fn().mockResolvedValue(undefined),
}));

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
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import {
  runManagePartnerApplication,
  MANAGE_PARTNER_APPLICATION_TOOL,
} from "../manage-partner-application";

const mockPrisma = prisma as unknown as {
  partnerApplication: {
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  partnerApplicationDomain: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  partnerActivity: {
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── scope / gate ──────────────────────────────────────────────────────────────

describe("manage_partner_application metadata", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PARTNER_APPLICATION_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerApplication("u1", { action: "update_title", applicationId: "a1", title: "x" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });
});

// ─── update_title ──────────────────────────────────────────────────────────────

describe("update_title", () => {
  it("updates the title", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    const out = await runManagePartnerApplication("u1", {
      action: "update_title",
      applicationId: "a1",
      title: "New Title",
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: "New Title" } }),
    );
  });

  it("rejects empty title", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerApplication("u1", {
        action: "update_title",
        applicationId: "a1",
        title: "   ",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpNotFoundError on P2025", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockRejectedValue({ code: "P2025" });
    await expect(
      runManagePartnerApplication("u1", {
        action: "update_title",
        applicationId: "missing",
        title: "Whatever",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── assign_meeter ────────────────────────────────────────────────────────────

describe("assign_meeter", () => {
  it("sets the assigned meeter", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    const out = await runManagePartnerApplication("u1", {
      action: "assign_meeter",
      applicationId: "a1",
      assignedMeeterId: "user-99",
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedMeeterId: "user-99" } }),
    );
  });

  it("clears the meeter when assignedMeeterId is empty string", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    await runManagePartnerApplication("u1", {
      action: "assign_meeter",
      applicationId: "a1",
      assignedMeeterId: "",
    });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedMeeterId: null } }),
    );
  });

  it("clears the meeter when assignedMeeterId is omitted", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    await runManagePartnerApplication("u1", {
      action: "assign_meeter",
      applicationId: "a1",
    });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedMeeterId: null } }),
    );
  });
});

// ─── save_eval ────────────────────────────────────────────────────────────────

describe("save_eval", () => {
  it("saves criterion scores and logs Evaluated activity", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    const out = await runManagePartnerApplication("u1", {
      action: "save_eval",
      applicationId: "a1",
      evalScores: { feasibility: 4, impact: 5 },
      interviewRating: 4,
      evalNotes: "Great team",
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          interviewRating: 4,
        }),
      }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: "a1",
        type: "Evaluated",
        metadata: { interviewRating: 4 },
      }),
    );
  });

  it("rejects an unknown criterion key", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerApplication("u1", {
        action: "save_eval",
        applicationId: "a1",
        evalScores: { badKey: 3 },
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("rejects out-of-range scores", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerApplication("u1", {
        action: "save_eval",
        applicationId: "a1",
        evalScores: { feasibility: 6 },
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("saves with no scores (just notes)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);
    const out = await runManagePartnerApplication("u1", {
      action: "save_eval",
      applicationId: "a1",
      evalNotes: "First impressions noted",
    });
    expect(out).toMatchObject({ ok: true });
  });
});

// ─── save_acceptance ──────────────────────────────────────────────────────────

describe("save_acceptance", () => {
  it("saves ambiguity rating and funding model", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    const out = await runManagePartnerApplication("u1", {
      action: "save_acceptance",
      applicationId: "a1",
      ambiguityRating: 3,
      fundingModel: "Magnuson grant",
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ambiguityRating: 3, fundingModel: "Magnuson grant" }),
      }),
    );
  });

  it("requires at least one field", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerApplication("u1", {
        action: "save_acceptance",
        applicationId: "a1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("clamps ambiguity rating to 1-5", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.update.mockResolvedValue({ id: "a1" });
    await runManagePartnerApplication("u1", {
      action: "save_acceptance",
      applicationId: "a1",
      ambiguityRating: 99,
    });
    expect(mockPrisma.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ambiguityRating: 5 }) }),
    );
  });
});

// ─── add_note ─────────────────────────────────────────────────────────────────

describe("add_note", () => {
  it("logs a Note activity", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ id: "a1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    const out = await runManagePartnerApplication("u1", {
      action: "add_note",
      applicationId: "a1",
      body: "Had a great discovery call",
    });
    expect(out).toMatchObject({ ok: true });
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: "a1",
        type: "Note",
        body: "Had a great discovery call",
        actorUserId: "u1",
      }),
    );
  });

  it("rejects empty body", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerApplication("u1", {
        action: "add_note",
        applicationId: "a1",
        body: "   ",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpNotFoundError when application missing", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(
      runManagePartnerApplication("u1", {
        action: "add_note",
        applicationId: "missing",
        body: "note",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── update_domain_scope with expectedChallenges ──────────────────────────────

describe("update_domain_scope (expectedChallenges)", () => {
  it("writes a paragraph block for expectedChallenges", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplicationDomain.findUnique.mockResolvedValue({ id: "dom-1" });
    mockPrisma.partnerApplicationDomain.update.mockResolvedValue({ id: "dom-1" });

    const out = await runManagePartnerApplication("u1", {
      action: "update_domain_scope",
      applicationDomainId: "dom-1",
      expectedMembers: 2,
      expectedChallenges: "Build a real-time dashboard",
    });
    expect(out).toMatchObject({ ok: true });
    const updateCall = mockPrisma.partnerApplicationDomain.update.mock.calls[0][0] as {
      data: { expectedChallenges: unknown[] };
    };
    expect(updateCall.data.expectedChallenges).toBeInstanceOf(Array);
    expect(updateCall.data.expectedChallenges[0]).toMatchObject({
      type: "paragraph",
      content: expect.arrayContaining([
        expect.objectContaining({ text: "Build a real-time dashboard" }),
      ]),
    });
  });

  it("does not write expectedChallenges when not provided", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplicationDomain.findUnique.mockResolvedValue({ id: "dom-1" });
    mockPrisma.partnerApplicationDomain.update.mockResolvedValue({ id: "dom-1" });

    await runManagePartnerApplication("u1", {
      action: "update_domain_scope",
      applicationDomainId: "dom-1",
      expectedMembers: 3,
    });
    const updateCall = mockPrisma.partnerApplicationDomain.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty("expectedChallenges");
  });
});
