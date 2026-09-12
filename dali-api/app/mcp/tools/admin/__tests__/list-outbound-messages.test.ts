import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    outboundMessage: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runListOutboundMessages,
  LIST_OUTBOUND_MESSAGES_TOOL,
} from "~/mcp/tools/admin/list-outbound-messages";
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

const MSG_ROW = {
  id: "msg-1",
  channel: "Email",
  status: "Sent",
  target: "user@example.com",
  recipientUserId: "u-1",
  subject: "Welcome to DALI",
  eventType: "member.welcome",
  attempts: 1,
  lastError: null,
  sentAt: new Date("2026-09-01T10:00:00Z"),
  createdAt: new Date("2026-09-01T09:59:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  (prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MSG_ROW]);
});

describe("list_outbound_messages", () => {
  it("requires mcp:admin scope", () => {
    expect(LIST_OUTBOUND_MESSAGES_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListOutboundMessages(makeCtx("u-nobody"), {})).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });

  it("returns messages with ISO timestamps on happy path", async () => {
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out.total).toBe(1);
    expect(out.messages[0]).toMatchObject({
      id: "msg-1",
      channel: "Email",
      status: "Sent",
      target: "user@example.com",
      sentAt: "2026-09-01T10:00:00.000Z",
      createdAt: "2026-09-01T09:59:00.000Z",
    });
  });

  it("passes status filter through to prisma query", async () => {
    await runListOutboundMessages(makeCtx(), { status: "Dead" });
    expect(prisma.outboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "Dead" }) }),
    );
  });

  it("passes text search (q) through to prisma OR clause", async () => {
    await runListOutboundMessages(makeCtx(), { q: "welcome" });
    expect(prisma.outboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ subject: expect.objectContaining({ contains: "welcome" }) }),
          ]),
        }),
      }),
    );
  });

  it("returns empty list when no rows found", async () => {
    (prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out.total).toBe(0);
    expect(out.messages).toEqual([]);
  });

  it("serializes null sentAt as null", async () => {
    (prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MSG_ROW, sentAt: null },
    ]);
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out.messages[0].sentAt).toBeNull();
  });
});
