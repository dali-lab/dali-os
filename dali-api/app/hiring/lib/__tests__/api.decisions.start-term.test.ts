import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { action } from "~/hiring/routes/api.decisions.$id.start-term";

const db = prisma as any;

function post(termId: string) {
  return action({
    request: new Request("http://localhost/api/hiring/decisions/dec-1/start-term", {
      method: "POST",
      body: new URLSearchParams({ termId }),
    }),
    params: { id: "dec-1" },
    context: {},
  } as any) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead-1" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(null);
  db.decision = {
    findUnique: vi.fn().mockResolvedValue({
      domainApplication: { application: { userId: "ada", applicationCycleId: "cycle-1" } },
    }),
  };
  db.application = {
    findUnique: vi.fn().mockResolvedValue({ id: "app-1", applicationCycle: { term: { sortKey: 20264 } } }),
    update: vi.fn(),
  };
  db.term = { findUnique: vi.fn().mockResolvedValue({ sortKey: 20271 }) };
});

describe("POST /api/hiring/decisions/:id/start-term", () => {
  it("stores the term on the decision's application and audits it", async () => {
    const res = await post("t-27w");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ startTermId: "t-27w" });
    expect(db.application.findUnique.mock.calls[0][0].where).toEqual({
      userId_applicationCycleId: { userId: "ada", applicationCycleId: "cycle-1" },
    });
    expect(db.application.update).toHaveBeenCalledWith({ where: { id: "app-1" }, data: { startTermId: "t-27w" } });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "application.start-term",
      userId: "lead-1",
      targetId: "app-1",
      metadata: { cycleId: "cycle-1", applicantUserId: "ada", startTermId: "t-27w" },
    });
  });

  it("clears the term on an empty value", async () => {
    const res = await post("");
    expect(await res.json()).toEqual({ startTermId: null });
    expect(db.application.update).toHaveBeenCalledWith({ where: { id: "app-1" }, data: { startTermId: null } });
  });

  it("refuses a term before the one the cycle ran in", async () => {
    db.term.findUnique.mockResolvedValue({ sortKey: 20263 });
    const res = await post("t-26x");
    expect(res.status).toBe(400);
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("403s for non-core users", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await post("t-27w");
    expect(res.status).toBe(403);
    expect(db.decision.findUnique).not.toHaveBeenCalled();
  });

  it("404s for an unknown decision", async () => {
    db.decision.findUnique.mockResolvedValue(null);
    const res = await post("t-27w");
    expect(res.status).toBe(404);
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("returns the confidentiality gate's response when the lead hasn't signed", async () => {
    vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(new Response(null, { status: 451 }));
    const res = await post("t-27w");
    expect(res.status).toBe(451);
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("405s on anything but POST", async () => {
    const res = (await action({
      request: new Request("http://localhost/api/hiring/decisions/dec-1/start-term", { method: "PUT" }),
      params: { id: "dec-1" },
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(405);
  });
});
