// MCP `list_infrastructure` — read-only Fly.io + Neon fleet view.
// Reuses loadFleet() from ~/lib/infra/dashboard.server.ts. mcp:admin, Core leads only.
// Also checks the infra-dashboard feature flag.

import { getUserRoles } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadFleet } from "~/lib/infra/dashboard.server";
import type { McpCtx } from "../../registry";

export const LIST_INFRASTRUCTURE_TOOL = {
  name: "list_infrastructure",
  description:
    "Read-only view of the Fly.io + Neon fleet for all projects. " +
    "Returns per-project app/machine counts and Neon project/endpoint states. " +
    "Requires the infra-dashboard feature flag and Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListInfrastructure(ctx: McpCtx) {
  const roles = await getUserRoles(ctx.user.id, ctx.request);
  if (!roles.isCore) {
    throw new McpForbiddenError("Only Core leads can view infrastructure.");
  }
  const flagEnabled = await isFeatureEnabled(
    "infra-dashboard",
    ctx.user.id,
    roles,
    ctx.request,
  );
  if (!flagEnabled) {
    throw new McpForbiddenError("Infrastructure dashboard feature flag is not enabled.");
  }

  const { projects, lastSweep, protectedFly, protectedNeon } = await loadFleet();

  return {
    lastSweep,
    protectedFly,
    protectedNeon,
    projects: projects.map((p) => ({
      projectId: p.projectId,
      name: p.name,
      infraEnabled: p.infraEnabled,
      flyOrgSlug: p.flyOrgSlug ?? null,
      neonOrgId: p.neonOrgId ?? null,
      flyApps: (p.fly?.apps ?? []).map((app) => ({
        name: app.name,
        status: app.status ?? null,
        machineCount: app.machines.length,
        runningCount: app.machines.filter((m) => m.state === "started").length,
        machines: app.machines.map((m) => ({
          id: m.id,
          name: m.name,
          cpuKind: m.cpuKind,
          cpus: m.cpus,
          memoryMb: m.memoryMb,
          region: m.region,
          state: m.state,
        })),
      })),
      neonProjects: (p.neon?.projects ?? []).map((np) => ({
        id: np.id,
        name: np.name,
        regionId: np.regionId,
        pgVersion: np.pgVersion ?? null,
        branchCount: np.branches.length,
        endpointCount: np.endpoints.length,
        activeEndpoints: np.endpoints.filter((e) => e.currentState === "active").length,
        endpoints: np.endpoints.map((e) => ({
          id: e.id,
          type: e.type,
          currentState: e.currentState,
          autoscalingMinCu: e.autoscalingMinCu ?? null,
          autoscalingMaxCu: e.autoscalingMaxCu ?? null,
          suspendTimeoutSeconds: e.suspendTimeoutSeconds ?? null,
        })),
      })),
    })),
  };
}
