import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { partnerApplication: { findFirst: vi.fn() } },
}));
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));
vi.mock("~/partners/lib/partner-access", () => ({ partnerHasProjectAccess: vi.fn() }));
vi.mock("~/partners/lib/partner-meetings.server", () => ({
  createMeetingRequest: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { createMeetingRequest } from "~/partners/lib/partner-meetings.server";
import { action } from "~/partners/routes/api.partner.meeting-requests";

const mockPrisma = prisma as unknown as { partnerApplication: { findFirst: ReturnType<typeof vi.fn> } };

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

function post(body: unknown) {
  const request = new Request("http://localhost/api/partner/meeting-requests", {
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

describe("POST /api/partner/meeting-requests", () => {
  it("rejects an invalid duration", async () => {
    const res = await post({ applicationId: "app-1", startTime: FUTURE, durationMinutes: 40 });
    expect(res.status).toBe(400);
  });

  it("rejects a startTime in the past", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue({ id: "app-1" });
    const res = await post({
      applicationId: "app-1",
      startTime: "2020-01-01T00:00:00.000Z",
      durationMinutes: 30,
    });
    expect(res.status).toBe(400);
  });

  it("404s when the contact doesn't own the application", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue(null);
    const res = await post({ applicationId: "app-1", startTime: FUTURE, durationMinutes: 30 });
    expect(res.status).toBe(404);
    expect(createMeetingRequest).not.toHaveBeenCalled();
  });

  it("404s when the contact has no access to the project", async () => {
    vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
    const res = await post({ projectId: "proj-1", startTime: FUTURE, durationMinutes: 30 });
    expect(res.status).toBe(404);
  });

  it("creates the request scoped to the signed-in contact", async () => {
    mockPrisma.partnerApplication.findFirst.mockResolvedValue({ id: "app-1" });
    vi.mocked(createMeetingRequest).mockResolvedValue({ id: "req-1" });
    const res = await post({
      applicationId: "app-1",
      startTime: FUTURE,
      durationMinutes: 45,
      note: "Afternoons only",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: "req-1" });
    expect(createMeetingRequest).toHaveBeenCalledWith({
      contactId: "contact-1",
      applicationId: "app-1",
      projectId: null,
      startTime: new Date(FUTURE),
      durationMinutes: 45,
      note: "Afternoons only",
    });
  });
});
