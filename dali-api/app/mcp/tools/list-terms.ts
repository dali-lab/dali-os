// MCP `list_terms` — the lab's term vocabulary (code "26S"/"26X"/…, dates),
// chronological. Terms key nearly everything (staffing, project terms,
// assignments, CE credits), and agents previously had no way to resolve a
// code like "26X" to an id or find the current term. `isCurrent` uses the
// same roll-forward currentTerm() the app's role checks use: between terms
// it advances to the next upcoming term rather than reporting none.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

export const LIST_TERMS_TOOL = {
  name: "list_terms",
  description:
    "List all lab terms chronologically (id, code like '26X', year, season, start/end dates). isCurrent marks the active term (rolls forward to the next term during inter-term gaps). Read-only.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListTerms() {
  const [terms, current] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "asc" },
      select: {
        id: true,
        code: true,
        year: true,
        season: true,
        startDate: true,
        endDate: true,
      },
    }),
    currentTerm(),
  ]);

  return {
    terms: terms.map((t) => ({
      id: t.id,
      code: t.code,
      year: t.year,
      season: t.season,
      startsAt: t.startDate.toISOString(),
      endsAt: t.endDate.toISOString(),
      isCurrent: t.id === current?.id,
    })),
  };
}
