import { describe, it, expect } from "vitest";
import {
  DRIVE_SPACES,
  visibleDriveSpaces,
  isProcessRootSpace,
  sharedSpaceItems,
  type DriveSpaceDef,
} from "~/lib/drive-spaces";
import type { RoleFlags } from "~/lib/nav-areas";
import type { DriveItem } from "~/lib/drive.server";

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
  isAlumni: false,
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
      "shared",
      "lab",
      "projects",
      "education",
      "core",
      "hiring",
      "mentorship",
    ]);
  });

  it("every space has a label, icon, and backing", () => {
    for (const space of DRIVE_SPACES) {
      expect(space.label).toBeTruthy();
      expect(space.icon).toBeTruthy();
      expect(space.backing).toBeTruthy();
    }
  });

  it("core, hiring and mentorship are process-root spaces backed by their own root", () => {
    for (const key of ["core", "hiring", "mentorship"] as const) {
      const space = DRIVE_SPACES.find((s) => s.key === key) as DriveSpaceDef;
      expect(space.backing).toBe("process-root");
      expect(space.rootKey).toBe(key);
    }
  });

  it("process-root spaces carry no role gate (root sharing decides who sees them)", () => {
    for (const space of DRIVE_SPACES.filter((s) => s.backing === "process-root")) {
      expect(space.gate).toBeUndefined();
    }
  });

  it("isProcessRootSpace is true only for process-root space ids", () => {
    expect(isProcessRootSpace("core")).toBe(true);
    expect(isProcessRootSpace("hiring")).toBe(true);
    expect(isProcessRootSpace("mentorship")).toBe(true);
    expect(isProcessRootSpace("lab")).toBe(false);
    expect(isProcessRootSpace("mine")).toBe(false);
    expect(isProcessRootSpace("some-project-id")).toBe(false);
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

  it("shows the process-root spaces to every viewer; the loader filters them by root access", () => {
    for (const flags of [NOBODY, CORE, HIRING_ONLY]) {
      const keys = visibleDriveSpaces(flags).map((s) => s.key);
      expect(keys).toEqual(["mine", "shared", "lab", "projects", "education", "core", "hiring", "mentorship"]);
    }
  });

  it("shared with me is ungated and backed by shared-with-me", () => {
    const shared = DRIVE_SPACES.find((s) => s.key === "shared")!;
    expect(shared.backing).toBe("shared-with-me");
    expect(shared.gate).toBeUndefined();
    expect(shared.label).toBe("Shared with me");
    for (const flags of [NOBODY, CORE, HIRING_ONLY]) {
      expect(visibleDriveSpaces(flags).map((s) => s.key)).toContain("shared");
    }
  });
});

describe("sharedSpaceItems", () => {
  const doc = (id: string, flags: { sharedWithMe?: boolean; sharedByMe?: boolean }): DriveItem => ({
    type: "doc",
    id,
    title: id,
    parentFolderId: null,
    iconEmoji: null,
    updatedAt: new Date(0),
    href: `/documents/${id}`,
    ...flags,
  });
  const items = [
    doc("received", { sharedWithMe: true }),
    doc("granted", { sharedByMe: true }),
    doc("both", { sharedWithMe: true, sharedByMe: true }),
  ];

  it("with-me keeps pages shared with the viewer, including ones they re-shared", () => {
    expect(sharedSpaceItems(items, "with-me").map((i) => i.id)).toEqual(["received", "both"]);
  });

  it("by-me keeps pages the viewer shared, including ones also shared with them", () => {
    expect(sharedSpaceItems(items, "by-me").map((i) => i.id)).toEqual(["granted", "both"]);
  });

  it("drops anything that is not a flagged doc", () => {
    const folder: DriveItem = { ...doc("f", {}), type: "folder" } as DriveItem;
    expect(sharedSpaceItems([folder, doc("plain", {})], "with-me")).toEqual([]);
  });
});
