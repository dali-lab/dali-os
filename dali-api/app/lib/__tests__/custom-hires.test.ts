import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  getRoleLabel,
  instructorRoleLabel,
  projectRoleLabel,
  resolveRoleRef,
  getUserRoleInstances,
} from "~/lib/roles";

// Custom hires are the non-DALI half of role attribution: a member's outside
// job, resolvable as a TimeEntry role and exportable to JobX as its own hire.

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of [
    "projectAssignment",
    "coreAssignment",
    "instructorAssignment",
    "domainLeadAssignment",
    "customHire",
  ]) {
    mockPrisma[model]!.findMany?.mockResolvedValue([]);
  }
  mockPrisma.adminMembership!.findUnique.mockResolvedValue(null);
  mockPrisma.term!.findFirst.mockResolvedValue({ id: "term-1" });
});

describe("getRoleLabel — Custom", () => {
  it("resolves to the hire's own label", async () => {
    mockPrisma.customHire!.findUnique.mockResolvedValue({ label: "Baker Library desk" });
    expect(await getRoleLabel("Custom", "ch-1")).toBe("Baker Library desk");
  });

  it("still resolves an archived hire, so past entries keep their label", async () => {
    // getRoleLabel intentionally doesn't filter on archivedAt.
    mockPrisma.customHire!.findUnique.mockResolvedValue({ label: "Old job" });
    expect(await getRoleLabel("Custom", "ch-1")).toBe("Old job");
    expect(mockPrisma.customHire!.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ch-1" } }),
    );
  });

  it("returns null when the hire is gone", async () => {
    mockPrisma.customHire!.findUnique.mockResolvedValue(null);
    expect(await getRoleLabel("Custom", "missing")).toBeNull();
  });
});

describe("resolveRoleRef — Custom", () => {
  it("accepts a live hire the user owns, with no project attached", async () => {
    mockPrisma.customHire!.findFirst.mockResolvedValue({ id: "ch-1" });
    expect(await resolveRoleRef(USER, "Custom", "ch-1")).toEqual({ projectId: null });
  });

  it("scopes the lookup to the owner and to unarchived rows", async () => {
    mockPrisma.customHire!.findFirst.mockResolvedValue(null);
    expect(await resolveRoleRef(USER, "Custom", "ch-1")).toBeNull();
    expect(mockPrisma.customHire!.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ch-1", userId: USER, archivedAt: null },
      }),
    );
  });
});

describe("getUserRoleInstances", () => {
  it("includes custom hires alongside DALI roles", async () => {
    mockPrisma.customHire!.findMany.mockResolvedValue([
      { id: "ch-1", label: "Baker Library desk" },
    ]);
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles).toContainEqual({
      assignmentType: "Custom",
      roleRefId: "ch-1",
      label: "Baker Library desk",
    });
  });

  it("lists DALI roles before outside jobs", async () => {
    mockPrisma.coreAssignment!.findMany.mockResolvedValue([{ id: "ca-1", leadTitle: "Design" }]);
    mockPrisma.customHire!.findMany.mockResolvedValue([{ id: "ch-1", label: "Outside job" }]);
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles.map((r) => r.assignmentType)).toEqual(["Core", "Custom"]);
  });

  it("never offers Admin — it is an access grant, not a paid post", async () => {
    mockPrisma.adminMembership!.findUnique.mockResolvedValue({ id: "am-1" });
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles.map((r) => r.assignmentType)).not.toContain("Admin");
  });

  it("omits archived hires from the picker", async () => {
    mockPrisma.customHire!.findMany.mockResolvedValue([]);
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles).toEqual([]);
    expect(mockPrisma.customHire!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, archivedAt: null },
      }),
    );
  });
});

describe("instructorRoleLabel", () => {
  it("names the offering rather than the generic post", () => {
    expect(instructorRoleLabel("Workshop", "Intro to Figma")).toBe(
      "Intro to Figma (Workshop Instructor)",
    );
    expect(instructorRoleLabel("Miniseries", "Swift Bootcamp")).toBe(
      "Swift Bootcamp (Miniseries Instructor)",
    );
  });

  it("is what getRoleLabel returns for an Instructor assignment", async () => {
    mockPrisma.instructorAssignment!.findUnique.mockResolvedValue({
      offering: { title: "Design Systems", type: "Miniseries" },
    });
    expect(await getRoleLabel("Instructor", "ia-1")).toBe(
      "Design Systems (Miniseries Instructor)",
    );
  });

  it("puts one entry per offering in the role picker", async () => {
    mockPrisma.instructorAssignment!.findMany.mockResolvedValue([
      { id: "ia-1", offering: { title: "Intro to Figma", type: "Workshop" } },
      { id: "ia-2", offering: { title: "Swift Bootcamp", type: "Miniseries" } },
    ]);
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles.map((r) => r.label)).toEqual([
      "Intro to Figma (Workshop Instructor)",
      "Swift Bootcamp (Miniseries Instructor)",
    ]);
  });
});

describe("projectRoleLabel", () => {
  it("names the staffed domain, not a blanket 'Developer'", () => {
    expect(projectRoleLabel("Evergreen", "UI/UX Design", "P2")).toBe("Evergreen UI/UX Design");
    expect(projectRoleLabel("Evergreen", "Fullstack Dev", "P1")).toBe("Evergreen Fullstack Dev");
  });

  it("marks P3 as a mentor within that domain", () => {
    expect(projectRoleLabel("Evergreen", "UI/UX Design", "P3")).toBe("Evergreen UI/UX Design Mentor");
  });

  it("is what getRoleLabel returns for a Project assignment", async () => {
    mockPrisma.projectAssignment!.findUnique.mockResolvedValue({
      level: "P3",
      project: { name: "Evergreen" },
      domain: { displayName: "UI/UX Design" },
    });
    expect(await getRoleLabel("Project", "pa-1")).toBe("Evergreen UI/UX Design Mentor");
  });

  it("gives one distinct entry per domain for someone staffed in several", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      { id: "pa-1", projectId: "p-1", level: "P3", project: { name: "Evergreen" }, domain: { displayName: "UI/UX Design" } },
      { id: "pa-2", projectId: "p-1", level: "P1", project: { name: "Evergreen" }, domain: { displayName: "Fullstack Dev" } },
    ]);
    const roles = await getUserRoleInstances(USER, "term-1");
    expect(roles.map((r) => r.label)).toEqual([
      "Evergreen UI/UX Design Mentor",
      "Evergreen Fullstack Dev",
    ]);
  });
});
