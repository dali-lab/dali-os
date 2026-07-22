// MCP `list_groups` — lab groups visible to the authenticated member.
// Static groups they're a member of and Dynamic groups whose resolved
// membership includes them. Requires the `mcp:read` scope.
//
// The full `memberIds` roster is only returned to callers who can view rosters
// on the web (Core / Admin / Instructor — the same `canViewForms` gate that
// guards the web Groups page). Everyone else gets `memberCount` but not the
// userId list, so a rank-and-file member can't bulk-enumerate a group's
// membership through MCP when no equivalent web surface would show it.

import { listVisibleGroupsForUser } from "~/lib/groups";
import { canViewForms } from "~/lib/roles";

export const LIST_GROUPS_TOOL = {
  name: "list_groups",
  description:
    "List lab groups the authenticated DALI OS member belongs to. Returns each group's id, name, type (Static/Dynamic), and memberCount. The full member userId list (`memberIds`) is included only for Core/Admin/Instructor callers, matching the web Groups page.",
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
  const canSeeRosters = await canViewForms(callerId);
  const visible = await listVisibleGroupsForUser(callerId);
  const groups = visible
    .filter((g) => includeArchived || !g.archived)
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      systemKey: g.systemKey,
      // Roster userIds only for Core/Admin/Instructor; others see the count.
      memberIds: canSeeRosters ? g.memberIds : undefined,
      memberCount: g.memberIds.length,
      archived: g.archived,
    }));
  return { groups };
}
