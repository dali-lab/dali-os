// MCP `list_groups` — every lab group (Static and Dynamic) with its resolved
// membership. Groups are not member-scoped: any authenticated member can list
// them and see rosters, matching the web scheduler (which lets anyone schedule
// a meeting with any team). Requires the `mcp:read` scope.

import { listAllGroups } from "~/lib/groups";
import { pageArray, pageProps, type PageArgs } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_GROUPS_TOOL = {
  name: "list_groups",
  description:
    "List all lab groups (Static and Dynamic). Returns each group's id, name, type, and memberCount, plus memberIds when includeMemberIds is true. Pass page.nextCursor as cursor to read the next page until page.hasMore is false. Pair with the free-busy / schedule tools to schedule a meeting with a group's members.",
  inputSchema: {
    type: "object" as const,
    properties: {
      includeArchived: {
        type: "boolean",
        description:
          "If true, also return groups whose bound terms have ended or that were manually archived (default false).",
      },
      includeMemberIds: {
        type: "boolean",
        description:
          "If true, each group also carries memberIds (default false). Use a small limit with it, since rosters can be long.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { includeArchived?: boolean; includeMemberIds?: boolean };

export async function runListGroups(_callerId: string, input: Input) {
  const includeArchived = input.includeArchived ?? false;
  const all = await listAllGroups();
  const { rows, page } = pageArray(
    all.filter((g) => includeArchived || !g.archived),
    input,
    PAGE_LIMITS,
  );
  const groups = rows.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      systemKey: g.systemKey,
      ...(input.includeMemberIds ? { memberIds: g.memberIds } : {}),
      memberCount: g.memberIds.length,
      archived: g.archived,
    }));
  return { page, groups };
}
