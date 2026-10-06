import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { partnerApplication: { findFirst: vi.fn() } },
}));
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));
vi.mock("~/partners/lib/partner-access", () => ({ partnerHasProjectAccess: vi.fn() }));
vi.mock("~/partners/lib/partner-meetings.server", () => ({
  resolveMeetingParticipantIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/availability", async (orig) => {
  const real = await orig<typeof import("~/lib/availability")>();
  return { ...real, computeUserFreeBusy: vi.fn().mockResolvedValue({ free: [], busy: [] }) };
});

import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { resolveMeetingParticipantIds } from "~/partners/lib/partner-meetings.server";
import { action } from "~/partners/routes/api.partner.availability";

const mockPrisma = prisma as unknown as { partnerApplication: { findFirst: ReturnType<typeof vi.fn> } };

const BASE_BODY = {
  weekStartIso: "2026-11-01T05:00:00.000Z",
  weekEndIso: "2026-11-08T05:00:00.000Z",
  durationMinutes: 30,
  timezone: "America/New_York",
};

function post(body: unknown) {
  const request = new Request("http://localhost/api/partner/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePartnerAccount).mockResolvedValue({
    auth: { user: { sub: "partner-user-1" } },
    contact: { id: "contact-1", name: "Pat", email: "pat@example.com", userId: "partner-user-1" },
    memberships: [],
  } as never);
});

describe("POST /api/partner/availability", () => {
  it("rejects a body with both applicationId and projectId", async () => {
    const res = await post({ ...BASE_BODY, applicationId: "app-1", projectId: "proj-1" });
    expect(res.status).toBe(400);
  });

  it("rejects a body with neither", async () => {
    const res = await post(BASE_BODY);
    expect(res.status).toBe(400);
  });

  it("404s when the contact doesn't own the application", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue(null);
    const res = await post({ ...BASE_BODY, applicationId: "app-1" });
    expect(res.status).toBe(404);
    expect(resolveMeetingParticipantIds).not.toHaveBeenCalled();
  });

  it("404s when the contact has no access to the project", async () => {
    vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
    const res = await post({ ...BASE_BODY, projectId: "proj-1" });
    expect(res.status).toBe(404);
  });

  it("returns {days} with no perUser key when the application is owned", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue({ id: "app-1" });
    vi.mocked(resolveMeetingParticipantIds).mockResolvedValue(["core-1"]);
    const res = await post({ ...BASE_BODY, applicationId: "app-1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("days");
    expect(json).not.toHaveProperty("perUser");
  });

  it("scopes the ownership check to this contact (one partner can't probe another's application)", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue(null);
    await post({ ...BASE_BODY, applicationId: "someone-elses-app" });
    expect(mockPrisma.partnerApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "someone-elses-app", applicantContactId: "contact-1" },
      }),
    );
  });
});
