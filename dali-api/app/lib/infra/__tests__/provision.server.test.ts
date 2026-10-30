import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, audit, refresh, flyMock, neonMock, infraMock } = vi.hoisted(() => ({
  prismaMock: { project: { update: vi.fn() } },
  audit: vi.fn(),
  refresh: vi.fn(),
  flyMock: { createApp: vi.fn() },
  neonMock: { createProject: vi.fn(), pollOperations: vi.fn(), neonConfigured: vi.fn() },
  infraMock: { listInfraProjects: vi.fn(), getProjectInfraCreds: vi.fn(), inheritFlyTokens: vi.fn() },
}));

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: audit }));
vi.mock("~/jobs/infra-snapshot.server", () => ({ refreshProjectInfra: refresh }));
vi.mock("../fly.server", () => flyMock);
vi.mock("../neon.server", () => neonMock);
vi.mock("../project-infra.server", () => infraMock);

import {
  FLY_APP_NAME,
  listProvisionTargets,
  provisionProjectInfra,
  provisionRequestFromForm,
} from "../provision.server";

const request = new Request("http://localhost/projects");
const info = (over: Record<string, unknown>) => ({
  projectId: "p0",
  name: "DALI OS",
  flyOrgSlug: null,
  flyAppNames: [],
  neonOrgId: null,
  neonProjectIds: [],
  infraEnabled: true,
  hasFlyReadToken: false,
  hasFlyWriteToken: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  neonMock.neonConfigured.mockReturnValue(true);
  neonMock.createProject.mockResolvedValue({ projectId: "np-new", operations: [] });
  neonMock.pollOperations.mockResolvedValue(undefined);
  infraMock.listInfraProjects.mockResolvedValue([
    info({ projectId: "p0", flyOrgSlug: "dali-os", hasFlyWriteToken: true, neonOrgId: "org-dali-1" }),
  ]);
  infraMock.getProjectInfraCreds.mockResolvedValue({ flyWriteToken: "write-tok" });
  infraMock.inheritFlyTokens.mockImplementation(async (_id: string, d: object) => ({ ...d, flyReadTokenEnc: "enc" }));
});

describe("listProvisionTargets", () => {
  it("offers orgs already in use, Fly only where a write token exists", async () => {
    infraMock.listInfraProjects.mockResolvedValue([
      info({ flyOrgSlug: "dali-os", hasFlyWriteToken: true, neonOrgId: "org-dali-1" }),
      info({ flyOrgSlug: "read-only-org", hasFlyWriteToken: false, neonOrgId: "org-dali-1" }),
    ]);
    expect(await listProvisionTargets()).toEqual({ neonOrgs: ["org-dali-1"], flyOrgs: ["dali-os"] });
  });

  it("offers no Neon org without the Neon key", async () => {
    neonMock.neonConfigured.mockReturnValue(false);
    expect((await listProvisionTargets()).neonOrgs).toEqual([]);
  });
});

describe("provisionRequestFromForm", () => {
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };

  it("asks for nothing when neither box is checked", () => {
    expect(provisionRequestFromForm(form([["neonOrgId", "org"], ["flyOrgSlug", "dali-os"]]), "Ultrasound", "ultrasound")).toEqual({});
  });

  it("defaults names from the project", () => {
    expect(
      provisionRequestFromForm(
        form([["createNeon", "on"], ["neonOrgId", "org-dali-1"], ["createFly", "on"], ["flyOrgSlug", "dali-os"]]),
        "Ultrasound Education",
        "ultrasound-education",
      ),
    ).toEqual({
      neon: { orgId: "org-dali-1", name: "Ultrasound Education" },
      fly: { orgSlug: "dali-os", appName: "ultrasound-education" },
    });
  });

  it("uses typed names", () => {
    const want = provisionRequestFromForm(
      form([["createNeon", "on"], ["neonOrgId", "o"], ["neonName", "pocus-db"], ["createFly", "on"], ["flyOrgSlug", "f"], ["flyAppName", "pocus"]]),
      "X",
      "x",
    );
    expect(want).toEqual({ neon: { orgId: "o", name: "pocus-db" }, fly: { orgSlug: "f", appName: "pocus" } });
  });

  it("skips a checked box with no org", () => {
    expect(provisionRequestFromForm(form([["createNeon", "on"]]), "X", "x")).toEqual({});
  });
});

describe("provisionProjectInfra", () => {
  it("creates and links a Neon database", async () => {
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { neon: { orgId: "org-dali-1", name: "Ultrasound" } },
    });
    expect(out).toEqual({ errors: [] });
    expect(neonMock.createProject).toHaveBeenCalledWith("org-dali-1", "Ultrasound");
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { neonOrgId: "org-dali-1", neonProjectIds: { push: "np-new" } },
    });
    expect(audit.mock.calls[0][0]).toMatchObject({ action: "infra.neon.project.create", targetId: "np-new", userId: "u1" });
    expect(refresh).toHaveBeenCalledWith("p1");
  });

  it("creates a Fly app with an org member's write token and links it", async () => {
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { fly: { orgSlug: "dali-os", appName: "ultrasound" } },
    });
    expect(out).toEqual({ errors: [] });
    expect(infraMock.getProjectInfraCreds).toHaveBeenCalledWith("p0");
    expect(flyMock.createApp).toHaveBeenCalledWith("write-tok", "dali-os", "ultrasound");
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { flyOrgSlug: "dali-os", flyReadTokenEnc: "enc", flyAppNames: { push: "ultrasound" } },
    });
    expect(audit.mock.calls[0][0]).toMatchObject({ action: "infra.fly.app.create", targetId: "ultrasound" });
  });

  it("rejects an invalid Fly app name without calling Fly", async () => {
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { fly: { orgSlug: "dali-os", appName: "Bad Name" } },
    });
    expect(out.errors[0]).toMatch(/^Fly app: app names use lowercase/);
    expect(flyMock.createApp).not.toHaveBeenCalled();
  });

  it("reports a Fly org with no write token", async () => {
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { fly: { orgSlug: "unknown-org", appName: "ultrasound" } },
    });
    expect(out.errors).toEqual(["Fly app: no project has a Fly write token for unknown-org"]);
  });

  it("keeps going when one step fails", async () => {
    neonMock.createProject.mockRejectedValue(new Error("Neon API 403"));
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { neon: { orgId: "org-dali-1", name: "U" }, fly: { orgSlug: "dali-os", appName: "ultrasound" } },
    });
    expect(out.errors).toEqual(["Neon database: Neon API 403"]);
    expect(flyMock.createApp).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith("p1");
  });

  it("reports a Fly name that's taken", async () => {
    flyMock.createApp.mockRejectedValue(new Error("Fly API 422 on /apps: name taken"));
    const out = await provisionProjectInfra({
      userId: "u1",
      projectId: "p1",
      request,
      want: { fly: { orgSlug: "dali-os", appName: "ultrasound" } },
    });
    expect(out.errors).toEqual(["Fly app: Fly API 422 on /apps: name taken"]);
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it("does nothing when nothing was asked for", async () => {
    expect(await provisionProjectInfra({ userId: "u1", projectId: "p1", request, want: {} })).toEqual({ errors: [] });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("FLY_APP_NAME", () => {
  it("accepts lowercase names with hyphens", () => {
    expect(FLY_APP_NAME.test("ultrasound-education")).toBe(true);
    expect(FLY_APP_NAME.test("a1b")).toBe(true);
  });

  it("rejects capitals, spaces, edge hyphens, and short names", () => {
    for (const bad of ["Ultrasound", "ultra sound", "-ultra", "ultra-", "ab"]) expect(FLY_APP_NAME.test(bad)).toBe(false);
  });
});
