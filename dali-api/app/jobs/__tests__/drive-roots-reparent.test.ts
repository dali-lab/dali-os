import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    groupDefinition: { findUnique: vi.fn() },
    processFolderBinding: { findMany: vi.fn() },
    page: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));
vi.mock("~/lib/drive-roots.server", () => ({ ensureAllRoots: vi.fn() }));
vi.mock("~/lib/pages", () => ({ collectSubtree: vi.fn(), MAX_PAGE_DEPTH: 6 }));

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { ensureAllRoots } from "~/lib/drive-roots.server";
import { collectSubtree } from "~/lib/pages";
import { runDriveRootsReparent } from "~/jobs/drive-roots-reparent.server";
import { JOBS } from "~/jobs/registry";

const m = prisma as any;

let tops: { id: string; title: string }[] = [];
let heights: Record<string, number> = {};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  tops = [];
  heights = {};
  m.groupDefinition.findUnique.mockResolvedValue({ id: "grp_core" });
  vi.mocked(resolveGroupMembers).mockResolvedValue(["u_b", "u_a"]);
  vi.mocked(ensureAllRoots).mockResolvedValue({ core: "root_core", hiring: "root_hiring", mentorship: "root_m" });
  m.processFolderBinding.findMany.mockResolvedValue([]);
  m.page.findMany.mockImplementation(async () => tops);
  m.page.count.mockResolvedValue(0);
  m.page.update.mockResolvedValue({});
  vi.mocked(collectSubtree).mockImplementation(async (id: string) => ({ ids: [], height: heights[id] ?? 0 }));
});

describe("drive-roots-reparent registration", () => {
  it("is registered and off by default", () => {
    const job = JOBS.find((j) => j.name === "drive-roots-reparent");
    expect(job?.enabledByDefault).toBe(false);
    expect(job?.description).toBe("One-time: moves Core-scoped top-level folders under the Core and Hiring roots.");
  });
});

describe("runDriveRootsReparent", () => {
  it("moves a Core-scoped top-level folder under the Core root by setting only its parent", async () => {
    tops = [{ id: "f1", title: "Finance" }];

    const res = await runDriveRootsReparent();

    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { parentPageId: "root_core" } });
    expect(res.items).toBe(1);
    expect(res.note).toContain("moved 1, skipped 0, already placed 0");
  });

  it("selects only live, unscoped-type, core-group Lab top-level folders", async () => {
    await runDriveRootsReparent();
    const where = m.page.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      kind: "Folder",
      archivedAt: null,
      scopeKind: "Group",
      scopeGroupId: "grp_core",
      folderType: null,
    });
  });

  it("moves a hiring-bound folder under the Hiring root", async () => {
    tops = [{ id: "forms", title: "Hiring Forms" }, { id: "f1", title: "Finance" }];
    m.processFolderBinding.findMany.mockResolvedValue([{ folderPageId: "forms" }]);

    await runDriveRootsReparent();

    expect(m.processFolderBinding.findMany.mock.calls[0][0].where).toMatchObject({
      processType: "HiringCycle",
      processId: "hiring",
    });
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "forms" }, data: { parentPageId: "root_hiring" } });
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { parentPageId: "root_core" } });
  });

  it("skips a folder whose subtree would pass the depth limit and reports it", async () => {
    tops = [{ id: "deep", title: "Deep" }, { id: "ok", title: "Fine" }];
    heights = { deep: 6, ok: 5 };

    const res = await runDriveRootsReparent();

    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "ok" }, data: { parentPageId: "root_core" } });
    expect(res.note).toContain("moved 1, skipped 1");
    expect(res.note).toContain("Deep");
  });

  it("is a no-op on a second run, reporting what is already placed", async () => {
    tops = [];
    m.page.count.mockResolvedValue(4);

    const res = await runDriveRootsReparent();

    expect(m.page.update).not.toHaveBeenCalled();
    expect(res.items).toBe(0);
    expect(res.note).toContain("moved 0, skipped 0, already placed 4");
    expect(m.page.count.mock.calls[0][0].where.parentPageId).toEqual({ in: ["root_core", "root_hiring"] });
  });

  it("creates the roots as the first Core member by id", async () => {
    await runDriveRootsReparent();
    expect(ensureAllRoots).toHaveBeenCalledWith("u_a");
  });

  it("aborts without touching anything when there are no Core members", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValue([]);
    const res = await runDriveRootsReparent();
    expect(res.items).toBe(0);
    expect(res.note).toMatch(/no current Core members/);
    expect(ensureAllRoots).not.toHaveBeenCalled();
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("aborts when the Core group does not exist", async () => {
    m.groupDefinition.findUnique.mockResolvedValue(null);
    const res = await runDriveRootsReparent();
    expect(res.note).toMatch(/Core group/);
    expect(ensureAllRoots).not.toHaveBeenCalled();
  });
});
