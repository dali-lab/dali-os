import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";

type EmailTemplateRow = Awaited<ReturnType<typeof prisma.emailTemplate.findMany>>[number];

export type EmailTemplateWithCreatedBy = EmailTemplateRow & {
  createdBy: { id: string; firstName: string | null; lastName: string | null };
};

async function attachCreatedBy(rows: EmailTemplateRow[]): Promise<EmailTemplateWithCreatedBy[]> {
  const ids = [...new Set(rows.map((r) => r.createdById))];
  if (ids.length === 0) {
    return rows.map((r) => ({
      ...r,
      createdBy: { id: r.createdById, firstName: null, lastName: null },
    }));
  }
  const members = await prisma.dALIMember.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => ({
    ...r,
    createdBy: byId.get(r.createdById) ?? {
      id: r.createdById,
      firstName: null,
      lastName: null,
    },
  }));
}

/** Loads templates without Prisma relation include (avoids stale-client include errors). */
export async function findManyEmailTemplatesWithCreatedBy(
  args?: Prisma.EmailTemplateFindManyArgs,
): Promise<EmailTemplateWithCreatedBy[]> {
  const rows = await prisma.emailTemplate.findMany(args);
  return attachCreatedBy(rows);
}

export async function createEmailTemplateWithCreatedBy(
  data: Prisma.EmailTemplateUncheckedCreateInput,
): Promise<EmailTemplateWithCreatedBy> {
  const row = await prisma.emailTemplate.create({ data });
  const [withAuthor] = await attachCreatedBy([row]);
  return withAuthor;
}
