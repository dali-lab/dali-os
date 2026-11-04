import type { Route } from "./+types/api.audit-logs";
import { prisma } from "~/lib/db.server";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
} from "~/lib/audit-query";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const url = new URL(request.url);
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const filters = parseAuditFilters(url.searchParams);
  const where = {
    ...buildAuditWhere(filters),
    ...(await resolveAuditTextFilters(prisma, filters)),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return withCors(
    request,
    Response.json({ total, limit, offset, filters, entries }),
  );
}
