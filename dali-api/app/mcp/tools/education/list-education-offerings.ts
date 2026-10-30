// MCP tool: list_education_offerings — catalog of published offerings, with
// per-offering approved counts and the caller's own application status.
// Pass manageable:true to list offerings the caller can manage (all statuses;
// instructor/Core only). Scope: mcp:read.

import { listCatalog, listManageable } from "~/education/lib/offerings.server";
import { manageableOfferingIds } from "~/education/lib/access.server";
import { isCore } from "~/lib/roles";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError } from "../../registry";
import { pageArray, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_EDUCATION_OFFERINGS_TOOL = {
  name: "list_education_offerings",
  description:
    "List education offerings (catalog). Includes approved enrollment counts and the caller's own application status on each. Pass `manageable:true` to list offerings you can manage (all statuses; instructor/Core only). Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      manageable: {
        type: "boolean",
        description:
          "If true, return offerings the caller can manage (all statuses). Requires instructor or Core role.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { manageable?: boolean };

function serializeOffering(o: Record<string, unknown>): Record<string, unknown> {
  return {
    ...o,
    registrationOpensAt:
      o.registrationOpensAt instanceof Date
        ? o.registrationOpensAt.toISOString()
        : o.registrationOpensAt,
    registrationClosesAt:
      o.registrationClosesAt instanceof Date
        ? o.registrationClosesAt.toISOString()
        : o.registrationClosesAt,
    startsAt: o.startsAt instanceof Date ? o.startsAt.toISOString() : o.startsAt,
    endsAt: o.endsAt instanceof Date ? o.endsAt.toISOString() : o.endsAt,
    closedOutAt:
      o.closedOutAt instanceof Date
        ? o.closedOutAt.toISOString()
        : (o.closedOutAt ?? null),
  };
}

function pageOfferings(all: unknown[], input: PageArgs) {
  const { rows, page } = pageArray(all, input, PAGE_LIMITS);
  return {
    page,
    offerings: rows.map((o) => serializeOffering(o as Record<string, unknown>)),
  };
}

export async function runListEducationOfferings(ctx: McpCtx, input: Input) {
  if (input.manageable) {
    const [core, ids] = await Promise.all([
      isCore(ctx.user.id),
      manageableOfferingIds(ctx.user.id),
    ]);
    const hasAny = ids === "all" || ids.length > 0;
    if (!core && !hasAny) {
      throw new McpForbiddenError(
        "Only instructors and Core members can list manageable offerings",
      );
    }
    return pageOfferings(await listManageable(ctx.user.id), input);
  }

  return pageOfferings(await listCatalog(ctx.user.id), input);
}

export const LIST_EDUCATION_OFFERINGS: McpTool = {
  def: LIST_EDUCATION_OFFERINGS_TOOL,
  run: (ctx: McpCtx, args) =>
    runListEducationOfferings(ctx, args as Input),
};
