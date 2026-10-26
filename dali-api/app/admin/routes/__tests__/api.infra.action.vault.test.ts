import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(null, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/db", () => ({ prisma: { project: { update: vi.fn() } } }));
vi.mock("~/lib/infra/project-infra.server", () => ({ getProjectInfraCreds: vi.fn() }));
vi.mock("~/lib/infra/fly.server", () => ({}));
vi.mock("~/lib/infra/neon.server", () => ({}));
vi.mock("~/lib/infra/vaultwarden.server", () => ({
  getVaultInventory: vi.fn(),
  memberAction: vi.fn(),
  setGroupCollections: vi.fn(),
}));
vi.mock("~/lib/infra/vault-sync.server", () => ({ syncProjectVault: vi.fn() }));
vi.mock("~/jobs/infra-snapshot.server", () => ({ refreshVaultSnapshot: vi.fn(async () => true) }));

import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { getProjectInfraCreds } from "~/lib/infra/project-infra.server";
import * as vw from "~/lib/infra/vaultwarden.server";
import { syncProjectVault } from "~/lib/infra/vault-sync.server";
import { action } from "~/admin/routes/api.infra.action";

const post = (body: Record<string, unknown>) =>
  action({
    request: new Request("http://x/api/infra/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

const group = { id: "g1", name: "Ultrasound", externalId: "dali-project:p1", memberIds: ["m1"], collectionIds: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(getProjectInfraCreds).mockResolvedValue({ projectId: "p1", vaultwardenGroupId: "g1" } as never);
  vi.mocked(vw.getVaultInventory).mockResolvedValue({
    orgId: "org",
    groups: [group, { ...group, id: "g2", memberIds: ["m9"] }],
    members: [],
    collections: [{ id: "c1", externalId: null, itemCount: 0, recentUses: null }],
  });
  vi.mocked(syncProjectVault).mockResolvedValue({ added: 1, removed: 0, noEmail: 0 });
});

describe("vault.sync", () => {
  it("syncs for Core and audits the result", async () => {
    const res = await post({ intent: "vault.sync", projectId: "p1" });
    expect(await res.json()).toEqual({ ok: true, added: 1, removed: 0, noEmail: 0 });
    expect(syncProjectVault).toHaveBeenCalledWith("p1", { remove: undefined });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({ action: "infra.vault.sync", targetId: "g1" });
  });

  it("passes removals through", async () => {
    await post({ intent: "vault.sync", projectId: "p1", remove: ["alan@example.edu"] });
    expect(syncProjectVault).toHaveBeenCalledWith("p1", { remove: ["alan@example.edu"] });
  });

  it("rejects a removal that isn't an email", async () => {
    expect((await post({ intent: "vault.sync", projectId: "p1", remove: ["nope"] })).status).toBe(400);
    expect(syncProjectVault).not.toHaveBeenCalled();
  });

  it("refuses non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await post({ intent: "vault.sync", projectId: "p1" })).status).toBe(403);
  });

  it("returns a sync failure as an error", async () => {
    vi.mocked(syncProjectVault).mockRejectedValue(new Error("groups disabled"));
    const res = await post({ intent: "vault.sync", projectId: "p1" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "groups disabled" });
  });
});

describe("vault.member", () => {
  it("acts on a member of the project's group", async () => {
    const res = await post({ intent: "vault.member", projectId: "p1", memberId: "m1", action: "revoke" });
    expect(await res.json()).toEqual({ ok: true });
    expect(vw.memberAction).toHaveBeenCalledWith("m1", "revoke");
  });

  it("refuses a member of another group", async () => {
    expect((await post({ intent: "vault.member", projectId: "p1", memberId: "m9", action: "revoke" })).status).toBe(400);
    expect(vw.memberAction).not.toHaveBeenCalled();
  });

  it("refuses a project with no linked group", async () => {
    vi.mocked(getProjectInfraCreds).mockResolvedValue({ projectId: "p1", vaultwardenGroupId: null } as never);
    expect((await post({ intent: "vault.member", projectId: "p1", memberId: "m1", action: "restore" })).status).toBe(400);
  });
});

describe("vault.collections", () => {
  it("sets the group's collections", async () => {
    await post({ intent: "vault.collections", projectId: "p1", collectionIds: ["c1"] });
    expect(vw.setGroupCollections).toHaveBeenCalledWith(group, ["c1"]);
  });

  it("refuses an unknown collection", async () => {
    expect((await post({ intent: "vault.collections", projectId: "p1", collectionIds: ["nope"] })).status).toBe(400);
    expect(vw.setGroupCollections).not.toHaveBeenCalled();
  });
});
