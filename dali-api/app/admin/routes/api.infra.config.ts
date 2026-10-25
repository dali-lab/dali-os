// Save a project's infra config from the Admin console (Core, infra-dashboard
// flag). Same save path as the project hub's Infrastructure section.

import type { Route } from "./+types/api.infra.config";
import { requireAuth, forbidden } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { prisma } from "~/lib/db";
import { saveInfraConfig } from "~/lib/infra/config-save.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) return forbidden(request);
  if (!(await isFeatureEnabled("infra-dashboard", auth.user.sub, roles, request))) return forbidden(request);

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) return Response.json({ error: "Unknown project" }, { status: 404 });

  return Response.json(await saveInfraConfig({ userId: auth.user.sub, projectId, form, request }));
}
