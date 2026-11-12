// MCP `search_directory` — substring search over lab members (User rows with a
// linked DALIMember marker). Matches against names, daliEmail, netId, domain
// names, and current-term role titles. Requires the `mcp:read` scope.
//
// Scoping mirrors the web People page (members.tsx): by default only members
// active in the current term are returned (a current-term Core or project
// assignment), so alumni and inactive members are excluded unless the caller
// opts into `includeInactive` (the web "All terms" toggle). netId is not
// returned in bulk rows — the web list view never shows it either; use
// get_member_profile for a single member's netId.

import { searchDirectory, type DirectoryRow } from "~/members/lib/directory-search.server";
import { offsetPage, offsetWindow, pageProps, type PageArgs, type PageInfo } from "~/mcp/pagination";

const PAGE_LIMITS = { defaultLimit: 20, maxLimit: 50 };

export const SEARCH_DIRECTORY_TOOL = {
  name: "search_directory",
  description:
    "Search the DALI member directory. Matches against name fragments, daliEmail, netId, domain names, and role titles. Returns current-term-active members by default (set includeInactive to also match alumni / members inactive this term). Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Search query (≤ 100 chars). Case-insensitive substring match.",
      },
      ...pageProps(PAGE_LIMITS),
      includeInactive: {
        type: "boolean",
        description:
          "If true, also match members with no current-term assignment (alumni / inactive). Defaults to false — mirrors the web directory's current-term filter.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { query: string; includeInactive?: boolean };

export async function runSearchDirectory(input: Input): Promise<{ results: DirectoryRow[]; page: PageInfo }> {
  const window = offsetWindow(input, PAGE_LIMITS);
  const rows = await searchDirectory({
    query: input.query,
    skip: window.skip,
    take: window.take,
    includeInactive: input.includeInactive,
  });
  const { rows: results, page } = offsetPage(rows, window);
  return { results, page };
}
