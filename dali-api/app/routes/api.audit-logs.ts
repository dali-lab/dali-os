import type { Route } from "./+types/api.audit-logs";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count(),
  ]);

  return withAuth(auth, withCors(request, Response.json({ total, limit, offset, entries })));
}
