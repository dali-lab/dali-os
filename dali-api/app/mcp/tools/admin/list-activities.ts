import { isCore } from "~/lib/roles";
import { listActivitiesForAdmin } from "~/lib/activities.server";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";
import { pageArray, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_ACTIVITIES_TOOL = {
  name: "list_activities",
  description:
    "List time-boxed Activities (onboarding hunts and site modes), newest start first. Pass page.nextCursor as cursor to read the next page until page.hasMore is false. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: { ...pageProps(PAGE_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListActivities(ctx: McpCtx, args: PageArgs) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view activities.");
  }
  const all = await listActivitiesForAdmin();
  const ordered = [...all].sort(
    (a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const { rows: activities, page } = pageArray(ordered, args, PAGE_LIMITS);
  return {
    page,
    activities: activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      status: a.status,
      termId: a.termId,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      participantCount: a.participantCount,
      eventCount: a.eventCount,
    })),
  };
}
