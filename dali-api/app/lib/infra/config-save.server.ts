// The one save path for a project's infra config, shared by the project hub's
// Infrastructure section and the Admin console. Callers check permission.

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { refreshProjectInfra } from "~/jobs/infra-snapshot.server";
import { buildInfraConfigUpdate, infraConfigFromForm, inheritFlyTokens } from "./project-infra.server";

export async function saveInfraConfig(opts: {
  userId: string;
  projectId: string;
  form: FormData;
  request: Request;
}): Promise<{ ok: true }> {
  const typed = buildInfraConfigUpdate(infraConfigFromForm(opts.form));
  const data = await inheritFlyTokens(opts.projectId, typed);
  await prisma.project.update({ where: { id: opts.projectId }, data });
  await refreshProjectInfra(opts.projectId);
  await logAuditEvent({
    action: "infra.config",
    userId: opts.userId,
    targetId: opts.projectId,
    metadata: {
      flyOrgSlug: data.flyOrgSlug ?? null,
      flyAppNames: data.flyAppNames ?? null,
      neonOrgId: data.neonOrgId ?? null,
      neonProjectIds: data.neonProjectIds ?? null,
      infraEnabled: data.infraEnabled ?? null,
      setFlyReadToken: !!typed.flyReadTokenEnc,
      setFlyWriteToken: !!typed.flyWriteTokenEnc,
      reusedFlyTokens: !typed.flyReadTokenEnc && !!data.flyReadTokenEnc,
    },
    request: opts.request,
  });
  return { ok: true };
}
