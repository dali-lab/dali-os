import { prisma } from "~/lib/db";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";

// Show the newest N submissions inline; the CSV export covers the full set.
const MAX_RESPONSES = 200;

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
export async function loadVersionResponses(formId: string, versionId: string) {
  const [partnerBinding, totalCount, submissions] = await Promise.all([
    // When this form is the bound partner application form, the applications
    // board is the canonical review surface — this view is just the raw data.
    prisma.partnerApplicationFormBinding.findFirst({
      where: { formId },
      select: { id: true },
    }),
    prisma.formSubmission.count({ where: { formId, formVersionId: versionId } }),
    prisma.formSubmission.findMany({
      where: { formId, formVersionId: versionId },
      orderBy: { createdAt: "desc" },
      take: MAX_RESPONSES,
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
    columns: grid.columns,
    slotOptions: [
      ...new Set(responses.flatMap((r) => (r.slot ? [r.slot] : []))),
    ].sort(),
    responses,
  };
}
