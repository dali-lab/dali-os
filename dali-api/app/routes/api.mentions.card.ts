import type { Route } from "./+types/api.mentions.card";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";

// GET /api/mentions/card?id=<userId>
// Backs the hover card on an @handle chip: the photo and name behind a handle
// that, on its own, tells you very little.
//
// Same audience and same LAB_MEMBER_WHERE scope as /api/mentions/search — if
// you could have inserted the mention, you can see who it points at. Kept
// separate from users/:id, which is deliberately self-only and returns the
// whole User row; this returns four public-facing fields.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  const user = await prisma.user.findFirst({
    where: { ...LAB_MEMBER_WHERE, id },
    select: { id: true, firstName: true, lastName: true, handle: true, photoUrl: true },
  });
  if (!user) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    member: {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      handle: user.handle,
      photoUrl: await resolvePhotoUrl(user.photoUrl),
    },
  });
}
