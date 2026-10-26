// A project's view of the shared Vaultwarden org: its group, each member's
// state, and how the group compares with the project's current staffing.
// Client-safe (no server imports).

import type { VaultCollection, VaultGroup, VaultInventory, VaultMember } from "./types";

export const VAULT_ORG_SNAPSHOT = "vaultwarden-org";

/** Config picker value meaning "make a new Vaultwarden group for this project". */
export const NEW_VAULT_GROUP = "__new__";

export function vaultGroupExternalId(projectId: string): string {
  return `dali-project:${projectId}`;
}

export type RosterPerson = { userId: string; name: string; email: string | null };

export type VaultMemberRow = VaultMember & {
  /** On the project's staffing roster this term. */
  staffed: boolean;
};

export type ProjectVault = {
  group: Pick<VaultGroup, "id" | "name" | "externalId">;
  members: VaultMemberRow[];
  collections: VaultCollection[];
  /** Staffed people with an email who aren't in the group yet. */
  missing: RosterPerson[];
  /** Staffed people with no DALI email, who can't be synced. */
  noEmail: RosterPerson[];
  /** Accepted invites waiting for a human to confirm in the web vault. */
  awaitingConfirm: number;
};

export function projectVault(
  inv: VaultInventory | null,
  groupId: string | null,
  roster: RosterPerson[],
): ProjectVault | null {
  const group = groupId ? inv?.groups.find((g) => g.id === groupId) : undefined;
  if (!inv || !group) return null;
  const byId = new Map(inv.members.map((m) => [m.id, m]));
  const rosterEmails = new Set(roster.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])));
  const members = group.memberIds
    .map((id) => byId.get(id))
    .filter((m): m is VaultMember => !!m)
    .map((m) => ({ ...m, staffed: rosterEmails.has(m.email) }))
    .sort((a, b) => Number(a.staffed) - Number(b.staffed) || a.email.localeCompare(b.email));
  const inGroup = new Set(members.map((m) => m.email));
  const cols = new Map(inv.collections.map((c) => [c.id, c]));
  return {
    group: { id: group.id, name: group.name, externalId: group.externalId },
    members,
    collections: group.collectionIds.flatMap((id) => (cols.has(id) ? [cols.get(id)!] : [])),
    missing: roster.filter((p) => p.email && !inGroup.has(p.email.toLowerCase())),
    noEmail: roster.filter((p) => !p.email),
    awaitingConfirm: members.filter((m) => m.status === 1).length,
  };
}

/**
 * Emails the group should hold after a sync: everyone already in it (removal
 * is a separate, explicit step) plus staffed people not in it yet.
 */
export function syncedEmails(vault: ProjectVault, remove: string[] = []): string[] {
  const drop = new Set(remove.map((e) => e.toLowerCase()));
  const emails = [...vault.members.map((m) => m.email), ...vault.missing.map((p) => p.email!.toLowerCase())];
  return [...new Set(emails)].filter((e) => !drop.has(e));
}

export function vaultGroupOptions(inv: VaultInventory | null): { id: string; name: string }[] {
  return (inv?.groups ?? []).map((g) => ({ id: g.id, name: g.name }));
}

export function collectionLabel(c: Pick<VaultCollection, "id" | "externalId">): string {
  return c.externalId || `Collection ${c.id.slice(0, 8)}`;
}

export const VAULT_STATUS_LABEL: Record<number, string> = {
  [-1]: "revoked",
  0: "invited",
  1: "needs confirm",
  2: "confirmed",
};
