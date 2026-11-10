import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  clearReceiver,
  clearTypeIfLeavingRoot,
  findReceiver,
  folderPath,
  isUnderRoot,
  projectSlot,
  ReceiverError,
  resolveFilingFolder,
  setReceiver,
  singletonSlot,
} from "~/lib/drive-receivers.server";
import { makePage, makeProject, makeUser } from "./integration-fixtures.docs";

const coreSlot = singletonSlot("Core", "Meetings");

async function coreRoot(userId: string) {
  return makePage(userId, { title: "Core", kind: "Folder", folderType: "Root", processType: "Core", processId: "core" });
}

async function folder(userId: string, parentPageId: string | null, title = "F") {
  return makePage(userId, { title, kind: "Folder", parentPageId });
}

async function reload(id: string) {
  return prisma.page.findUniqueOrThrow({ where: { id } });
}

describe("setReceiver", () => {
  it("marks the folder, records an audit event, and findReceiver resolves it", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const f = await folder(u.id, root.id);
    await setReceiver(coreSlot, f.id, u.id);
    expect(await reload(f.id)).toMatchObject({ folderType: "Meetings", processType: "Core", processId: "core" });
    expect(await findReceiver(coreSlot)).toBe(f.id);
    const audit = await prisma.auditLog.findMany({ where: { action: "page.receiver", targetId: f.id } });
    expect(audit).toHaveLength(1);
  });

  it("re-pointing clears the previous folder in the same step", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const a = await folder(u.id, root.id, "A");
    const b = await folder(u.id, root.id, "B");
    await setReceiver(coreSlot, a.id, u.id);
    await setReceiver(coreSlot, b.id, u.id);
    expect(await reload(a.id)).toMatchObject({ folderType: null, processType: null, processId: null });
    expect(await findReceiver(coreSlot)).toBe(b.id);
    expect(await prisma.page.count({ where: { folderType: "Meetings", archivedAt: null } })).toBe(1);
  });

  it("is a no-op when the folder already holds that slot", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const f = await folder(u.id, root.id);
    await setReceiver(coreSlot, f.id, u.id);
    await setReceiver(coreSlot, f.id, u.id);
    expect(await prisma.auditLog.count({ where: { action: "page.receiver" } })).toBe(1);
  });

  it("refuses a folder outside the tree it files for, an archived one, a root, and one already typed elsewhere", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const stray = await folder(u.id, null, "Stray");
    await expect(setReceiver(coreSlot, stray.id, u.id)).rejects.toBeInstanceOf(ReceiverError);

    const gone = await makePage(u.id, { kind: "Folder", parentPageId: root.id, archivedAt: new Date() });
    await expect(setReceiver(coreSlot, gone.id, u.id)).rejects.toThrow(/trash/);
    await expect(setReceiver(coreSlot, root.id, u.id)).rejects.toThrow(/root/);

    const agreements = await folder(u.id, root.id, "Agr");
    await setReceiver(singletonSlot("Core", "Agreements"), agreements.id, u.id);
    await expect(setReceiver(coreSlot, agreements.id, u.id)).rejects.toMatchObject({ status: 409 });
    expect(await findReceiver(coreSlot)).toBeNull();
  });

  it("racing two folders for one slot leaves exactly one live receiver", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const a = await folder(u.id, root.id, "A");
    const b = await folder(u.id, root.id, "B");
    const results = await Promise.allSettled([
      setReceiver(coreSlot, a.id, u.id),
      setReceiver(coreSlot, b.id, u.id),
    ]);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ReceiverError);
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.page.count({ where: { folderType: "Meetings", processType: "Core", archivedAt: null } })).toBe(1);
  });

  it("the database forbids two live receivers for a slot but allows an archived duplicate", async () => {
    const u = await makeUser();
    const mark = { kind: "Folder" as const, folderType: "Meetings" as const, processType: "Core" as const, processId: "core" };
    await makePage(u.id, mark);
    await expect(makePage(u.id, mark)).rejects.toMatchObject({ code: "P2002" });
    await expect(makePage(u.id, { ...mark, archivedAt: new Date() })).resolves.toBeDefined();
  });
});

describe("project receivers", () => {
  it("only accepts a folder inside that project's workspace", async () => {
    const u = await makeUser();
    const p1 = await makeProject("One");
    const p2 = await makeProject("Two");
    const inP1 = await makePage(u.id, { kind: "Folder", workspaceType: "Project", workspaceId: p1.id });
    await expect(setReceiver(projectSlot(p2.id), inP1.id, u.id)).rejects.toBeInstanceOf(ReceiverError);
    await setReceiver(projectSlot(p1.id), inP1.id, u.id);
    expect(await findReceiver(projectSlot(p1.id))).toBe(inP1.id);
    expect(await findReceiver(projectSlot(p2.id))).toBeNull();
  });
});

describe("clearReceiver", () => {
  it("returns the cleared id, resets the columns, and is null when nothing is set", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const f = await folder(u.id, root.id);
    expect(await clearReceiver(coreSlot, u.id)).toBeNull();
    await setReceiver(coreSlot, f.id, u.id);
    expect(await clearReceiver(coreSlot, u.id)).toBe(f.id);
    expect(await reload(f.id)).toMatchObject({ folderType: null, processType: null, processId: null });
  });
});

describe("clearTypeIfLeavingRoot", () => {
  it("clears a receiver moved out of its tree and keeps one that stayed", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const stays = await folder(u.id, root.id, "Stays");
    const leaves = await folder(u.id, root.id, "Leaves");
    await setReceiver(singletonSlot("Core", "Meetings"), stays.id, u.id);
    await setReceiver(singletonSlot("Core", "Agreements"), leaves.id, u.id);
    await prisma.page.update({ where: { id: leaves.id }, data: { parentPageId: null } });

    expect(await clearTypeIfLeavingRoot([stays.id, leaves.id])).toEqual([leaves.id]);
    expect(await reload(leaves.id)).toMatchObject({ folderType: null, processType: null });
    expect((await reload(stays.id)).folderType).toBe("Meetings");
  });

  it("checks a project receiver by workspace, not by ancestry", async () => {
    const u = await makeUser();
    const p1 = await makeProject("One");
    const p2 = await makeProject("Two");
    const f = await makePage(u.id, { kind: "Folder", workspaceType: "Project", workspaceId: p1.id });
    await setReceiver(projectSlot(p1.id), f.id, u.id);
    await prisma.page.update({ where: { id: f.id }, data: { workspaceId: p2.id } });
    expect(await clearTypeIfLeavingRoot([f.id])).toEqual([f.id]);
    expect(await clearTypeIfLeavingRoot([])).toEqual([]);
  });
});

describe("resolveFilingFolder", () => {
  it("prefers a set receiver", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const f = await folder(u.id, root.id);
    await setReceiver(coreSlot, f.id, u.id);
    expect(await resolveFilingFolder(coreSlot, u.id)).toEqual({ folderId: f.id, viaReceiver: true });
  });

  it("falls back to the process root when no receiver is set", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    expect(await resolveFilingFolder(coreSlot, u.id)).toEqual({ folderId: root.id, viaReceiver: false });
  });

  it("returns no folder for a process without a root and no receiver", async () => {
    const u = await makeUser();
    expect(await resolveFilingFolder(singletonSlot("Lab", "Meetings"), u.id)).toEqual({ folderId: null, viaReceiver: false });
  });

  it("creates a project's Meetings receiver once, even when called concurrently", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const results = await Promise.all(Array.from({ length: 6 }, () => resolveFilingFolder(projectSlot(proj.id), u.id)));
    expect(new Set(results.map((r) => r.folderId)).size).toBe(1);
    expect(results.every((r) => r.viaReceiver)).toBe(true);
    const live = await prisma.page.findMany({ where: { workspaceId: proj.id, folderType: "Meetings", archivedAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ title: "Meetings", processType: "Project", processId: proj.id, parentPageId: null });
  });

  it("adopts an existing top-level untyped Meetings folder instead of duplicating it", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const existing = await makePage(u.id, { title: "Meetings", kind: "Folder", workspaceType: "Project", workspaceId: proj.id });
    const { folderId } = await resolveFilingFolder(projectSlot(proj.id), u.id);
    expect(folderId).toBe(existing.id);
    expect((await reload(existing.id)).folderType).toBe("Meetings");
    expect(await prisma.page.count({ where: { workspaceId: proj.id } })).toBe(1);
  });

  it("does not leak one project's receiver to another", async () => {
    const u = await makeUser();
    const p1 = await makeProject("One");
    const p2 = await makeProject("Two");
    const a = await resolveFilingFolder(projectSlot(p1.id), u.id);
    const b = await resolveFilingFolder(projectSlot(p2.id), u.id);
    expect(a.folderId).not.toBe(b.folderId);
  });
});

describe("folderPath and isUnderRoot", () => {
  it("returns the path root first and recognises the tree", async () => {
    const u = await makeUser();
    const root = await coreRoot(u.id);
    const mid = await folder(u.id, root.id, "Mid");
    const leaf = await folder(u.id, mid.id, "Leaf");
    expect(await folderPath(leaf.id)).toEqual([
      { id: root.id, title: "Core" },
      { id: mid.id, title: "Mid" },
      { id: leaf.id, title: "Leaf" },
    ]);
    expect(await isUnderRoot(leaf.id, { processType: "Core", processId: "core" })).toBe(true);
    expect(await isUnderRoot(leaf.id, { processType: "HiringCycle", processId: "hiring" })).toBe(false);
  });
});
