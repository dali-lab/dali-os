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

  it("lab-scoped-root spaces carry both systemKey and groupQuery", () => {
    const scoped = DRIVE_SPACES.filter((s) => s.backing === "lab-scoped-root");
    expect(scoped.length).toBeGreaterThan(0);
    for (const s of scoped) {
      expect(s.systemKey, `${s.key} missing systemKey`).toBeTruthy();
      expect(s.groupQuery, `${s.key} missing groupQuery`).toBeTruthy();
    }
  });

  it("core space uses systemKey drive:space:core", () => {
    const core = DRIVE_SPACES.find((s) => s.key === "core") as DriveSpaceDef;
    expect(core.systemKey).toBe("drive:space:core");
    expect(core.groupQuery).toBe("core");
  });

  it("hiring space uses systemKey drive:space:hiring", () => {
    const hiring = DRIVE_SPACES.find((s) => s.key === "hiring") as DriveSpaceDef;
    expect(hiring.systemKey).toBe("drive:space:hiring");
    expect(hiring.groupQuery).toBe("hiring");
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

  it("hides core and hiring from a plain member", () => {
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

  it("shows hiring (but not core) to a hiring-only member", () => {
    const keys = visibleDriveSpaces(HIRING_ONLY).map((s) => s.key);
    expect(keys).toContain("hiring");
    expect(keys).not.toContain("core");
  });

  it("hides core from a hiring-only member", () => {
    const keys = visibleDriveSpaces(HIRING_ONLY).map((s) => s.key);
    expect(keys).not.toContain("core");
  });
});
