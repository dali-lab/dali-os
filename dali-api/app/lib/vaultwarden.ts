// Vaultwarden (self-hosted Bitwarden) organization provisioning. Used to add a
// project's staffed roster to that project's Vaultwarden GROUP and grant the
// group access to the project's secrets COLLECTION — the analog of the GitHub
// team automation (app/lib/github.ts + projects/lib/github-team-sync.ts).
//
// Auth model: a dedicated BOT USER that is a confirmed Owner/Admin of the org,
// authenticated with its PERSONAL API KEY via the `client_credentials` grant
// (bypasses 2FA). The bearer token authorizes the internal org endpoints for
// access-control operations (groups, invite). It deliberately CANNOT perform
// crypto operations — confirming a member (re-encrypting the org key to their
// public key) and creating/naming a collection (encrypted names) both need the
// org symmetric key, which an API-key-only session doesn't hold. That's exactly
// the v1 scope: we invite + manage group membership + grant an EXISTING
// collection by id, and leave member confirmation to a human in the web vault.
//
// Everything is gated on the env being present — when unconfigured the caller
// gets a "skipped" result and nothing happens, mirroring the Google-Workspace /
// GitHub finalize precedents. See docs/VAULTWARDEN_PROVISIONING.md for the
// one-time bot/org setup and the env vars below.
//
// NOTE: the exact HTTP paths/bodies below target the Bitwarden/Vaultwarden
// internal API. Vaultwarden tracks the upstream API but lags/varies by version,
// so verify these against the running server (ideally with
// FINALIZE_EXTERNAL_OVERRIDE=1 against a throwaway test org) before relying on
// them. The sync logic (projects/lib/vaultwarden-group-sync.ts) is written
// against the VaultwardenClient interface, so version drift is contained here.

// Org member lifecycle status (Bitwarden OrganizationUserStatusType).
export const VW_STATUS = {
  Revoked: -1,
  Invited: 0,
  Accepted: 1,
  Confirmed: 2,
} as const;
export type VwMemberStatus = (typeof VW_STATUS)[keyof typeof VW_STATUS];

export type VwMember = { id: string; email: string; status: VwMemberStatus };

export interface VaultwardenClient {
  // Get-or-create a group by its (plaintext) name. Idempotent.
  ensureGroup(name: string): Promise<{ id: string; name: string; created: boolean }>;
  // Group name + the collection ids it currently has access to. Null if the id
  // doesn't resolve (e.g. an operator pasted a stale/foreign group id).
  getGroupDetails(
    groupId: string,
  ): Promise<{ id: string; name: string; collectionIds: string[] } | null>;
  // The member ids currently in the group.
  getGroupUserIds(groupId: string): Promise<string[]>;
  // Replace the group's name/collections/users in one PUT (Bitwarden group PUT
  // is full-replacement). Callers pass the already-unioned sets so this stays
  // add-only at the sync layer.
  updateGroup(
    groupId: string,
    args: { name: string; collectionIds: string[]; userIds: string[] },
  ): Promise<void>;
  // All org members (any status), for email→member resolution.
  listOrgMembers(): Promise<VwMember[]>;
  // Invite a member by email (Vaultwarden emails them the join link). Optional
  // groupId pre-assigns them to the group; membership is also reconciled by the
  // subsequent updateGroup, so this doesn't depend on invite-time group support.
  inviteMember(email: string, groupId?: string): Promise<void>;
}

export class VaultwardenError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "VaultwardenError";
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof VaultwardenError && err.status === 404;
}

// All four vars required. Cheap; no network.
export function vaultwardenConfigured(): boolean {
  return !!(
    process.env.VAULTWARDEN_URL &&
    process.env.VAULTWARDEN_ORG_ID &&
    process.env.VAULTWARDEN_CLIENT_ID &&
    process.env.VAULTWARDEN_CLIENT_SECRET
  );
}

function baseUrl(): string {
  return (process.env.VAULTWARDEN_URL ?? "").replace(/\/+$/, "");
}
function orgId(): string {
  const id = process.env.VAULTWARDEN_ORG_ID;
  if (!id) throw new VaultwardenError("VAULTWARDEN_ORG_ID is not set");
  return id;
}

// ─── Access token (client_credentials, cached) ───────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "api",
    client_id: process.env.VAULTWARDEN_CLIENT_ID!,
    client_secret: process.env.VAULTWARDEN_CLIENT_SECRET!,
    // Bitwarden's identity endpoint requires device metadata even for API-key
    // logins. A stable identifier keeps this from registering a new device each
    // call. deviceType 21 = "SDK" (any valid server-side type is accepted).
    deviceType: "21",
    deviceIdentifier: "dali-os-vaultwarden-bot",
    deviceName: "dali-os",
  });

  const res = await fetch(`${baseUrl()}/identity/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new VaultwardenError(`identity/connect/token ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new VaultwardenError("No access_token from Vaultwarden");
  // Refresh a minute early to avoid using a just-expired token.
  const ttl = (json.expires_in ?? 3600) - 60;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + Math.max(ttl, 30) * 1000 };
  return tokenCache.token;
}

// Test seam: reset the memoized token between tests.
export function __resetVaultwardenTokenForTests() {
  tokenCache = null;
}

async function vwFetch(method: string, path: string, jsonBody?: unknown): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
  });
  return res;
}

async function vwJson<T>(method: string, path: string, jsonBody?: unknown): Promise<T> {
  const res = await vwFetch(method, path, jsonBody);
  if (!res.ok) {
    const text = await res.text();
    throw new VaultwardenError(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  // Some endpoints (PUT) return 200 with no/empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Bitwarden list envelope: { object: "list", data: [...] }.
type ListResponse<T> = { data: T[] };

// ─── Default HTTP client ─────────────────────────────────────────────────────

const httpClient: VaultwardenClient = {
  async ensureGroup(name) {
    const org = orgId();
    const list = await vwJson<ListResponse<{ id: string; name: string }>>(
      "GET",
      `/organizations/${org}/groups`,
    );
    const found = list.data?.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return { id: found.id, name: found.name, created: false };
    const created = await vwJson<{ id: string; name: string }>(
      "POST",
      `/organizations/${org}/groups`,
      { name, accessAll: false, collections: [], users: [] },
    );
    return { id: created.id, name: created.name ?? name, created: true };
  },

  async getGroupDetails(groupId) {
    const org = orgId();
    try {
      const g = await vwJson<{
        id: string;
        name: string;
        collections?: { id: string }[];
      }>("GET", `/organizations/${org}/groups/${groupId}/details`);
      return { id: g.id, name: g.name, collectionIds: (g.collections ?? []).map((c) => c.id) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async getGroupUserIds(groupId) {
    const org = orgId();
    // Vaultwarden returns a bare array of member ids; older/other shapes return
    // objects — accept both.
    const raw = await vwJson<(string | { id: string })[]>(
      "GET",
      `/organizations/${org}/groups/${groupId}/users`,
    );
    return (raw ?? []).map((u) => (typeof u === "string" ? u : u.id));
  },

  async updateGroup(groupId, { name, collectionIds, userIds }) {
    const org = orgId();
    await vwJson<void>("PUT", `/organizations/${org}/groups/${groupId}`, {
      name,
      accessAll: false,
      collections: collectionIds.map((id) => ({
        id,
        readOnly: false,
        hidePasswords: false,
        manage: false,
      })),
      users: userIds,
    });
  },

  async listOrgMembers() {
    const org = orgId();
    const list = await vwJson<ListResponse<{ id: string; email: string; status: number }>>(
      "GET",
      `/organizations/${org}/users`,
    );
    return (list.data ?? []).map((m) => ({
      id: m.id,
      email: (m.email ?? "").trim().toLowerCase(),
      status: m.status as VwMemberStatus,
    }));
  },

  async inviteMember(email, groupId) {
    const org = orgId();
    await vwFetch("POST", `/organizations/${org}/users/invite`, {
      emails: [email],
      type: 2, // User
      accessAll: false,
      collections: [],
      groups: groupId ? [groupId] : [],
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new VaultwardenError(
          `invite ${email} ${res.status}: ${text.slice(0, 200)}`,
          res.status,
        );
      }
    });
  },
};

// Cached client + test seam, mirroring app/lib/github.ts.
let cached: VaultwardenClient | null = null;
export function vaultwardenClient(): VaultwardenClient {
  if (!cached) cached = httpClient;
  return cached;
}
export function __setVaultwardenClientForTests(c: VaultwardenClient | null) {
  cached = c;
  tokenCache = null;
}
