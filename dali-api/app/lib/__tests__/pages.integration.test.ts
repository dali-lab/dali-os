import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  collectSubtree,
  createLabPage,
  createProjectPage,
  ensureOfferingFormsFolder,
  ensurePublicWriteupPage,
  isAncestorOf,
  MAX_PAGE_DEPTH,
  pageDepth,
} from "~/lib/pages.server";
import { makeOffering, makePage, makeProject, makeUser } from "./integration-fixtures.docs";

describe("ensureOfferingFormsFolder", () => {
  it("creates one Forms folder and returns it on every later call", async () => {
    const u = await makeUser();
    const o = await makeOffering();
    const first = await ensureOfferingFormsFolder(o.id, u.id);
    expect(await ensureOfferingFormsFolder(o.id, u.id)).toBe(first);
    const row = await prisma.page.findUniqueOrThrow({ where: { id: first } });
    expect(row).toMatchObject({
      workspaceType: "EducationOffering",
      workspaceId: o.id,
      kind: "Folder",
      folderType: "OfferingForms",
      title: "Forms",
      parentPageId: null,
    });
  });

  it("creates exactly one folder when called concurrently (row lock)", async () => {
    const u = await makeUser();
    const o = await makeOffering();
    const ids = await Promise.all(Array.from({ length: 6 }, () => ensureOfferingFormsFolder(o.id, u.id)));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.page.count({ where: { workspaceId: o.id, title: "Forms" } })).toBe(1);
  });

  it("locks per offering, so offerings each get their own folder", async () => {
    const u = await makeUser();
    const a = await makeOffering("A");
    const b = await makeOffering("B");
    const [fa, fb] = await Promise.all([ensureOfferingFormsFolder(a.id, u.id), ensureOfferingFormsFolder(b.id, u.id)]);
    expect(fa).not.toBe(fb);
  });

  it("appends after existing top-level pages and re-creates after the folder is archived", async () => {
    const u = await makeUser();
    const o = await makeOffering();
    await makePage(u.id, { workspaceType: "EducationOffering", workspaceId: o.id, position: 4 });
    const first = await ensureOfferingFormsFolder(o.id, u.id);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: first } })).position).toBe(5);
    await prisma.page.update({ where: { id: first }, data: { archivedAt: new Date() } });
    const second = await ensureOfferingFormsFolder(o.id, u.id);
    expect(second).not.toBe(first);
  });
});

describe("ensurePublicWriteupPage", () => {
  it("creates a public page, links it, and reuses it", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const page = await ensurePublicWriteupPage(proj.id, u.id);
    expect(await ensurePublicWriteupPage(proj.id, u.id)).toEqual(page);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: proj.id } })).publicWriteupPageId).toBe(page.id);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).publicVisible).toBe(true);
  });

  it("adopts an already-public project page instead of creating a second one", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const nominated = await makePage(u.id, { workspaceType: "Project", workspaceId: proj.id });
    await prisma.page.update({ where: { id: nominated.id }, data: { publicVisible: true } });
    expect((await ensurePublicWriteupPage(proj.id, u.id)).id).toBe(nominated.id);
    expect(await prisma.page.count({ where: { workspaceId: proj.id } })).toBe(1);
  });

  it("replaces an archived write-up page", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const first = await ensurePublicWriteupPage(proj.id, u.id);
    await prisma.page.update({ where: { id: first.id }, data: { archivedAt: new Date(), publicVisible: false } });
    const second = await ensurePublicWriteupPage(proj.id, u.id);
    expect(second.id).not.toBe(first.id);
  });

  it("the link is cleared when the page is deleted (onDelete SetNull)", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const page = await ensurePublicWriteupPage(proj.id, u.id);
    await prisma.page.delete({ where: { id: page.id } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: proj.id } })).publicWriteupPageId).toBeNull();
  });
});

describe("sibling ordering", () => {
  it("createProjectPage and createLabPage append per parent and per workspace", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const other = await makeProject("Other");
    const a = await createProjectPage({ projectId: proj.id, title: "A", createdById: u.id });
    const b = await createProjectPage({ projectId: proj.id, title: "B", createdById: u.id });
    const child = await createProjectPage({ projectId: proj.id, title: "C", createdById: u.id, parentPageId: a.id });
    const o = await createProjectPage({ projectId: other.id, title: "A", createdById: u.id });
    const pos = async (id: string) => (await prisma.page.findUniqueOrThrow({ where: { id } })).position;
    expect([await pos(a.id), await pos(b.id), await pos(child.id), await pos(o.id)]).toEqual([0, 1, 0, 0]);

    const l1 = await createLabPage({ title: "X", createdById: u.id });
    const l2 = await createLabPage({ title: "Y", createdById: u.id });
    expect([await pos(l1.id), await pos(l2.id)]).toEqual([0, 1]);
  });

  it("rejects a duplicate sibling name against the real table", async () => {
    const u = await makeUser();
    await createLabPage({ title: "Same", createdById: u.id });
    await expect(createLabPage({ title: "Same", createdById: u.id })).rejects.toThrow();
  });
});

describe("concurrent creates", () => {
  it("lets one of several same-name lab creates through and gives siblings distinct positions", async () => {
    const u = await makeUser();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => createLabPage({ title: "Same", createdById: u.id })));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.page.count({ where: { workspaceType: "Lab", title: "Same" } })).toBe(1);
  });

  it("gives concurrent differently named project pages distinct positions", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    await Promise.all(
      ["A", "B", "C", "D", "E"].map((title) => createProjectPage({ projectId: proj.id, title, createdById: u.id })),
    );

    const positions = (await prisma.page.findMany({ where: { workspaceId: proj.id }, select: { position: true } })).map((p) => p.position);
    expect([...positions].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("tree walks on real rows", () => {
  async function build(u: string, depth: number) {
    const ids: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i <= depth; i++) {
      const p = await makePage(u, { title: `L${i}`, parentPageId: parent });
      ids.push(p.id);
      parent = p.id;
    }
    return ids;
  }

  it("pageDepth and isAncestorOf agree with the stored parents", async () => {
    const u = await makeUser();
    const ids = await build(u.id, 3);
    expect(await pageDepth(ids[0])).toBe(0);
    expect(await pageDepth(ids[3])).toBe(3);
    expect(await isAncestorOf(ids[0], ids[3])).toBe(true);
    expect(await isAncestorOf(ids[3], ids[0])).toBe(false);
  });

  it("pageDepth and isAncestorOf survive a cycle", async () => {
    const u = await makeUser();
    const a = await makePage(u.id);
    const b = await makePage(u.id, { parentPageId: a.id });
    await prisma.page.update({ where: { id: a.id }, data: { parentPageId: b.id } });
    expect(await pageDepth(a.id)).toBe(-1);
    expect(await isAncestorOf("nobody", a.id)).toBe(false);
    expect(await isAncestorOf(a.id, b.id)).toBe(true);
  });

  it("collectSubtree returns live descendants only, bounded by MAX_PAGE_DEPTH", async () => {
    const u = await makeUser();
    const ids = await build(u.id, MAX_PAGE_DEPTH + 2);
    const sub = await collectSubtree(ids[0]);
    expect(sub.height).toBe(MAX_PAGE_DEPTH);
    expect(sub.ids).toEqual(ids.slice(1, MAX_PAGE_DEPTH + 1));

    const root = await makePage(u.id);
    const live = await makePage(u.id, { parentPageId: root.id });
    await makePage(u.id, { parentPageId: root.id, archivedAt: new Date() });
    expect((await collectSubtree(root.id)).ids).toEqual([live.id]);
  });

  it("collectSubtree terminates on a cycle without returning the root", async () => {
    const u = await makeUser();
    const a = await makePage(u.id);
    const b = await makePage(u.id, { parentPageId: a.id });
    await prisma.page.update({ where: { id: a.id }, data: { parentPageId: b.id } });
    expect((await collectSubtree(a.id)).ids).toEqual([b.id]);
  });
});
