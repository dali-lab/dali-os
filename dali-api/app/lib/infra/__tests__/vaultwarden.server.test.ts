import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetVaultwardenTokensForTests,
  collectionStats,
  getVaultInventory,
  listMembers,
  memberAction,
  setGroupCollections,
  syncGroup,
  vaultMembersUrl,
  vaultwardenConfigured,
  vaultwardenSyncConfigured,
} from "../vaultwarden.server";

const fetchMock = vi.fn();
const ENV = {
  VAULTWARDEN_URL: "https://vault.example.edu/",
  VAULTWARDEN_ORG_ID: "org-1",
  VAULTWARDEN_CLIENT_ID: "user.bot",
  VAULTWARDEN_CLIENT_SECRET: "bot-secret",
  VAULTWARDEN_ORG_CLIENT_ID: "organization.org-1",
  VAULTWARDEN_ORG_CLIENT_SECRET: "org-secret",
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  __resetVaultwardenTokensForTests();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const token = (t: string) => json({ access_token: t, expires_in: 3600 });

/** Routes token requests by scope and API requests through `api`. */
function serve(api: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (u: string, init: RequestInit) => {
    const url = new URL(u);
    if (url.pathname === "/identity/connect/token") {
      const scope = new URLSearchParams(String(init.body)).get("scope");
      return token(scope === "api" ? "bot-token" : "org-token");
    }
    return api(url, init);
  });
}
const apiCalls = () =>
  fetchMock.mock.calls
    .filter((c) => !String(c[0]).includes("/identity/"))
    .map((c) => ({ url: new URL(c[0] as string), init: c[1] as RequestInit }));

describe("config", () => {
  it("needs the URL, org, and bot key to read, and the org key too to sync", () => {
    expect(vaultwardenConfigured()).toBe(true);
    expect(vaultwardenSyncConfigured()).toBe(true);
    delete process.env.VAULTWARDEN_ORG_CLIENT_SECRET;
    expect(vaultwardenSyncConfigured()).toBe(false);
    delete process.env.VAULTWARDEN_CLIENT_ID;
    expect(vaultwardenConfigured()).toBe(false);
  });

  it("links the org's member page", () => {
    expect(vaultMembersUrl()).toBe("https://vault.example.edu/#/organizations/org-1/members");
  });
});

describe("tokens", () => {
  it("logs the bot in with the user API key and reuses the token", async () => {
    serve(() => json({ data: [] }));
    await listMembers();
    await listMembers();
    const logins = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/identity/connect/token"));
    expect(logins).toHaveLength(1);
    const body = new URLSearchParams(String(logins[0][1].body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("api");
    expect(body.get("client_id")).toBe("user.bot");
    expect(body.get("deviceIdentifier")).toBe("dali-os-vaultwarden-bot");
    expect(apiCalls()[0].init.headers).toMatchObject({ Authorization: "Bearer bot-token" });
  });

  it("uses the org API key for the import, without device fields", async () => {
    serve(() => new Response(null, { status: 200 }));
    await syncGroup({ externalId: "dali-project:p1", name: "Ultrasound", emails: [] });
    const login = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/identity/connect/token"))!;
    const body = new URLSearchParams(String(login[1].body));
    expect(body.get("scope")).toBe("api.organization");
    expect(body.get("client_id")).toBe("organization.org-1");
    expect(body.has("deviceIdentifier")).toBe(false);
    expect(apiCalls()[0].init.headers).toMatchObject({ Authorization: "Bearer org-token" });
  });

  it("reports a failed login without the secret", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(listMembers()).rejects.toThrow("Vaultwarden login (api) failed: 400");
    await expect(listMembers()).rejects.not.toThrow(/bot-secret/);
  });
});

describe("listMembers", () => {
  it("normalizes emails and reads status, type, and 2FA", async () => {
    serve(() =>
      json({ data: [{ id: "m1", email: " Ada@Example.edu ", name: "Ada", status: 1, type: 2, twoFactorEnabled: false }] }),
    );
    expect(await listMembers()).toEqual([
      { id: "m1", email: "ada@example.edu", name: "Ada", status: 1, type: 2, twoFactorEnabled: false },
    ]);
    expect(apiCalls()[0].url.pathname).toBe("/api/organizations/org-1/users");
  });
});

describe("syncGroup", () => {
  it("imports one group with its members keyed by email, never overwriting others", async () => {
    serve(() => new Response(null, { status: 200 }));
    await syncGroup({ externalId: "dali-project:p1", name: "Ultrasound", emails: ["Ada@example.edu", "ada@example.edu", ""] });
    const call = apiCalls()[0];
    expect(call.url.pathname).toBe("/api/public/organization/import");
    expect(JSON.parse(String(call.init.body))).toEqual({
      groups: [{ name: "Ultrasound", externalId: "dali-project:p1", memberExternalIds: ["ada@example.edu"] }],
      members: [{ email: "ada@example.edu", externalId: "ada@example.edu", deleted: false }],
      overwriteExisting: false,
    });
  });

  it("raises the server's error", async () => {
    serve(() => new Response("groups disabled", { status: 400 }));
    await expect(syncGroup({ externalId: "x", name: "X", emails: [] })).rejects.toThrow(
      "Vaultwarden POST /public/organization/import 400: groups disabled",
    );
  });
});

describe("setGroupCollections", () => {
  it("replaces collections while keeping the group's name, external id, and members", async () => {
    serve(() => new Response(null, { status: 200 }));
    await setGroupCollections({ id: "g1", name: "U", externalId: "dali-project:p1", memberIds: ["m1"], collectionIds: [] }, ["c1"]);
    const call = apiCalls()[0];
    expect(call.init.method).toBe("PUT");
    expect(call.url.pathname).toBe("/api/organizations/org-1/groups/g1");
    expect(JSON.parse(String(call.init.body))).toEqual({
      name: "U",
      externalId: "dali-project:p1",
      accessAll: false,
      collections: [{ id: "c1", readOnly: false, hidePasswords: false, manage: false }],
      users: ["m1"],
    });
  });
});

describe("memberAction", () => {
  it.each([
    ["revoke", "PUT", "/api/organizations/org-1/users/m1/revoke"],
    ["restore", "PUT", "/api/organizations/org-1/users/m1/restore"],
    ["reinvite", "POST", "/api/organizations/org-1/users/m1/reinvite"],
  ] as const)("%s", async (action, method, path) => {
    serve(() => new Response(null, { status: 200 }));
    await memberAction("m1", action);
    expect(apiCalls()[0].init.method).toBe(method);
    expect(apiCalls()[0].url.pathname).toBe(path);
  });
});

describe("collectionStats", () => {
  const items = new Map([
    ["i1", ["c1"]],
    ["i2", ["c1", "c2"]],
  ]);

  it("counts items per collection and sums their recent uses", () => {
    const uses = new Map([["i1", 3], ["i2", 1]]);
    expect(collectionStats([{ id: "c1", externalId: null }, { id: "c2", externalId: "x" }, { id: "c3", externalId: null }], items, uses)).toEqual([
      { id: "c1", externalId: null, itemCount: 2, recentUses: 4 },
      { id: "c2", externalId: "x", itemCount: 1, recentUses: 1 },
      { id: "c3", externalId: null, itemCount: 0, recentUses: 0 },
    ]);
  });

  it("leaves recent uses null when events are off", () => {
    expect(collectionStats([{ id: "c1", externalId: null }], items, null)[0].recentUses).toBeNull();
  });
});

describe("getVaultInventory", () => {
  function org(events: (url: URL) => Response) {
    serve((url) => {
      const p = url.pathname;
      if (p.endsWith("/groups/g1/details")) return json({ collections: [{ id: "c1" }] });
      if (p.endsWith("/groups/g1/users")) return json(["m1"]);
      if (p.endsWith("/users")) return json({ data: [{ id: "m1", email: "ada@example.edu", status: 2, type: 2 }] });
      if (p.endsWith("/groups")) return json({ data: [{ id: "g1", name: "Ultrasound", externalId: null }] });
      if (p.endsWith("/collections")) return json({ data: [{ id: "c1", externalId: "secrets" }] });
      if (p === "/api/ciphers/organization-details") return json({ data: [{ id: "i1", collectionIds: ["c1"] }] });
      if (p.endsWith("/events")) return events(url);
      return new Response("not found", { status: 404 });
    });
  }

  it("assembles members, groups, and collections with item counts and uses", async () => {
    org(() => json({ data: [{ type: 1107, cipherId: "i1" }, { type: 1111, cipherId: "i1" }, { type: 1000, cipherId: "i1" }] }));
    const inv = await getVaultInventory(new Date("2026-10-25T12:00:00Z"));
    expect(inv.groups).toEqual([{ id: "g1", name: "Ultrasound", externalId: null, collectionIds: ["c1"], memberIds: ["m1"] }]);
    expect(inv.collections).toEqual([{ id: "c1", externalId: "secrets", itemCount: 1, recentUses: 2 }]);
    expect(inv.orgId).toBe("org-1");
  });

  it("reads 30 days of events and follows the continuation token", async () => {
    let page = 0;
    org(() => json(page++ === 0 ? { data: [{ type: 1107, cipherId: "i1" }], continuationToken: "2026-10-10T00:00:00Z" } : { data: [{ type: 1107, cipherId: "i1" }] }));
    const inv = await getVaultInventory(new Date("2026-10-25T12:00:00Z"));
    const eventCalls = apiCalls().filter((c) => c.url.pathname.endsWith("/events"));
    expect(eventCalls.map((c) => c.url.searchParams.get("end"))).toEqual(["2026-10-25T12:00:00.000Z", "2026-10-10T00:00:00Z"]);
    expect(eventCalls[0].url.searchParams.get("start")).toBe("2026-09-25T12:00:00.000Z");
    expect(inv.collections[0].recentUses).toBe(2);
  });

  it("treats an empty event log as events off", async () => {
    org(() => json({ data: [] }));
    expect((await getVaultInventory()).collections[0].recentUses).toBeNull();
  });

  it("still returns the inventory when events fail", async () => {
    org(() => new Response("", { status: 500 }));
    expect((await getVaultInventory()).collections[0].recentUses).toBeNull();
  });
});
