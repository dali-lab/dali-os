import type { Route } from "./+types/forms.responses.$formId.export.csv";
import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { csvResponse, rowsToCsv } from "~/lib/csv";
import {
  buildResponseGrid,
  responsesCsvRows,
} from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";

// Resource route — no default export, no layout wrapping. Returning a Response
// from a route nested under the app layout would render the layout shell
// around it; registering the download under its own non-layout path keeps it
// a pure byte stream.
//
// Unlike the responses page (newest 200), this exports EVERY submission —
// it's the full-export escape hatch behind the page cap.

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await prisma.form.findUnique({
    where: { id: params.formId },
    select: { id: true, name: true },
  });
  if (!form) return redirect("/forms");

  const submissions = await prisma.formSubmission.findMany({
    where: { formId: form.id },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      answers: true,
      submitterName: true,
      submitterEmail: true,
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
    rows: grid.rowsBySubmission[i],
  }));

  const csv = rowsToCsv(
    responsesCsvRows(grid.columns, responses, {
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
