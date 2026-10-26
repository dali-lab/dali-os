// Vaultwarden (self-hosted Bitwarden) adapter. One shared org, two credentials:
//
// - Bot user API key (VAULTWARDEN_CLIENT_ID/SECRET, scope "api"): an org Admin
//   with no master password in our hands. Drives reads and the access-control
//   writes that need no org key: revoke, restore, re-invite, a group's
//   collections.
// - Org API key (VAULTWARDEN_ORG_CLIENT_ID/SECRET, scope "api.organization"):
//   drives POST /api/public/organization/import, which finds or creates a
//   group by externalId and replaces its membership, inviting unknown emails.
//   Needs ORG_GROUPS_ENABLED on the server.
//
// Not possible without the org key, so left to a human in the web vault:
// confirming members and creating or naming collections (names are encrypted).
// Responses never carry secrets we keep; item contents are encrypted and only
// ids are read.

import type { VaultCollection, VaultGroup, VaultInventory, VaultMember, VaultMemberStatus } from "./types";

export class VaultwardenError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "VaultwardenError";
  }
}

export function vaultwardenConfigured(): boolean {
  const e = process.env;
  return !!(e.VAULTWARDEN_URL && e.VAULTWARDEN_ORG_ID && e.VAULTWARDEN_CLIENT_ID && e.VAULTWARDEN_CLIENT_SECRET);
}

export function vaultwardenSyncConfigured(): boolean {
  return vaultwardenConfigured() && !!(process.env.VAULTWARDEN_ORG_CLIENT_ID && process.env.VAULTWARDEN_ORG_CLIENT_SECRET);
}

export function vaultwardenUrl(): string {
  return (process.env.VAULTWARDEN_URL ?? "").replace(/\/+$/, "");
}

export function vaultwardenOrgId(): string {
  const id = process.env.VAULTWARDEN_ORG_ID;
  if (!id) throw new VaultwardenError("VAULTWARDEN_ORG_ID is not set");
  return id;
}

/** The org in the web vault; pages hang off it (see consoleUrl.vault*). */
export function vaultOrgUrl(): string {
  return `${vaultwardenUrl()}/#/organizations/${encodeURIComponent(vaultwardenOrgId())}`;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

type Scope = "api" | "api.organization";
const tokens = new Map<Scope, { token: string; expiresAt: number }>();

function credentials(scope: Scope): { id: string; secret: string } {
  const e = process.env;
  const id = scope === "api" ? e.VAULTWARDEN_CLIENT_ID : e.VAULTWARDEN_ORG_CLIENT_ID;
  const secret = scope === "api" ? e.VAULTWARDEN_CLIENT_SECRET : e.VAULTWARDEN_ORG_CLIENT_SECRET;
  if (!id || !secret) throw new VaultwardenError(`Vaultwarden ${scope} credentials are not set`);
  return { id, secret };
}

async function accessToken(scope: Scope): Promise<string> {
  const cached = tokens.get(scope);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const { id, secret } = credentials(scope);
  const body = new URLSearchParams({ grant_type: "client_credentials", scope, client_id: id, client_secret: secret });
  if (scope === "api") {
    // User API-key logins register a device; a stable identifier reuses one.
    body.set("deviceType", "21");
    body.set("deviceIdentifier", "dali-os-vaultwarden-bot");
    body.set("deviceName", "dali-os");
  }
  const res = await fetch(`${vaultwardenUrl()}/identity/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new VaultwardenError(`Vaultwarden login (${scope}) failed: ${res.status}`, res.status);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new VaultwardenError("Vaultwarden login returned no token");
  const ttl = Math.max((json.expires_in ?? 3600) - 60, 30);
  tokens.set(scope, { token: json.access_token, expiresAt: Date.now() + ttl * 1000 });
  return json.access_token;
}

export function __resetVaultwardenTokensForTests() {
  tokens.clear();
}

async function vwFetch<T>(scope: Scope, method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(scope);
  const res = await fetch(`${vaultwardenUrl()}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new VaultwardenError(`Vaultwarden ${method} ${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type List<T> = { data?: T[]; continuationToken?: string | null };

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listMembers(): Promise<VaultMember[]> {
  const res = await vwFetch<List<Record<string, unknown>>>("api", "GET", `/organizations/${vaultwardenOrgId()}/users`);
  return (res.data ?? []).map((m) => ({
    id: String(m.id ?? ""),
    email: String(m.email ?? "").trim().toLowerCase(),
    name: (m.name as string | null) ?? null,
    status: Number(m.status ?? 0) as VaultMemberStatus,
    type: Number(m.type ?? 2),
    twoFactorEnabled: m.twoFactorEnabled === true,
  }));
}

async function listGroups(): Promise<VaultGroup[]> {
  const org = vaultwardenOrgId();
  const res = await vwFetch<List<{ id: string; name: string; externalId?: string | null }>>(
    "api",
    "GET",
    `/organizations/${org}/groups`,
  );
  const out: VaultGroup[] = [];
  for (const g of res.data ?? []) {
    const [details, users] = await Promise.all([
      vwFetch<{ collections?: { id: string }[] }>("api", "GET", `/organizations/${org}/groups/${g.id}/details`),
      vwFetch<(string | { id: string })[]>("api", "GET", `/organizations/${org}/groups/${g.id}/users`),
    ]);
    out.push({
      id: g.id,
      name: g.name,
      externalId: g.externalId ?? null,
      collectionIds: (details?.collections ?? []).map((c) => c.id),
      memberIds: (users ?? []).map((u) => (typeof u === "string" ? u : u.id)),
    });
  }
  return out;
}

async function listCollections(): Promise<{ id: string; externalId: string | null }[]> {
  const res = await vwFetch<List<{ id: string; externalId?: string | null }>>(
    "api",
    "GET",
    `/organizations/${vaultwardenOrgId()}/collections`,
  );
  return (res.data ?? []).map((c) => ({ id: c.id, externalId: c.externalId ?? null }));
}

/** Item id to the collections it sits in. Item contents stay encrypted and unread. */
async function itemCollections(): Promise<Map<string, string[]>> {
  const res = await vwFetch<List<{ id: string; collectionIds?: string[] }>>(
    "api",
    "GET",
    `/ciphers/organization-details?organizationId=${encodeURIComponent(vaultwardenOrgId())}`,
  );
  return new Map((res.data ?? []).map((c) => [c.id, c.collectionIds ?? []]));
}

const USE_EVENTS = new Set([1107, 1108, 1109, 1110, 1111, 1112, 1113, 1114, 1117]);
const MAX_EVENT_PAGES = 40;

/** Item views and copies per item since `from`, or null when org events are off. */
async function recentItemUses(from: Date, to: Date): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  let end = to.toISOString();
  let sawAny = false;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const qs = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(end)}`;
    const res = await vwFetch<List<{ type?: number; cipherId?: string | null }>>(
      "api",
      "GET",
      `/organizations/${vaultwardenOrgId()}/events?${qs}`,
    );
    const events = res.data ?? [];
    if (events.length) sawAny = true;
    for (const e of events) {
      if (e.cipherId && e.type != null && USE_EVENTS.has(e.type)) counts.set(e.cipherId, (counts.get(e.cipherId) ?? 0) + 1);
    }
    if (!res.continuationToken) break;
    end = res.continuationToken;
  }
  return sawAny ? counts : null;
}

export async function getVaultInventory(now = new Date()): Promise<VaultInventory> {
  const [members, groups, collections, items] = await Promise.all([
    listMembers(),
    listGroups(),
    listCollections(),
    itemCollections(),
  ]);
  const uses = await recentItemUses(new Date(now.getTime() - 30 * 86_400_000), now).catch(() => null);
  return { orgId: vaultwardenOrgId(), members, groups, collections: collectionStats(collections, items, uses) };
}

export function collectionStats(
  collections: { id: string; externalId: string | null }[],
  items: Map<string, string[]>,
  uses: Map<string, number> | null,
): VaultCollection[] {
  const count = new Map<string, number>();
  const used = new Map<string, number>();
  for (const [itemId, cols] of items) {
    for (const c of cols) {
      count.set(c, (count.get(c) ?? 0) + 1);
      if (uses) used.set(c, (used.get(c) ?? 0) + (uses.get(itemId) ?? 0));
    }
  }
  return collections.map((c) => ({
    id: c.id,
    externalId: c.externalId,
    itemCount: count.get(c.id) ?? 0,
    recentUses: uses ? (used.get(c.id) ?? 0) : null,
  }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Make a group's membership exactly `emails` (lowercased), creating the group
 * by externalId if needed and inviting anyone not in the org. Other groups and
 * members are untouched (overwriteExisting stays false).
 */
export async function syncGroup(group: { externalId: string; name: string; emails: string[] }): Promise<void> {
  const emails = [...new Set(group.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  await vwFetch<void>("api.organization", "POST", `/public/organization/import`, {
    groups: [{ name: group.name, externalId: group.externalId, memberExternalIds: emails }],
    members: emails.map((email) => ({ email, externalId: email, deleted: false })),
    overwriteExisting: false,
  });
}

export async function findGroupByExternalId(externalId: string): Promise<{ id: string; name: string } | null> {
  const res = await vwFetch<List<{ id: string; name: string; externalId?: string | null }>>(
    "api",
    "GET",
    `/organizations/${vaultwardenOrgId()}/groups`,
  );
  const g = (res.data ?? []).find((x) => x.externalId === externalId);
  return g ? { id: g.id, name: g.name } : null;
}

/** Replace which collections a group can open, keeping its name and members. */
export async function setGroupCollections(group: VaultGroup, collectionIds: string[]): Promise<void> {
  await vwFetch<void>("api", "PUT", `/organizations/${vaultwardenOrgId()}/groups/${group.id}`, {
    name: group.name,
    externalId: group.externalId,
    accessAll: false,
    collections: collectionIds.map((id) => ({ id, readOnly: false, hidePasswords: false, manage: false })),
    users: group.memberIds,
  });
}

export type VaultMemberAction = "revoke" | "restore" | "reinvite";

export async function memberAction(memberId: string, action: VaultMemberAction): Promise<void> {
  const base = `/organizations/${vaultwardenOrgId()}/users/${encodeURIComponent(memberId)}`;
  if (action === "reinvite") await vwFetch<void>("api", "POST", `${base}/reinvite`);
  else await vwFetch<void>("api", "PUT", `${base}/${action}`);
}
