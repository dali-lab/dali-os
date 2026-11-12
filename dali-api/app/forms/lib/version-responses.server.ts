import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { offsetPage, offsetWindow } from "~/lib/pagination";
import {
  buildReferenceLabelMaps,
  buildResponseGrid,
  type FormAnswerRow,
} from "~/forms/lib/answer-rows.server";
import { RESPONSE_LOCK_SELECT, responseLockReason } from "~/forms/lib/response-lock";
import type { Question } from "~/types";
import { filterableQuestions, type AnswerFilter } from "~/forms/lib/answer-filters";
import {
  NO_ANSWER_MATCHES,
  resolveAnswerMatches,
  type AnswerMatches,
} from "~/forms/lib/answer-filters.server";
import {
  MEMBER_HISTORY_COLUMNS,
  memberHistoryText,
  type MemberHistoryColumn,
} from "~/projects/lib/member-history";
import { loadMemberHistories } from "~/projects/lib/member-history.server";
import { responseColumnId } from "~/forms/lib/response-columns";

export const RESPONSES_PAGE_SIZE = 50;

export type ResponseFilters = {
  page?: number;
  q?: string;
  slot?: string;
  answers?: AnswerFilter[];
  // The version's questions; answer filters are built against them.
  questions?: Question[];
  memberColumns?: MemberHistoryColumn[];
};

export function searchWords(q = ""): string[] {
  return q.split(/\s+/).filter(Boolean);
}

// A submission matches when every word of the query is found in the
// respondent's name or email (signed-in fills carry them on the user,
// anonymous ones on the submission) or in one of its answers. `matches` holds
// the ids the answer lookup found; see versionResponsesWhere for building it.
export function responsesWhere(
  formId: string,
  versionId: string,
  { q = "", slot = "" }: Pick<ResponseFilters, "q" | "slot"> = {},
  matches: AnswerMatches = NO_ANSWER_MATCHES,
): Prisma.FormSubmissionWhereInput {
  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const words = searchWords(q);
  return {
    formId,
    formVersionId: versionId,
    ...(slot ? { slot } : {}),
    ...(matches.filterIds ? { id: { in: matches.filterIds } } : {}),
    ...(words.length
      ? {
          AND: words.map((word, i) => ({
            OR: [
              { submitterName: contains(word) },
              { submitterEmail: contains(word) },
              { user: { is: { firstName: contains(word) } } },
              { user: { is: { lastName: contains(word) } } },
              { user: { is: { daliEmail: contains(word) } } },
              { user: { is: { personalEmail: contains(word) } } },
              ...(matches.wordIds[i]?.length ? [{ id: { in: matches.wordIds[i] } }] : []),
            ],
          })),
        }
      : {}),
  };
}

// The one place the results view, the Summary and the CSV export build their
// submission filter, so all three agree on what "matching" means.
export async function versionResponsesWhere(
  formId: string,
  versionId: string,
  filters: ResponseFilters = {},
) {
  const matches = await resolveAnswerMatches(versionId, filters.questions ?? [], {
    answers: filters.answers,
    words: searchWords(filters.q),
  });
  return responsesWhere(formId, versionId, filters, matches);
}

export type ResponseRow = {
  id: string;
  createdAt: string;
  edited: boolean;
  // Why this response can't be deleted (it feeds another feature); null when it can.
  lockReason: string | null;
  name: string;
  email: string | null;
  slot: string | null;
  // Only anonymous (Public-audience) fills carry an IP.
  submitterIp: string | null;
  partnerApplication: { id: string; title: string } | null;
  rows: FormAnswerRow[];
};

// Member columns (hired roles, history) for a set of respondents, in the order
// given. Anonymous respondents get blank cells.
export async function memberColumnValues(
  keys: MemberHistoryColumn[],
  userIds: (string | null)[],
) {
  const defs = keys.flatMap((k) => MEMBER_HISTORY_COLUMNS.filter((c) => c.key === k));
  const columns = defs.map((c) => ({ key: responseColumnId(c.key), label: c.label }));
  const histories = defs.length
    ? await loadMemberHistories([...new Set(userIds.filter((id): id is string => id !== null))])
    : null;
  const now = new Date();
  return {
    columns,
    rowsFor(userId: string | null): FormAnswerRow[] {
      const history = userId ? histories?.get(userId) : undefined;
      const text = history ? memberHistoryText(history, now) : null;
      return defs.map((c, i) => ({ ...columns[i], value: text?.[c.key] ?? "" }));
    },
  };
}

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
  const where = await versionResponsesWhere(formId, versionId, filters);
  const [partnerBinding, totalCount, matchCount, slots, fetched, refLabels] = await Promise.all([
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
        ...RESPONSE_LOCK_SELECT,
        id: true,
        createdAt: true,
        updatedAt: true,
        answers: true,
        submitterName: true,
        submitterEmail: true,
        submitterIp: true,
        userId: true,
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
        form: { select: { name: true } },
      },
    }),
    filters.questions ? buildReferenceLabelMaps(filters.questions) : null,
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

  const member = await memberColumnValues(
    filters.memberColumns ?? [],
    submissions.map((s) => s.userId),
  );

  const responses: ResponseRow[] = submissions.map((s, i) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    edited: s.updatedAt > s.createdAt,
    lockReason: responseLockReason(s, s.form.name),
    name:
      [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") ||
      s.submitterName ||
      "Anonymous",
    email:
      s.user?.daliEmail || s.user?.personalEmail || s.submitterEmail || null,
    slot: s.slot,
    submitterIp: s.submitterIp,
    partnerApplication: s.partnerApplication,
    rows: [...grid.rowsBySubmission[i], ...member.rowsFor(s.userId)],
  }));

  return {
    versionId,
    isPartnerApplicationForm: partnerBinding !== null,
    totalCount,
    matchCount,
    page,
    hasNext,
    columns: [...grid.columns, ...member.columns],
    slotOptions: slots.flatMap((s) => (s.slot ? [s.slot] : [])),
    filterQuestions: filters.questions ? filterableQuestions(filters.questions, refLabels ?? undefined) : [],
    responses,
  };
}
