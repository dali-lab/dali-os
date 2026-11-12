import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/application-form.server", () => ({
  setApplicationFormBinding: vi.fn(),
  clearApplicationFormBinding: vi.fn(),
  getApplicationFormBinding: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), getActiveCoreCycleTermIds: vi.fn() }));
vi.mock("~/partners/lib/partner-survey.server", () => ({
  setSurveyFormBinding: vi.fn(),
  clearSurveyFormBinding: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/partners/routes/core.partners.settings";

const db = prisma as unknown as Record<string, any>;

function callAction(fields: Record<string, string>) {
  const request = new Request("http://localhost/core/partners/settings", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1", type: "member" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  db.partnerCrmSettings.upsert.mockResolvedValue({});
});

describe("maintenance prices", () => {
  it("saves each tier's per-term price in cents, blank meaning not set", async () => {
    const res = await callAction({ intent: "maintenance-prices", Hosting: "500", Mild: "1,250.50", Medium: "" });
    expect(res).toEqual({ ok: true });
    const data = { maintenanceHostingCents: 50000, maintenanceMildCents: 125050, maintenanceMediumCents: null };
    expect(db.partnerCrmSettings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "partner.settings.save",
        metadata: { maintenancePrices: { Hosting: 50000, Mild: 125050, Medium: null } },
      }),
    );
  });

  it("rejects a price that isn't an amount", async () => {
    const res = await callAction({ intent: "maintenance-prices", Hosting: "lots", Mild: "", Medium: "" });
    expect(res).toMatchObject({ error: expect.stringContaining("Hosting") });
    expect(db.partnerCrmSettings.upsert).not.toHaveBeenCalled();
  });

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await callAction({ intent: "maintenance-prices", Hosting: "1", Mild: "", Medium: "" });
    expect(db.partnerCrmSettings.upsert).not.toHaveBeenCalled();
  });
});
