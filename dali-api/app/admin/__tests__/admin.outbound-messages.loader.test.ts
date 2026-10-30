import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    outboundMessage: { findMany: vi.fn(), groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { loader } from "~/admin/routes/admin.outbound-messages";

const findMany = vi.mocked(prisma.outboundMessage.findMany);

function load(qs = "") {
  return loader({
    request: new Request(`http://localhost/admin/outbound-messages${qs}`),
    params: {},
    context: {},
  } as never) as Promise<any>;
}

function row(id: string) {
  return {
    id,
    channel: "email",
    status: "Sent",
    purpose: null,
    target: "ada@example.edu",
    recipientUserId: null,
    subject: "Hi",
    eventType: null,
    attempts: 1,
    lastError: null,
    sentAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(prisma.outboundMessage.groupBy).mockResolvedValue([
    { status: "Sent", _count: 120 },
    { status: "Dead", _count: 7 },
  ] as never);
  findMany.mockResolvedValue([] as never);
});

describe("admin.outbound-messages loader paging", () => {
  it("reads one extra row past the page, offsets by page, and breaks createdAt ties by id", async () => {
    findMany.mockResolvedValue(Array.from({ length: 51 }, (_, i) => row(`m${i}`)) as never);
    const data = await load("?page=2&status=Sent&q=ada");
    const args = findMany.mock.calls[0][0]!;
    expect(args.skip).toBe(50);
    expect(args.take).toBe(51);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.where).toMatchObject({ status: "Sent" });
    expect(data.messages).toHaveLength(50);
    expect(data.hasNext).toBe(true);
    expect(data.page).toBe(2);
  });

  it("uses the filtered status count as the matching total, and the grand total with no filter", async () => {
    expect((await load("?status=Dead")).matching).toBe(7);
    expect((await load("")).matching).toBe(127);
  });

  it("falls back to page one for a bad page and reports no next page on a short result", async () => {
    findMany.mockResolvedValue([row("m1")] as never);
    const data = await load("?page=abc");
    expect(findMany.mock.calls[0][0]!.skip).toBe(0);
    expect(data.hasNext).toBe(false);
  });
});
