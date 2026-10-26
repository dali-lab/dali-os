import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, audit, refresh, inherit, createGroup } = vi.hoisted(() => ({
  prismaMock: { project: { update: vi.fn() } },
  audit: vi.fn(),
  refresh: vi.fn(),
  inherit: vi.fn(),
  createGroup: vi.fn(),
}));
vi.mock("../vault-sync.server", () => ({ createProjectVaultGroup: createGroup }));
vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: audit }));
vi.mock("~/jobs/infra-snapshot.server", () => ({ refreshProjectInfra: refresh }));
vi.mock("../project-infra.server", async () => {
  const real = await vi.importActual<typeof import("../project-infra.server")>("../project-infra.server");
  return { ...real, inheritFlyTokens: inherit };
});

import { saveInfraConfig } from "../config-save.server";

const request = new Request("http://localhost/x");

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  inherit.mockImplementation(async (_id: string, d: object) => d);
});

describe("saveInfraConfig", () => {
  it("saves, refreshes, and audits without token values", async () => {
    await saveInfraConfig({
      userId: "u1",
      projectId: "p1",
      request,
      form: form([["flyOrgSlug", "dali-os"], ["flyAppNames", "web"], ["neonOrgId", "org-1"], ["neonProjectIds", "np-a"], ["infraEnabled", "on"]]),
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { flyOrgSlug: "dali-os", flyAppNames: ["web"], neonOrgId: "org-1", neonProjectIds: ["np-a"], infraEnabled: true },
    });
    expect(refresh).toHaveBeenCalledWith("p1");
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: "infra.config",
      targetId: "p1",
      metadata: { flyAppNames: ["web"], setFlyReadToken: false, reusedFlyTokens: false },
    });
  });

  it("audits reused tokens and never their ciphertext", async () => {
    inherit.mockImplementation(async (_id: string, d: object) => ({ ...d, flyReadTokenEnc: "enc-r" }));
    await saveInfraConfig({ userId: "u1", projectId: "p1", request, form: form([["flyOrgSlug", "dali-os"]]) });
    const meta = audit.mock.calls[0][0].metadata;
    expect(meta.reusedFlyTokens).toBe(true);
    expect(JSON.stringify(meta)).not.toContain("enc-r");
    expect(prismaMock.project.update.mock.calls[0][0].data.flyReadTokenEnc).toBe("enc-r");
  });
});

describe("saveInfraConfig Vaultwarden group", () => {
  it("links a chosen group", async () => {
    await saveInfraConfig({ userId: "u1", projectId: "p1", request, form: form([["vaultwardenGroupId", "g1"]]) });
    expect(prismaMock.project.update.mock.calls[0][0].data.vaultwardenGroupId).toBe("g1");
    expect(createGroup).not.toHaveBeenCalled();
  });

  it("unlinks with None", async () => {
    await saveInfraConfig({ userId: "u1", projectId: "p1", request, form: form([["vaultwardenGroupId", ""]]) });
    expect(prismaMock.project.update.mock.calls[0][0].data.vaultwardenGroupId).toBeNull();
  });

  it("leaves the link alone when the form has no picker", async () => {
    await saveInfraConfig({ userId: "u1", projectId: "p1", request, form: form([["neonOrgId", "o"]]) });
    expect(prismaMock.project.update.mock.calls[0][0].data).not.toHaveProperty("vaultwardenGroupId");
  });

  it("creates a group for the project instead of storing the placeholder", async () => {
    createGroup.mockResolvedValue("g-new");
    const out = await saveInfraConfig({ userId: "u1", projectId: "p1", request, form: form([["vaultwardenGroupId", "__new__"]]) });
    expect(out).toEqual({ ok: true });
    expect(prismaMock.project.update.mock.calls[0][0].data).not.toHaveProperty("vaultwardenGroupId");
    expect(createGroup).toHaveBeenCalledWith("p1");
    expect(audit.mock.calls[0][0].metadata.vaultwardenGroupId).toBe("__new__");
  });

  it("saves the rest and reports a group that couldn't be created", async () => {
    createGroup.mockRejectedValue(new Error("groups are disabled"));
    const out = await saveInfraConfig({
      userId: "u1",
      projectId: "p1",
      request,
      form: form([["vaultwardenGroupId", "__new__"], ["neonOrgId", "o"]]),
    });
    expect(out).toEqual({ ok: false, error: "Saved, but the Vaultwarden group wasn't created: groups are disabled" });
    expect(prismaMock.project.update.mock.calls[0][0].data.neonOrgId).toBe("o");
  });
});
