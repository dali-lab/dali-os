import { redirect } from "react-router";
import type { Route } from "./+types/forms.edit.$formId";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { loadFormForEdit, runFormsAction } from "~/forms/lib/forms-data";
import { formUsages } from "~/forms/lib/form-usages.server";
import { FormDetail } from "~/forms/components/FormDetail";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as any)?.form?.name ?? "Form"} · Forms · DALI OS` },
];

// Resolves the dynamic leaf crumb so the trail reads
// "Documents › Edit › <form name>" instead of a raw id.
export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { form?: { name?: string } } | undefined)?.form?.name ?? null,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await loadFormForEdit(params.formId);
  if (!form) return redirect("/forms");
  // Terms for term-scoped reference questions (e.g. projects active in a
  // chosen term). Newest first so the most likely choices are at the top.
  const [terms, usages, submissionCount] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
    formUsages(params.formId),
    prisma.formSubmission.count({ where: { formId: params.formId } }),
  ]);
  return {
    form,
    terms,
    usages,
    submissionCount,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const result = await runFormsAction(await request.formData(), auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}

export default FormDetail;
