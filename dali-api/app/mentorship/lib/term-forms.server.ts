import { prisma } from "~/lib/db.server";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import {
  emptyDomainTermForms,
  isTermFormRole,
  latestPerUser,
  type TermFormRole,
  type TermForms,
} from "./term-forms";

export async function loadTermForms(
  term: { id: string; startDate: Date },
  userIds: string[],
): Promise<TermForms> {
  const result: TermForms = {};
  const links = await prisma.mentorshipTermForm.findMany({
    where: { termId: term.id },
    select: { domainId: true, role: true, form: { select: { id: true, name: true } } },
  });

  await Promise.all(
    links.map(async (link) => {
      if (!isTermFormRole(link.role)) return;
      const slot = (result[link.domainId] ??= emptyDomainTermForms())[link.role];
      slot.form = link.form;
      if (userIds.length === 0) return;
      // A form reused across terms keeps its older answers out of this one.
      const submissions = latestPerUser(
        await prisma.formSubmission.findMany({
          where: {
            formId: link.form.id,
            userId: { in: userIds },
            createdAt: { gte: term.startDate },
          },
          orderBy: { createdAt: "desc" },
          select: {
            userId: true,
            createdAt: true,
            answers: true,
            formVersion: { select: { versionNumber: true, questions: true } },
          },
        }),
      );
      const grid = await buildResponseGrid(
        submissions.map((s) => ({
          formVersion: {
            versionNumber: s.formVersion.versionNumber,
            questions: (s.formVersion.questions as unknown as Question[]) ?? [],
          },
          answers: (s.answers as Record<string, unknown>) ?? {},
        })),
      );
      submissions.forEach((s, i) => {
        slot.responses[s.userId] = {
          submittedAt: s.createdAt.toISOString(),
          rows: grid.rowsBySubmission[i],
        };
      });
    }),
  );
  return result;
}

export async function setTermForm(
  termId: string,
  domainId: string,
  role: TermFormRole,
  formId: string | null,
) {
  if (!formId) {
    await prisma.mentorshipTermForm.deleteMany({ where: { termId, domainId, role } });
    return;
  }
  await prisma.mentorshipTermForm.upsert({
    where: { termId_domainId_role: { termId, domainId, role } },
    create: { termId, domainId, role, formId },
    update: { formId },
  });
}
