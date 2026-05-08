import type { Route } from "./+types/api.audit-logs";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  buildAuditWhere,
  encodeCursor,
  parseCursor,
  parseFilters,
  parseLimit,
} from "~/lib/audit-query";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = parseCursor(url.searchParams.get("before"));
  const filters = parseFilters(url.searchParams);

  // take = limit + 1 so we can tell if a next page exists without count(*).
  const [rows, actionGroups] = await Promise.all([
    prisma.auditLog.findMany({
      where: buildAuditWhere(filters, cursor),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
  ]);

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  const last = entries[entries.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  const actions = actionGroups.map((g) => g.action);

  return withAuth(auth, withCors(request, Response.json({ entries, actions, limit, nextCursor })));
}
