import { redirect } from "react-router";
import type { Route } from "./+types/forms.edit.$formId";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { loadFormForEdit, runFormsAction } from "~/forms/lib/forms-data";
import { FormDetail } from "~/forms/components/FormDetail";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as any)?.form?.name ?? "Form"} · Forms · DALI OS` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const form = await loadFormForEdit(params.formId);
  if (!form) return redirect("/forms");
  // Terms for term-scoped reference questions (e.g. projects active in a
  // chosen term). Newest first so the most likely choices are at the top.
  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true },
  });
  // Return the user to the form's folder (or top level) on "Back".
  return {
    form,
    terms,
    backTo: form.folderId ? `/forms/${form.folderId}` : "/forms",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const result = await runFormsAction(await request.formData(), auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}

export default FormDetail;
