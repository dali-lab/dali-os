import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/cycles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { autoCloseIfExpired, findOtherActiveCycleId } from "~/lib/cycles";
import { action } from "~/routes/api.cycles.$cycleId.status";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  applicationCycleStatusUpdate: { create: ReturnType<typeof vi.fn> };
  challengeVersion: { findMany: ReturnType<typeof vi.fn> };
  interview: { count: ReturnType<typeof vi.fn> };
  domainApplication: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).applicationCycle = { findUniqueOrThrow: vi.fn() };
  (mockPrisma as any).applicationCycleStatusUpdate = {
    create: vi.fn().mockResolvedValue({ id: "update-1" }),
  };
  (mockPrisma as any).challengeVersion = { findMany: vi.fn() };
  (mockPrisma as any).interview = { count: vi.fn() };
  (mockPrisma as any).domainApplication = { count: vi.fn() };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
  vi.mocked(autoCloseIfExpired).mockResolvedValue(undefined as any);
  vi.mocked(findOtherActiveCycleId).mockResolvedValue(null);
});

function makeOpenRequest() {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newStatus: "Open" }),
  });
}

function setupCycle({
  domains,
  challengeVersionDomainIds,
  closeDate = new Date("2099-01-01"),
}: {
  domains: Array<{ domainId: string; isReady: boolean }>;
  challengeVersionDomainIds: (string | null)[];
  closeDate?: Date | null;
}) {
  mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
    id: CYCLE_ID,
    closeDate,
    statusUpdates: [{ newStatus: "Draft" }],
    domains,
    challengeVersions: challengeVersionDomainIds.map((domainId, i) => ({
      challengeVersionId: `cv-${i}`,
      challengeVersion: { domainId },
    })),
  });
  mockPrisma.challengeVersion.findMany.mockResolvedValue(
    challengeVersionDomainIds
      .filter((d): d is string => d !== null)
      .map((domainId) => ({ domainId })),
  );
}

describe("POST /api/cycles/:cycleId/status — Draft → Open all-domains-ready guard", () => {
  it("opens successfully when every domain is marked ready", async () => {
    setupCycle({
      domains: [
        { domainId: "d-1", isReady: true },
        { domainId: "d-2", isReady: true },
      ],
      challengeVersionDomainIds: ["d-1", "d-2", null],
    });

    const res = await action({
      request: makeOpenRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.currentStatus).toBe("Open");
    expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalledTimes(1);
  });

  it("returns 400 and does not transition when at least one domain is not ready", async () => {
    setupCycle({
      domains: [
        { domainId: "d-1", isReady: true },
        { domainId: "d-2", isReady: false },
      ],
      challengeVersionDomainIds: ["d-1", "d-2", null],
    });

    const res = await action({
      request: makeOpenRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/marked ready/i);
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("returns 400 when a cycle has no domains", async () => {
    setupCycle({
      domains: [],
      challengeVersionDomainIds: [null],
    });

    const res = await action({
      request: makeOpenRequest(),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });
});
