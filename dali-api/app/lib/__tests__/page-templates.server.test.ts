import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findMany: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { listPageTemplates } from "../page-templates.server";

const findMany = (prisma as unknown as { page: { findMany: ReturnType<typeof vi.fn> } }).page.findMany;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  findMany.mockResolvedValue([{ id: "t1", title: "Weekly 1:1", iconEmoji: null }]);
});

function queriedWhere() {
  return findMany.mock.calls[0][0].where;
}

describe("listPageTemplates — Member (private) scope", () => {
  it("lists the caller's own templates when no id is given", async () => {
    const rows = await listPageTemplates("u1", "Member", null);

    expect(rows).toEqual([{ id: "t1", title: "Weekly 1:1", iconEmoji: null }]);
    expect(queriedWhere()).toEqual({
      workspaceType: "Member",
      workspaceId: "u1",
      isTemplate: true,
      archivedAt: null,
      kind: "FreeForm",
    });
  });

  it("lists the caller's own templates when the id is their own", async () => {
    await listPageTemplates("u1", "Member", "u1");
    expect(queriedWhere()).toMatchObject({ workspaceType: "Member", workspaceId: "u1" });
  });

  it("returns nothing for another member's space", async () => {
    expect(await listPageTemplates("u1", "Member", "u2")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("gives Core no bypass into another member's space", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await listPageTemplates("core-1", "Member", "u2")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("listPageTemplates — shared scopes", () => {
  it("lists Lab templates for a lab member", async () => {
    await listPageTemplates("u1", "Lab", null);
    expect(queriedWhere()).toMatchObject({ workspaceType: "Lab", workspaceId: null, isTemplate: true });
  });

  it("returns nothing in the Lab for a non-member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect(await listPageTemplates("u1", "Lab", null)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("lists a project's templates for someone staffed on it", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    await listPageTemplates("u1", "Project", "p1");
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
    expect(queriedWhere()).toMatchObject({ workspaceType: "Project", workspaceId: "p1" });
  });

  it("returns nothing for a project the caller isn't on", async () => {
    expect(await listPageTemplates("u1", "Project", "p1")).toEqual([]);
  });

  it("returns nothing for a Project scope with no id", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await listPageTemplates("u1", "Project", null)).toEqual([]);
  });

  it("lets Core list any project's templates", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await listPageTemplates("core-1", "Project", "p1");
    expect(findMany).toHaveBeenCalled();
  });

  it("never lists archived or non-FreeForm pages", async () => {
    await listPageTemplates("u1", "Lab", null);
    expect(queriedWhere()).toMatchObject({ archivedAt: null, kind: "FreeForm" });
  });
});
