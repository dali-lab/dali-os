// The one save path for a project's infra config, shared by the project hub's
// Infrastructure section and the Admin console. Callers check permission.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { refreshProjectInfra } from "~/jobs/infra-snapshot.server";
import { buildInfraConfigUpdate, infraConfigFromForm, inheritFlyTokens } from "./project-infra.server";
import { createProjectVaultGroup } from "./vault-sync.server";
import { NEW_VAULT_GROUP } from "./vault-scope";

export async function saveInfraConfig(opts: {
  userId: string;
  projectId: string;
  form: FormData;
  request: Request;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const typed = buildInfraConfigUpdate(infraConfigFromForm(opts.form));
  const wantsNewGroup = typed.vaultwardenGroupId === NEW_VAULT_GROUP;
  if (wantsNewGroup) delete typed.vaultwardenGroupId;
  const data = await inheritFlyTokens(opts.projectId, typed);
  await prisma.project.update({ where: { id: opts.projectId }, data });
  let vaultError: string | null = null;
  if (wantsNewGroup) {
    vaultError = await createProjectVaultGroup(opts.projectId).then(
      () => null,
      (err) => (err instanceof Error ? err.message : "Could not create the Vaultwarden group"),
    );
  }
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
      vaultwardenGroupId: wantsNewGroup ? NEW_VAULT_GROUP : (data.vaultwardenGroupId ?? null),
      infraEnabled: data.infraEnabled ?? null,
      setFlyReadToken: !!typed.flyReadTokenEnc,
      setFlyWriteToken: !!typed.flyWriteTokenEnc,
      reusedFlyTokens: !typed.flyReadTokenEnc && !!data.flyReadTokenEnc,
    },
    request: opts.request,
  });
  return vaultError ? { ok: false, error: `Saved, but the Vaultwarden group wasn't created: ${vaultError}` } : { ok: true };
}
