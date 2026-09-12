import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    gmailIntegration: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runManageEmailSender,
  MANAGE_EMAIL_SENDER_TOOL,
} from "~/mcp/tools/admin/manage-email-sender";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  (prisma.gmailIntegration.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "gi-1",
  });
  (prisma.gmailIntegration.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("manage_email_sender", () => {
  it("requires mcp:admin scope", () => {
    expect(MANAGE_EMAIL_SENDER_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageEmailSender(makeCtx("u-nobody"), {
        action: "disable",
        integrationId: "gi-1",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(prisma.gmailIntegration.update).not.toHaveBeenCalled();
  });

  it("throws McpNotFoundError when integration does not exist", async () => {
    (prisma.gmailIntegration.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      runManageEmailSender(makeCtx(), { action: "disable", integrationId: "gi-missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    expect(prisma.gmailIntegration.update).not.toHaveBeenCalled();
  });

  describe("action: disable", () => {
    it("sets enabled=false and returns ok", async () => {
      const out = await runManageEmailSender(makeCtx(), {
        action: "disable",
        integrationId: "gi-1",
      });
      expect(out).toEqual({ ok: true });
      expect(prisma.gmailIntegration.update).toHaveBeenCalledWith({
        where: { id: "gi-1" },
        data: { enabled: false },
      });
    });
  });

  describe("action: save_cap", () => {
    it("sets a positive dailyCap", async () => {
      const out = await runManageEmailSender(makeCtx(), {
        action: "save_cap",
        integrationId: "gi-1",
        dailyCap: 500,
      });
      expect(out).toEqual({ ok: true, dailyCap: 500 });
      expect(prisma.gmailIntegration.update).toHaveBeenCalledWith({
        where: { id: "gi-1" },
        data: { dailyCap: 500 },
      });
    });

    it("clears dailyCap when dailyCap=0", async () => {
      const out = await runManageEmailSender(makeCtx(), {
        action: "save_cap",
        integrationId: "gi-1",
        dailyCap: 0,
      });
      expect(out).toEqual({ ok: true, dailyCap: null });
      expect(prisma.gmailIntegration.update).toHaveBeenCalledWith({
        where: { id: "gi-1" },
        data: { dailyCap: null },
      });
    });

    it("clears dailyCap when dailyCap is omitted", async () => {
      const out = await runManageEmailSender(makeCtx(), {
        action: "save_cap",
        integrationId: "gi-1",
      });
      expect(out).toEqual({ ok: true, dailyCap: null });
    });

    it("floors decimal dailyCap values", async () => {
      const out = await runManageEmailSender(makeCtx(), {
        action: "save_cap",
        integrationId: "gi-1",
        dailyCap: 99.9,
      });
      expect(out).toEqual({ ok: true, dailyCap: 99 });
    });
  });
});
