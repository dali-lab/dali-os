// Vaultwarden reads for the infra read model: the cached org snapshot and each
// project's staffing roster to compare its group against.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { VAULT_ORG_SNAPSHOT, type RosterPerson } from "./vault-scope";
import type { VaultInventory } from "./types";

/** Each project's staffed people this term, deduped (one row per domain). */
export async function loadVaultRosters(projectIds: string[]): Promise<Map<string, RosterPerson[]>> {
  const out = new Map<string, RosterPerson[]>(projectIds.map((id) => [id, []]));
  if (projectIds.length === 0) return out;
  const term = await currentTerm();
  if (!term) return out;
  const rows = await prisma.projectAssignment.findMany({
    where: { termId: term.id, projectId: { in: projectIds } },
    select: { projectId: true, user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.projectId}:${r.user.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(r.projectId)?.push({
      userId: r.user.id,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      email: r.user.daliEmail?.trim().toLowerCase() || null,
    });
  }
  return out;
}

export async function latestVaultInventory(): Promise<VaultInventory | null> {
  const snap = await prisma.infraSnapshot.findFirst({
    where: { projectId: VAULT_ORG_SNAPSHOT, provider: "vaultwarden" },
    orderBy: { fetchedAt: "desc" },
    select: { payload: true },
  });
  return (snap?.payload as VaultInventory | undefined) ?? null;
}
