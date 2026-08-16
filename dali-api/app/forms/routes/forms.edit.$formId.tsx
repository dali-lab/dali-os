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
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { PageIcon } from "~/components/PageIcon";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import {
  loadFormHiringLinks,
  unlinkHiringForm,
} from "~/hiring/lib/form-links.server";
import { listAllGroups } from "~/lib/groups";
import { FormDetail } from "~/forms/components/FormDetail";
import { driveRootCrumbs } from "~/lib/drive-crumbs";

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
    const d = data as {
      form?: { name: string };
      driveCrumbs?: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null;
    } | undefined;
    if (!d?.form) return null;
    const scope = d.driveCrumbs?.scope ?? "lab";
    return [
      ...driveRootCrumbs(scope),
      ...(d.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <PageIcon iconEmoji={f.iconEmoji} />,
      })),
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
  const [terms, usages, crumbs, allGroups, hiringLinks, driveCrumbs] =
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
      loadFormHiringLinks(params.formId),
      driveFolderCrumbs(form.folderPageId),
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
    hiringLinks,
    crumbs,
    driveCrumbs,
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

  // Read formData once so we can branch on intent without consuming the stream.
  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  if (intent === "unlink-hiring-form") {
    const linkType = formData.get("linkType") as "application" | "challenge";
    const cycleId = (formData.get("cycleId") as string) || undefined;
    const cycleDomainFormId =
      (formData.get("cycleDomainFormId") as string) || undefined;
    const result = await unlinkHiringForm(
      { linkType, cycleId, cycleDomainFormId },
      auth.user.sub,
    );
    return Response.json(result, { status: "error" in result ? 400 : 200 });
  }

  const result = await runFormsAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}

export default FormDetail;
