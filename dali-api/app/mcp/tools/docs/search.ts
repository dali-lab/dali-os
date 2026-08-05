// MCP `search` — global command-palette search, permission-scoped.
// Wraps runSearch from ~/lib/search.server so the same role gates apply.

import { getUserRoles } from "~/lib/roles";
import { runSearch } from "~/lib/search.server";

export const SEARCH_TOOL = {
  name: "search",
  description:
    "Search across people, projects, tasks, documents, files, education offerings, and more. Results are permission-scoped to the caller's roles (hiring results require domain-lead/Core + signed confidentiality). Returns at most ~40 results per category, ranked by relevance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      q: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Search query. At least 2 characters for results.",
      },
    },
    required: ["q"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { q: string };

export class SearchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "SearchError";
  }
}

export async function runMcpSearch(callerId: string, input: Input) {
  const roles = await getUserRoles(callerId);
  const results = await runSearch({ userId: callerId, roles, q: input.q });
  return { results };
}
