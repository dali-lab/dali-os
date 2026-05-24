import type { Route } from "./+types/api.audit-logs";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// Filterable on the indexed columns (action, userId, createdAt) plus the
// non-indexed targetId. With ~100 lab members the userId scans are cheap;
// a heavier deployment would want a (targetId, createdAt) index.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const action = url.searchParams.get("action") || undefined;
  const userId = url.searchParams.get("userId") || undefined;
  const targetId = url.searchParams.get("targetId") || undefined;
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  const from = fromStr ? new Date(fromStr) : null;
  const to = toStr ? new Date(toStr) : null;
  if ((fromStr && from && isNaN(from.getTime())) || (toStr && to && isNaN(to.getTime()))) {
    return withCors(request, Response.json({ error: "Invalid date" }, { status: 400 }));
  }

  const createdAt =
    from || to
      ? {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        }
      : undefined;

  const where = {
    ...(action ? { action } : {}),
    ...(userId ? { userId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(createdAt ? { createdAt } : {}),
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
    Response.json({ total, limit, offset, filters: { action, userId, targetId, from, to }, entries }),
  );
}
