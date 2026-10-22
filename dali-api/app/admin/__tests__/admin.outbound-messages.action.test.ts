import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { outboundMessage: { update: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { prisma } from "~/lib/db";
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
});
