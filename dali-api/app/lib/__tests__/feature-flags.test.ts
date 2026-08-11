import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAGS,
  evaluateFlag,
  evaluateVariant,
  isHomeSurface,
  type FeatureFlagDef,
} from "../feature-flags";
import type { UserRoles } from "../roles";

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

const coreRoles: UserRoles = { ...noRoles, isCore: true };

const base = { enabled: true, everyone: false, roles: [] as string[], userIds: [] as string[] };

describe("evaluateFlag", () => {
  it("is off for everyone when the master switch is off, even with targets", () => {
    const config = { ...base, enabled: false, everyone: true, roles: ["isCore"], userIds: ["u1"] };
    expect(evaluateFlag(config, "u1", coreRoles)).toBe(false);
  });

  it("is on for everyone when enabled + everyone", () => {
    expect(evaluateFlag({ ...base, everyone: true }, "u1", noRoles)).toBe(true);
  });

  it("matches an explicit user in the allowlist", () => {
    expect(evaluateFlag({ ...base, userIds: ["u1"] }, "u1", noRoles)).toBe(true);
    expect(evaluateFlag({ ...base, userIds: ["u1"] }, "u2", noRoles)).toBe(false);
  });

  it("matches a held role", () => {
    expect(evaluateFlag({ ...base, roles: ["isCore"] }, "u1", coreRoles)).toBe(true);
    expect(evaluateFlag({ ...base, roles: ["isCore"] }, "u1", noRoles)).toBe(false);
  });

  it("is off when enabled but no target matches", () => {
    expect(evaluateFlag({ ...base, roles: ["isAdmin"], userIds: ["u2"] }, "u1", coreRoles)).toBe(false);
  });

  it("ignores unknown role keys on a stale row", () => {
    expect(evaluateFlag({ ...base, roles: ["isWizard"] }, "u1", coreRoles)).toBe(false);
  });
});

describe("evaluateVariant", () => {
  const def: FeatureFlagDef = {
    key: "home-surface",
    label: "Home page",
    description: "",
    variants: [
      { value: "classic", label: "Current home", description: "" },
      { value: "search", label: "Search-first", description: "" },
      { value: "calendar", label: "Calendar", description: "" },
    ],
    defaultVariant: "search",
  };

  it("is null when the flag doesn't target the user — the caller decides", () => {
    expect(evaluateVariant(def, { ...base, userIds: ["u1"], variant: "calendar" }, "u2", noRoles))
      .toBe(null);
    expect(evaluateVariant(def, { ...base, enabled: false, everyone: true }, "u1", noRoles))
      .toBe(null);
  });

  it("returns the chosen option to a targeted user", () => {
    expect(evaluateVariant(def, { ...base, everyone: true, variant: "calendar" }, "u1", noRoles))
      .toBe("calendar");
    expect(evaluateVariant(def, { ...base, roles: ["isCore"], variant: "classic" }, "u1", coreRoles))
      .toBe("classic");
  });

  it("falls back to the registry default when the row names no option", () => {
    expect(evaluateVariant(def, { ...base, everyone: true, variant: null }, "u1", noRoles))
      .toBe("search");
  });

  it("falls back when the row names an option the registry has dropped", () => {
    expect(evaluateVariant(def, { ...base, everyone: true, variant: "retired" }, "u1", noRoles))
      .toBe("search");
  });
});

describe("home-surface registry entry", () => {
  const def = FEATURE_FLAGS.find((f) => f.key === "home-surface") as FeatureFlagDef;

  it("offers exactly the three home surfaces", () => {
    expect(def.variants?.map((v) => v.value)).toEqual(["classic", "search", "calendar"]);
  });

  it("every option is a surface the home route knows how to render", () => {
    for (const v of def.variants ?? []) expect(isHomeSurface(v.value)).toBe(true);
    expect(isHomeSurface(def.defaultVariant)).toBe(true);
  });

  it("rejects anything else as a surface", () => {
    expect(isHomeSurface("dashboard")).toBe(false);
    expect(isHomeSurface(null)).toBe(false);
  });
});
