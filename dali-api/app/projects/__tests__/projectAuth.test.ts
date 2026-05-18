import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    term: { findUnique: vi.fn() },
    projectAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  isAdmin: vi.fn(),
  isCore: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { currentTerm, isAdmin, isCore } from "~/lib/roles";
import {
  getProjectMembership,
  canCreateProject,
  requireProjectArchiver,
  requireProjectSettingsEditor,
  requireProjectEditor,
} from "../../lib/projectAuth";

const mockPrisma = prisma as unknown as {
  term: { findUnique: ReturnType<typeof vi.fn> };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.resetAllMocks();
  (currentTerm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "term1",
  });
  (isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  (isCore as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
});

describe("getProjectMembership", () => {
  it("returns no privileges for an outsider", async () => {
    const m = await getProjectMembership("u1", "p1");
    expect(m).toEqual({
      isMember: false,
      isPM: false,
      isCore: false,
      isAdmin: false,
      canEdit: false,
      canEditSettings: false,
      canArchive: false,
    });
  });

  it("marks a project member as canEdit but not canEditSettings", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { domain: { code: "Fullstack" } },
    ]);
    const m = await getProjectMembership("u1", "p1");
    expect(m.isMember).toBe(true);
    expect(m.isPM).toBe(false);
    expect(m.canEdit).toBe(true);
    expect(m.canEditSettings).toBe(false);
    expect(m.canArchive).toBe(false);
  });

  it("marks a PM as canEditSettings but not canArchive", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { domain: { code: "PM" } },
    ]);
    const m = await getProjectMembership("u1", "p1");
    expect(m.isPM).toBe(true);
    expect(m.canEditSettings).toBe(true);
    expect(m.canArchive).toBe(false);
  });

  it("Core gets canEdit and canEditSettings and canArchive even without an assignment", async () => {
    (isCore as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const m = await getProjectMembership("u1", "p1");
    expect(m.canEdit).toBe(true);
    expect(m.canEditSettings).toBe(true);
    expect(m.canArchive).toBe(true);
  });

  it("Admin gets all privileges", async () => {
    (isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const m = await getProjectMembership("u1", "p1");
    expect(m.isAdmin).toBe(true);
    expect(m.canArchive).toBe(true);
  });

  it("falls back to current term when termId not provided", async () => {
    await getProjectMembership("u1", "p1");
    expect(currentTerm).toHaveBeenCalled();
  });
});

describe("require* gates", () => {
  it("requireProjectEditor throws 403 for an outsider", async () => {
    let response: Response | null = null;
    try {
      await requireProjectEditor("u1", "p1");
    } catch (err) {
      response = err as Response;
    }
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(403);
  });

  it("requireProjectSettingsEditor passes for PM", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { domain: { code: "PM" } },
    ]);
    await expect(
      requireProjectSettingsEditor("u1", "p1"),
    ).resolves.toBeTruthy();
  });

  it("requireProjectArchiver rejects PM", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { domain: { code: "PM" } },
    ]);
    let response: Response | null = null;
    try {
      await requireProjectArchiver("u1", "p1");
    } catch (err) {
      response = err as Response;
    }
    expect(response?.status).toBe(403);
  });

  it("requireProjectArchiver allows Core", async () => {
    (isCore as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await expect(requireProjectArchiver("u1", "p1")).resolves.toBeTruthy();
  });
});

describe("canCreateProject", () => {
  it("allows Admin", async () => {
    (isAdmin as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    expect(await canCreateProject("u1")).toBe(true);
  });
  it("allows Core", async () => {
    (isCore as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    expect(await canCreateProject("u1")).toBe(true);
  });
  it("rejects regular members", async () => {
    expect(await canCreateProject("u1")).toBe(false);
  });
});
