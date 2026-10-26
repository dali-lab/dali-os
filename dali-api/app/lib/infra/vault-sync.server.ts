// Staffing → Vaultwarden group sync for one project. Adds staffed people (the
// import invites anyone not in the org); removing someone is an explicit
// `remove` from the console, never a side effect of a sweep.

import { prisma } from "~/lib/db";
import { refreshVaultSnapshot } from "~/jobs/infra-snapshot.server";
import * as vw from "./vaultwarden.server";
import { projectVault, syncedEmails, vaultGroupExternalId } from "./vault-scope";
import { loadVaultRosters } from "./vault-read.server";

export type VaultSyncResult = { added: number; removed: number; noEmail: number };

export async function syncProjectVault(projectId: string, opts: { remove?: string[] } = {}): Promise<VaultSyncResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, vaultwardenGroupId: true },
  });
  if (!project?.vaultwardenGroupId) throw new vw.VaultwardenError("No Vaultwarden group is linked to this project");
  const [inv, rosters] = await Promise.all([vw.getVaultInventory(), loadVaultRosters([projectId])]);
  const vault = projectVault(inv, project.vaultwardenGroupId, rosters.get(projectId) ?? []);
  const group = inv.groups.find((g) => g.id === project.vaultwardenGroupId);
  if (!vault || !group) throw new vw.VaultwardenError("The linked Vaultwarden group no longer exists");

  // The import finds groups by externalId; give a hand-made group one first so
  // the import updates it rather than creating a twin.
  const externalId = group.externalId || vaultGroupExternalId(projectId);
  if (!group.externalId) await vw.setGroupCollections({ ...group, externalId }, group.collectionIds);

  const emails = syncedEmails(vault, opts.remove);
  await vw.syncGroup({ externalId, name: group.name, emails });
  await refreshVaultSnapshot().catch(() => {});
  return {
    added: vault.missing.length,
    removed: vault.members.length + vault.missing.length - emails.length,
    noEmail: vault.noEmail.length,
  };
}

/** A new group for the project, named after it and seeded with its staffed people. */
export async function createProjectVaultGroup(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) throw new vw.VaultwardenError("Unknown project");
  const roster = (await loadVaultRosters([projectId])).get(projectId) ?? [];
  const externalId = vaultGroupExternalId(projectId);
  await vw.syncGroup({ externalId, name: project.name, emails: roster.flatMap((p) => (p.email ? [p.email] : [])) });
  const group = await vw.findGroupByExternalId(externalId);
  if (!group) throw new vw.VaultwardenError("Vaultwarden did not create the group (is ORG_GROUPS_ENABLED on?)");
  await prisma.project.update({ where: { id: projectId }, data: { vaultwardenGroupId: group.id } });
  await refreshVaultSnapshot().catch(() => {});
  return group.id;
}
