import { describe, it, expect } from "vitest";
import {
  flattenFolderTree,
  descendantSetOf,
  type FolderOption,
} from "../folder-tree.shared";

// A(root) > B > D, A > C, E(root) — input name-sorted like the loader's list.
const FIXTURE: FolderOption[] = [
  { id: "A", name: "Alpha", parentId: null },
  { id: "B", name: "Beta", parentId: "A" },
  { id: "C", name: "Gamma", parentId: "A" },
  { id: "D", name: "Delta", parentId: "B" },
  { id: "E", name: "Epsilon", parentId: null },
];

describe("flattenFolderTree", () => {
  it("emits depth-first rows with sibling input order preserved", () => {
    expect(flattenFolderTree(FIXTURE)).toEqual([
      { id: "A", name: "Alpha", depth: 0 },
      { id: "B", name: "Beta", depth: 1 },
      { id: "D", name: "Delta", depth: 2 },
      { id: "C", name: "Gamma", depth: 1 },
      { id: "E", name: "Epsilon", depth: 0 },
    ]);
  });

  it("returns [] for no folders", () => {
    expect(flattenFolderTree([])).toEqual([]);
  });

  it("renders an orphan (unknown parentId) as a root instead of dropping it", () => {
    const rows = flattenFolderTree([
      { id: "X", name: "X", parentId: "ghost" },
      { id: "Y", name: "Y", parentId: null },
    ]);
    expect(rows).toEqual([
      { id: "X", name: "X", depth: 0 },
      { id: "Y", name: "Y", depth: 0 },
    ]);
  });

  it("terminates on cyclic data and keeps every folder", () => {
    const rows = flattenFolderTree([
      { id: "X", name: "X", parentId: "Y" },
      { id: "Y", name: "Y", parentId: "X" },
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual(["X", "Y"]);
  });
});

describe("descendantSetOf", () => {
  it("returns the folder plus its whole subtree", () => {
    expect(descendantSetOf(FIXTURE, "A")).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("returns just the folder for a leaf", () => {
    expect(descendantSetOf(FIXTURE, "D")).toEqual(new Set(["D"]));
  });

  it("returns just the id for an unknown folder", () => {
    expect(descendantSetOf(FIXTURE, "ghost")).toEqual(new Set(["ghost"]));
  });

  it("terminates on cyclic data", () => {
    const cyclic: FolderOption[] = [
      { id: "X", name: "X", parentId: "Y" },
      { id: "Y", name: "Y", parentId: "X" },
    ];
    expect(descendantSetOf(cyclic, "X")).toEqual(new Set(["X", "Y"]));
  });
});
