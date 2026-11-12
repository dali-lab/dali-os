import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const prisma: any = { page: { findFirst: vi.fn(), create: vi.fn() }, $executeRaw: vi.fn() };
  prisma.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/drive/lib/page-names.server", () => ({ assertUniqueName: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { assertUniqueName } from "~/drive/lib/page-names.server";
import { createLabPage, createProjectPage } from "~/lib/pages";

const m = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  m.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(m));
  m.page.findFirst.mockResolvedValue(null);
  m.page.create.mockResolvedValue({ id: "new" });
});

describe("createProjectPage names", () => {
  it("checks the name in the project folder it lands in before creating", async () => {
    await createProjectPage({ projectId: "p1", title: "Plans", createdById: "u1", parentPageId: "f1", kind: "Folder" });
    expect(assertUniqueName).toHaveBeenCalledWith({
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "f1",
      kind: "Folder",
      title: "Plans",
    });
  });

  it("defaults to a document at the project's top level", async () => {
    await createProjectPage({ projectId: "p1", title: "Plans", createdById: "u1" });
    expect(assertUniqueName).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "FreeForm", parentPageId: null }),
    );
  });

  it("creates nothing when the name is taken", async () => {
    vi.mocked(assertUniqueName).mockRejectedValue(new Error("taken"));
    await expect(createProjectPage({ projectId: "p1", title: "Plans", createdById: "u1" })).rejects.toThrow("taken");
    expect(m.page.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a meeting note", { meetingNoteId: "m1" }],
    ["a meeting whiteboard", { meetingWhiteboardId: "m1" }],
    ["an auto-grouped notebook", { notebookKey: "k" }],
  ])("leaves %s alone, since recurring meetings reuse titles", async (_n, extra) => {
    await createProjectPage({ projectId: "p1", title: "Weekly", createdById: "u1", ...extra });
    expect(assertUniqueName).not.toHaveBeenCalled();
    expect(m.page.create).toHaveBeenCalled();
  });
});

describe("createLabPage names", () => {
  it("checks the name in the lab folder it lands in before creating", async () => {
    await createLabPage({ title: "Plans", createdById: "u1", parentPageId: "f1", kind: "Notebook" });
    expect(assertUniqueName).toHaveBeenCalledWith({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "f1",
      kind: "Notebook",
      title: "Plans",
    });
  });

  it("creates nothing when the name is taken", async () => {
    vi.mocked(assertUniqueName).mockRejectedValue(new Error("taken"));
    await expect(createLabPage({ title: "Plans", createdById: "u1" })).rejects.toThrow("taken");
    expect(m.page.create).not.toHaveBeenCalled();
  });
});

describe("sibling lock", () => {
  const lockKey = () => (m.$executeRaw.mock.calls[0] as unknown[]).slice(1);

  it("locks the project folder before checking the name, so concurrent creates can't both pass", async () => {
    const order: string[] = [];
    m.$executeRaw.mockImplementation(async () => order.push("lock"));
    vi.mocked(assertUniqueName).mockImplementation(async () => {
      order.push("check");
    });
    await createProjectPage({ projectId: "p1", title: "Plans", createdById: "u1", parentPageId: "f1" });
    expect(order).toEqual(["lock", "check"]);
    expect(lockKey()).toEqual(["page-siblings:Project:p1:f1"]);
  });

  it("locks the lab top level for a top-level lab page", async () => {
    await createLabPage({ title: "Plans", createdById: "u1" });
    expect(lockKey()).toEqual(["page-siblings:Lab::"]);
  });
});
