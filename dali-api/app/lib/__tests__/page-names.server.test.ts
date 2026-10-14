import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findFirst: vi.fn() }, projectFile: { findFirst: vi.fn() } },
}));

import { prisma } from "~/lib/db";
import { assertUniqueName, findNameConflict, nameConflictResponse, PageNameConflictError } from "../page-names.server";

const pageFind = prisma.page.findFirst as unknown as ReturnType<typeof vi.fn>;
const fileFind = prisma.projectFile.findFirst as unknown as ReturnType<typeof vi.fn>;

const lab = { workspaceType: "Lab" as const, workspaceId: null, parentPageId: null };

beforeEach(() => {
  vi.resetAllMocks();
  pageFind.mockResolvedValue(null);
  fileFind.mockResolvedValue(null);
});

describe("findNameConflict: pages", () => {
  it("is null when no live page of that kind has the name", async () => {
    expect(await findNameConflict({ ...lab, kind: "FreeForm", title: "Notes" })).toBeNull();
  });

  it("matches the same kind, place and name, ignoring case, among live non-template pages", async () => {
    await findNameConflict({ ...lab, parentPageId: "f1", kind: "Folder", title: "  Plans " });
    expect(pageFind).toHaveBeenCalledWith({
      where: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: "f1",
        parent: { kind: { not: "Notebook" } },
        kind: "Folder",
        archivedAt: null,
        isTemplate: false,
        title: { equals: "Plans", mode: "insensitive" },
      },
      select: { id: true },
    });
    expect(fileFind).not.toHaveBeenCalled();
  });

  it("checks the top level without a parent filter", async () => {
    await findNameConflict({ ...lab, kind: "FreeForm", title: "Notes" });
    expect(pageFind.mock.calls[0][0].where).not.toHaveProperty("parent");
    expect(pageFind.mock.calls[0][0].where.parentPageId).toBeNull();
  });

  it("leaves the renamed or moved row out of the comparison", async () => {
    await findNameConflict({ ...lab, kind: "FreeForm", title: "Notes", excludeId: "p9" });
    expect(pageFind.mock.calls[0][0].where.id).toEqual({ not: "p9" });
  });

  it.each([
    ["Folder", "folder"],
    ["FreeForm", "document"],
    ["Notebook", "notebook"],
    ["Whiteboard", "whiteboard"],
    ["Form", "form"],
  ] as const)("names a %s as a %s", async (kind, label) => {
    pageFind.mockResolvedValue({ id: "other" });
    expect(await findNameConflict({ ...lab, kind, title: "Roadmap" })).toBe(
      `A ${label} named “Roadmap” already exists here`,
    );
  });

  it("exempts shortcuts without querying", async () => {
    pageFind.mockResolvedValue({ id: "other" });
    expect(await findNameConflict({ ...lab, kind: "Shortcut", title: "Roadmap" })).toBeNull();
    expect(pageFind).not.toHaveBeenCalled();
  });
});

describe("findNameConflict: files", () => {
  it("looks among live files in the folder, scoped by project id for a project", async () => {
    fileFind.mockResolvedValue({ id: "x" });
    const msg = await findNameConflict({
      workspaceType: "Project",
      workspaceId: "proj1",
      parentPageId: "f1",
      kind: "File",
      title: "report.pdf",
    });
    expect(msg).toBe("A file named “report.pdf” already exists here");
    expect(fileFind).toHaveBeenCalledWith({
      where: {
        projectId: "proj1",
        folderPageId: "f1",
        archivedAt: null,
        title: { equals: "report.pdf", mode: "insensitive" },
      },
      select: { id: true },
    });
    expect(pageFind).not.toHaveBeenCalled();
  });

  it("scopes a lab or personal file by workspace columns", async () => {
    await findNameConflict({ workspaceType: "Member", workspaceId: "u1", parentPageId: null, kind: "File", title: "a.txt" });
    expect(fileFind.mock.calls[0][0].where).toMatchObject({
      workspaceType: "Member",
      workspaceId: "u1",
      folderPageId: null,
    });
  });
});

describe("assertUniqueName", () => {
  it("resolves when the name is free", async () => {
    await expect(assertUniqueName({ ...lab, kind: "FreeForm", title: "Notes" })).resolves.toBeUndefined();
  });

  it("throws a 409 PageNameConflictError carrying the message", async () => {
    pageFind.mockResolvedValue({ id: "other" });
    const err = await assertUniqueName({ ...lab, kind: "FreeForm", title: "Notes" }).catch((e) => e);
    expect(err).toBeInstanceOf(PageNameConflictError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("A document named “Notes” already exists here");
  });
});

describe("nameConflictResponse", () => {
  it("turns the error into a 409 with the error key", async () => {
    const res = nameConflictResponse(new PageNameConflictError("A folder named “X” already exists here"))!;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A folder named “X” already exists here" });
  });

  it("ignores other errors", () => {
    expect(nameConflictResponse(new Error("boom"))).toBeNull();
  });
});
