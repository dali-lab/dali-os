import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockLogAuditEvent = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

import { action } from "~/routes/api.desktop.updated";

function req(body?: unknown, method = "POST") {
  return new Request("http://localhost/api/desktop/updated", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ ok: true, user: { sub: "user-1" } });
});

describe("POST /api/desktop/updated", () => {
  it("logs desktop.update with the from/to versions", async () => {
    const res = await action({
      request: req({ from: "0.1.5", to: "0.1.6" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "desktop.update",
        userId: "user-1",
        metadata: { from: "0.1.5", to: "0.1.6" },
      }),
    );
  });

  it("rejects an unauthenticated request without logging", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response("unauth", { status: 401 }),
    });
    const res = await action({
      request: req({ from: "0.1.5", to: "0.1.6" }),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(401);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("tolerates a missing body and still records the event", async () => {
    const res = await action({ request: req(undefined), params: {}, context: {} } as any);
    expect(res.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "desktop.update",
        metadata: { from: "unknown", to: "unknown" },
      }),
    );
  });
});
