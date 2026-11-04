import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRoles } from "../roles";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { featureFlag: { findMany: vi.fn(), upsert: vi.fn() } },
}));

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));

const TEST_FLAGS = vi.hoisted(() => [
  { key: "plain", label: "Plain", description: "off by default" },
  { key: "rolled-out", label: "Rolled out", description: "d", defaultEnabled: true, defaultEveryone: true },
  { key: "enabled-only", label: "Enabled only", description: "d", defaultEnabled: true },
  {
    key: "multi",
    label: "Multi",
    description: "d",
    defaultEnabled: true,
    defaultEveryone: true,
    variants: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    defaultVariant: "a",
  },
] as const);

vi.mock("~/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("~/lib/feature-flags")>("~/lib/feature-flags");
  return {
    ...actual,
    FEATURE_FLAGS: TEST_FLAGS,
    isFeatureFlagKey: (k: string) => TEST_FLAGS.some((f) => f.key === k),
  };
});

import {
  isFeatureEnabled,
  isFeatureEnabledForEveryone,
  listFlagsForAdmin,
  resolveFeatureFlags,
  resolveFlagVariant,
  updateFlag,
} from "../feature-flags.server";

const noRoles: UserRoles = {
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
};
const core: UserRoles = { ...noRoles, isCore: true };

function row(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    enabled: true,
    everyone: false,
    roles: [],
    userIds: [],
    variant: null,
    note: null,
    ...over,
  };
}

const asKey = (k: string) => k as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMock.featureFlag.findMany.mockResolvedValue([]);
  prismaMock.featureFlag.upsert.mockResolvedValue({});
});

describe("resolveFeatureFlags", () => {
  it("uses registry defaults when no rows exist: off unless the def ships rolled out", async () => {
    const map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
    expect(map).toEqual({
      plain: false,
      "rolled-out": true,
      "enabled-only": false,
      multi: true,
    });
  });

  it("a row overrides the registry default, including switching a rolled-out flag off", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      row("rolled-out", { enabled: false, everyone: true }),
      row("plain", { everyone: true }),
    ]);
    const map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
    expect(map["rolled-out"]).toBe(false);
    expect(map.plain).toBe(true);
  });

  it("targets by role and by user id", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      row("plain", { roles: ["isCore"] }),
      row("enabled-only", { userIds: ["u2"] }),
    ]);
    const asCore = (await resolveFeatureFlags("u1", core)) as Record<string, boolean>;
    expect(asCore.plain).toBe(true);
    expect(asCore["enabled-only"]).toBe(false);
    const asU2 = (await resolveFeatureFlags("u2", noRoles)) as Record<string, boolean>;
    expect(asU2.plain).toBe(false);
    expect(asU2["enabled-only"]).toBe(true);
  });

  it("treats a null findMany result as no rows", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue(null);
    const map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
    expect(map.plain).toBe(false);
  });

  it("reads rows once per request when a request is passed", async () => {
    const request = new Request("http://x/");
    await resolveFeatureFlags("u1", noRoles, request);
    await isFeatureEnabled(asKey("plain"), "u1", noRoles, request);
    expect(prismaMock.featureFlag.findMany).toHaveBeenCalledTimes(1);
  });

  describe("DEV_FEATURE_FLAGS outside production", () => {
    it("forces listed flags on by default but a row still wins", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DEV_FEATURE_FLAGS", "plain, enabled-only");
      let map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
      expect(map.plain).toBe(true);
      expect(map["enabled-only"]).toBe(true);
      prismaMock.featureFlag.findMany.mockResolvedValue([row("plain", { enabled: false })]);
      map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
      expect(map.plain).toBe(false);
    });

    it("is ignored in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEV_FEATURE_FLAGS", "plain");
      const map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
      expect(map.plain).toBe(false);
    });

    it("an empty value turns the mechanism off", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DEV_FEATURE_FLAGS", "");
      const map = (await resolveFeatureFlags("u1", noRoles)) as Record<string, boolean>;
      expect(map.plain).toBe(false);
    });
  });
});

describe("isFeatureEnabled", () => {
  it("is false for a key not in the registry without querying", async () => {
    expect(await isFeatureEnabled(asKey("nope"), "u1", noRoles)).toBe(false);
    expect(prismaMock.featureFlag.findMany).not.toHaveBeenCalled();
  });

  it("defaults off with no row, and follows registry defaults", async () => {
    expect(await isFeatureEnabled(asKey("plain"), "u1", noRoles)).toBe(false);
    expect(await isFeatureEnabled(asKey("rolled-out"), "u1", noRoles)).toBe(true);
  });

  it("evaluates a row's role and user targeting", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      row("plain", { roles: ["isCore"], userIds: ["u9"] }),
    ]);
    expect(await isFeatureEnabled(asKey("plain"), "u1", core)).toBe(true);
    expect(await isFeatureEnabled(asKey("plain"), "u9", noRoles)).toBe(true);
    expect(await isFeatureEnabled(asKey("plain"), "u1", noRoles)).toBe(false);
  });
});

describe("isFeatureEnabledForEveryone", () => {
  it("is false for unknown keys", async () => {
    expect(await isFeatureEnabledForEveryone(asKey("nope"))).toBe(false);
  });

  it("requires both the master switch and everyone targeting", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      row("plain", { enabled: true, everyone: false, roles: ["isCore"], userIds: ["u1"] }),
      row("enabled-only", { enabled: false, everyone: true }),
      row("multi", { enabled: true, everyone: true }),
    ]);
    expect(await isFeatureEnabledForEveryone(asKey("plain"))).toBe(false);
    expect(await isFeatureEnabledForEveryone(asKey("enabled-only"))).toBe(false);
    expect(await isFeatureEnabledForEveryone(asKey("multi"))).toBe(true);
  });

  it("falls back to registry defaults with no row", async () => {
    expect(await isFeatureEnabledForEveryone(asKey("rolled-out"))).toBe(true);
    expect(await isFeatureEnabledForEveryone(asKey("enabled-only"))).toBe(false);
    expect(await isFeatureEnabledForEveryone(asKey("plain"))).toBe(false);
  });
});

describe("resolveFlagVariant", () => {
  it("is null for flags without variants or unknown keys", async () => {
    expect(await resolveFlagVariant(asKey("plain"), "u1", noRoles)).toBeNull();
    expect(await resolveFlagVariant(asKey("nope"), "u1", noRoles)).toBeNull();
  });

  it("uses the registry default variant with no row", async () => {
    expect(await resolveFlagVariant(asKey("multi"), "u1", noRoles)).toBe("a");
  });

  it("returns the row's variant, falling back to default if the row names a removed option", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([row("multi", { everyone: true, variant: "b" })]);
    expect(await resolveFlagVariant(asKey("multi"), "u1", noRoles)).toBe("b");
    prismaMock.featureFlag.findMany.mockResolvedValue([row("multi", { everyone: true, variant: "gone" })]);
    expect(await resolveFlagVariant(asKey("multi"), "u1", noRoles)).toBe("a");
  });

  it("is null for a user the flag does not target", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([row("multi", { roles: ["isCore"], variant: "b" })]);
    expect(await resolveFlagVariant(asKey("multi"), "u1", noRoles)).toBeNull();
    expect(await resolveFlagVariant(asKey("multi"), "u1", core)).toBe("b");
  });
});

describe("listFlagsForAdmin", () => {
  it("fills unseeded flags from registry defaults with no note", async () => {
    const list = await listFlagsForAdmin();
    expect(list.map((f) => f.key)).toEqual(["plain", "rolled-out", "enabled-only", "multi"]);
    expect(list[0]).toMatchObject({ enabled: false, everyone: false, roles: [], userIds: [], note: null, variants: [], variant: null });
    expect(list[1]).toMatchObject({ enabled: true, everyone: true });
    expect(list[3]).toMatchObject({ variant: "a" });
    expect(list[3].variants).toHaveLength(2);
  });

  it("uses row values and drops stale role keys", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      row("plain", { enabled: true, roles: ["isCore", "isRetiredRole"], userIds: ["u1"], note: "pilot" }),
      row("multi", { variant: "b" }),
    ]);
    const list = await listFlagsForAdmin();
    expect(list[0]).toMatchObject({ roles: ["isCore"], userIds: ["u1"], note: "pilot", variant: null });
    expect(list[3].variant).toBe("b");
  });

  it("shows a multi-value flag's default variant when the row has none", async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([row("multi", { variant: null })]);
    expect((await listFlagsForAdmin())[3].variant).toBe("a");
  });
});

describe("updateFlag", () => {
  const patch = { enabled: true, everyone: false, roles: ["isCore"], userIds: ["u1"], note: "n" };

  it("rejects unknown keys without writing", async () => {
    await expect(updateFlag("nope", patch)).rejects.toThrow("Unknown feature flag: nope");
    expect(prismaMock.featureFlag.upsert).not.toHaveBeenCalled();
  });

  it("rejects a variant the registry does not declare, and any variant on a plain flag", async () => {
    await expect(updateFlag("multi", { ...patch, variant: "zzz" })).rejects.toThrow("Unknown variant for multi: zzz");
    await expect(updateFlag("plain", { ...patch, variant: "a" })).rejects.toThrow("Unknown variant for plain: a");
    expect(prismaMock.featureFlag.upsert).not.toHaveBeenCalled();
  });

  it("upserts by key, filtering unknown role keys, nulling variant for plain flags", async () => {
    await updateFlag("plain", { ...patch, roles: ["isCore", "bogus", "isAdmin"] });
    const data = { enabled: true, everyone: false, roles: ["isCore", "isAdmin"], userIds: ["u1"], note: "n", variant: null };
    expect(prismaMock.featureFlag.upsert).toHaveBeenCalledWith({
      where: { key: "plain" },
      create: { key: "plain", ...data },
      update: data,
    });
  });

  it("stores a declared variant, or the default when none is given", async () => {
    await updateFlag("multi", { ...patch, variant: "b" });
    expect(prismaMock.featureFlag.upsert.mock.calls[0][0].update.variant).toBe("b");
    await updateFlag("multi", { ...patch, variant: null });
    expect(prismaMock.featureFlag.upsert.mock.calls[1][0].update.variant).toBe("a");
  });
});
