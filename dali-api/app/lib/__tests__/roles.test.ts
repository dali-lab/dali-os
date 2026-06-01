import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  hasCycleAccess,
  isInstructor,
  canViewForms,
  canViewStaffing,
  isAlumni,
  tier,
  standardGradDate,
  getUserRoles,
} from "~/lib/roles";

// Phase 2: roles helpers now query AdminMembership / CoreAssignment /
// DomainLeadAssignment / cycleReviewer / cycleInterviewer (all keyed on
// userId). DALIMember is only used as a presence marker via findUnique.

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  adminMembership: { findUnique: ReturnType<typeof vi.fn> };
  coreAssignment: { findFirst: ReturnType<typeof vi.fn> };
  domainLeadAssignment: { findFirst: ReturnType<typeof vi.fn> };
  instructorAssignment: { findFirst: ReturnType<typeof vi.fn> };
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findFirst: ReturnType<typeof vi.fn> };
  term: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_USER_IDS;

  (mockPrisma as any).dALIMember = { findUnique: vi.fn() };
  (mockPrisma as any).adminMembership = { findUnique: vi.fn() };
  (mockPrisma as any).coreAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).domainLeadAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).instructorAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).cycleReviewer = { findFirst: vi.fn() };
  (mockPrisma as any).cycleInterviewer = { findFirst: vi.fn() };
  // Core access scopes to the current Term; default to one being present so
  // a Core assignment in setRoleFlags is treated as current-term Core.
  (mockPrisma as any).term = {
    findFirst: vi.fn().mockResolvedValue({ id: "term-1" }),
  };
  // Alumni derivation / tier resolver additions.
  (mockPrisma as any).user = { findUnique: vi.fn() };
  (mockPrisma as any).projectAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).partnerUser = { findUnique: vi.fn() };
  // Default: no assignments anywhere. Individual tests override as needed.
  (mockPrisma as any).projectAssignment.findFirst.mockResolvedValue(null);
  (mockPrisma as any).coreAssignment.findFirst.mockResolvedValue(null);
  (mockPrisma as any).instructorAssignment.findFirst.mockResolvedValue(null);
  (mockPrisma as any).domainLeadAssignment.findFirst.mockResolvedValue(null);
  (mockPrisma as any).partnerUser.findUnique.mockResolvedValue(null);
});

const CYCLE_ID = "cycle-1";

// Helper — set up the typical "is a lab member" baseline.
function setRoleFlags(opts: { member?: boolean; admin?: boolean; core?: boolean; domainLead?: boolean; instructor?: boolean } = {}) {
  mockPrisma.dALIMember.findUnique.mockResolvedValue(opts.member !== false ? { id: "m1" } : null);
  mockPrisma.adminMembership.findUnique.mockResolvedValue(opts.admin ? { id: "a1" } : null);
  mockPrisma.coreAssignment.findFirst.mockResolvedValue(opts.core ? { id: "c1" } : null);
  mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(opts.domainLead ? { id: "d1" } : null);
  mockPrisma.instructorAssignment.findFirst.mockResolvedValue(opts.instructor ? { id: "i1" } : null);
}

describe("hasCycleAccess", () => {
  it("returns true for a hiring lead (via ADMIN_USER_IDS)", async () => {
    process.env.ADMIN_USER_IDS = "admin-user";
    setRoleFlags({ member: true });

    const result = await hasCycleAccess("admin-user", CYCLE_ID);

    expect(result).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.cycleInterviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a hiring lead (via Core assignment)", async () => {
    setRoleFlags({ member: true, core: true });

    expect(await hasCycleAccess("user-hl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a domain lead", async () => {
    setRoleFlags({ member: true, domainLead: true });

    expect(await hasCycleAccess("user-dl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a cycle reviewer", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue({ id: "cr-1" });
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-reviewer", CYCLE_ID)).toBe(true);
  });

  it("returns true for a cycle interviewer", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue({ id: "ci-1" });

    expect(await hasCycleAccess("user-interviewer", CYCLE_ID)).toBe(true);
  });

  it("returns false for a member who is neither lead nor participant", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-nobody", CYCLE_ID)).toBe(false);
  });

  it("returns false for a non-member (no DALIMember record)", async () => {
    setRoleFlags({ member: false });

    const result = await hasCycleAccess("applicant-user", CYCLE_ID);

    expect(result).toBe(false);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns false for a reviewer on a different cycle", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-wrong-cycle", CYCLE_ID)).toBe(false);
  });
});

describe("isInstructor", () => {
  it("returns true with any InstructorAssignment row", async () => {
    setRoleFlags({ instructor: true });
    expect(await isInstructor("user-inst")).toBe(true);
  });

  it("returns false with no InstructorAssignment row", async () => {
    setRoleFlags({ instructor: false });
    expect(await isInstructor("user-x")).toBe(false);
  });
});

describe("canViewForms (Core, Admin, or Instructor)", () => {
  it("true for Core", async () => {
    setRoleFlags({ core: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("true for Admin", async () => {
    setRoleFlags({ admin: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("true for Instructor (not Core/Admin)", async () => {
    setRoleFlags({ instructor: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("false for a plain member", async () => {
    setRoleFlags({ member: true });
    expect(await canViewForms("u")).toBe(false);
  });
});

describe("canViewStaffing (Core or Admin only)", () => {
  it("true for Core", async () => {
    setRoleFlags({ core: true });
    expect(await canViewStaffing("u")).toBe(true);
  });

  it("true for Admin", async () => {
    setRoleFlags({ admin: true });
    expect(await canViewStaffing("u")).toBe(true);
  });

  it("false for Instructor without Core/Admin", async () => {
    setRoleFlags({ instructor: true });
    expect(await canViewStaffing("u")).toBe(false);
  });

  it("false for a plain member", async () => {
    setRoleFlags({ member: true });
    expect(await canViewStaffing("u")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Alumni derivation
// ───────────────────────────────────────────────────────────────────────────

// Helper: simulate "has past assignments, none current" by inspecting the
// where clause. Past queries pass `NOT: { termId }`; current queries pass
// `termId` directly.
function mockPastOnlyAssignment() {
  (mockPrisma as any).projectAssignment.findFirst.mockImplementation(
    (args: { where: Record<string, unknown> }) => {
      const w = args.where as { NOT?: unknown; termId?: unknown };
      return w.NOT !== undefined ? { id: "past-p" } : null;
    },
  );
}

type AlumniMockUser = {
  classYear: number | null;
  graduatedAt: Date | null;
  dartmouthAffiliation: string | null;
  dartmouthLookupAffiliation: string | null;
  dartmouthLookupSyncedAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function setUser(u: Partial<AlumniMockUser>) {
  const base: AlumniMockUser = {
    classYear: null,
    graduatedAt: null,
    dartmouthAffiliation: null,
    dartmouthLookupAffiliation: null,
    dartmouthLookupSyncedAt: null,
  };
  (mockPrisma as any).user.findUnique.mockResolvedValue({ ...base, ...u });
}

describe("standardGradDate", () => {
  it("returns June 15 of the given class year", () => {
    expect(standardGradDate(2026)).toEqual(new Date(2026, 5, 15));
    expect(standardGradDate(2027)).toEqual(new Date(2027, 5, 15));
  });
});

describe("isAlumni — Tier 1: People API ALUMNI", () => {
  it("returns true regardless of other signals", async () => {
    setUser({
      dartmouthAffiliation: "ALUMNI",
      // Even with a current assignment elsewhere, Tier 1 wins.
      classYear: 2030,
    });
    (mockPrisma as any).projectAssignment.findFirst.mockResolvedValue({ id: "p1" });
    expect(await isAlumni("u-alumni-1")).toBe(true);
  });
});

describe("isAlumni — Tier 2: explicit graduatedAt", () => {
  it("returns true when graduatedAt is in the past", async () => {
    setUser({ graduatedAt: new Date(Date.now() - 30 * DAY_MS) });
    expect(await isAlumni("u-grad")).toBe(true);
  });

  it("returns false when graduatedAt is in the future", async () => {
    setUser({ graduatedAt: new Date(Date.now() + 30 * DAY_MS), classYear: null });
    expect(await isAlumni("u-future-grad")).toBe(false);
  });
});

describe("isAlumni — Tier 3: lookup-says-Student override", () => {
  it("returns false when lookup says Student and sync is fresh, even with past classYear", async () => {
    // 5th-year senior case: classYear is past, but Dartmouth still lists
    // them as a Student in the public directory.
    setUser({
      classYear: 2025,
      dartmouthLookupAffiliation: "Student",
      dartmouthLookupSyncedAt: new Date(Date.now() - 1 * DAY_MS),
    });
    // Has past + would otherwise qualify under Tier 4.
    (mockPrisma as any).projectAssignment.findFirst.mockResolvedValue({ id: "p1" });
    expect(await isAlumni("u-5th-year")).toBe(false);
  });

  it("falls through to Tier 4 when lookup is stale (> 14 days old)", async () => {
    setUser({
      classYear: 2025,
      dartmouthLookupAffiliation: "Student",
      dartmouthLookupSyncedAt: new Date(Date.now() - 30 * DAY_MS),
    });
    mockPastOnlyAssignment();
    expect(await isAlumni("u-stale")).toBe(true);
  });
});

describe("isAlumni — Tier 4: classYear math + assignment history", () => {
  it("returns true when classYear is past, has past assignment, no current", async () => {
    setUser({ classYear: 2024 });
    mockPastOnlyAssignment();
    expect(await isAlumni("u-tier4")).toBe(true);
  });

  it("returns false when classYear is in the future (on-leave case)", async () => {
    setUser({ classYear: 2030 });
    mockPastOnlyAssignment();
    expect(await isAlumni("u-on-leave")).toBe(false);
  });

  it("returns false when classYear is past but no assignment history exists", async () => {
    setUser({ classYear: 2020 });
    // All assignment lookups return null.
    expect(await isAlumni("u-orphan-classyear")).toBe(false);
  });

  it("returns false when there is a current-term assignment (still active)", async () => {
    setUser({ classYear: 2024 });
    // First call (past) → null, second (current) → row. But our impl runs
    // past+current in parallel — past query excludes current termId. We
    // simulate a "has only current" member by returning null for the
    // past query and a row for the current query.
    let projectCall = 0;
    (mockPrisma as any).projectAssignment.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) => {
        projectCall++;
        // The past query carries NOT.termId; the current query has termId
        // set directly. Distinguish on that.
        const w = args.where as { NOT?: unknown; termId?: unknown };
        return w.NOT !== undefined ? null : { id: "current-p" };
      },
    );
    expect(await isAlumni("u-still-current")).toBe(false);
    expect(projectCall).toBeGreaterThan(0);
  });

  it("returns false when classYear is null and no other signals fired", async () => {
    setUser({ classYear: null });
    expect(await isAlumni("u-no-classyear")).toBe(false);
  });

  it("returns false when the User row does not exist", async () => {
    (mockPrisma as any).user.findUnique.mockResolvedValue(null);
    expect(await isAlumni("u-missing")).toBe(false);
  });
});

describe("getUserRoles — isAlumni field", () => {
  it("includes isAlumni: true when derivation returns true", async () => {
    setRoleFlags({ member: true });
    setUser({ dartmouthAffiliation: "ALUMNI" });
    const roles = await getUserRoles("u");
    expect(roles.isAlumni).toBe(true);
  });

  it("includes isAlumni: false when no signal fires", async () => {
    setRoleFlags({ member: true });
    setUser({ classYear: null });
    const roles = await getUserRoles("u");
    expect(roles.isAlumni).toBe(false);
  });

  it("flips isLabMember to false for an alumnus with a DALIMember row", async () => {
    // Past member: DALIMember row still exists, but they've graduated.
    // Route guards key off isLabMember, so this must go false.
    setRoleFlags({ member: true });
    setUser({ dartmouthAffiliation: "ALUMNI" });
    const roles = await getUserRoles("u");
    expect(roles.isAlumni).toBe(true);
    expect(roles.isLabMember).toBe(false);
  });

  it("keeps isLabMember true for an active member who is not alumni", async () => {
    setRoleFlags({ member: true });
    setUser({ classYear: null });
    const roles = await getUserRoles("u");
    expect(roles.isLabMember).toBe(true);
  });

  it("zeros out lingering role flags for pure alumni", async () => {
    // A member who was a past-term instructor + domain-lead has graduated.
    // Those *Assignment rows persist (we don't delete history), but neither
    // flag should still grant authority post-grad.
    setRoleFlags({ member: true, instructor: true, domainLead: true });
    setUser({ dartmouthAffiliation: "ALUMNI" });
    const roles = await getUserRoles("u");
    expect(roles.isAlumni).toBe(true);
    expect(roles.isInstructor).toBe(false);
    expect(roles.isDomainLead).toBe(false);
    expect(roles.canViewForms).toBe(false);
  });

  it("preserves Admin authority for an alumnus who is also an Admin", async () => {
    // A former member rehired as full-time staff: AdminMembership row exists,
    // classYear math says alumni. Admin authority wins.
    setRoleFlags({ member: true, admin: true });
    setUser({ dartmouthAffiliation: "ALUMNI" });
    const roles = await getUserRoles("u");
    expect(roles.isAlumni).toBe(true);
    expect(roles.isAdmin).toBe(true);
    expect(roles.isCore).toBe(true); // Admin is a superset of Core
    expect(roles.isLabMember).toBe(true); // not a "pure" alumnus
  });
});

// ───────────────────────────────────────────────────────────────────────────
// tier resolver
// ───────────────────────────────────────────────────────────────────────────

describe("tier", () => {
  it("returns Admin for an AdminMembership holder", async () => {
    setRoleFlags({ admin: true });
    setUser({});
    expect(await tier("u")).toBe("Admin");
  });

  it("returns Core for a current-term Core assignment", async () => {
    setRoleFlags({ core: true });
    setUser({});
    expect(await tier("u")).toBe("Core");
  });

  it("returns Member for a current-term project assignment", async () => {
    setRoleFlags({ member: true });
    setUser({});
    (mockPrisma as any).projectAssignment.findFirst.mockResolvedValue({ id: "p1" });
    expect(await tier("u")).toBe("Member");
  });

  it("returns Alumni when isAlumni is true and not Admin/Core/active", async () => {
    setRoleFlags({ member: true });
    setUser({ dartmouthAffiliation: "ALUMNI" });
    // No current assignment, so we fall past Member into Alumni.
    expect(await tier("u")).toBe("Alumni");
  });

  it("returns Partner for a PartnerUser with no other roles", async () => {
    setRoleFlags({ member: false });
    setUser({});
    (mockPrisma as any).partnerUser.findUnique.mockResolvedValue({ id: "pu1" });
    expect(await tier("u")).toBe("Partner");
  });

  it("returns Student as the catch-all", async () => {
    setRoleFlags({ member: false });
    setUser({});
    expect(await tier("u")).toBe("Student");
  });
});
