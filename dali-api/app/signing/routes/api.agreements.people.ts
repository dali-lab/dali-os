import type { Route } from "./+types/api.agreements.people";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";

// GET /api/agreements/people?q=...
// Backs the "Admin signature" signatory picker in the agreement builder: a
// lab-member search by name or email, matched per-token (AND). Core-only, since
// only Core authors agreements. Returns { results: [{ userId, name, email }] }.

const LIMIT = 10;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });

  const tokens = q.split(/\s+/).filter(Boolean);
  const rows = await prisma.user.findMany({
    where: {
      ...LAB_MEMBER_WHERE,
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { daliEmail: { contains: t, mode: "insensitive" as const } },
          { dartmouthEmail: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, firstName: true, lastName: true, daliEmail: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: LIMIT,
  });

  const results = rows.map((u) => ({
    userId: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.daliEmail,
  }));

  return Response.json({ results });
}
