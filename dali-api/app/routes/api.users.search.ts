// GET /api/users/search?q=...
// Member/applicant search for manual applicant-email linking in the Email
// tab. Core/Admin only — this is a narrow name/address lookup across the
// whole User table, not a directory, and callers must already have a reason
// to look someone up (linking a thread to the applicant it belongs to).

import type { Route } from "./+types/api.users.search";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";

const LIMIT = 8;
const FETCH = 16;
const MIN_CHARS = 2;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(roles.isCore || roles.isAdmin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < MIN_CHARS) return Response.json({ users: [] });

  const words = q.split(/\s+/).filter(Boolean).slice(0, 3);
  const rows = await prisma.user.findMany({
    where: {
      AND: words.map((w) => ({
        OR: [
          { firstName: { startsWith: w, mode: "insensitive" as const } },
          { lastName: { startsWith: w, mode: "insensitive" as const } },
          { email: { startsWith: w, mode: "insensitive" as const } },
          { daliEmail: { startsWith: w, mode: "insensitive" as const } },
          { dartmouthEmail: { startsWith: w, mode: "insensitive" as const } },
          { personalEmail: { startsWith: w, mode: "insensitive" as const } },
          { emails: { some: { address: { startsWith: w.toLowerCase() } } } },
        ],
      })),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      email: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      _count: { select: { applications: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: FETCH,
  });

  // Applicants first — the common case for this lookup — without needing a
  // DB-level order over a relation count.
  rows.sort((a, b) => Number(b._count.applications > 0) - Number(a._count.applications > 0));

  const users = await Promise.all(
    rows.slice(0, LIMIT).map(async (u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      photoUrl: await resolvePhotoUrl(u.photoUrl),
      email: u.daliEmail ?? u.dartmouthEmail ?? u.personalEmail ?? u.email ?? "",
    })),
  );
  return Response.json({ users });
}
