// MCP `list_groups` — every lab group (Static and Dynamic) with its resolved
// membership. Groups are not member-scoped: any authenticated member can list
// them and see rosters, matching the web scheduler (which lets anyone schedule
// a meeting with any team). Requires the `mcp:read` scope.

import { listAllGroups } from "~/lib/groups";

export const LIST_GROUPS_TOOL = {
  name: "list_groups",
  description:
    "List all lab groups (Static and Dynamic). Returns each group's id, name, type, memberIds, and memberCount. Pair with the free-busy / schedule tools to schedule a meeting with a group's members.",
  inputSchema: {
    type: "object" as const,
    properties: {
      includeArchived: {
        type: "boolean",
        description:
          "If true, also return groups whose bound terms have ended or that were manually archived (default false).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { includeArchived?: boolean };

export async function runListGroups(_callerId: string, input: Input) {
  const includeArchived = input.includeArchived ?? false;
  const all = await listAllGroups();
  const groups = all
    .filter((g) => includeArchived || !g.archived)
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      systemKey: g.systemKey,
      memberIds: g.memberIds,
      memberCount: g.memberIds.length,
      archived: g.archived,
    }));
  return { groups };
}
