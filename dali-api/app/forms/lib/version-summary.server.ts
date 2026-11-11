import { prisma } from "~/lib/db.server";
import { buildReferenceLabelMaps } from "~/forms/lib/answer-rows.server";
import { versionResponsesWhere } from "~/forms/lib/version-responses.server";
import { filterableQuestions, type AnswerFilter } from "~/forms/lib/answer-filters";
import { summarizeResponses } from "~/forms/lib/version-summary";
import type { Question } from "~/types";

// Unlike loadVersionResponses this reads every submission in the version, and
// only their answers, because the counts need the whole set rather than a page.
export async function loadVersionSummary(
  formId: string,
  version: { id: string; questions: Question[] },
  { slot = "", answers = [] }: { slot?: string; answers?: AnswerFilter[] } = {},
) {
  const [submissions, slots, refLabels] = await Promise.all([
    versionResponsesWhere(formId, version.id, { slot, answers, questions: version.questions }).then(
      (where) => prisma.formSubmission.findMany({ where, select: { answers: true } }),
    ),
    prisma.formSubmission.findMany({
      where: { formId, formVersionId: version.id, slot: { not: null } },
      distinct: ["slot"],
      orderBy: { slot: "asc" },
      select: { slot: true },
    }),
    buildReferenceLabelMaps(version.questions),
  ]);
  return {
    versionId: version.id,
    slotOptions: slots.flatMap((s) => (s.slot ? [s.slot] : [])),
    filterQuestions: filterableQuestions(version.questions, refLabels),
    summary: summarizeResponses(
      version.questions,
      submissions.map((s) => (s.answers as Record<string, unknown>) ?? {}),
      refLabels,
    ),
  };
}

export type VersionSummary = Awaited<ReturnType<typeof loadVersionSummary>>;
