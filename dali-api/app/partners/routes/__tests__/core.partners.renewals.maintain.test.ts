import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/core-members.server", () => ({ listActiveCoreMembers: vi.fn() }));
vi.mock("~/partners/lib/partner-renewals.server", () => ({
  applyContinue: vi.fn(),
  applyMaintain: vi.fn(),
  applyNotContinuing: vi.fn(),
  applyUndecided: vi.fn(),
  loadRenewalCards: vi.fn(),
  setTermPi: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { applyMaintain } from "~/partners/lib/partner-renewals.server";
import { action } from "~/partners/routes/core.partners.renewals";

function post(fields: Record<string, string>) {
  const request = new Request("http://localhost/core/partners/renewals", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

const base = { intent: "maintain", projectId: "p1", decisionTermId: "t27w", nextStep: "", nextStepDue: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("renewals maintain intent", () => {
  it("puts the project on the chosen plan with its fee", async () => {
    expect(await post({ ...base, plan: "Mild", feeCents: "150000" })).toEqual({ ok: true });
    expect(applyMaintain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "p1", decisionTermId: "t27w", plan: "Mild", feeCents: 150000, userId: "core-1" }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "p1", metadata: { renewalIntent: "maintain", decisionTermId: "t27w" } }),
    );
  });

  it("allows no fee", async () => {
    await post({ ...base, plan: "Hosting", feeCents: "" });
    expect(vi.mocked(applyMaintain).mock.calls[0][1]).toMatchObject({ plan: "Hosting", feeCents: null });
  });

  it.each([
    ["no plan", { plan: "" }],
    ["an unknown plan", { plan: "Heavy" }],
    ["a negative fee", { plan: "Mild", feeCents: "-5" }],
    ["a fractional fee", { plan: "Mild", feeCents: "1.5" }],
  ])("rejects %s", async (_label, fields) => {
    expect(await post({ ...base, ...fields })).toMatchObject({ error: expect.any(String) });
    expect(applyMaintain).not.toHaveBeenCalled();
  });

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await post({ ...base, plan: "Mild" });
    expect(applyMaintain).not.toHaveBeenCalled();
  });
});
