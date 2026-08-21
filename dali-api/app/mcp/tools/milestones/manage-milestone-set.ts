// MCP `manage_milestone_set` — faceted router over create / update /
// save_version / assign. Core-only. Business logic lives in milestones.server.

import type { McpTool, McpCtx } from "../../registry";
import { McpInvalidError, McpForbiddenError, requireForAction } from "../../errors";
import { isCore } from "~/lib/roles";
import { coerceEntries } from "~/lib/milestones";
import {
  createMilestoneSet,
  updateMilestoneSet,
  saveMilestoneVersion,
  assignMilestoneSet,
  unassignMilestoneSet,
} from "~/lib/milestones.server";

const DEF = {
  name: "manage_milestone_set",
  description: `Manage milestone sets (versioned, per-project-assignable week-by-week timelines). Core-only. Pass \`action\`:
- \`create\`: create a set. Requires: name. Optional: description.
- \`update\`: rename / redescribe / archive a set. Requires: setId. Optional: name, description, archived.
- \`save_version\`: freeze the given entries into a new immutable version. Requires: setId, entries.
- \`assign\`: pin a set's latest version to a project for a term (locks it). Requires: projectId, termId. Omit setId to remove the pin.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "save_version", "assign"],
        description: "Operation to perform.",
      },
      setId: { type: "string", description: "Target set (update / save_version / assign)." },
      name: { type: "string", description: "Set name (create / update)." },
      description: { type: "string", description: "Set description (create / update)." },
      archived: { type: "boolean", description: "Archive (true) or restore (false) a set (update)." },
      entries: {
        type: "array",
        description: "Milestones for save_version, one per goal.",
        items: {
          type: "object",
          properties: {
            weekIndex: { type: "number", description: "0-based week the milestone falls on." },
            name: { type: "string" },
            detail: { type: "string" },
            labWide: {
              type: "boolean",
              description: "A lab-wide event (shown on every project timeline).",
            },
          },
          required: ["weekIndex", "name"],
          additionalProperties: false,
        },
      },
      projectId: { type: "string", description: "Project to (un)assign (assign)." },
      termId: { type: "string", description: "Term the assignment applies to (assign)." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["name"],
  update: ["setId"],
  save_version: ["setId", "entries"],
  assign: ["projectId", "termId"],
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can manage milestone sets");
  }

  const action = args.action as string;
  requireForAction(action, args, ACTION_REQUIRED);

  switch (action) {
    case "create": {
      const set = await createMilestoneSet({
        name: args.name as string,
        description: (args.description as string) ?? null,
        createdById: ctx.user.id,
      });
      return { id: set.id, name: set.name };
    }
    case "update": {
      await updateMilestoneSet(args.setId as string, {
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        archived: args.archived as boolean | undefined,
      });
      return { ok: true };
    }
    case "save_version": {
      const version = await saveMilestoneVersion(
        args.setId as string,
        coerceEntries(args.entries),
        ctx.user.id,
      );
      return version;
    }
    case "assign": {
      const projectId = args.projectId as string;
      const termId = args.termId as string;
      const setId = typeof args.setId === "string" && args.setId ? args.setId : null;
      if (setId) {
        await assignMilestoneSet({ projectId, termId, setId, assignedById: ctx.user.id });
        return { ok: true, assigned: true };
      }
      await unassignMilestoneSet({ projectId, termId });
      return { ok: true, assigned: false };
    }
    default:
      throw new McpInvalidError(`Unknown action '${action}'`);
  }
}

export const MANAGE_MILESTONE_SET_TOOL: McpTool = { def: DEF, run };
