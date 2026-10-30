import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { offsetPage, offsetWindow } from "~/lib/pagination";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";

export const RESPONSES_PAGE_SIZE = 50;

export type ResponseFilters = { page?: number; q?: string; slot?: string };

// A submission matches when every word of the query is found in the
// respondent's name or email, the same fields the table shows. Signed-in fills
// carry them on the user, anonymous ones on the submission.
export function responsesWhere(
  formId: string,
  versionId: string,
  { q = "", slot = "" }: ResponseFilters = {},
): Prisma.FormSubmissionWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const words = q.split(/\s+/).filter(Boolean);
  return {
    formId,
    formVersionId: versionId,
    ...(slot ? { slot } : {}),
    ...(words.length
      ? {
          AND: words.map((word) => ({
            OR: [
              { submitterName: contains(word) },
              { submitterEmail: contains(word) },
              { user: { is: { firstName: contains(word) } } },
              { user: { is: { lastName: contains(word) } } },
              { user: { is: { daliEmail: contains(word) } } },
              { user: { is: { personalEmail: contains(word) } } },
            ],
          })),
        }
      : {}),
  };
}

export type ResponseRow = {
  id: string;
  createdAt: string;
  name: string;
  email: string | null;
  slot: string | null;
  // Only anonymous (Public-audience) fills carry an IP.
  submitterIp: string | null;
  partnerApplication: { id: string; title: string } | null;
  rows: { key: string; label: string; value: string }[];
};

export type VersionResponses = Awaited<ReturnType<typeof loadVersionResponses>>;

// Responses submitted against one frozen version of a form. Results live with
// the version they were collected on — each version's question set is its own
// column layout.
export async function loadVersionResponses(
  formId: string,
  versionId: string,
  filters: ResponseFilters = {},
) {
  const page = filters.page ?? 1;
  const where = responsesWhere(formId, versionId, filters);
  const [partnerBinding, totalCount, matchCount, slots, fetched] = await Promise.all([
    // When this form is the bound partner application form, the applications
    // board is the canonical review surface — this view is just the raw data.
    prisma.partnerApplicationFormBinding.findFirst({
      where: { formId },
      select: { id: true },
    }),
    prisma.formSubmission.count({ where: { formId, formVersionId: versionId } }),
    prisma.formSubmission.count({ where }),
    // Filter options come from every submission in the version, not the page.
    prisma.formSubmission.findMany({
      where: { formId, formVersionId: versionId, slot: { not: null } },
      distinct: ["slot"],
      orderBy: { slot: "asc" },
      select: { slot: true },
    }),
    prisma.formSubmission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...offsetWindow(page, RESPONSES_PAGE_SIZE),
      select: {
        id: true,
        createdAt: true,
        answers: true,
        submitterName: true,
        submitterEmail: true,
        submitterIp: true,
        slot: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            daliEmail: true,
            personalEmail: true,
          },
        },
        formVersion: { select: { versionNumber: true, questions: true } },
        partnerApplication: { select: { id: true, title: true } },
      },
    }),
  ]);

  const { items: submissions, hasNext } = offsetPage(fetched, RESPONSES_PAGE_SIZE);
  const grid = await buildResponseGrid(
    submissions.map((s) => ({
      formVersion: {
        versionNumber: s.formVersion.versionNumber,
        questions: (s.formVersion.questions as unknown as Question[]) ?? [],
      },
      answers: (s.answers as Record<string, unknown>) ?? {},
    })),
  );

  const responses: ResponseRow[] = submissions.map((s, i) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    name:
      [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") ||
      s.submitterName ||
      "Anonymous",
    email:
      s.user?.daliEmail || s.user?.personalEmail || s.submitterEmail || null,
    slot: s.slot,
    submitterIp: s.submitterIp,
    partnerApplication: s.partnerApplication,
    rows: grid.rowsBySubmission[i],
  }));

  return {
    versionId,
    isPartnerApplicationForm: partnerBinding !== null,
    totalCount,
    matchCount,
    page,
    hasNext,
    columns: grid.columns,
    slotOptions: slots.flatMap((s) => (s.slot ? [s.slot] : [])),
    responses,
  };
}
