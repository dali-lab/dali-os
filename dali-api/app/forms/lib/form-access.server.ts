// Who may see, build, and fill a form. Behind the `forms-page-access` flag the
// answer comes from the form's Drive page (getPageAccess: workspace role,
// folder scope, named shares, general access); otherwise from the legacy
// gates (canViewForms to see, isCore to build, Form.audience to fill).
// Fill = View on the page, build (and responses) = Edit. The flag is a cutover
// switch, so only the "everyone" setting counts.

import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getPageAccess, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";
import { canViewForms, isCore, isLabMember } from "~/lib/roles";

export async function formsUsePageAccess(request?: Request): Promise<boolean> {
  return isFeatureEnabledForEveryone("forms-page-access", request);
}

async function loadFormPage(formId: string) {
  return prisma.page.findUnique({ where: { id: formId, kind: "Form" }, select: PAGE_ACCESS_SELECT });
}

/** Whether the viewer may open the form's row in Drive, search, and Trash. */
export async function canSeeForm(userId: string, formId: string, request?: Request): Promise<boolean> {
  if (!(await formsUsePageAccess(request))) return canViewForms(userId, request);
  const page = await loadFormPage(formId);
  if (!page) return false;
  return (await getPageAccess(userId, page, request, { includeArchived: true })).canView;
}

/** Whether the viewer may edit the questions, settings, and read responses. */
export async function canBuildForm(userId: string, formId: string, request?: Request): Promise<boolean> {
  if (!(await formsUsePageAccess(request))) return isCore(userId, request);
  const page = await loadFormPage(formId);
  if (!page) return false;
  return (await getPageAccess(userId, page, request, { includeArchived: true })).canEdit;
}

/**
 * Whether the viewer may move, trash, restore, or purge the form. Flag off,
 * the Drive's canViewForms gate (which is wider than build); flag on, edit on
 * the form's page like any other Drive item.
 */
export async function canManageFormPlacement(userId: string, formId: string, request?: Request): Promise<boolean> {
  if (!(await formsUsePageAccess(request))) return canViewForms(userId, request);
  return canBuildForm(userId, formId, request);
}

/**
 * Whether the user may create a form in the destination: flag off, the legacy
 * canViewForms gate; flag on, edit on the folder page or, with no folder, any
 * lab member (the same rule as creating a document).
 */
export async function canCreateForm(userId: string, folderPageId: string | null | undefined, request?: Request): Promise<boolean> {
  if (!(await formsUsePageAccess(request))) return canViewForms(userId, request);
  if (!folderPageId) return isLabMember(userId, request);
  const folder = await prisma.page.findUnique({ where: { id: folderPageId, kind: "Folder" }, select: PAGE_ACCESS_SELECT });
  if (!folder) return false;
  return (await getPageAccess(userId, folder, request)).canEdit;
}

export type FillAccess = "ok" | "login" | "denied";

/**
 * The page-access half of formFillAccess: Public general access admits
 * anyone, otherwise a session is required and the page's canView decides.
 */
export async function fillAccessByPage(formId: string, userId: string | null, request?: Request): Promise<FillAccess> {
  const page = await loadFormPage(formId);
  if (!page || page.archivedAt) return "denied";
  if (page.linkAccess === "Public") return "ok";
  if (!userId) return "login";
  return (await getPageAccess(userId, page, request)).canView ? "ok" : "denied";
}
