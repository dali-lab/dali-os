import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { MAX_PAGE_DEPTH } from "~/lib/pages";
import {
  chainDepth,
  chainGoverningScope,
  chainHasAncestor,
  loadAncestorChain,
  loadAncestorChains,
} from "~/lib/page-ancestry.server";
import { makePage, makeProject, makeUser } from "./integration-fixtures.docs";

async function chainOf(userId: string, depth: number) {
  const ids: string[] = [];
  let parent: string | null = null;
  for (let i = 0; i <= depth; i++) {
    const p = await makePage(userId, { title: `L${i}`, parentPageId: parent });
    ids.push(p.id);
    parent = p.id;
  }
  return ids; // root first
}

describe("loadAncestorChain", () => {
  it("returns the page then each ancestor, nearest first", async () => {
    const u = await makeUser();
    const [root, mid, leaf] = await chainOf(u.id, 2);
    const chain = await loadAncestorChain(leaf);
    expect(chain.map((r) => r.id)).toEqual([leaf, mid, root]);
    expect(chain[2].parentPageId).toBeNull();
  });

  it("is empty for an unknown id and a single row for a root", async () => {
    const u = await makeUser();
    expect(await loadAncestorChain("nope")).toEqual([]);
    const root = await makePage(u.id);
    expect((await loadAncestorChain(root.id)).map((r) => r.id)).toEqual([root.id]);
  });

  it("carries workspace, kind, archive and scope columns for the access check", async () => {
    const u = await makeUser();
    const proj = await makeProject();
    const folder = await makePage(u.id, {
      kind: "Folder",
      workspaceType: "Project",
      workspaceId: proj.id,
      scopeKind: "Lab",
      archivedAt: new Date("2026-01-01"),
    });
    const [row] = await loadAncestorChain(folder.id);
    expect(row).toMatchObject({
      workspaceType: "Project",
      workspaceId: proj.id,
      kind: "Folder",
      scopeKind: "Lab",
      createdById: u.id,
    });
    expect(row.archivedAt).toEqual(new Date("2026-01-01"));
  });

  it("ends a cyclic chain at the row cap instead of recursing forever", async () => {
    const u = await makeUser();
    const a = await makePage(u.id, { title: "A" });
    const b = await makePage(u.id, { title: "B", parentPageId: a.id });
    await prisma.page.update({ where: { id: a.id }, data: { parentPageId: b.id } });
    const chain = await loadAncestorChain(a.id);
    expect(chain.length).toBe(MAX_PAGE_DEPTH + 3);
    expect(chainDepth(chain)).toBe(-1);
  });

  it("feeds the pure helpers real answers", async () => {
    const u = await makeUser();
    const ids = await chainOf(u.id, 3);
    await prisma.page.update({ where: { id: ids[1] }, data: { scopeKind: "Private" } });
    await prisma.page.update({ where: { id: ids[0] }, data: { scopeKind: "Lab" } });
    const chain = await loadAncestorChain(ids[3]);
    expect(chainDepth(chain)).toBe(3);
    expect(chainHasAncestor(chain, ids[0])).toBe(true);
    expect(chainHasAncestor(chain, "other")).toBe(false);
    expect(chainGoverningScope(chain)?.id).toBe(ids[1]);
  });

  it("reports a runaway-deep chain as -1 and a chain at the maximum depth as its depth", async () => {
    const u = await makeUser();
    const ok = await chainOf(u.id, MAX_PAGE_DEPTH);
    expect(chainDepth(await loadAncestorChain(ok[MAX_PAGE_DEPTH]))).toBe(MAX_PAGE_DEPTH);
    const deep = await chainOf(u.id, MAX_PAGE_DEPTH + 5);
    expect(chainDepth(await loadAncestorChain(deep[deep.length - 1]))).toBe(-1);
  });
});

describe("loadAncestorChains", () => {
  it("keys each chain by its start id, sharing ancestors without mixing", async () => {
    const u = await makeUser();
    const [root, mid, leafA] = await chainOf(u.id, 2);
    const leafB = await makePage(u.id, { parentPageId: mid });
    const other = await makePage(u.id);
    const chains = await loadAncestorChains([leafA, leafB.id, other.id]);
    expect(chains.get(leafA)!.map((r) => r.id)).toEqual([leafA, mid, root]);
    expect(chains.get(leafB.id)!.map((r) => r.id)).toEqual([leafB.id, mid, root]);
    expect(chains.get(other.id)!.map((r) => r.id)).toEqual([other.id]);
  });

  it("omits unknown ids, dedupes input, and handles empty input", async () => {
    const u = await makeUser();
    const p = await makePage(u.id);
    const chains = await loadAncestorChains([p.id, p.id, "missing"]);
    expect([...chains.keys()]).toEqual([p.id]);
    expect((await loadAncestorChains([])).size).toBe(0);
  });

  it("caps each chain at maxRows and rejects a non-positive cap", async () => {
    const u = await makeUser();
    const ids = await chainOf(u.id, 4);
    const chains = await loadAncestorChains([ids[4]], 2);
    expect(chains.get(ids[4])!.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    await expect(loadAncestorChains([ids[4]], 0)).rejects.toThrow(/positive integer/);
  });

  it("keeps pages from different workspaces separate and preserves their workspace columns", async () => {
    const u = await makeUser();
    const p1 = await makeProject("One");
    const p2 = await makeProject("Two");
    const a = await makePage(u.id, { workspaceType: "Project", workspaceId: p1.id });
    const b = await makePage(u.id, { workspaceType: "Project", workspaceId: p2.id });
    const chains = await loadAncestorChains([a.id, b.id]);
    expect(chains.get(a.id)![0].workspaceId).toBe(p1.id);
    expect(chains.get(b.id)![0].workspaceId).toBe(p2.id);
    expect(chains.get(a.id)).toHaveLength(1);
  });

  it("includes the sharing and visibility columns the access check reads", async () => {
    const u = await makeUser();
    const p = await makePage(u.id);
    await prisma.page.update({
      where: { id: p.id },
      data: { linkAccess: "LabMembers", linkPermission: "Edit", partnerVisible: true },
    });
    const [row] = (await loadAncestorChains([p.id])).get(p.id)!;
    expect(row).toMatchObject({ linkAccess: "LabMembers", linkPermission: "Edit", partnerVisible: true, profileVisible: false });
  });
});
