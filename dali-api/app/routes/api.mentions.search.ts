import type { Route } from "./+types/api.mentions.search";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";

// GET /api/mentions/search?q=...
// Backs the @-mention typeahead in page-doc bodies and (eventually) comment
// composers. Returns lab members who HAVE a handle (only they can be mentioned),
// matched on name or handle, capped small. Lab-member gated — the same audience
// that can open a docs modal.

const LIMIT = 8;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const rows = await prisma.user.findMany({
    where: {
      ...LAB_MEMBER_WHERE,
      handle: { not: null },
      ...(q
        ? {
            OR: [
              { handle: { contains: q.toLowerCase() } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true, handle: true, photoUrl: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: LIMIT,
  });

  const members = await Promise.all(
    rows.map(async (u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      handle: u.handle!,
      photoUrl: await resolvePhotoUrl(u.photoUrl),
    })),
  );

  return Response.json({ members });
}
