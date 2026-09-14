import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/infra/dashboard.server", () => ({ loadFleet: vi.fn() }));

import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadFleet } from "~/lib/infra/dashboard.server";
import {
  runListInfrastructure,
  LIST_INFRASTRUCTURE_TOOL,
} from "~/mcp/tools/admin/list-infrastructure";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

const CORE_ROLES = {
  isCore: true,
  isAdmin: false,
  isLabMember: true,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: true,
  canViewStaffing: true,
};

const FLEET_RESULT = {
  lastSweep: "2026-09-10T00:00:00.000Z",
  protectedFly: ["dali-prod"],
  protectedNeon: ["proj-main"],
  projects: [
    {
      projectId: "proj-1",
      name: "DALI App",
      infraEnabled: true,
      flyOrgSlug: "dali-org",
      neonOrgId: "neon-org-1",
      hasFlyReadToken: true,
      hasFlyWriteToken: false,
      fly: {
        orgSlug: "dali-org",
        apps: [
          {
            id: "app-1",
            name: "dali-prod",
            status: "running",
            machineCount: 2,
            machines: [
              {
                id: "m-1",
                name: "m-1",
                appName: "dali-prod",
                state: "started",
                region: "iad",
                cpuKind: "shared",
                cpus: 2,
                memoryMb: 512,
                createdAt: null,
              },
              {
                id: "m-2",
                name: "m-2",
                appName: "dali-prod",
                state: "stopped",
                region: "iad",
                cpuKind: "shared",
                cpus: 2,
                memoryMb: 512,
                createdAt: null,
              },
            ],
            volumes: [],
          },
        ],
      },
      neon: {
        projects: [
          {
            id: "np-1",
            name: "dali-db",
            regionId: "aws-us-east-1",
            pgVersion: 16,
            branches: [{ id: "br-1", name: "main", default: true, createdAt: null }],
            endpoints: [
              {
                id: "ep-1",
                branchId: "br-1",
                type: "read_write",
                currentState: "active",
                autoscalingMinCu: 0.25,
                autoscalingMaxCu: 4,
                suspendTimeoutSeconds: 300,
                lastActive: null,
              },
            ],
          },
        ],
      },
      flyFetchedAt: null,
      neonFetchedAt: null,
      usage: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserRoles).mockResolvedValue(CORE_ROLES);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(loadFleet).mockResolvedValue(FLEET_RESULT as any);
});

describe("list_infrastructure", () => {
  it("requires mcp:admin scope", () => {
    expect(LIST_INFRASTRUCTURE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ ...CORE_ROLES, isCore: false });
    await expect(runListInfrastructure(makeCtx("u-nobody"))).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(loadFleet).not.toHaveBeenCalled();
  });

  it("throws McpForbiddenError when infra-dashboard flag is disabled", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await expect(runListInfrastructure(makeCtx())).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(loadFleet).not.toHaveBeenCalled();
  });

  it("returns fleet data on happy path", async () => {
    const out = await runListInfrastructure(makeCtx());
    expect(out.lastSweep).toBe("2026-09-10T00:00:00.000Z");
    expect(out.protectedFly).toEqual(["dali-prod"]);
    expect(out.protectedNeon).toEqual(["proj-main"]);
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]).toMatchObject({
      projectId: "proj-1",
      name: "DALI App",
      infraEnabled: true,
      flyOrgSlug: "dali-org",
      neonOrgId: "neon-org-1",
    });
  });

  it("maps fly apps with machine counts correctly", async () => {
    const out = await runListInfrastructure(makeCtx());
    const app = out.projects[0].flyApps[0];
    expect(app.name).toBe("dali-prod");
    expect(app.machineCount).toBe(2);
    expect(app.runningCount).toBe(1); // only one machine is "started"
    expect(app.machines).toHaveLength(2);
    expect(app.machines[0]).toMatchObject({
      id: "m-1",
      state: "started",
      cpuKind: "shared",
      memoryMb: 512,
    });
  });

  it("maps neon projects with endpoint details", async () => {
    const out = await runListInfrastructure(makeCtx());
    const np = out.projects[0].neonProjects[0];
    expect(np.id).toBe("np-1");
    expect(np.branchCount).toBe(1);
    expect(np.endpointCount).toBe(1);
    expect(np.activeEndpoints).toBe(1);
    expect(np.endpoints[0]).toMatchObject({
      id: "ep-1",
      type: "read_write",
      currentState: "active",
      autoscalingMinCu: 0.25,
      autoscalingMaxCu: 4,
    });
  });

  it("returns empty flyApps and neonProjects when fly/neon are null", async () => {
    vi.mocked(loadFleet).mockResolvedValue({
      ...FLEET_RESULT,
      projects: [{ ...FLEET_RESULT.projects[0], fly: null, neon: null }],
    });
    const out = await runListInfrastructure(makeCtx());
    expect(out.projects[0].flyApps).toEqual([]);
    expect(out.projects[0].neonProjects).toEqual([]);
  });
});
