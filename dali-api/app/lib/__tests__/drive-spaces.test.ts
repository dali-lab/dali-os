import { describe, it, expect } from "vitest";
import {
  DRIVE_SPACES,
  visibleDriveSpaces,
  type DriveSpaceDef,
} from "~/lib/drive-spaces";
import type { RoleFlags } from "~/lib/nav-areas";

// ── Fixture role flags ────────────────────────────────────────────────────────

const NOBODY: RoleFlags = {
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInterviewer: false,
  canViewForms: false,
  canViewStaffing: false,
  hasHiringAccess: false,
  hasActiveHiringAccess: false,
  isLabMentor: false,
  isInstructor: false,
};

const CORE: RoleFlags = {
  ...NOBODY,
  isCore: true,
  canViewForms: true,
  canViewStaffing: true,
  hasHiringAccess: true,
};

const HIRING_ONLY: RoleFlags = {
  ...NOBODY,
  hasHiringAccess: true,
};

// ── Registry shape ────────────────────────────────────────────────────────────

describe("DRIVE_SPACES registry", () => {
  it("has a unique key for every space", () => {
    const keys = DRIVE_SPACES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("contains exactly the expected keys in order", () => {
    expect(DRIVE_SPACES.map((s) => s.key)).toEqual([
      "mine",
      "lab",
      "projects",
      "education",
      "core",
      "hiring",
    ]);
  });

  it("every space has a label, icon, and backing", () => {
    for (const space of DRIVE_SPACES) {
      expect(space.label).toBeTruthy();
      expect(space.icon).toBeTruthy();
      expect(space.backing).toBeTruthy();
    }
  });

  it("core is a virtual-filter space scoped to the core group", () => {
    const core = DRIVE_SPACES.find((s) => s.key === "core") as DriveSpaceDef;
    expect(core.backing).toBe("virtual-filter");
    expect(core.groupQuery).toBe("core");
  });

  it("mine and lab have no gate (always visible)", () => {
    const mine = DRIVE_SPACES.find((s) => s.key === "mine")!;
    const lab = DRIVE_SPACES.find((s) => s.key === "lab")!;
    expect(mine.gate).toBeUndefined();
    expect(lab.gate).toBeUndefined();
  });
});

// ── visibleDriveSpaces gating ─────────────────────────────────────────────────

describe("visibleDriveSpaces", () => {
  it("always includes mine and lab for any member", () => {
    const keys = visibleDriveSpaces(NOBODY).map((s) => s.key);
    expect(keys).toContain("mine");
    expect(keys).toContain("lab");
  });

  it("always includes projects and education for any member", () => {
    const keys = visibleDriveSpaces(NOBODY).map((s) => s.key);
    expect(keys).toContain("projects");
    expect(keys).toContain("education");
  });

  it("hides both the core and hiring spaces from a plain member (both Core-gated)", () => {
    const keys = visibleDriveSpaces(NOBODY).map((s) => s.key);
    expect(keys).not.toContain("core");
    expect(keys).not.toContain("hiring");
  });

  it("shows all spaces (including core and hiring) to a Core member", () => {
    const keys = visibleDriveSpaces(CORE).map((s) => s.key);
    expect(keys).toContain("mine");
    expect(keys).toContain("lab");
    expect(keys).toContain("projects");
    expect(keys).toContain("education");
    expect(keys).toContain("core");
    expect(keys).toContain("hiring");
  });

  it("hides core and hiring from a hiring-only member (both are Core-only)", () => {
    const keys = visibleDriveSpaces(HIRING_ONLY).map((s) => s.key);
    expect(keys).not.toContain("core");
    expect(keys).not.toContain("hiring");
  });
});
