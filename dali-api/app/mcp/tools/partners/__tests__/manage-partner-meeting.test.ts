// Tests for manage_partner_meeting (create + debrief actions).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplication: {
      findUnique: vi.fn(),
    },
    partnerMeeting: {
      create: vi.fn(),
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

vi.mock("~/partners/lib/partner-activity.server", () => ({
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
  runManagePartnerMeeting,
  MANAGE_PARTNER_MEETING_TOOL,
} from "../manage-partner-meeting";

const mockPrisma = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn> };
  partnerMeeting: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── scope / gate ──────────────────────────────────────────────────────────────

describe("manage_partner_meeting metadata", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PARTNER_MEETING_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerMeeting("u1", {
        action: "create",
        applicationId: "a1",
        scheduledAt: "2026-10-15T14:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("rejects unknown actions", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerMeeting("u1", { action: "explode", applicationId: "a1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── create ────────────────────────────────────────────────────────────────────

describe("create", () => {
  it("creates a meeting and logs MeetingScheduled activity", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({
      applicantContactId: "contact-1",
    });
    mockPrisma.partnerMeeting.create.mockResolvedValue({ id: "meet-1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    const out = await runManagePartnerMeeting("u1", {
      action: "create",
      applicationId: "a1",
      scheduledAt: "2026-10-15T14:00:00Z",
      attendeeUserIds: ["user-a", "user-b"],
      notes: "First discovery call",
    });

    expect(out).toMatchObject({ id: "meet-1", scheduledAt: "2026-10-15T14:00:00.000Z" });
    expect(mockPrisma.partnerMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: "a1",
          attendeeUserIds: ["user-a", "user-b"],
          notes: "First discovery call",
          contactId: "contact-1",
        }),
      }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: "a1",
        type: "MeetingScheduled",
        metadata: expect.objectContaining({ meetingId: "meet-1" }),
      }),
    );
  });

  it("throws McpNotFoundError when application is missing", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(
      runManagePartnerMeeting("u1", {
        action: "create",
        applicationId: "missing",
        scheduledAt: "2026-10-15T14:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpInvalidError for a bad date", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ applicantContactId: "c1" });
    await expect(
      runManagePartnerMeeting("u1", {
        action: "create",
        applicationId: "a1",
        scheduledAt: "not-a-date",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("requires scheduledAt", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerMeeting("u1", { action: "create", applicationId: "a1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("does NOT email the partner (no email fn called)", async () => {
    // Verify that no partner-email helper is invoked. The test implicitly
    // passes as long as the mocked logPartnerActivity is the only side-effect —
    // there is no sendMeetingInviteEmail in the tool module.
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerApplication.findUnique.mockResolvedValue({ applicantContactId: null });
    mockPrisma.partnerMeeting.create.mockResolvedValue({ id: "meet-2" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    await runManagePartnerMeeting("u1", {
      action: "create",
      applicationId: "a1",
      scheduledAt: "2026-11-01T10:00:00Z",
    });
    // logPartnerActivity called once (MeetingScheduled), not EmailSent
    expect(logPartnerActivity).toHaveBeenCalledTimes(1);
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "MeetingScheduled" }),
    );
  });
});

// ─── debrief ───────────────────────────────────────────────────────────────────

describe("debrief", () => {
  it("updates debrief and outcome, logs MeetingDebriefed", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerMeeting.update.mockResolvedValue({ id: "meet-1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    const out = await runManagePartnerMeeting("u1", {
      action: "debrief",
      applicationId: "a1",
      meetingId: "meet-1",
      debrief: "Great fit, strong technical requirements",
      outcome: "Advance",
    });

    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.partnerMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "meet-1" },
        data: expect.objectContaining({ debrief: "Great fit, strong technical requirements", outcome: "Advance" }),
      }),
    );
    expect(logPartnerActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "MeetingDebriefed",
        metadata: expect.objectContaining({ meetingId: "meet-1", outcome: "Advance" }),
      }),
    );
  });

  it("requires at least debrief or outcome", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerMeeting("u1", {
        action: "debrief",
        applicationId: "a1",
        meetingId: "meet-1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("ignores an invalid outcome value", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerMeeting.update.mockResolvedValue({ id: "meet-1" });
    vi.mocked(logPartnerActivity).mockResolvedValue(undefined);

    await runManagePartnerMeeting("u1", {
      action: "debrief",
      applicationId: "a1",
      meetingId: "meet-1",
      debrief: "Some notes",
      outcome: "InvalidOutcome",
    });
    // outcome should not appear in update data
    const updateCall = mockPrisma.partnerMeeting.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty("outcome");
  });

  it("throws McpNotFoundError on P2025", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerMeeting.update.mockRejectedValue({ code: "P2025" });
    await expect(
      runManagePartnerMeeting("u1", {
        action: "debrief",
        applicationId: "a1",
        meetingId: "missing",
        debrief: "x",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
