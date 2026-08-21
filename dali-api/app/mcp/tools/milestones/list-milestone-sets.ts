// MCP `list_milestone_sets` — read milestone sets (summaries), or one set's
// full version history + entries when `setId` is given. Core-only.

import type { McpTool, McpCtx } from "../../registry";
import { McpForbiddenError, McpNotFoundError } from "../../errors";
import { isCore } from "~/lib/roles";
import { coerceEntries } from "~/lib/milestones";
import { getMilestoneSet, listMilestoneSets } from "~/lib/milestones.server";

const DEF = {
  name: "list_milestone_sets",
  description:
    "List milestone sets (versioned, per-project-assignable week-by-week timelines). " +
    "With `setId`, returns that set's full version history and each version's entries. " +
    "Core-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      setId: {
        type: "string",
        description: "Return this set's full versions + entries instead of the summary list.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

async function run(ctx: McpCtx, args: Record<string, unknown>) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core members can read milestone sets");
  }

  const setId = typeof args.setId === "string" ? args.setId : null;
  if (setId) {
    const set = await getMilestoneSet(setId);
    if (!set) throw new McpNotFoundError("Milestone set not found");
    return {
      set: {
        id: set.id,
        name: set.name,
        description: set.description,
        isLabWide: set.isLabWide,
        versions: set.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          createdAt: v.createdAt.toISOString(),
          entries: coerceEntries(v.entries),
        })),
      },
    };
  }

  const sets = await listMilestoneSets();
  return {
    sets: sets.map((s) => {
      const latest = s.versions[0];
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        isLabWide: s.isLabWide,
        versionCount: s._count.versions,
        latestVersionNumber: latest?.versionNumber ?? null,
        milestoneCount: latest ? coerceEntries(latest.entries).length : 0,
      };
    }),
  };
}

export const LIST_MILESTONE_SETS_TOOL: McpTool = { def: DEF, run };
