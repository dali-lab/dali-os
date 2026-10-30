import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { outboundMessage: { update: vi.fn(), updateMany: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/admin/routes/admin.outbound-messages";

function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/admin/outbound-messages", { method: "POST", body }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(prisma.outboundMessage.update).mockResolvedValue({ channel: "email", purpose: "applicant" } as never);
});

describe("admin.outbound-messages action", () => {
  it("logs a retry with the channel and purpose but not the recipient", async () => {
    await submit({ intent: "retry", id: "om-1" });

    const event = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      action: "outbound.retry",
      userId: "u1",
      targetId: "om-1",
      metadata: { channel: "email", purpose: "applicant" },
    });
    expect(vi.mocked(prisma.outboundMessage.update).mock.calls[0][0].select).toEqual({
      channel: true,
      purpose: true,
    });
  });

  it("logs a cancel", async () => {
    await submit({ intent: "cancel", id: "om-2" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "outbound.cancel", targetId: "om-2" }),
    );
  });

  it("logs nothing when the row is not in the right state or the caller is not Core", async () => {
    vi.mocked(prisma.outboundMessage.update).mockRejectedValue(new Error("not found"));
    await expect(submit({ intent: "cancel", id: "om-3" })).rejects.toThrow();
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await submit({ intent: "retry", id: "om-1" })).status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("re-queues a Dead row with a fresh attempt budget", async () => {
    await submit({ intent: "retry", id: "om-1" });
    const call = vi.mocked(prisma.outboundMessage.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "om-1", status: "Dead" });
    expect(call.data).toMatchObject({ status: "Pending", attempts: 0, lastError: null });
    expect(call.data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("cancels only Pending or Dead rows", async () => {
    await submit({ intent: "cancel", id: "om-4" });
    const call = vi.mocked(prisma.outboundMessage.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "om-4", status: { in: ["Pending", "Dead"] } });
    expect(call.data).toEqual({ status: "Canceled" });
  });

  it("rejects a retry or cancel with no id", async () => {
    expect((await submit({ intent: "retry" })).status).toBe(400);
    expect((await submit({ intent: "cancel" })).status).toBe(400);
    expect(prisma.outboundMessage.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    expect((await submit({ intent: "nope", id: "om-1" })).status).toBe(400);
  });
});

describe("admin.outbound-messages retry-all", () => {
  it("re-queues every Dead row matching the search and logs one entry with the count", async () => {
    vi.mocked(prisma.outboundMessage.updateMany).mockResolvedValue({ count: 3 } as never);
    const res = await submit({ intent: "retry-all", q: "  digest " });
    expect(await res.json()).toEqual({ ok: true, count: 3 });

    const call = vi.mocked(prisma.outboundMessage.updateMany).mock.calls[0][0]!;
    const contains = { contains: "digest", mode: "insensitive" };
    expect(call.where).toEqual({
      status: "Dead",
      OR: [{ target: contains }, { recipientUserId: contains }, { eventType: contains }, { subject: contains }],
    });
    expect(call.data).toMatchObject({ status: "Pending", attempts: 0, lastError: null });

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "outbound.retry_all",
      userId: "u1",
      metadata: { count: 3, search: "digest" },
    });
  });

  it("matches every Dead row when there is no search, without needing an id", async () => {
    vi.mocked(prisma.outboundMessage.updateMany).mockResolvedValue({ count: 1 } as never);
    await submit({ intent: "retry-all" });
    expect(vi.mocked(prisma.outboundMessage.updateMany).mock.calls[0][0]!.where).toEqual({ status: "Dead" });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({ count: 1, search: null });
  });

  it("logs nothing when no row was re-queued", async () => {
    vi.mocked(prisma.outboundMessage.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await (await submit({ intent: "retry-all", q: "x" })).json()).toEqual({ ok: true, count: 0 });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await submit({ intent: "retry-all" })).status).toBe(403);
    expect(prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
});
