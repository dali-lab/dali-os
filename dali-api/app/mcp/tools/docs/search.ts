// MCP `search` — global command-palette search, permission-scoped.
// Wraps runSearch from ~/lib/search.server so the same role gates apply.

import { getUserRoles } from "~/lib/roles";
import { runCategorySearch, runSearchWithOverflow } from "~/lib/search.server";
import { SEARCH_CATEGORIES, type SearchResult, type SearchResultType } from "~/lib/search";
import { McpInvalidError } from "../../errors";
import { offsetPage, offsetWindow, pageProps, type PageArgs, type PageInfo } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const SEARCH_TOOL = {
  name: "search",
  description:
    "Search across people, projects, tasks, documents, files, education offerings, and more. Results are permission-scoped to the caller's roles (hiring results require domain-lead/Core + signed confidentiality). Without category, returns the 5 best matches per category, ranked by relevance, and lists the categories that had more in categoriesWithMore. Pass category to page through one category: pass page.nextCursor as cursor until page.hasMore is false. Only the first 500 matches of a category are ranked, so very broad queries should be narrowed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      q: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Search query. At least 2 characters for results.",
      },
      category: {
        type: "string",
        enum: SEARCH_CATEGORIES,
        description: "Return only this category and page through it with limit and cursor.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["q"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { q: string; category?: SearchResultType };

export class SearchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "SearchError";
  }
}

export async function runMcpSearch(
  callerId: string,
  input: Input,
): Promise<
  | { results: SearchResult[]; categoriesWithMore: SearchResultType[] }
  | { results: SearchResult[]; page: PageInfo }
> {
  const roles = await getUserRoles(callerId);
  if (!input.category) {
    if (input.cursor) throw new McpInvalidError("cursor requires category.");
    return runSearchWithOverflow({ userId: callerId, roles, q: input.q });
  }
  if (!SEARCH_CATEGORIES.includes(input.category)) {
    throw new McpInvalidError(`Invalid category '${input.category}'. Valid values: ${SEARCH_CATEGORIES.join(", ")}`);
  }
  const window = offsetWindow(input, PAGE_LIMITS);
  const fetched = await runCategorySearch({
    userId: callerId,
    roles,
    q: input.q,
    category: input.category,
    skip: window.skip,
    limit: window.limit,
  });
  const { rows, page } = offsetPage(fetched, window);
  return { results: rows, page };
}
