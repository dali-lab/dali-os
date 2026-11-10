import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import type { Season } from "~/generated/prisma/client";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

const SEASON_ORDER: Record<Season, number> = { W: 1, S: 2, X: 3, F: 4 };

export const BACKFILL_TERMS_TOOL = {
  name: "backfill_terms",
  description:
    "Create historical Term rows, for backfill. Year, season, and sort key are derived from the " +
    "code; terms whose code already exists are skipped and counted, never changed. Admins only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      terms: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          properties: {
            code: { type: "string", description: "Two-digit year plus season, like '16F'." },
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["code", "startDate", "endDate"],
          additionalProperties: false,
        },
      },
    },
    required: ["terms"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = { terms: { code: string; startDate: string; endDate: string }[] };

function parseTerm({ code, startDate, endDate }: Input["terms"][number]) {
  const match = /^(\d{2})([WSXF])$/.exec(code);
  if (!match) throw new McpInvalidError(`Invalid term code: ${code}.`);
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new McpInvalidError(`Invalid dates for term ${code}.`);
  }
  const year = 2000 + Number(match[1]);
  const season = match[2] as Season;
  return {
    code,
    year,
    season,
    sortKey: year * 10 + SEASON_ORDER[season],
    startDate: start,
    endDate: end,
  };
}

export async function runBackfillTerms(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can backfill terms.");
  }

  const data = args.terms.map(parseTerm);
  const { count } = await prisma.term.createMany({ data, skipDuplicates: true });
  const summary = { requested: data.length, created: count, skipped: data.length - count };

  await logAuditEvent({
    action: "term.backfill",
    userId: callerId,
    metadata: summary,
    request: ctx.request,
  });

  return { ok: true, ...summary };
}
