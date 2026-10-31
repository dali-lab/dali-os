import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { project: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));

import {
  buildInfraConfigUpdate,
  infraConfigFromForm,
  inheritFlyTokens,
  listInfraProjects,
} from "../project-infra.server";

beforeEach(() => vi.clearAllMocks());

describe("buildInfraConfigUpdate neonProjectIds", () => {
  it("leaves linked databases unchanged when not submitted", () => {
    expect(buildInfraConfigUpdate({ neonOrgId: "org-dali-1" })).not.toHaveProperty("neonProjectIds");
  });

  it("saves the submitted databases", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: ["np-a", "np-b"] }).neonProjectIds).toEqual(["np-a", "np-b"]);
  });

  it("clears links when an empty list is submitted", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: [] }).neonProjectIds).toEqual([]);
  });

  it("trims, drops blanks, and dedupes", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: [" np-a ", "", "np-a", "np-b"] }).neonProjectIds).toEqual([
      "np-a",
      "np-b",
    ]);
  });
});

describe("buildInfraConfigUpdate flyAppNames", () => {
  it("leaves linked apps unchanged when not submitted", () => {
    expect(buildInfraConfigUpdate({ flyOrgSlug: "dali-os" })).not.toHaveProperty("flyAppNames");
  });

  it("trims, drops blanks, and dedupes", () => {
    expect(buildInfraConfigUpdate({ flyAppNames: [" web ", "", "web", "worker"] }).flyAppNames).toEqual(["web", "worker"]);
  });

  it("clears an org set to blank", () => {
    expect(buildInfraConfigUpdate({ flyOrgSlug: "", neonOrgId: "" })).toEqual({ flyOrgSlug: null, neonOrgId: null });
  });
});

describe("infraConfigFromForm", () => {
  function form(entries: [string, string][]) {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  }

  it("reads orgs, linked lists, and the sweep toggle", () => {
    expect(
      infraConfigFromForm(
        form([
          ["flyOrgSlug", " dali-os "],
          ["flyAppNames", "web"],
          ["flyAppNames", "worker"],
          ["neonOrgId", "org-dali-1"],
          ["neonProjectIds", "np-a"],
          ["infraEnabled", "on"],
        ]),
      ),
    ).toEqual({
      flyOrgSlug: "dali-os",
      flyAppNames: ["web", "worker"],
      neonOrgId: "org-dali-1",
      neonProjectIds: ["np-a"],
      infraEnabled: true,
      flyReadToken: undefined,
      flyWriteToken: undefined,
    });
  });

  it("treats a missing checkbox as sweep off and empty lists as cleared", () => {
    const out = infraConfigFromForm(form([["flyOrgSlug", ""]]));
    expect(out.infraEnabled).toBe(false);
    expect(out.flyAppNames).toEqual([]);
    expect(out.neonProjectIds).toEqual([]);
  });

  it("passes typed tokens through for encryption", () => {
    const out = infraConfigFromForm(form([["flyReadToken", "FlyV1 r"], ["flyWriteToken", " "]]));
    expect(out.flyReadToken).toBe("FlyV1 r");
    expect(out.flyWriteToken).toBeUndefined();
  });
});

describe("inheritFlyTokens", () => {
  it("copies another project's encrypted tokens when joining its org without typing any", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ flyOrgSlug: null, flyReadTokenEnc: null });
    prismaMock.project.findFirst.mockResolvedValue({ flyReadTokenEnc: "enc-r", flyWriteTokenEnc: "enc-w" });
    expect(await inheritFlyTokens("p2", { flyOrgSlug: "dali-os" })).toEqual({
      flyOrgSlug: "dali-os",
      flyReadTokenEnc: "enc-r",
      flyWriteTokenEnc: "enc-w",
    });
    expect(prismaMock.project.findFirst.mock.calls[0][0].where).toEqual({
      id: { not: "p2" },
      flyOrgSlug: "dali-os",
      flyReadTokenEnc: { not: null },
    });
  });

  it("copies a read token alone when the donor has no write token", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    prismaMock.project.findFirst.mockResolvedValue({ flyReadTokenEnc: "enc-r", flyWriteTokenEnc: null });
    expect(await inheritFlyTokens("p2", { flyOrgSlug: "dali-os" })).toEqual({ flyOrgSlug: "dali-os", flyReadTokenEnc: "enc-r" });
  });

  it("keeps the project's own token for the same org", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ flyOrgSlug: "dali-os", flyReadTokenEnc: "own" });
    expect(await inheritFlyTokens("p2", { flyOrgSlug: "dali-os" })).toEqual({ flyOrgSlug: "dali-os" });
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
  });

  it("replaces tokens when switching to an org another project uses", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ flyOrgSlug: "old-org", flyReadTokenEnc: "old" });
    prismaMock.project.findFirst.mockResolvedValue({ flyReadTokenEnc: "enc-r", flyWriteTokenEnc: null });
    expect((await inheritFlyTokens("p2", { flyOrgSlug: "dali-os" })).flyReadTokenEnc).toBe("enc-r");
  });

  it("never overrides typed tokens", async () => {
    const typed = { flyOrgSlug: "dali-os", flyReadTokenEnc: "typed" };
    expect(await inheritFlyTokens("p2", typed)).toBe(typed);
    expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing without a Fly org", async () => {
    expect(await inheritFlyTokens("p2", { neonOrgId: "org" })).toEqual({ neonOrgId: "org" });
  });

  it("leaves the data alone when no other project is in the org", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    prismaMock.project.findFirst.mockResolvedValue(null);
    expect(await inheritFlyTokens("p2", { flyOrgSlug: "new-org" })).toEqual({ flyOrgSlug: "new-org" });
  });
});

describe("listInfraProjects", () => {
  const row = {
    id: "p1",
    name: "Ultrasound",
    flyOrgSlug: null,
    flyAppNames: [],
    neonOrgId: null,
    neonProjectIds: [],
    flyReadTokenEnc: "secret",
    flyWriteTokenEnc: null,
    infraEnabled: true,
  };

  it("lists configured projects by default", async () => {
    prismaMock.project.findMany.mockResolvedValue([row]);
    await listInfraProjects();
    expect(prismaMock.project.findMany.mock.calls[0][0].where).toHaveProperty("OR");
  });

  it("lists every project when asked for all", async () => {
    prismaMock.project.findMany.mockResolvedValue([]);
    await listInfraProjects({ all: true });
    expect(prismaMock.project.findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it("scopes all to the term but keeps configured projects", async () => {
    prismaMock.project.findMany.mockResolvedValue([]);
    await listInfraProjects({ all: true, termId: "t26f" });
    const where = prismaMock.project.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ projectTerms: { some: { termId: "t26f" } } });
    expect(where.OR[1]).toHaveProperty("OR");
  });

  it("reports token presence without the ciphertext", async () => {
    prismaMock.project.findMany.mockResolvedValue([row]);
    const [info] = await listInfraProjects();
    expect(info).toEqual({
      projectId: "p1",
      name: "Ultrasound",
      flyOrgSlug: null,
      flyAppNames: [],
      neonOrgId: null,
      neonProjectIds: [],
      infraEnabled: true,
      hasFlyReadToken: true,
      hasFlyWriteToken: false,
    });
  });
});
