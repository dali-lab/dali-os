import type { PrismaClient } from "~/generated/prisma/client";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";

export type AdminPerson = {
  id: string;
  name: string | null;
  email: string | null;
  photoUrl: string | null;
};

export async function loadPeopleById(
  db: Pick<PrismaClient, "user">,
  ids: Iterable<string>,
): Promise<Map<string, AdminPerson>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, daliEmail: true, photoUrl: true },
  });
  const people = await Promise.all(
    users.map(async (u): Promise<AdminPerson> => ({
      id: u.id,
      name: fullName(u) || u.daliEmail || null,
      email: u.daliEmail,
      photoUrl: await resolvePhotoUrl(u.photoUrl),
    })),
  );
  return new Map(people.map((p) => [p.id, p]));
}
