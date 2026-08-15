import { redirect } from "react-router";
import type { Route } from "./+types/forms.edit.$formId";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import {
  folderCrumbs,
  loadFormForEdit,
  runFormsAction,
} from "~/forms/lib/forms-data";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import { listAllGroups } from "~/lib/groups";
import { FormDetail } from "~/forms/components/FormDetail";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as any)?.form?.name ?? "Form"} · Forms · DALI OS` },
];

// Drive is the canonical home for forms — declare the full trail rooted there.
// The old Forms-folder ancestry is dropped since Forms no longer has a
// standalone area; Drive > <form name> is sufficient.
// The literal "edit" URL segment carries no location and is dropped by
// Breadcrumbs' DROPPED_SEGMENTS.
export const handle = {
  breadcrumbTrail: (data: unknown) => {
    const d = data as { form?: { name: string } } | undefined;
    if (!d?.form) return null;
    return [
      { label: "Drive", to: "/drive" },
      { label: d.form.name },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await loadFormForEdit(params.formId);
  if (!form) return redirect("/forms");
  // Terms for term-scoped reference questions (e.g. projects active in a
  // chosen term). Newest first so the most likely choices are at the top.
  const [terms, usages, crumbs, allGroups] =
    await Promise.all([
      prisma.term.findMany({
        orderBy: { sortKey: "desc" },
        select: { id: true, code: true },
      }),
      formUsages(params.formId),
      folderCrumbs(form.folderId),
      // Audience picker choices. listAllGroups (not the per-user visibility
      // helper): a Core author must be able to target groups they aren't in.
      listAllGroups(),
    ]);
  // When a feature owns this form's distribution (hiring cycle, education
  // offering, staffing, partner), the generic publish/audience settings are
  // hidden — access is governed by that feature, not the Form.
  const managing = managingUsage(usages);
  return {
    form,
    terms,
    usages,
    managing,
    crumbs,
    groups: allGroups
      .filter((g) => !g.archived)
      .map((g) => ({ id: g.id, name: g.name, type: g.type })),
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
