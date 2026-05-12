import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { action, describeDomainUsage } from "~/admin-console/routes/api.domains.$domainId";

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  domain: {
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const ADMIN_ID = "admin-user-1";
const DOMAIN_ID = "domain-1";

const ZERO_COUNTS = {
  challengeVersions: 0,
  applicationCycles: 0,
  domainLeadAssignments: 0,
  cycleReviewers: 0,
  cycleInterviewers: 0,
  delibsSessions: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).domain = { findUnique: vi.fn(), delete: vi.fn() };
  // Run the transaction callback inline against the mocked client.
  (mockPrisma as any).$transaction = vi.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
});

function makeRequest(method = "DELETE") {
  return new Request(`http://localhost/api/domains/${DOMAIN_ID}`, { method });
}

describe("describeDomainUsage", () => {
  it("returns empty list when nothing references the domain", () => {
    expect(describeDomainUsage(ZERO_COUNTS)).toEqual([]);
  });

  it("describes only non-zero relations", () => {
    const out = describeDomainUsage({
      ...ZERO_COUNTS,
      applicationCycles: 2,
      cycleReviewers: 3,
    });
    expect(out).toEqual(["2 application cycles", "3 cycle reviewers"]);
  });
});

describe("DELETE /api/domains/:domainId", () => {
  it("returns 403 when caller is not an admin", async () => {
    vi.mocked(isAdmin).mockResolvedValueOnce(false);
    const res = await action({ request: makeRequest(), params: { domainId: DOMAIN_ID }, context: {} } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.domain.delete).not.toHaveBeenCalled();
  });

  it("returns 405 for non-DELETE methods", async () => {
    const res = await action({ request: makeRequest("POST"), params: { domainId: DOMAIN_ID }, context: {} } as any);
    expect(res.status).toBe(405);
  });

  it("returns 404 when the domain does not exist", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);
    const res = await action({ request: makeRequest(), params: { domainId: DOMAIN_ID }, context: {} } as any);
    expect(res.status).toBe(404);
    expect(mockPrisma.domain.delete).not.toHaveBeenCalled();
  });

  it("returns 409 with a helpful message when the domain is in use", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: DOMAIN_ID,
      name: "Engineering",
      _count: { ...ZERO_COUNTS, applicationCycles: 1, cycleReviewers: 2 },
    });
    const res = await action({ request: makeRequest(), params: { domainId: DOMAIN_ID }, context: {} } as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/application cycles/);
    expect(json.error).toMatch(/cycle reviewers/);
    expect(mockPrisma.domain.delete).not.toHaveBeenCalled();
  });

  it("deletes the domain when no references exist", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: DOMAIN_ID,
      name: "Engineering",
      _count: ZERO_COUNTS,
    });
    mockPrisma.domain.delete.mockResolvedValue({ id: DOMAIN_ID });

    const res = await action({ request: makeRequest(), params: { domainId: DOMAIN_ID }, context: {} } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.domain.delete).toHaveBeenCalledWith({ where: { id: DOMAIN_ID } });
  });
});
