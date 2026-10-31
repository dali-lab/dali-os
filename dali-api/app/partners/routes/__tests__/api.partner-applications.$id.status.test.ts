import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/partners/lib/partner-activity.server", () => ({ setApplicationStage: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { setApplicationStage } from "~/partners/lib/partner-activity.server";
import { action } from "~/partners/routes/api.partner-applications.$id.status";

function post(body: unknown) {
  return action({
    request: new Request("http://localhost/api/partner-applications/app-1/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "app-1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(setApplicationStage).mockResolvedValue("New" as never);
});

describe("POST /api/partner-applications/:id/status audit", () => {
  it("hands the request to the shared stage funnel, which writes the row, and does not log itself", async () => {
    await post({ stage: "Interview" });

    expect(setApplicationStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: "app-1",
        to: "Interview",
        actorUserId: "core-1",
        request: expect.any(Request),
      }),
    );
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing when the application is gone or the stage is invalid", async () => {
    vi.mocked(setApplicationStage).mockResolvedValue(null);
    expect((await post({ stage: "Interview" })).status).toBe(404);
    expect((await post({ stage: "Nonsense" })).status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
