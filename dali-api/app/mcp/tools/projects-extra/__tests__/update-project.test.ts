import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { runUpdateProject, UPDATE_PROJECT_TOOL, UpdateProjectError } from "~/mcp/tools/projects-extra/update-project";

const mockPrisma = prisma as unknown as {
  project: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_project", () => {
  it("requires mcp:write scope", () => {
    expect(UPDATE_PROJECT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runUpdateProject("u1", { projectId: "p1", name: "Test" }),
    ).rejects.toMatchObject({ name: "UpdateProjectError", status: 403 });
  });

  it("rejects when project is not found", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runUpdateProject("u1", { projectId: "nope", name: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects invalid status", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    await expect(
      runUpdateProject("u1", { projectId: "p1", status: "Deleted" }),
    ).rejects.toBeInstanceOf(UpdateProjectError);
  });

  it("rejects when no fields to update", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    await expect(
      runUpdateProject("u1", { projectId: "p1" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("updates name and status for Core member", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.project.update.mockResolvedValue({ id: "p1" });
    const out = await runUpdateProject("u1", { projectId: "p1", name: "New Name", status: "Active" });
    expect(out).toMatchObject({ ok: true, projectId: "p1" });
    expect(mockPrisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "New Name", status: "Active" }) }),
    );
  });

  it("allows a non-Core project member to update", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.project.update.mockResolvedValue({ id: "p1" });
    const out = await runUpdateProject("u2", { projectId: "p1", description: "hello" });
    expect(out).toMatchObject({ ok: true });
  });

  it("normalises githubTeamSlug to lowercase-hyphenated", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.project.update.mockResolvedValue({ id: "p1" });
    await runUpdateProject("u1", { projectId: "p1", githubTeamSlug: "My Cool Project!" });
    expect(mockPrisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ githubTeamSlug: "my-cool-project" }) }),
    );
  });

  it("treats empty githubTeamSlug as null", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.project.update.mockResolvedValue({ id: "p1" });
    await runUpdateProject("u1", { projectId: "p1", githubTeamSlug: "" });
    expect(mockPrisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ githubTeamSlug: null }) }),
    );
  });
});
