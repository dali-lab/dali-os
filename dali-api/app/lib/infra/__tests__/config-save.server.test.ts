import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, audit, refresh, inherit } = vi.hoisted(() => ({
  prismaMock: { project: { update: vi.fn() } },
  audit: vi.fn(),
  refresh: vi.fn(),
  inherit: vi.fn(),
}));
vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
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
