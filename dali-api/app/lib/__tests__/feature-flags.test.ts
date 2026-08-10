import { describe, expect, it } from "vitest";
import { evaluateFlag } from "../feature-flags";
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
