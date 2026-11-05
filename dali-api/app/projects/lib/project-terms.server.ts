import { prisma } from "~/lib/db.server";

// Project term set. Full-replacement, so the one helper covers both adding and
// removing terms. The start term and active-this-term are derived from this set,
// not stored.
export async function replaceProjectTerms(projectId: string, incoming: string[]) {
  const valid = incoming.length
    ? await prisma.term.findMany({
        where: { id: { in: incoming } },
        select: { id: true },
      })
    : [];
  const ids = valid.map((t) => t.id);
  await prisma.$transaction([
    prisma.projectTerm.deleteMany({ where: { projectId, termId: { notIn: ids } } }),
    ...(ids.length
      ? [
          prisma.projectTerm.createMany({
            data: ids.map((termId) => ({ projectId, termId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}
