// MCP `manage_job` — enable/disable/configure/run background jobs.
// Mirrors the Admin → Jobs panel and api.jobs.$name.ts route.
// Requires the `mcp:admin` scope; caller must be isCore.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { jobByName } from "~/jobs/registry";
import type { JobDefinition } from "~/jobs/registry";
import { runJob } from "~/jobs/runner.server";
import { logAuditEvent } from "~/lib/audit";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminNotFoundError as McpNotFoundError,
  AdminInvalidError as McpInvalidError,
  requireForAction,
} from "./errors";
import type { McpCtx } from "../../registry";

export const MANAGE_JOB_TOOL = {
  name: "manage_job",
  description:
    "Enable/disable/configure or immediately trigger a background job. " +
    "Actions: set_config · run. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["set_config", "run"],
        description: "set_config — patch enabled/interval/settings; run — trigger immediately.",
      },
      name: {
        type: "string",
        description: "Job name (stable registry key).",
      },
      enabled: {
        type: "boolean",
        description: "set_config: enable or disable the job.",
      },
      intervalMinutes: {
        type: "number",
        description: "set_config: cadence override (1–10080 minutes).",
      },
      settings: {
        type: "object",
        description: "set_config: numeric setting overrides keyed by setting key.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action: string;
  name?: string;
  enabled?: boolean;
  intervalMinutes?: number;
  settings?: Record<string, unknown>;
};

function validateSettings(def: JobDefinition, settings: Record<string, unknown>): string | null {
  const defs = new Map((def.settings ?? []).map((s) => [s.key, s]));
  for (const [key, value] of Object.entries(settings)) {
    const sd = defs.get(key);
    if (!sd) return `Unknown setting "${key}"`;
    if (!Number.isFinite(value) || (value as number) < sd.min || (value as number) > sd.max) {
      return `"${sd.label}" must be between ${sd.min} and ${sd.max}`;
    }
  }
  return null;
}

export async function runManageJob(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can manage jobs.");
  }

  requireForAction(args.action, args as Record<string, unknown>, {
    set_config: ["name"],
    run: ["name"],
  });

  // args.name is guaranteed present after requireForAction
  const name = args.name as string;

  if (args.action === "set_config") {
    const { enabled, intervalMinutes, settings } = args;

    const def = jobByName(name);
    if (!def) throw new McpNotFoundError(`Unknown job: ${name}`);

    if (enabled === undefined && intervalMinutes === undefined && settings === undefined) {
      throw new McpInvalidError("Nothing to update");
    }

    if (intervalMinutes !== undefined && (intervalMinutes < 1 || intervalMinutes > 10080)) {
      throw new McpInvalidError("intervalMinutes must be between 1 and 10080");
    }

    if (settings !== undefined) {
      const err = validateSettings(def, settings);
      if (err) throw new McpInvalidError(err);
    }

    const updateData = {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(intervalMinutes !== undefined ? { intervalMinutes } : {}),
      ...(settings !== undefined ? { settings: settings as Record<string, number> } : {}),
    };
    await prisma.scheduledJob.update({ where: { name }, data: updateData });

    const auditMeta: Record<string, unknown> = {};
    if (enabled !== undefined) auditMeta.enabled = enabled;
    if (intervalMinutes !== undefined) auditMeta.intervalMinutes = intervalMinutes;
    if (settings !== undefined) auditMeta.settings = settings;
    await logAuditEvent({
      action: "jobs.toggle",
      userId: ctx.user.id,
      targetId: name,
      metadata: auditMeta as import("~/generated/prisma/client").Prisma.InputJsonValue,
      request: ctx.request,
    });

    return { ok: true };
  }

  // action === "run"
  const def = jobByName(name);
  if (!def) throw new McpNotFoundError(`Unknown job: ${name}`);

  const result = await runJob(name, { force: true });

  await logAuditEvent({
    action: "jobs.run",
    userId: ctx.user.id,
    targetId: name,
    metadata: { ran: result.ran, error: result.error ?? null },
    request: ctx.request,
  });

  if (!result.ran) {
    throw new McpInvalidError(result.error ?? "Job did not run (in-flight lease held)");
  }

  return { ok: true, error: result.error ?? null };
}

