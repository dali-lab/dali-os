import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    outboundMessage: { updateMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runManageOutboundMessage,
  MANAGE_OUTBOUND_MESSAGE_TOOL,
} from "~/mcp/tools/admin/manage-outbound-message";
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
  (prisma.outboundMessage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
});

describe("manage_outbound_message", () => {
  it("requires mcp:admin scope", () => {
    expect(MANAGE_OUTBOUND_MESSAGE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageOutboundMessage(makeCtx("u-nobody"), { action: "retry", messageId: "msg-1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  describe("action: retry", () => {
    it("resets a Dead message to Pending and returns ok", async () => {
      const out = await runManageOutboundMessage(makeCtx(), {
        action: "retry",
        messageId: "msg-dead",
      });
      expect(out).toEqual({ ok: true });
      expect(prisma.outboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-dead", status: "Dead" },
          data: expect.objectContaining({ status: "Pending", attempts: 0, lastError: null }),
        }),
      );
    });

    it("throws McpNotFoundError when message is not Dead or does not exist", async () => {
      (prisma.outboundMessage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });
      await expect(
        runManageOutboundMessage(makeCtx(), { action: "retry", messageId: "msg-none" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });

  describe("action: cancel", () => {
    it("sets a Pending message to Canceled and returns ok", async () => {
      const out = await runManageOutboundMessage(makeCtx(), {
        action: "cancel",
        messageId: "msg-pending",
      });
      expect(out).toEqual({ ok: true });
      expect(prisma.outboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-pending", status: "Pending" },
          data: { status: "Canceled" },
        }),
      );
    });

    it("throws McpNotFoundError when message is not Pending or does not exist", async () => {
      (prisma.outboundMessage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });
      await expect(
        runManageOutboundMessage(makeCtx(), { action: "cancel", messageId: "msg-none" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });

  it("throws McpInvalidError for an unknown action", async () => {
    await expect(
      runManageOutboundMessage(makeCtx(), { action: "explode", messageId: "msg-1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
});
