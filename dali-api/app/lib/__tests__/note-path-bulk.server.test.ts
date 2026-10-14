import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn() },
    groupDefinition: { findUnique: vi.fn() },
    project: { findUnique: vi.fn(), findMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));
vi.mock("~/lib/pageAccess.server", () => ({
  MAX_ANCESTOR_WALK: 8,
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
  governingScopeMap: vi.fn(() => new Map()),
}));

import { prisma } from "~/lib/db";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { notebookLocationParts, notebookLocationPartsBulk } from "~/lib/note-path.server";

const m = prisma as any;

const page = (id: string, title: string, parentPageId: string | null, over: Record<string, unknown> = {}) => ({
  id,
  title,
  parentPageId,
  iconEmoji: null,
  scopeKind: null,
  scopeGroupId: null,
  folderType: null,
  processType: null,
  processId: null,
  workspaceType: "Lab",
  workspaceId: null,
  archivedAt: null,
  ...over,
});
const group = { scopeKind: "Group", scopeGroupId: "core-grp" };

const TREE: Record<string, ReturnType<typeof page>> = Object.fromEntries(
  [
    page("lab-folder", "Team Notes", null),
    page("lab-nested", "Meetings", "lab-folder"),
    page("untitled", "", null),
    page("core-root", "Core", null, { ...group, folderType: "Root", processType: "Core", processId: "core" }),
    page("core-child", "Agreements", "core-root", group),
    page("core-grandchild", "2026", "core-child", group),
    page("hiring-root", "Hiring", null, { ...group, folderType: "Root", processType: "HiringCycle", processId: "hiring" }),
    page("mentor-root", "Mentorship", null, {
      scopeKind: "Group",
      scopeGroupId: "mentors-grp",
      folderType: "Root",
      processType: "Mentorship",
      processId: "mentorship",
    }),
    page("mentor-notes", "Notes", "mentor-root"),
    page("reparented-core", "Old Core", null, group),
    page("proj-folder", "Team meeting notes", null, { workspaceType: "Project", workspaceId: "p1" }),
    page("proj-nested", "2026", "proj-folder", { workspaceType: "Project", workspaceId: "p1" }),
    page("edu-folder", "Forms", null, { workspaceType: "EducationOffering", workspaceId: "o1" }),
    page("mem-folder", "Private", null, { workspaceType: "Member", workspaceId: "u1" }),
    page("archived", "Old Stuff", null, { archivedAt: new Date("2026-01-01") }),
  ].map((p) => [p.id, p]),
);

const PROJECTS: Record<string, string> = { p1: "Cortex", p2: "Atlas" };

type NB = { id: string; parentPageId: string | null; workspaceType: string; workspaceId: string | null };
const nb = (id: string, parentPageId: string | null, workspaceType = "Lab", workspaceId: string | null = null): NB => ({
  id,
  parentPageId,
  workspaceType,
  workspaceId,
});

const CASES: NB[] = [
  nb("lab-root", null),
  nb("lab-folder", "lab-folder"),
  nb("lab-nested", "lab-nested"),
  nb("untitled", "untitled"),
  nb("core-direct", "core-root"),
  nb("core-child", "core-child"),
  nb("core-deep", "core-grandchild"),
  nb("hiring", "hiring-root"),
  nb("mentor", "mentor-notes"),
  nb("reparented", "reparented-core"),
  nb("proj-top", null, "Project", "p1"),
  nb("proj-folder", "proj-folder", "Project", "p1"),
  nb("proj-nested", "proj-nested", "Project", "p1"),
  nb("proj-other", "proj-folder", "Project", "p2"),
  nb("proj-unnamed", null, "Project", "p-gone"),
  nb("edu", "edu-folder", "EducationOffering", "o1"),
  nb("mine", "mem-folder", "Member", "u1"),
  nb("archived", "archived"),
  nb("dangling", "no-such-folder"),
];

let denied = new Set<string>();

beforeEach(() => {
  vi.resetAllMocks();
  denied = new Set();
  m.groupDefinition.findUnique.mockResolvedValue({ id: "core-grp" });
  m.page.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(TREE[where.id] ?? null));
  m.project.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(PROJECTS[where.id] ? { name: PROJECTS[where.id] } : null),
  );
  m.project.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.filter((id) => PROJECTS[id]).map((id) => ({ id, name: PROJECTS[id] }))),
  );
  m.$queryRawUnsafe.mockImplementation((sql: string, ids: string[]) => {
    const limit = Number(/"depth" \+ 1 < (\d+)/.exec(sql)![1]);
    return Promise.resolve(
      ids.flatMap((startId) => {
        const rows = [];
        for (let cur = TREE[startId]; cur && rows.length < limit; cur = cur.parentPageId ? TREE[cur.parentPageId] : (undefined as never)) {
          rows.push({ startId, ...cur });
        }
        return rows;
      }),
    );
  });
  vi.mocked(getPageAccess).mockImplementation((async (_u: string, id: string) => ({
    canView: !denied.has(id),
    canEdit: false,
    canComment: false,
  })) as never);
  vi.mocked(getPageAccessBulk).mockImplementation((async (_u: string, pages: { id: string }[]) =>
    new Map(pages.map((p) => [p.id, { canView: !denied.has(p.id), canEdit: false, canComment: false }]))) as never);
});

async function singles(notebooks: NB[]) {
  return new Map(await Promise.all(notebooks.map(async (n) => [n.id, await notebookLocationParts(n, "viewer")] as const)));
}

describe("notebookLocationPartsBulk", () => {
  it("gives every notebook the path the single lookup gives it", async () => {
    expect(await notebookLocationPartsBulk(CASES, "viewer")).toEqual(await singles(CASES));
  });

  it.each([
    ["lab top level", "lab-root", ["General"]],
    ["a lab folder", "lab-nested", ["General", "Team Notes", "Meetings"]],
    ["an untitled folder", "untitled", ["General", "Untitled folder"]],
    ["a nested core folder", "core-deep", ["Core", "Agreements", "2026"]],
    ["the core receiver", "core-direct", ["Core"]],
    ["hiring", "hiring", ["Hiring"]],
    ["a not-yet-reparented core folder", "reparented", ["Core", "Old Core"]],
    ["a project", "proj-top", ["Projects", "Cortex"]],
    ["a project folder", "proj-nested", ["Projects", "Cortex", "Team meeting notes", "2026"]],
    ["a project whose name is gone", "proj-unnamed", ["Projects"]],
    ["an education offering", "edu", ["Education", "Forms"]],
    ["my drive", "mine", ["My Drive", "Private"]],
    ["an archived folder", "archived", ["General"]],
    ["a folder that no longer exists", "dangling", ["General"]],
  ])("names the path of %s", async (_label, id, expected) => {
    expect((await notebookLocationPartsBulk(CASES, "viewer")).get(id)).toEqual(expected);
  });

  it("agrees with the single lookup when the viewer cannot open the core folders", async () => {
    denied = new Set(["core-root", "core-child", "mentor-root", "reparented-core", "lab-folder", "proj-folder"]);
    const bulk = await notebookLocationPartsBulk(CASES, "viewer");
    expect(bulk).toEqual(await singles(CASES));
    expect(bulk.get("core-deep")).toEqual(["General", "2026"]);
    expect(bulk.get("core-direct")).toEqual(["General"]);
    expect(bulk.get("lab-nested")).toEqual(["General", "Meetings"]);
  });

  it("returns an empty map for no notebooks without querying", async () => {
    expect(await notebookLocationPartsBulk([], "viewer")).toEqual(new Map());
    expect(m.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(m.groupDefinition.findUnique).not.toHaveBeenCalled();
  });

  it.each([2, 40])("resolves %i notebooks with the same fixed set of queries", async (count) => {
    const folders = ["lab-folder", "lab-nested", "core-child", "proj-nested", "edu-folder", "mem-folder"];
    const notebooks = Array.from({ length: count }, (_, i) =>
      i % 2 ? nb(`n${i}`, folders[i % folders.length]) : nb(`n${i}`, "proj-nested", "Project", i % 4 ? "p1" : "p2"),
    );

    await notebookLocationPartsBulk(notebooks, "viewer");

    expect(m.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(m.groupDefinition.findUnique).toHaveBeenCalledTimes(1);
    expect(getPageAccessBulk).toHaveBeenCalledTimes(1);
    expect(m.project.findMany).toHaveBeenCalledTimes(1);
    expect(m.page.findUnique).not.toHaveBeenCalled();
    expect(m.project.findUnique).not.toHaveBeenCalled();
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("asks for each distinct folder's ancestry once", async () => {
    await notebookLocationPartsBulk([nb("a", "lab-nested"), nb("b", "lab-nested"), nb("c", null)], "viewer");

    expect(m.$queryRawUnsafe.mock.calls[0][1]).toEqual(["lab-nested"]);
  });

  it("looks up no projects when no notebook is in one", async () => {
    await notebookLocationPartsBulk([nb("a", "lab-folder")], "viewer");

    expect(m.project.findMany).not.toHaveBeenCalled();
  });

  it("hands the page-access check the viewer and the request", async () => {
    const request = new Request("http://os.test/api/notebooks");
    await notebookLocationPartsBulk([nb("a", "lab-folder")], "viewer", request);

    expect(vi.mocked(getPageAccessBulk).mock.calls[0][0]).toBe("viewer");
    expect(vi.mocked(getPageAccessBulk).mock.calls[0][2]).toBe(request);
  });
});
