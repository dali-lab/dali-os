import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { JOBS, resolveJobSettings } from "~/jobs/registry";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_JOBS_TOOL = {
  name: "list_jobs",
  description:
    "List all background jobs with their interval, settings, enabled state and last run. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListJobs(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view jobs.");
  }
  const rows = await prisma.scheduledJob.findMany();
  const rowByName = new Map(rows.map((r) => [r.name, r]));
  const jobs = JOBS.map((def) => {
    const row = rowByName.get(def.name);
    return {
      name: def.name,
      description: def.description,
      intervalMinutes: row?.intervalMinutes ?? def.intervalMinutes,
      settings: resolveJobSettings(def, row?.settings),
      enabled: row?.enabled ?? true,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastError: row?.lastError ?? null,
    };
  });
  return { jobs };
}
