import { Link, redirect, useLoaderData } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/forms.responses.$formId";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { formAnswerRows } from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `Responses · ${(data as { formName?: string } | undefined)?.formName ?? "Form"} · DALI OS`,
  },
];

// Show the newest N submissions inline; older ones exist but this page is a
// review surface, not an export.
const MAX_RESPONSES = 200;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await prisma.form.findUnique({
    where: { id: params.formId },
    select: { id: true, name: true, _count: { select: { submissions: true } } },
  });
  if (!form) return redirect("/forms");

  const submissions = await prisma.formSubmission.findMany({
    where: { formId: form.id },
    orderBy: { createdAt: "desc" },
    take: MAX_RESPONSES,
    select: {
      id: true,
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
      partnerApplication: { select: { id: true, title: true } },
    },
  });

  const responses = await Promise.all(
    submissions.map(async (s) => {
      const name =
        [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") ||
        s.submitterName ||
        "Anonymous";
      const email =
        s.user?.daliEmail || s.user?.personalEmail || s.submitterEmail || null;
      return {
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        versionNumber: s.formVersion.versionNumber,
        name,
        email,
        slot: s.slot,
        partnerApplication: s.partnerApplication,
        rows: await formAnswerRows(
          (s.formVersion.questions as unknown as Question[]) ?? [],
          (s.answers as Record<string, unknown>) ?? {},
        ),
      };
    }),
  );

  return {
    formId: form.id,
    formName: form.name,
    totalCount: form._count.submissions,
    responses,
  };
}

export default function FormResponses() {
  const { formId, formName, totalCount, responses } =
    useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/forms/edit/${formId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to form
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">
          {formName} · Responses
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} {totalCount === 1 ? "response" : "responses"}
          {totalCount > responses.length &&
            ` · showing the ${responses.length} most recent`}
        </p>
      </div>

      {responses.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border border-dashed">
          <p className="text-sm text-muted-foreground">No responses yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {responses.map((r) => (
            <div
              key={r.id}
              className="bg-card rounded-xl border border-border p-5"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <span className="text-sm font-semibold text-foreground">
                    {r.name}
                  </span>
                  {r.email && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.email}
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {" · "}v{r.versionNumber}
                  </div>
                </div>
                {r.partnerApplication && (
                  <Link
                    to={`/partners/applications/${r.partnerApplication.id}`}
                    className="text-xs font-medium text-accent-teal hover:underline"
                  >
                    Partner application: {r.partnerApplication.title} →
                  </Link>
                )}
              </div>
              <dl className="flex flex-col gap-3">
                {r.rows.map((row) => (
                  <div key={row.key}>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">
                      {row.label}
                    </dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">
                      {row.value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
