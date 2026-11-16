import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn(() => new Response(null, { status: 403 })) }));
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/staffing-assign.server", () => {
  class StaffingWriteError extends Error {
    constructor(
      m: string,
      public status: number,
    ) {
      super(m);
    }
  }
  return { StaffingWriteError, setDomainEligibility: vi.fn() };
});

import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { setDomainEligibility, StaffingWriteError } from "../../lib/staffing-assign.server";
import { action } from "../api.staffing.eligibility";

function call(body: unknown) {
  return action({
    request: new Request("http://localhost/api/staffing/eligibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as never);
}
const BODY = { cycleId: "c1", userId: "u1", domainId: "d1", level: "P2" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead" } } as never);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
});

describe("POST /api/staffing/eligibility", () => {
  it("forbids non-managers", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await call(BODY)).status).toBe(403);
    expect(setDomainEligibility).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    expect((await call({ ...BODY, level: "P9" })).status).toBe(400);
  });

  it("calls the service as the signed-in user and returns the same shape", async () => {
    vi.mocked(setDomainEligibility).mockResolvedValue({ created: false, domainName: "Development" });
    const res = await call(BODY);
    expect(setDomainEligibility).toHaveBeenCalledWith(expect.objectContaining({ ...BODY, actorId: "lead" }));
    expect(await res.json()).toEqual({ ok: true, domainId: "d1", domainName: "Development", level: "P2" });
  });

  it("maps a service error to its status and message", async () => {
    vi.mocked(setDomainEligibility).mockRejectedValue(new StaffingWriteError("Cycle not found", 404));
    const res = await call(BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Cycle not found" });
  });
});
