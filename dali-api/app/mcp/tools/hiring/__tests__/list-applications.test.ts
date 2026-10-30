import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, getUserRoles: vi.fn(), hasCycleAccess: vi.fn() };
});

import { prisma } from "~/lib/db.server";
import { getUserRoles, hasCycleAccess } from "~/lib/roles";
import { LIST_APPLICATIONS_TOOL, runListApplications } from "../list-applications";

const mockPrisma = prisma as unknown as {
  domainApplication: { findMany: ReturnType<typeof vi.fn> };
  applicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  cycleReviewer: { findMany: ReturnType<typeof vi.fn> };
  application: { findMany: ReturnType<typeof vi.fn> };
  decision: { findMany: ReturnType<typeof vi.fn> };
};

const coreRoles = {
  isCore: true,
  isDomainLead: false,
  isLabMember: true,
  isAdmin: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: true,
  canViewStaffing: true,
};

const reviewerRoles = {
  ...coreRoles,
  isCore: false,
  canViewForms: false,
  canViewStaffing: false,
};

const fakeApp = {
  id: "da1",
  domainId: "dom1",
  domain: { displayName: "Design", name: "design" },
  challengeVersion: null,
  application: {
    id: "app1",
    user: { firstName: "Alice", lastName: "Smith" },
    statusUpdates: [
      { newStatus: "Submitted", createdAt: new Date("2026-09-15") },
    ],
  },
  _count: { reviews: 2 },
};

function makeApp(opts: { daId: string; appId: string; first: string; last: string; domainId?: string; domain?: string }) {
  return {
    id: opts.daId,
    domainId: opts.domainId ?? "dom1",
    domain: { displayName: opts.domain ?? "Design", name: "design" },
    application: {
      id: opts.appId,
      user: { firstName: opts.first, lastName: opts.last },
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-09-15") }],
    },
    _count: { reviews: 0 },
  };
}

type Row = { applicationId: string; applicantName: string | null; domain: string | null };

// `listed` is what the main list query returns; `selected` is every selected
// DomainApplication per application (the blind lookup), which can include
// domains the caller can't see.
function setupBlindCycle(opts: {
  listed: ReturnType<typeof makeApp>[];
  selected: { id: string; applicationId: string }[];
  released?: string[];
  creationOrder: string[];
  anonymizeReview?: boolean;
}) {
  mockPrisma.applicationCycle.findUnique.mockResolvedValue({
    id: "cy1",
    anonymizeReview: opts.anonymizeReview ?? true,
  });
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
  mockPrisma.domainApplication.findMany.mockImplementation(async (args: any) =>
    args.where.applicationId ? opts.selected : opts.listed,
  );
  mockPrisma.decision.findMany.mockResolvedValue(
    (opts.released ?? []).map((id) => ({ domainApplicationId: id })),
  );
  mockPrisma.application.findMany.mockResolvedValue(opts.creationOrder.map((id) => ({ id })));
}

async function list(input: Parameters<typeof runListApplications>[1] = { cycleId: "cy1" }) {
  return ((await runListApplications("u1", input)) as { applications: Row[] }).applications;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.domainApplication.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.decision.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.application.findMany.mockReset().mockResolvedValue([]);
});

describe("list_applications", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_APPLICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws 404 when cycle not found", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);
    await expect(
      runListApplications("u1", { cycleId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws forbidden when caller has no cycle access", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    await expect(
      runListApplications("u1", { cycleId: "cy1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns all apps for a Core user", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp]);

    const { applications } = await runListApplications("u1", { cycleId: "cy1" }) as { applications: any[] };
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({
      domainApplicationId: "da1",
      applicantName: "Alice Smith",
      domain: "Design",
      status: "Submitted",
      reviewCount: 2,
    });
  });

  it("scopes to reviewer domains for non-Core caller", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(reviewerRoles);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "dom1" }]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp]);

    const { applications } = await runListApplications("u2", { cycleId: "cy1" }) as { applications: any[] };
    expect(applications).toHaveLength(1);
    // Confirm domain filter was applied via OR clause.
    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it("returns empty when reviewer has no assigned domains in cycle", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(reviewerRoles);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);

    const result = await runListApplications("u2", { cycleId: "cy1" });
    expect(result).toEqual({ applications: [] });
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns empty without querying when a reviewer asks for a domain outside their scope", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(reviewerRoles);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "dom1" }]);

    const result = await runListApplications("u2", { cycleId: "cy1", domainId: "dom2" });
    expect(result).toEqual({ applications: [] });
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("lets a domain lead see every domain without reviewer scoping", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue({ ...reviewerRoles, isDomainLead: true });
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp]);

    await runListApplications("u3", { cycleId: "cy1" });
    expect(mockPrisma.cycleReviewer.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplication.findMany.mock.calls[0][0].where).not.toHaveProperty("OR");
  });

  it("filters by status when provided", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
    const draftApp = {
      ...fakeApp,
      id: "da2",
      application: {
        ...fakeApp.application,
        statusUpdates: [{ newStatus: "Draft", createdAt: new Date("2026-09-10") }],
      },
    };
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp, draftApp]);

    const { applications } = await runListApplications("u1", { cycleId: "cy1", status: "Submitted" }) as { applications: any[] };
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe("Submitted");
  });
});

describe("list_applications blind review", () => {
  it("replaces names with Applicant N labels in creation order while review is blind", async () => {
    setupBlindCycle({
      listed: [
        makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Lovelace" }),
        makeApp({ daId: "da2", appId: "app2", first: "Grace", last: "Hopper" }),
      ],
      selected: [
        { id: "da1", applicationId: "app1" },
        { id: "da2", applicationId: "app2" },
      ],
      creationOrder: ["app2", "app1"],
    });

    const rows = await list();
    expect(rows.map((r) => [r.applicationId, r.applicantName])).toEqual([
      ["app2", "Applicant 1"],
      ["app1", "Applicant 2"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Lovelace|Hopper|Ada|Grace/);
  });

  it("keeps an applicant blinded until every selected domain is released, even ones the caller can't see", async () => {
    setupBlindCycle({
      listed: [makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Lovelace" })],
      selected: [
        { id: "da1", applicationId: "app1" },
        { id: "da1-other", applicationId: "app1" },
      ],
      released: ["da1"],
      creationOrder: ["app1"],
    });

    expect((await list())[0].applicantName).toBe("Applicant 1");
  });

  it("shows the real name once every selected domain is released", async () => {
    setupBlindCycle({
      listed: [makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Lovelace" })],
      selected: [
        { id: "da1", applicationId: "app1" },
        { id: "da1-other", applicationId: "app1" },
      ],
      released: ["da1", "da1-other"],
      creationOrder: ["app1"],
    });

    expect((await list())[0].applicantName).toBe("Ada Lovelace");
  });

  it("checks blinding against all selected domains, not just the filtered one", async () => {
    setupBlindCycle({
      listed: [makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Lovelace" })],
      selected: [{ id: "da1", applicationId: "app1" }],
      creationOrder: ["app1"],
    });

    await list({ cycleId: "cy1", domainId: "dom1" });
    const blindLookup = mockPrisma.domainApplication.findMany.mock.calls.find(
      ([args]) => args.where.applicationId,
    );
    expect(blindLookup?.[0].where).toEqual({ applicationId: { in: ["app1"] }, selected: true });
  });

  it("orders blinded rows by label so row order doesn't reveal surnames", async () => {
    setupBlindCycle({
      listed: [
        makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Adams" }),
        makeApp({ daId: "da2", appId: "app2", first: "Zed", last: "Zimmer" }),
      ],
      selected: [
        { id: "da1", applicationId: "app1" },
        { id: "da2", applicationId: "app2" },
      ],
      creationOrder: ["app2", "app1"],
    });

    expect((await list()).map((r) => r.applicationId)).toEqual(["app2", "app1"]);
  });

  it("orders labels numerically so Applicant 10 follows Applicant 9", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `app${i + 1}`);
    setupBlindCycle({
      listed: ids.map((id, i) => makeApp({ daId: `da${i + 1}`, appId: id, first: "X", last: "Y" })),
      selected: ids.map((id, i) => ({ id: `da${i + 1}`, applicationId: id })),
      creationOrder: ids,
    });

    const names = (await list()).map((r) => r.applicantName);
    expect(names.slice(-2)).toEqual(["Applicant 9", "Applicant 10"]);
  });

  it("orders one applicant's rows by domain", async () => {
    setupBlindCycle({
      listed: [
        makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "L", domainId: "dom2", domain: "Engineering" }),
        makeApp({ daId: "da2", appId: "app1", first: "Ada", last: "L", domainId: "dom1", domain: "Design" }),
      ],
      selected: [
        { id: "da1", applicationId: "app1" },
        { id: "da2", applicationId: "app1" },
      ],
      creationOrder: ["app1"],
    });

    expect((await list()).map((r) => r.domain)).toEqual(["Design", "Engineering"]);
  });

  it("shows real names, sorted by name, and skips the blind lookup when the cycle isn't blind", async () => {
    setupBlindCycle({
      anonymizeReview: false,
      listed: [
        makeApp({ daId: "da2", appId: "app2", first: "Grace", last: "Hopper" }),
        makeApp({ daId: "da1", appId: "app1", first: "Ada", last: "Lovelace" }),
      ],
      selected: [],
      creationOrder: [],
    });

    expect((await list()).map((r) => r.applicantName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });
});
