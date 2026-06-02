// MCP `list_groups` — lab groups visible to the authenticated member.
// Static groups they're a member of and Dynamic groups whose resolved
// membership includes them. Use a returned `id` (member.id) elsewhere, or use
// `memberIds` to bulk-resolve a group. Requires the `mcp:read` scope.

import { listVisibleGroupsForUser } from "~/lib/groups";

export const LIST_GROUPS_TOOL = {
  name: "list_groups",
  description:
    "List lab groups the authenticated DALI OS member belongs to. Returns each group's id, name, type (Static/Dynamic), and member userIds. Useful for resolving a group into a participant list before calling `schedule_meeting`.",
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

export async function runListGroups(callerId: string, input: Input) {
  const includeArchived = input.includeArchived ?? false;
  const visible = await listVisibleGroupsForUser(callerId);
  const groups = visible
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
