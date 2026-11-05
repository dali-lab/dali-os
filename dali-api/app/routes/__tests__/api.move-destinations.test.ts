import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    page: { findMany: vi.fn(), groupBy: vi.fn() },
    projectFile: { groupBy: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_r: Request, res: Response) => res,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccessBulk: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { loader } from "../api.move-destinations";

const m = prisma as any;
const run = () =>
  loader({ request: new Request("http://localhost/api/move-destinations"), params: {}, context: {} } as never) as Promise<Response>;

const folder = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  parentPageId: null,
  workspaceType: "Lab",
  workspaceId: null,
  ...over,
});
const canEdit = (ids: string[]) =>
  vi.mocked(getPageAccessBulk).mockResolvedValue(
    new Map(ids.map((id) => [id, { canEdit: true }])) as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(isCore).mockResolvedValue(false);
  m.project.findMany.mockResolvedValue([]);
  m.page.findMany.mockResolvedValue([]);
  m.page.groupBy.mockResolvedValue([]);
  m.projectFile.groupBy.mockResolvedValue([]);
  vi.mocked(getPageAccessBulk).mockResolvedValue(new Map() as never);
});

describe("GET /api/move-destinations", () => {
  it("returns the gate's response for a non-member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) } as never);
    expect((await run()).status).toBe(403);
    expect(m.project.findMany).not.toHaveBeenCalled();
  });

  it("limits a non-Core member to projects they are assigned to; Core sees all", async () => {
    await run();
    expect(m.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignments: { some: { userId: "u1" } } } }),
    );
    vi.mocked(isCore).mockResolvedValue(true);
    await run();
    expect(m.project.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it("always lists Lab-wide first, then each project, even with no folders", async () => {
    m.project.findMany.mockResolvedValue([{ id: "pr1", name: "Alpha", iconEmoji: "A" }]);
    expect(await (await run()).json()).toEqual({
      destinations: [
        { type: "Lab", id: null, label: "Lab-wide", iconEmoji: null, folders: [] },
        { type: "Project", id: "pr1", label: "Alpha", iconEmoji: "A", folders: [] },
      ],
    });
  });

  it("asks for lab folders plus folders of the caller's projects only", async () => {
    m.project.findMany.mockResolvedValue([{ id: "pr1", name: "Alpha", iconEmoji: null }]);
    await run();
    expect(m.page.findMany.mock.calls[0][0].where).toEqual({
      kind: "Folder",
      archivedAt: null,
      OR: [
        { workspaceType: "Lab", workspaceId: null },
        { workspaceType: "Project", workspaceId: { in: ["pr1"] } },
      ],
    });
  });

  it("with no projects, queries lab folders only", async () => {
    await run();
    expect(m.page.findMany.mock.calls[0][0].where.OR).toEqual([{ workspaceType: "Lab", workspaceId: null }]);
  });

  it("offers only folders the caller can EDIT (a viewable Core folder is not leaked)", async () => {
    m.page.findMany.mockResolvedValue([folder("open"), folder("core-only"), folder("view-only")]);
    vi.mocked(getPageAccessBulk).mockResolvedValue(
      new Map([
        ["open", { canEdit: true }],
        ["core-only", { canEdit: false }],
        ["view-only", { canView: true, canEdit: false }],
      ]) as never,
    );
    const body = await (await run()).json();
    expect(body.destinations[0].folders.map((f: { id: string }) => f.id)).toEqual(["open"]);
    expect(getPageAccessBulk).toHaveBeenCalledWith("u1", expect.any(Array), expect.any(Request));
  });

  it("drops a folder the access map knows nothing about", async () => {
    m.page.findMany.mockResolvedValue([folder("mystery")]);
    expect((await (await run()).json()).destinations[0].folders).toEqual([]);
  });

  it("groups folders under their project and keeps nested parents", async () => {
    m.project.findMany.mockResolvedValue([{ id: "pr1", name: "Alpha", iconEmoji: null }]);
    m.page.findMany.mockResolvedValue([
      folder("top", { workspaceType: "Project", workspaceId: "pr1" }),
      folder("child", { workspaceType: "Project", workspaceId: "pr1", parentPageId: "top" }),
    ]);
    canEdit(["top", "child"]);
    const body = await (await run()).json();
    expect(body.destinations[1].folders).toEqual([
      { id: "top", title: "top", parentId: null, itemCount: 0 },
      { id: "child", title: "child", parentId: "top", itemCount: 0 },
    ]);
    expect(body.destinations[0].folders).toEqual([]);
  });

  it("moves a folder to the drive's top level when its parent was filtered out", async () => {
    m.page.findMany.mockResolvedValue([folder("hidden-parent"), folder("child", { parentPageId: "hidden-parent" })]);
    canEdit(["child"]);
    const body = await (await run()).json();
    expect(body.destinations[0].folders).toEqual([{ id: "child", title: "child", parentId: null, itemCount: 0 }]);
  });

  it("counts child pages plus files per visible folder, only counting visible ids", async () => {
    m.page.findMany.mockResolvedValue([folder("a"), folder("b")]);
    canEdit(["a", "b"]);
    m.page.groupBy.mockResolvedValue([{ parentPageId: "a", _count: { _all: 2 } }]);
    m.projectFile.groupBy.mockResolvedValue([
      { folderPageId: "a", _count: { _all: 3 } },
      { folderPageId: "b", _count: { _all: 1 } },
    ]);
    const body = await (await run()).json();
    expect(body.destinations[0].folders.map((f: any) => [f.id, f.itemCount])).toEqual([["a", 5], ["b", 1]]);
    expect(m.page.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentPageId: { in: ["a", "b"] }, archivedAt: null } }),
    );
  });

  it("skips the count queries when nothing is visible", async () => {
    await run();
    expect(m.page.groupBy).not.toHaveBeenCalled();
    expect(m.projectFile.groupBy).not.toHaveBeenCalled();
  });
});
