import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    outboundMessage: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db.server";
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
    expect(out.page).toEqual({ nextCursor: null, hasMore: false, limit: 100 });
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
      expect.objectContaining({
        where: { AND: [expect.objectContaining({ status: "Dead" }), {}] },
      }),
    );
  });

  it("passes text search (q) through to prisma OR clause", async () => {
    await runListOutboundMessages(makeCtx(), { q: "welcome" });
    expect(prisma.outboundMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ subject: expect.objectContaining({ contains: "welcome" }) }),
              ]),
            }),
            {},
          ],
        },
      }),
    );
  });

  it("returns empty list when no rows found", async () => {
    (prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out.page.hasMore).toBe(false);
    expect(out.messages).toEqual([]);
  });

  it("serializes null sentAt as null", async () => {
    (prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MSG_ROW, sentAt: null },
    ]);
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out.messages[0].sentAt).toBeNull();
  });

  it("walks pages with the cursor and ends with a null cursor", async () => {
    const rows = [
      { ...MSG_ROW, id: "msg-3", createdAt: new Date("2026-09-03T00:00:00Z") },
      { ...MSG_ROW, id: "msg-2", createdAt: new Date("2026-09-02T00:00:00Z") },
      { ...MSG_ROW, id: "msg-1", createdAt: new Date("2026-09-01T00:00:00Z") },
    ];
    const findMany = prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce(rows);

    const first = await runListOutboundMessages(makeCtx(), { limit: 2 });
    expect(first.messages.map((m) => m.id)).toEqual(["msg-3", "msg-2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(findMany.mock.calls[0][0].take).toBe(3);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

    findMany.mockResolvedValueOnce([rows[2]]);
    const second = await runListOutboundMessages(makeCtx(), { limit: 2, cursor: first.page.nextCursor! });
    expect(second.messages.map((m) => m.id)).toEqual(["msg-1"]);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: new Date("2026-09-02T00:00:00Z") } },
        { createdAt: new Date("2026-09-02T00:00:00Z"), id: { lt: "msg-2" } },
      ],
    });
  });

  it("no longer reports the page length as total", async () => {
    const out = await runListOutboundMessages(makeCtx(), {});
    expect(out).not.toHaveProperty("total");
    expect(out.page).not.toHaveProperty("total");
  });
});
