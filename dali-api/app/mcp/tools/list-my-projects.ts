// MCP `list_my_projects` — every Project the authenticated member is staffed
// on (any term, like `isProjectMember`), enriched with current-term context:
// their role on the project this term, the current sprint, open task count.
// Requires the `mcp:read` scope.

export { listMyProjects as runListMyProjects } from "~/projects/lib/my-projects.server";

export const LIST_MY_PROJECTS_TOOL = {
  name: "list_my_projects",
  description:
    "List projects the authenticated DALI OS member is staffed on. Past-term assignments stay visible (matches in-app access). Each row includes the current-term role/domain (if assigned this term), the current sprint, and open task count.",
  inputSchema: {
    type: "object" as const,
    properties: {
      currentTermOnly: {
        type: "boolean",
        description:
          "If true, only return projects the member is staffed on for the current term (default false — past assignments included, matching project workspace access).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};
