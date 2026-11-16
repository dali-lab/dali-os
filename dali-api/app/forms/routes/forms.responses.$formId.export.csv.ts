import type { Route } from "./+types/forms.responses.$formId.export.csv";
import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { csvResponse, rowsToCsv } from "~/lib/csv";
import {
  buildResponseGrid,
  responsesCsvRows,
} from "~/forms/lib/answer-rows.server";
import { parseAnswerFilters } from "~/forms/lib/answer-filters";
import {
  memberColumnValues,
  versionResponsesWhere,
} from "~/forms/lib/version-responses.server";
import { arrangeResultColumns, parseResultColumns } from "~/forms/lib/response-columns";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { Question } from "~/types";

// Resource route — no default export, no layout wrapping. Returning a Response
// from a route nested under the app layout would render the layout shell
// around it; registering the download under its own non-layout path keeps it
// a pure byte stream.
//
// Unlike the paged results view, this exports every matching submission.
// `?version=N` limits the export to one version, and only then do `q`, `slot`
// and `a` (the results filters) apply, since they are read against its questions.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  if (!(await canBuildForm(auth.user.sub, params.formId, request))) return redirect("/");

  const form = await prisma.form.findUnique({
    where: { id: params.formId },
    select: { id: true, name: true, responseColumns: true },
  });
  if (!form) return redirect("/forms");
  const savedColumns = await isFeatureEnabled(
    "form-response-views",
    auth.user.sub,
    await getUserRoles(auth.user.sub, request),
    request,
  );

  const query = new URL(request.url).searchParams;
  const version = Number(query.get("version"));
  const versionRow =
    Number.isInteger(version) && version > 0
      ? await prisma.formVersion.findFirst({
          where: { formId: form.id, versionNumber: version },
          select: { id: true, questions: true },
        })
      : null;
  const questions = (versionRow?.questions as unknown as Question[]) ?? [];
  const where = versionRow
    ? await versionResponsesWhere(form.id, versionRow.id, {
        q: query.get("q") ?? "",
        slot: query.get("slot") ?? "",
        answers: parseAnswerFilters(query, questions),
        questions,
      })
    : { formId: form.id, ...(version > 0 ? { formVersion: { versionNumber: version } } : {}) };
  const submissions = await prisma.formSubmission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      answers: true,
      submitterName: true,
      submitterEmail: true,
      slot: true,
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
    },
  });

  const grid = await buildResponseGrid(
    submissions.map((s) => ({
      formVersion: {
        versionNumber: s.formVersion.versionNumber,
        questions: (s.formVersion.questions as unknown as Question[]) ?? [],
      },
      answers: (s.answers as Record<string, unknown>) ?? {},
    })),
  );

  const arranged = arrangeResultColumns(
    grid.columns,
    savedColumns ? parseResultColumns(form.responseColumns) : [],
  );
  const member = await memberColumnValues(arranged.members, submissions.map((s) => s.userId));

  const responses = submissions.map((s, i) => ({
    name:
      [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") ||
      s.submitterName ||
      "Anonymous",
    email:
      s.user?.daliEmail || s.user?.personalEmail || s.submitterEmail || null,
    createdAt: s.createdAt.toISOString(),
    versionNumber: s.formVersion.versionNumber,
    slot: s.slot,
    rows: [...grid.rowsBySubmission[i], ...member.rowsFor(s.userId)],
  }));

  const csv = rowsToCsv(
    responsesCsvRows(arranged.visible, responses, {
      includeSlot: submissions.some((s) => s.slot !== null),
    }),
  );

  const slug =
    form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "form";
  const fileStamp = new Date().toISOString().slice(0, 10);
  return csvResponse(csv, `${slug}-responses-${fileStamp}.csv`, {
    headers: { "Cache-Control": "no-store" },
  });
}
